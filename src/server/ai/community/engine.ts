import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import {
  aiCharacters,
  aiMemories,
  aiRelationships,
  comments,
  communityEvents,
  conversations,
  messages,
  notifications,
  posts,
  reactions,
  user,
} from '@/db/schema';
import { NoProviderError, resolveModel, runObject, runText } from '@/server/ai/core';
import { characterSystemPrompt, commentPrompt, postPrompt, replyPrompt } from '@/server/ai/prompts';
import { getMemories } from '@/server/ai/memory';
import { createImageGenTool } from '@/server/ai/image-tool';
import type { GeneratedImage } from '@/server/ai/image';
import { getCommunityConfig, setSetting } from '@/server/settings';
import { getFriendIds, areFriends } from '@/server/relationships';
import { canCharacterSeeMyPosts } from '@/server/friend-permissions';
import { enqueueEvent, type CommunityEventPayload } from './events';

/* ------------------------------------------------------------------ */
/* Guards & helpers                                                    */
/* ------------------------------------------------------------------ */

const AI_AI_MAX_DEPTH = 2;
/** a character won't be picked for autonomous behavior more than once per N minutes */
const CHARACTER_COOLDOWN_MS = 5 * 60 * 1000;
/** hard cap of AI reactions recorded on one post per event */
const MAX_AI_LIKES_PER_POST = 4;
/** 防无限回复：单条动态 6 小时内 AI 间回复（带父评论）总量上限 */
const MAX_AI_REPLIES_PER_POST = 10;
/** 防无限回复：统计窗口 */
const REPLY_WINDOW_MS = 6 * 60 * 60 * 1000;

function pickWeighted<T>(items: { item: T; weight: number }[]): T | null {
  const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const i of items) {
    r -= Math.max(0, i.weight);
    if (r <= 0) return i.item;
  }
  return items[items.length - 1]?.item ?? null;
}

