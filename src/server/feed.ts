import { and, desc, eq, isNull, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { aiCharacters, comments, posts, reactions, user } from '@/db/schema';
import { getFeedCover } from '@/server/settings';
import { getFeedHiddenCharacterIds } from '@/server/friend-permissions';

export type PostMedia = {
  type: 'image';
  url: string;
  width: number | null;
  height: number | null;
};

export function parsePostMedia(raw: string | null): PostMedia[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PostMedia[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => m && m.type === 'image' && typeof m.url === 'string').slice(0, 9);
  } catch {
    return [];
  }
}

export type FeedPost = {
  id: string;
  content: string;
  createdAt: Date;
  authorType: 'user' | 'ai';
  characterId: string | null;
  authorName: string;
  authorUsername: string;
  authorAvatarUrl: string | null;
  authorAvatarEmoji: string;
  authorAvatarColor: string;
  likeCount: number;
  commentCount: number;
  viewerLiked: boolean;
  media: PostMedia[];
};

const authorSelect = {
  authorName: sql<string>`CASE WHEN posts.author_type = 'user' THEN (SELECT name FROM "user" WHERE "user".id = posts.user_id) ELSE (SELECT name FROM ai_characters WHERE ai_characters.id = posts.character_id) END`,
  authorUsername: sql<string>`CASE WHEN posts.author_type = 'user' THEN 'me' ELSE (SELECT username FROM ai_characters WHERE ai_characters.id = posts.character_id) END`,
  authorAvatarUrl: sql<string | null>`CASE WHEN posts.author_type = 'user' THEN (SELECT image FROM "user" WHERE "user".id = posts.user_id) ELSE (SELECT avatar_url FROM ai_characters WHERE ai_characters.id = posts.character_id) END`,
  authorAvatarEmoji: sql<string>`CASE WHEN posts.author_type = 'user' THEN '🧑' ELSE (SELECT avatar_emoji FROM ai_characters WHERE ai_characters.id = posts.character_id) END`,
  authorAvatarColor: sql<string>`CASE WHEN posts.author_type = 'user' THEN 'violet' ELSE (SELECT avatar_color FROM ai_characters WHERE ai_characters.id = posts.character_id) END`,
};

function basePostQuery(viewerUserId: string) {
  return db
    .select({
      id: posts.id,
      content: posts.content,
      createdAt: posts.createdAt,
      authorType: posts.authorType,
      characterId: posts.characterId,
      mediaRaw: posts.media,
      likeCount: sql<number>`(SELECT CAST(count(*) AS INTEGER) FROM reactions WHERE reactions.post_id = posts.id)`,
      commentCount: sql<number>`(SELECT CAST(count(*) AS INTEGER) FROM comments WHERE comments.post_id = posts.id)`,
      viewerLiked: sql<boolean>`EXISTS (SELECT 1 FROM reactions WHERE reactions.post_id = posts.id AND reactions.user_id = ${viewerUserId} AND reactions.author_type = 'user')`,
      ...authorSelect,
    })
    .from(posts);
}

function withParsedMedia<T extends { mediaRaw: string | null }>(rows: T[]): (Omit<T, 'mediaRaw'> & { media: PostMedia[] })[] {
  return rows.map(({ mediaRaw, ...rest }) => ({ ...rest, media: parsePostMedia(mediaRaw) }));
}
export async function getFeedPosts(
  userId: string,
  limit = 30,
  offset = 0,
  filter?: 'all' | 'mine',
): Promise<FeedPost[]> {
  const conditions = [eq(posts.userId, userId)];
  if (filter === 'mine') {
    conditions.push(eq(posts.authorType, 'user'));
  }
  // 朋友圈可见性：被设为「不看他」/「仅聊天」的居民动态不进入我的朋友圈列表。
  // 过滤发生在查询层，历史动态同样生效，且不删除任何数据（仍可单独查看 TA 的朋友圈）。
  const hiddenCharacterIds = await getFeedHiddenCharacterIds(userId);
  if (hiddenCharacterIds.length > 0) {
    conditions.push(
      or(isNull(posts.characterId), notInArray(posts.characterId, hiddenCharacterIds))!,
    );
  }
  const rows = await basePostQuery(userId)
    .where(and(...conditions))
    .orderBy(desc(posts.createdAt))
    .limit(limit)
    .offset(offset);
  return withParsedMedia(rows) as FeedPost[];
}

/**
 * 单独查看某一个居民的朋友圈。
 * 不受「不看他」/「仅聊天」限制：TA 能发，只是不出现在聚合列表中。
 */
export async function getCharacterFeedPosts(
  userId: string,
  characterId: string,
  limit = 30,
  offset = 0,
): Promise<FeedPost[]> {
  const rows = await basePostQuery(userId)
    .where(
      and(
        eq(posts.userId, userId),
        eq(posts.authorType, 'ai'),
        eq(posts.characterId, characterId),
      ),
    )
    .orderBy(desc(posts.createdAt))
    .limit(limit)
    .offset(offset);
  return withParsedMedia(rows) as FeedPost[];
}

