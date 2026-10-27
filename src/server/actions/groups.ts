'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { aiCharacters, groupMembers, groupMessages, groupReactions, groups } from '@/db/schema';
import { requireUserId } from '@/lib/session';
import { markGroupRead } from '@/server/groups';
import { scheduleGroupMessageAttention } from '@/server/ai/group/attention';
import { tickGroupAttention } from '@/server/ai/group/engine';
import { linkMediaToGroupMessage } from '@/server/media';
import { waitForMediaPerceptions } from '@/server/ai/vision';
import { getVisionConfig } from '@/server/settings';
const createGroupSchema = z.object({
  name: z.string().trim().min(1, '群聊名称必填').max(50, '群聊名称最多 50 字'),
  description: z.string().trim().max(200, '描述最多 200 字').default(''),
  avatarEmoji: z.string().trim().max(8).default('💬'),
  avatarColor: z.string().trim().max(20).default('indigo'),
  characterIds: z.array(z.string()).min(1, '请至少选择一位 AI 居民加入群聊'),
});

/**
 * Create a new group chat with user and selected AI members.
 */
export async function createGroup(input: z.input<typeof createGroupSchema>) {
  const userId = await requireUserId();
  const parsed = createGroupSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '创建失败' };
  }

  const { name, description, avatarEmoji, avatarColor, characterIds } = parsed.data;
  const groupId = crypto.randomUUID();
  const now = new Date();

  // 1. Insert Group record
  await db.insert(groups).values({
    id: groupId,
    userId,
    name,
    description,
    avatarEmoji,
    avatarColor,
    createdBy: 'user',
    lastMessageAt: now,
    lastMessagePreview: '群聊已创建',
    createdAt: now,
    updatedAt: now,
  });

  // 2. Insert User Member
  const userMemberId = crypto.randomUUID();
  await db.insert(groupMembers).values({
    id: userMemberId,
    groupId,
    userId,
    memberType: 'user',
    role: 'owner',
    joinedAt: now,
    lastReadAt: now,
    createdAt: now,
    updatedAt: now,
  });

  // 3. Insert AI Members
  for (const charId of characterIds) {
    const memId = crypto.randomUUID();
    await db.insert(groupMembers).values({
      id: memId,
      groupId,
      userId,
      memberType: 'ai',
      characterId: charId,
      role: 'member',
      joinedAt: now,
      lastReadAt: null, // New member: hasn't read yet
      nextCheckAt: new Date(now.getTime() + Math.random() * 60 * 1000), // Staggered check
      createdAt: now,
      updatedAt: now,
    });
  }

  // 4. Insert System Welcome Message
  const sysMsgId = crypto.randomUUID();
  await db.insert(groupMessages).values({
    id: sysMsgId,
    groupId,
    userId,
    senderType: 'system',
    content: `群聊「${name}」已创建，快和大家打个招呼吧！`,
    createdAt: now,
  });

  // 5. Trigger initial attention check for members in background
  after(async () => {
    await scheduleGroupMessageAttention(userId, groupId, sysMsgId, null, `群聊「${name}」已创建`);
    await tickGroupAttention(userId, groupId, 2);
  });

  revalidatePath('/groups');
  return { ok: true, groupId };
}

/**
 * Update group basic profile.
 */
export async function updateGroupProfile(
  groupId: string,
  input: { name?: string; description?: string; avatarEmoji?: string; avatarColor?: string },
) {
  const userId = await requireUserId();
  const now = new Date();

  await db
    .update(groups)
    .set({
      name: input.name?.trim(),
      description: input.description?.trim(),
      avatarEmoji: input.avatarEmoji?.trim(),
      avatarColor: input.avatarColor?.trim(),
      updatedAt: now,
    })
    .where(and(eq(groups.id, groupId), eq(groups.userId, userId)));

  revalidatePath(`/groups/${groupId}`);
  revalidatePath('/groups');
  return { ok: true };
}

/**
 * Add AI members to existing group.
 */
export async function addAiMembers(groupId: string, characterIds: string[]) {
  const userId = await requireUserId();
  const now = new Date();

  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.userId, userId)))
    .limit(1);
  if (!group) return { error: '群聊不存在' };

  for (const charId of characterIds) {
    try {
      const memId = crypto.randomUUID();
      await db.insert(groupMembers).values({
        id: memId,
        groupId,
        userId,
        memberType: 'ai',
        characterId: charId,
        role: 'member',
        joinedAt: now,
        lastReadAt: null,
        nextCheckAt: new Date(now.getTime() + 10 * 1000),
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // Ignore if already member
    }
  }

  // Fetch character names for system notice
  const chars = await db
    .select({ name: aiCharacters.name })
    .from(aiCharacters)
    .where(inArray(aiCharacters.id, characterIds));
  const names = chars.map((c) => c.name).join('、');

  const sysMsgId = crypto.randomUUID();
  await db.insert(groupMessages).values({
    id: sysMsgId,
    groupId,
    userId,
    senderType: 'system',
    content: `${names} 加入了群聊`,
    createdAt: now,
  });

  after(async () => {
    await scheduleGroupMessageAttention(userId, groupId, sysMsgId, null, `${names} 加入了群聊`);
  });

  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}

/**
 * Remove an AI member from group.
 */
export async function removeAiMember(groupId: string, characterId: string) {
  const userId = await requireUserId();
  const now = new Date();

  const [character] = await db
    .select({ name: aiCharacters.name })
    .from(aiCharacters)
    .where(eq(aiCharacters.id, characterId))
    .limit(1);

  await db
    .delete(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.characterId, characterId),
      ),
    );

  const charName = character?.name || '某成员';
  await db.insert(groupMessages).values({
    id: crypto.randomUUID(),
    groupId,
    userId,
    senderType: 'system',
    content: `${charName} 退出了群聊`,
    createdAt: now,
  });

  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}