function interestMatch(interests: string, content: string): number {
  const tags = interests.split(/[,，、;；\s]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
  if (tags.length === 0) return 0.5;
  if (tags.some((t) => content.includes(t))) return 1;
  return 0.4;
}

async function activeCharacters(userId: string) {
  return db
    .select()
    .from(aiCharacters)
    .where(and(eq(aiCharacters.userId, userId), eq(aiCharacters.status, 'active')));
}

async function userName(userId: string) {
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return u?.name ?? '好友';
}

async function touchCharacter(characterId: string) {
  await db
    .update(aiCharacters)
    .set({ lastActiveAt: new Date() })
    .where(eq(aiCharacters.id, characterId));
}

async function insertAiComment(args: {
  postId: string;
  userId: string;
  characterId: string;
  content: string;
  parentCommentId?: string | null;
}) {
  const id = crypto.randomUUID();
  await db.insert(comments).values({
    id,
    postId: args.postId,
    userId: args.userId,
    authorType: 'ai',
    characterId: args.characterId,
    parentCommentId: args.parentCommentId ?? null,
    content: args.content,
  });
  await touchCharacter(args.characterId);
  return id;
}

/* ------------------------------------------------------------------ */
/* Event processing                                                    */
/* ------------------------------------------------------------------ */

/** Claim an event, process it, and mark the result. */
export async function processEvent(eventId: string): Promise<void> {
  const claimed = await db
    .update(communityEvents)
    .set({ status: 'processing', attempts: sql`${communityEvents.attempts} + 1` })
    .where(and(eq(communityEvents.id, eventId), eq(communityEvents.status, 'pending')))
    .returning({ id: communityEvents.id, userId: communityEvents.userId });

  if (claimed.length === 0) return; // already claimed/done

  try {
    const [event] = await db
      .select()
      .from(communityEvents)
      .where(eq(communityEvents.id, eventId))
      .limit(1);
    if (!event) return;

    const payload = JSON.parse(event.payload) as CommunityEventPayload;
    switch (event.type) {
      case 'user_post_created':
        await handleNewPost(event.userId, payload.postId!, 'user');
        break;
      case 'ai_post_created':
        await handleNewPost(event.userId, payload.postId!, 'ai');
        break;
      case 'user_comment_created':
        await handleUserComment(event.userId, payload.postId!, payload.commentId!);
        break;
      case 'ai_comment_created':
        await handleAiCommentChain(event.userId, payload.postId!, payload.commentId!, payload.actorCharacterId!, payload.depth ?? 0);
        break;
      case 'community_pulse':
        await handlePulse(event.userId);
        break;
    }

    await db
      .update(communityEvents)
      .set({ status: 'done', processedAt: new Date(), lastError: null })
      .where(eq(communityEvents.id, eventId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // NoProviderError-like config issues shouldn't be retried endlessly
    const attempts = (await db
      .select({ attempts: communityEvents.attempts })
      .from(communityEvents)
      .where(eq(communityEvents.id, eventId))
      .limit(1))[0]?.attempts ?? 1;

    await db
      .update(communityEvents)
      .set({
        status: attempts >= 3 ? 'failed' : 'pending',
        lastError: message.slice(0, 500),
        ...(attempts < 3 ? { scheduledFor: new Date(Date.now() + 2 * 60 * 1000) } : {}),
      })
      .where(eq(communityEvents.id, eventId));
  }
}

/* ------------------------------------------------------------------ */
/* User / AI post created -> the community reacts                      */
/* ------------------------------------------------------------------ */

async function handleNewPost(userId: string, postId: string, authorType: 'user' | 'ai') {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) return;

  const config = await getCommunityConfig(userId);
  if (!config.enabled) return;

  const authorName =
    authorType === 'user'
      ? await userName(userId)
      : (await db.select().from(aiCharacters).where(eq(aiCharacters.id, post.characterId!)).limit(1))[0]?.name ?? '邻居';

  const characters = await activeCharacters(userId);
  const authorId = authorType === 'ai' ? post.characterId : null;
  let candidates = characters.filter((c) => c.id !== authorId);

  // 朋友圈可见性：AI 之间的动态只有互为好友的居民才能读到；
  // 用户的动态默认对所有居民可见，但被设为「仅聊天」或「不让他看我」的居民读不到
  if (authorType === 'ai' && post.characterId) {
    const friendSet = new Set(await getFriendIds(userId, post.characterId));
    candidates = candidates.filter((c) => friendSet.has(c.id));
  } else if (authorType === 'user') {
    candidates = candidates.filter((c) => canCharacterSeeMyPosts(c));
  }

  // score candidates: personality tendency x interest x recency cooldown
  const now = Date.now();
  const scored = candidates
    .filter((c) => !c.lastActiveAt || now - c.lastActiveAt.getTime() > CHARACTER_COOLDOWN_MS)
    .map((c) => ({
      item: c,
      score:
        c.commentRate * interestMatch(c.interests, post.content) * (0.6 + Math.random() * 0.8),
      c,
    }))
    .sort((a, b) => b.score - a.score);

  const shortlist = scored.slice(0, 6);

  // commenters: top-N weighted by score, bounded by config
  const maxActors = authorType === 'ai' ? Math.min(1, config.maxActorsPerPost) : config.maxActorsPerPost;
  const picked: typeof candidates = [];
  const pool = [...shortlist.map((s) => s.c)];
  while (picked.length < maxActors && pool.length > 0) {
    const chosen = pickWeighted(pool.map((c) => ({ item: c, weight: c.commentRate || 0.1 })));
    if (!chosen) break;
    picked.push(chosen);
    pool.splice(pool.indexOf(chosen), 1);
  }

  // quiet likes: characters that didn't comment may still like the post
  const likers = candidates
    .filter((c) => !picked.some((p) => p.id === c.id))
    .filter((c) => Math.random() < c.likeRate * (authorType === 'ai' ? 0.25 : 0.5))
    .slice(0, MAX_AI_LIKES_PER_POST);
  for (const c of likers) {
    await db
      .insert(reactions)
      .values({
        id: crypto.randomUUID(),
        postId,
        userId,
        authorType: 'ai',
        characterId: c.id,
        type: 'like',
      })
      .onConflictDoNothing();
  }

  const existingComments = await db
    .select()
    .from(comments)
    .where(eq(comments.postId, postId))
    .orderBy(desc(comments.createdAt))
    .limit(5);

  for (const actor of picked) {
    try {
      const schema = z.object({
        act: z.boolean().describe('是否真的要评论'),
        comment: z.string().describe('评论内容，act 为 false 时留空'),
      });
      const memoryOf = await getMemories(actor.id, 6);

      const result = await runObject({
        userId,
        characterId: actor.id,
        callType: 'comment',
        system: characterSystemPrompt(actor, authorName),
        prompt: `「${authorName}」发布了一条动态：

"""
${post.content}
"""
${existingComments.length ? `\n已有的评论：\n${existingComments.map((c) => `- ${c.content}`).join('\n')}` : ''}
${memoryOf.length ? `\n你记得的事：\n${memoryOf.map((m) => `- ${m}`).join('\n')}` : ''}

根据你的性格、兴趣和与对方的关系，决定是否评论。不感兴趣可以 act=false 保持沉默。若评论，1~2 句话，自然口语。`,
        schema,
        temperature: 1,
        maxOutputTokens: 300,
      });

      if (result.act && result.comment.trim()) {
        const commentId = await insertAiComment({
          postId,
          userId,
          characterId: actor.id,
          content: result.comment.trim(),
        });

        if (authorType === 'user') {
          await db.insert(notifications).values({
            id: crypto.randomUUID(),
            userId,
            type: 'comment',
            characterId: actor.id,
            postId,
            content: result.comment.trim(),
          });
        }

        // limited AI <-> AI reply chain
        if (
          (authorType === 'user' || authorType === 'ai') &&
          Math.random() < config.aiReplyChainRate
        ) {
          const replier = candidates.find(
            (c) => c.id !== actor.id && Math.random() < c.commentRate * 0.8,
          );
          if (replier) {
            await enqueueEvent(
              userId,
              'ai_comment_created',
              {
                postId,
                commentId,
                actorCharacterId: actor.id,
                depth: 1,
                dedupeKey: `ai-reply:${commentId}:${replier.id}`,
              },
              { scheduledFor: new Date(Date.now() + 30_000 + Math.random() * 60_000) },
            );
          }
        }
      }
    } catch (err) {
      // one character failing shouldn't block the others
      console.error('[community] actor failed', actor.name, err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* AI responds to a comment (from user or another AI, depth-capped)    */
/* ------------------------------------------------------------------ */

/** 防无限回复：检查单条动态近期 AI 间回复总量，超限则不再继续对话链 */
async function aiReplyBudgetExhausted(userId: string, postId: string): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`CAST(count(*) AS INTEGER)` })
    .from(comments)
    .where(
      and(
        eq(comments.postId, postId),
        eq(comments.authorType, 'ai'),
        isNotNull(comments.parentCommentId),
        gte(comments.createdAt, new Date(Date.now() - REPLY_WINDOW_MS)),
      ),
    );
  return (row?.count ?? 0) >= MAX_AI_REPLIES_PER_POST;
}

/**
 * 被评论/被回复后的响应处理：
 * - 目标评论来自用户（含用户回复 AI 评论的场景）：AI 思考是否回应，回应后通知用户；
 * - 目标评论来自另一个 AI：AI 思考是否回复，回复后把话语权交回对方（depth 递增封顶）。
 */
async function handleAiCommentChain(
  userId: string,
  postId: string,
  commentId: string,
  actorCharacterId: string,
  depth: number,
) {
  if (depth > AI_AI_MAX_DEPTH) return;
  const config = await getCommunityConfig(userId);
  if (!config.enabled) return;

  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  const [target] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!post || !target) return;

  const [actor] = await db
    .select()
    .from(aiCharacters)
    .where(and(eq(aiCharacters.id, actorCharacterId), eq(aiCharacters.status, 'active')))
    .limit(1);
  if (!actor) return;

  // 朋友权限门禁：被设为「仅聊天」或「不让他看我」的居民读不到我的动态
  if (post.authorType === 'user' && !canCharacterSeeMyPosts(actor)) return;

  /* ---------- 目标是用户的评论/回复：AI 决定是否回应用户 ---------- */
  if (target.authorType === 'user') {
    const ownerName = await userName(userId);

    // 用户回复的是某条 AI 评论：提示词中体现"回复了你"的语境
    let repliedToActor = false;
    if (target.parentCommentId) {
      const [parent] = await db
        .select()
        .from(comments)
        .where(eq(comments.id, target.parentCommentId))
        .limit(1);
      repliedToActor = parent?.authorType === 'ai' && parent.characterId === actor.id;
    }

    try {
      const memoryOf = await getMemories(actor.id, 6);
      const result = await runObject({
        userId,
        characterId: actor.id,
        callType: 'reply',
        system: characterSystemPrompt(actor, ownerName),
        prompt: `在动态「${post.content}」下，${ownerName}${repliedToActor ? '回复了你的评论' : '发表了评论'}：

"""
${target.content}
"""
${memoryOf.length ? `\n你记得的事：\n${memoryOf.map((m) => `- ${m}`).join('\n')}` : ''}

以你的口吻决定是否回应，1 句话左右。不感兴趣或没必要就 act=false。`,
        schema: z.object({
          act: z.boolean().describe('是否真的要回复'),
          comment: z.string().describe('回复内容，act 为 false 时留空'),
        }),
        temperature: 1,
        maxOutputTokens: 200,
      });

      if (result.act && result.comment.trim()) {
        await insertAiComment({
          postId,
          userId,
          characterId: actor.id,
          content: result.comment.trim(),
          parentCommentId: target.id,
        });
        await db.insert(notifications).values({
          id: crypto.randomUUID(),
          userId,
          type: 'comment',
          characterId: actor.id,
          postId,
          content: result.comment.trim(),
        });
      }
    } catch (err) {
      console.error('[community] ai reply to user failed', actor.name, err);
    }
    return;
  }

  /* ---------- 目标是另一个 AI 的评论：决定是否回复，并把话语权交回对方 ---------- */
  if (await aiReplyBudgetExhausted(userId, postId)) return;
  if (!target.characterId) return;

  const [replierChar] = await db
    .select()
    .from(aiCharacters)
    .where(eq(aiCharacters.id, target.characterId))
    .limit(1);
  if (!replierChar) return;

  // 我的动态下，另一个 AI 同样需要能看见我的朋友圈才能继续对话链
  if (post.authorType === 'user' && !canCharacterSeeMyPosts(replierChar)) return;

  // 朋友圈好友门禁：非好友的 AI 之间不产生互动（评论/回复链同样受限）
  if (!(await areFriends(userId, actor.id, replierChar.id))) return;

  // relationship awareness between the two AIs
  const rel = await db
    .select()
    .from(aiRelationships)
    .where(
      and(
        eq(aiRelationships.fromCharacterId, actor.id),
        eq(aiRelationships.toCharacterId, replierChar.id),
      ),
    )
    .limit(1);

  try {
    const result = await runObject({
      userId,
      characterId: actor.id,
      callType: 'reply',
      system: characterSystemPrompt(
        actor,
        `${replierChar.name}${rel[0] ? `（你们是${rel[0].kind}）` : ''}`,
      ),
      prompt: `在动态「${post.content}」下，${replierChar.name} 评论了：

"""
${target.content}
"""

以你的口吻回复这条评论，1 句话左右。不想理就 act=false。`,
      schema: z.object({
        act: z.boolean().describe('是否真的要回复'),
        comment: z.string().describe('回复内容，act 为 false 时留空'),
      }),
      temperature: 1,
      maxOutputTokens: 200,
    });

    if (result.act && result.comment.trim()) {
      const replyId = await insertAiComment({
        postId,
        userId,
        characterId: actor.id,
        content: result.comment.trim(),
        parentCommentId: target.id,
      });

      // 对方（AI）也获得一次"是否继续回复"的思考机会；depth 递增封顶防无限循环
      await enqueueEvent(
        userId,
        'ai_comment_created',
        {
          postId,
          commentId: replyId,
          actorCharacterId: replierChar.id,
          depth: depth + 1,
          dedupeKey: `ai-reply:${replyId}:${replierChar.id}`,
        },
        { scheduledFor: new Date(Date.now() + 30_000 + Math.random() * 60_000) },
      );
    }
  } catch (err) {
    console.error('[community] ai-to-ai reply failed', actor.name, err);
  }
}

/* ------------------------------------------------------------------ */
/* User commented -> maybe a small reaction                            */
/* ------------------------------------------------------------------ */

async function handleUserComment(userId: string, postId: string, commentId: string) {
  const config = await getCommunityConfig(userId);
  if (!config.enabled) return;

  const [post] = await db
    .select({ authorType: posts.authorType })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
    .limit(1);

  // 我的动态：只有能看见我朋友圈的居民才会接手互动
  const characters = (await activeCharacters(userId)).filter((c) =>
    post?.authorType === 'user' ? canCharacterSeeMyPosts(c) : true,
  );
  if (characters.length === 0) return;

  const [comment] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);

  // 用户回复了某条 AI 评论：由该 AI 优先响应（有来有回），否则随机挑一个感兴趣的角色
  let candidate: (typeof characters)[number] | null = null;
  if (comment?.parentCommentId) {
    const [parent] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, comment.parentCommentId))
      .limit(1);
    if (parent?.authorType === 'ai' && parent.characterId) {
      candidate = characters.find((c) => c.id === parent.characterId) ?? null;
    }
  }
  if (!candidate) {
    candidate = pickWeighted(
      characters.map((c) => ({ item: c, weight: c.commentRate * 0.4 })),
    );
  }
  if (!candidate) return;

  await enqueueEvent(
    userId,
    'ai_comment_created',
    { postId, commentId, actorCharacterId: candidate.id, depth: 1, dedupeKey: `user-comment:${commentId}:${candidate.id}` },
    { scheduledFor: new Date(Date.now() + 15_000 + Math.random() * 30_000) },
  );
}