/** 居民朋友圈页需要的资料 + 动态总数 */
export async function getCharacterFeedProfile(userId: string, characterId: string) {
  const [character] = await db
    .select({
      id: aiCharacters.id,
      name: aiCharacters.name,
      username: aiCharacters.username,
      bio: aiCharacters.bio,
      avatarUrl: aiCharacters.avatarUrl,
      avatarEmoji: aiCharacters.avatarEmoji,
      avatarColor: aiCharacters.avatarColor,
      relationshipToUser: aiCharacters.relationshipToUser,
      status: aiCharacters.status,
      friendPermission: aiCharacters.friendPermission,
      hideMyPostsFromThem: aiCharacters.hideMyPostsFromThem,
      hideTheirPostsFromMe: aiCharacters.hideTheirPostsFromMe,
    })
    .from(aiCharacters)
    .where(and(eq(aiCharacters.id, characterId), eq(aiCharacters.userId, userId)))
    .limit(1);
  if (!character) return null;

  const [{ count }] = await db
    .select({ count: sql<number>`CAST(count(*) AS INTEGER)` })
    .from(posts)
    .where(
      and(
        eq(posts.userId, userId),
        eq(posts.authorType, 'ai'),
        eq(posts.characterId, characterId),
      ),
    );

  return { character, postCount: count };
}

export async function getPostById(userId: string, postId: string): Promise<FeedPost | null> {
  const [row] = await basePostQuery(userId)
    .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
    .limit(1);
  if (!row) return null;
  return withParsedMedia([row])[0] as FeedPost;
}

export type CommentView = {
  id: string;
  content: string;
  createdAt: Date;
  parentCommentId: string | null;
  /** 被回复评论的作者名（平铺列表中显示为「回复 @xxx」），顶级评论为 null */
  replyToName: string | null;
  authorType: 'user' | 'ai';
  characterId: string | null;
  authorName: string;
  authorAvatarEmoji: string;
  authorAvatarColor: string;
  authorAvatarUrl: string | null;
};

const commentAuthor = {
  authorName: sql<string>`CASE WHEN comments.author_type = 'user' THEN (SELECT name FROM "user" WHERE "user".id = comments.user_id) ELSE (SELECT name FROM ai_characters WHERE ai_characters.id = comments.character_id) END`,
  authorAvatarEmoji: sql<string>`CASE WHEN comments.author_type = 'user' THEN '🧑' ELSE (SELECT avatar_emoji FROM ai_characters WHERE ai_characters.id = comments.character_id) END`,
  authorAvatarColor: sql<string>`CASE WHEN comments.author_type = 'user' THEN 'violet' ELSE (SELECT avatar_color FROM ai_characters WHERE ai_characters.id = comments.character_id) END`,
  authorAvatarUrl: sql<string | null>`CASE WHEN comments.author_type = 'user' THEN (SELECT image FROM "user" WHERE "user".id = comments.user_id) ELSE (SELECT avatar_url FROM ai_characters WHERE ai_characters.id = comments.character_id) END`,
};

/**
 * 评论按时间平铺返回（非树形）。回复关系仅通过 replyToName 体现（「回复 @谁」）。
 */
export async function getPostComments(
  userId: string,
  postId: string,
): Promise<{ comments: CommentView[] }> {
  const rows = await db
    .select({
      id: comments.id,
      content: comments.content,
      createdAt: comments.createdAt,
      parentCommentId: comments.parentCommentId,
      authorType: comments.authorType,
      characterId: comments.characterId,
      ...commentAuthor,
    })
    .from(comments)
    .where(and(eq(comments.postId, postId), eq(comments.userId, userId)))
    .orderBy(comments.createdAt);

  const nameById = new Map(rows.map((r) => [r.id, r.authorName]));
  const list = rows.map((r) => ({
    ...r,
    replyToName: r.parentCommentId ? nameById.get(r.parentCommentId) ?? null : null,
  })) as CommentView[];

  return { comments: list };
}

export type PostLiker = {
  authorType: 'user' | 'ai';
  characterId: string | null;
  name: string;
  avatarUrl: string | null;
  avatarEmoji: string;
  avatarColor: string;
};

/** 动态的点赞人列表（详情页展示头像墙） */
export async function getPostLikers(userId: string, postId: string): Promise<PostLiker[]> {
  const rows = await db
    .select({
      authorType: reactions.authorType,
      characterId: reactions.characterId,
      userName: user.name,
      userImage: user.image,
      characterName: aiCharacters.name,
      characterAvatarUrl: aiCharacters.avatarUrl,
      characterAvatarEmoji: aiCharacters.avatarEmoji,
      characterAvatarColor: aiCharacters.avatarColor,
    })
    .from(reactions)
    .leftJoin(user, and(eq(reactions.authorType, 'user'), eq(user.id, reactions.userId)))
    .leftJoin(
      aiCharacters,
      and(eq(reactions.authorType, 'ai'), eq(aiCharacters.id, reactions.characterId)),
    )
    .where(and(eq(reactions.postId, postId), eq(reactions.userId, userId)))
    .orderBy(reactions.createdAt);

  return rows.map((r) => ({
    authorType: r.authorType as 'user' | 'ai',
    characterId: r.characterId,
    name: r.authorType === 'user' ? r.userName ?? '用户' : r.characterName ?? '居民',
    avatarUrl: r.authorType === 'user' ? r.userImage : r.characterAvatarUrl,
    avatarEmoji: r.authorType === 'user' ? '🧑' : r.characterAvatarEmoji ?? '🙂',
    avatarColor: r.authorType === 'user' ? 'violet' : r.characterAvatarColor ?? 'violet',
  }));
}

export async function getActiveCharacterCount(userId: string) {
  const [{ count }] = await db
    .select({ count: sql<number>`CAST(count(*) AS INTEGER)` })
    .from(aiCharacters)
    .where(and(eq(aiCharacters.userId, userId), eq(aiCharacters.status, 'active')));
  return count;
}

export async function getUserProfile(userId: string) {
  const [u] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  return u ?? null;
}

export { getFeedCover };