/**
 * Leave group as user.
 */
export async function leaveGroup(groupId: string) {
  const userId = await requireUserId();
  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));

  revalidatePath('/groups');
  return { ok: true };
}

const sendMessageSchema = z.object({
  content: z.string().trim().max(2000, '单条消息最多 2000 字').default(''),
  mediaAssetIds: z.array(z.string()).optional().default([]),
  replyToMessageId: z.string().optional().nullable(),
  mentions: z
    .array(
      z.object({
        type: z.enum(['user', 'ai']),
        id: z.string(),
        name: z.string(),
        username: z.string(),
      }),
    )
    .optional(),
}).refine((data) => data.content.trim().length > 0 || data.mediaAssetIds.length > 0, {
  message: '发送内容不能为空',
});
/**
 * Send a message to group as human user.
 * Immediately records message and dispatches attention to AI group members.
 */
export async function sendGroupMessage(groupId: string, input: z.input<typeof sendMessageSchema>) {
  const userId = await requireUserId();
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '发送失败' };
  }

  const { content, mediaAssetIds = [], replyToMessageId, mentions = [] } = parsed.data;
  const now = new Date();
  const msgId = crypto.randomUUID();
  const effectiveContent = content.trim() || (mediaAssetIds.length > 0 ? '[图片]' : '');

  // 1. Insert message
  await db.insert(groupMessages).values({
    id: msgId,
    groupId,
    userId,
    senderType: 'user',
    content: effectiveContent,
    replyToMessageId: replyToMessageId || null,
    mentions: JSON.stringify(mentions),
    createdAt: now,
  });

  // 1.1 Link media assets
  if (mediaAssetIds.length > 0) {
    await linkMediaToGroupMessage(userId, msgId, mediaAssetIds);
  }
  // 2. Update group metadata
  await db
    .update(groups)
    .set({
      lastMessageAt: now,
      lastMessagePreview: `我: ${content.slice(0, 50)}`,
      updatedAt: now,
    })
    .where(and(eq(groups.id, groupId), eq(groups.userId, userId)));

  // 3. Mark read for user
  await markGroupRead(userId, groupId);

  // 4. Wait for perceptions to complete, then schedule AI attention and trigger fast tick
  after(async () => {
    if (mediaAssetIds.length > 0) {
      const visionCfg = await getVisionConfig(userId);
      if (visionCfg.enabled) {
        await waitForMediaPerceptions(userId, mediaAssetIds, 25000);
      }
    }
    await scheduleGroupMessageAttention(userId, groupId, msgId, null, content, replyToMessageId, mentions);
    // Opportunistically run due events (e.g. fast-path @mentions)
    await tickGroupAttention(userId, groupId, 4);
  });

  revalidatePath(`/groups/${groupId}`);
  return { ok: true, messageId: msgId };
}

/**
 * Toggle emoji reaction on a group message by user.
 */
export async function toggleGroupReaction(groupId: string, messageId: string, emoji: string) {
  const userId = await requireUserId();
  const now = new Date();

  // Check if reaction already exists for user
  const [existing] = await db
    .select({ id: groupReactions.id })
    .from(groupReactions)
    .where(
      and(
        eq(groupReactions.messageId, messageId),
        eq(groupReactions.userId, userId),
        eq(groupReactions.reactorType, 'user'),
        eq(groupReactions.emoji, emoji),
      ),
    )
    .limit(1);

  if (existing) {
    await db.delete(groupReactions).where(eq(groupReactions.id, existing.id));
  } else {
    await db.insert(groupReactions).values({
      id: crypto.randomUUID(),
      groupId,
      messageId,
      userId,
      reactorType: 'user',
      emoji,
      createdAt: now,
    });
  }

  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}

/**
 * Poke an AI member in a group.
 */
export async function pokeGroupMember(groupId: string, characterId: string) {
  const userId = await requireUserId();
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/groups/${groupId}/poke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId }),
  });
  return res.json();
}

/**
 * Mark group read for user.
 */
export async function markGroupAsRead(groupId: string) {
  const userId = await requireUserId();
  await markGroupRead(userId, groupId);
  return { ok: true };
}

/**
 * Trigger group attention tick (called on poll / active session).
 */
export async function tickGroup(groupId?: string) {
  const userId = await requireUserId();
  const result = await tickGroupAttention(userId, groupId, 5);
  return { ok: true, processed: result.processed };
}