/* ------------------------------------------------------------------ */
/* Community pulse: autonomous posts & DMs                             */
/* ------------------------------------------------------------------ */

export async function maybePulse(userId: string): Promise<void> {
  const config = await getCommunityConfig(userId);
  if (!config.enabled) return;

  const last = await db
    .select()
    .from(communityEvents)
    .where(
      and(
        eq(communityEvents.userId, userId),
        eq(communityEvents.type, 'community_pulse'),
        gte(communityEvents.createdAt, new Date(Date.now() - config.pulseIntervalMinutes * 60 * 1000)),
      ),
    )
    .limit(1);
  if (last.length > 0) return;

  await enqueueEvent(userId, 'community_pulse', { dedupeKey: `pulse:${Math.floor(Date.now() / (config.pulseIntervalMinutes * 60 * 1000))}` });
}

async function handlePulse(userId: string) {
  const config = await getCommunityConfig(userId);
  if (!config.enabled) return;

  // remember pulse time for opportunistic triggering from feed loads
  await setSetting(userId, 'last_pulse_at', new Date().toISOString());

  const characters = await activeCharacters(userId);
  if (characters.length === 0) return;
  const ownerName = await userName(userId);

  // 1) autonomous posts (bounded)
  let postsCreated = 0;
  const shuffled = [...characters].sort(() => Math.random() - 0.5);
  for (const c of shuffled) {
    if (postsCreated >= config.maxPostsPerPulse) break;
    if (c.lastActiveAt && Date.now() - c.lastActiveAt.getTime() < CHARACTER_COOLDOWN_MS) continue;
    if (Math.random() > c.postRate) continue;

    try {
      // give the post some grounding: recent community activity
      // （朋友圈可见性：只能"刷到"用户动态和好友居民的动态）
      const recentPosts = await db
        .select({
          content: posts.content,
          authorType: posts.authorType,
          characterId: posts.characterId,
        })
        .from(posts)
        .where(eq(posts.userId, userId))
        .orderBy(desc(posts.createdAt))
        .limit(15);
      const friendSet = new Set(await getFriendIds(userId, c.id));
      const canSeeUserPosts = canCharacterSeeMyPosts(c);
      const visiblePosts = recentPosts
        .filter((p) =>
          p.authorType === 'user'
            ? canSeeUserPosts
            : !!(p.characterId && friendSet.has(p.characterId)),
        )
        .slice(0, 3);
      const context = visiblePosts.length
        ? `社区最近这些动态：\n${visiblePosts.map((p) => `- ${p.content.slice(0, 80)}`).join('\n')}`
        : undefined;

      // AI 生图：配置启用时才注入工具，模型可自主决定是否配图
      const collectedImages: GeneratedImage[] = [];
      const imageTools = await createImageGenTool({
        userId,
        characterId: c.id,
        collected: collectedImages,
      });

      const content = await runText({
        userId,
        characterId: c.id,
        callType: 'post_generation',
        system: characterSystemPrompt(c, ownerName),
        prompt: postPrompt({ context, imageEnabled: Object.keys(imageTools).length > 0 }),
        tools: imageTools,
        maxSteps: 4,
        temperature: 1,
        maxOutputTokens: 400,
      });
      const trimmed = content.trim().replace(/^["「]|["」]$/g, '');
      if (trimmed.length > 0) {
        const postId = crypto.randomUUID();
        const media = collectedImages
          .filter((img) => img.url)
          .slice(0, 9)
          .map((img) => ({ type: 'image' as const, url: img.url, width: img.width, height: img.height }));
        await db.insert(posts).values({
          id: postId,
          userId,
          authorType: 'ai',
          characterId: c.id,
          content: trimmed,
          ...(media.length > 0 ? { media: JSON.stringify(media) } : {}),
        });
        await touchCharacter(c.id);
        postsCreated++;
        await enqueueEvent(userId, 'ai_post_created', { postId, dedupeKey: `ai-post-react:${postId}` });
      }
    } catch (err) {
      console.error('[community] pulse post failed', c.name, err);
    }
  }

  // 2) occasional DM to the user (rare)
  for (const c of shuffled) {
    if (Math.random() > c.dmRate) continue;
    if (c.lastActiveAt && Date.now() - c.lastActiveAt.getTime() < CHARACTER_COOLDOWN_MS * 2) continue;
    try {
      const memories = await getMemories(c.id, 5);

      const content = await runText({
        userId,
        characterId: c.id,
        callType: 'chat',
        system: characterSystemPrompt(c, ownerName),
        prompt: `你忽然想主动私聊 ${ownerName} 一下。结合你们的关系和你记得的事，写一条自然的第一句话（1~2 句）。不要问"在吗"。直接输出内容。
${memories.length ? `\n你记得的事：\n${memories.map((m) => `- ${m}`).join('\n')}` : ''}`,
        temperature: 1,
        maxOutputTokens: 200,
      });

      const trimmed = content.trim();
      if (!trimmed) continue;

      let [conv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.userId, userId), eq(conversations.characterId, c.id)))
        .limit(1);
      if (!conv) {
        const convId = crypto.randomUUID();
        await db.insert(conversations).values({ id: convId, userId, characterId: c.id });
        [conv] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, convId))
          .limit(1);
      }

      await db.insert(messages).values({
        id: crypto.randomUUID(),
        conversationId: conv.id,
        userId,
        role: 'assistant',
        content: trimmed,
      });
      await db
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, conv.id));
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        userId,
        type: 'dm',
        characterId: c.id,
        conversationId: conv.id,
        content: trimmed,
      });
      await touchCharacter(c.id);
      break; // at most one DM per pulse
    } catch (err) {
      console.error('[community] pulse dm failed', c.name, err);
    }
  }
}

/** Process all due pending events for a user (used by cron & opportunistic tick). */
export async function processDueEvents(userId: string, limit = 5) {
  const due = await db
    .select({ id: communityEvents.id })
    .from(communityEvents)
    .where(
      and(
        eq(communityEvents.userId, userId),
        eq(communityEvents.status, 'pending'),
        sql`${communityEvents.scheduledFor} <= unixepoch('subsec') * 1000`,
        ne(communityEvents.attempts, 3),
      ),
    )
    .orderBy(communityEvents.scheduledFor)
    .limit(limit);

  for (const e of due) {
    await processEvent(e.id);
  }
}
