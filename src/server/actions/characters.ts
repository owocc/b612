'use server';

import { and, desc, eq, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { aiCharacters, aiMemories, aiRelationships } from '@/db/schema';
import { requireUserId } from '@/lib/session';
import { deleteFromBlobStorage } from '@/server/media';
import { summarizeDailyMemoriesForSingleCharacter } from '@/server/ai/nightly-memory';
const characterSchema = z.object({
  name: z.string().trim().min(1, '名字必填').max(30),
  username: z
    .string()
    .trim()
    .min(2, 'Username 至少 2 个字符')
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username 只能包含字母、数字和下划线'),
  bio: z.string().trim().max(200).default(''),
  avatarUrl: z.string().trim().max(500).optional().nullable(),
  avatarEmoji: z.string().trim().max(8).default('🙂'),
  avatarColor: z.string().trim().max(20).default('violet'),
  persona: z.string().trim().max(3000).default(''),
  personality: z.string().trim().max(200).default(''),
  interests: z.string().trim().max(200).default(''),
  expressionStyle: z.string().trim().max(500).default(''),
  relationshipToUser: z.string().trim().max(100).default('朋友'),
  systemPrompt: z.string().trim().max(4000).optional().nullable(),
  status: z.enum(['active', 'paused']).default('active'),
  chattiness: z.coerce.number().min(0).max(1).default(0.5),
  likeRate: z.coerce.number().min(0).max(1).default(0.5),
  commentRate: z.coerce.number().min(0).max(1).default(0.4),
  postRate: z.coerce.number().min(0).max(1).default(0.15),
  dmRate: z.coerce.number().min(0).max(1).default(0.05),
  memoryRetention: z.enum(['excellent', 'normal', 'slightly_forgetful', 'forgetful']).default('normal'),
  grudgeRate: z.coerce.number().min(0).max(1).default(0.3),
  providerId: z.string().trim().optional().nullable(),
  modelId: z.string().trim().max(120).optional().nullable(),
  temperature: z.coerce.number().min(0).max(2).optional().nullable(),
  topP: z.coerce.number().min(0).max(1).optional().nullable(),
  maxTokens: z.coerce.number().int().min(50).max(16000).optional().nullable(),
});

export type CharacterInput = z.input<typeof characterSchema>;

export async function createCharacter(input: CharacterInput) {
  const userId = await requireUserId();
  const parsed = characterSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '创建失败' };
  }
  const id = crypto.randomUUID();
  try {
    await db.insert(aiCharacters).values({
      id,
      userId,
      ...parsed.data,
      avatarUrl: parsed.data.avatarUrl || null,
      systemPrompt: parsed.data.systemPrompt || null,
      providerId: parsed.data.providerId || null,
      modelId: parsed.data.modelId || null,
    });
  } catch {
    return { error: 'Username 已被占用' };
  }
  revalidatePath('/characters');
  return { ok: true, id };
}

export async function updateCharacter(id: string, input: CharacterInput) {
  const userId = await requireUserId();
  const parsed = characterSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '保存失败' };
  }
  try {
    await db
      .update(aiCharacters)
      .set({
        ...parsed.data,
        avatarUrl: parsed.data.avatarUrl || null,
        systemPrompt: parsed.data.systemPrompt || null,
        providerId: parsed.data.providerId || null,
        modelId: parsed.data.modelId || null,
        updatedAt: new Date(),
      })
      .where(and(eq(aiCharacters.id, id), eq(aiCharacters.userId, userId)));
  } catch {
    return { error: 'Username 已被占用' };
  }
  revalidatePath('/characters');
  revalidatePath(`/characters/${id}`);
  return { ok: true };
}

export async function setCharacterStatus(id: string, status: 'active' | 'paused') {
  const userId = await requireUserId();
  await db
    .update(aiCharacters)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(aiCharacters.id, id), eq(aiCharacters.userId, userId)));
  revalidatePath('/characters');
  return { ok: true };
}

const friendSettingsSchema = z.object({
  friendPermission: z.enum(['feed_and_chat', 'chat_only']),
  hideMyPostsFromThem: z.boolean(),
  hideTheirPostsFromMe: z.boolean(),
});

export type FriendSettingsInput = z.input<typeof friendSettingsSchema>;

/**
 * 保存某个居民的朋友权限 / 朋友圈状态。
 * 仅聊天时朋友圈已关闭，两个开关会被服务端归一为 false，避免残留脏状态。
 */
export async function updateCharacterFriendSettings(id: string, input: FriendSettingsInput) {
  const userId = await requireUserId();
  const parsed = friendSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '保存失败' };
  }

  const [character] = await db
    .select({ id: aiCharacters.id })
    .from(aiCharacters)
    .where(and(eq(aiCharacters.id, id), eq(aiCharacters.userId, userId)))
    .limit(1);
  if (!character) return { error: '居民不存在' };

  const isChatOnly = parsed.data.friendPermission === 'chat_only';
  try {
    await db
      .update(aiCharacters)
      .set({
        friendPermission: parsed.data.friendPermission,
        hideMyPostsFromThem: isChatOnly ? false : parsed.data.hideMyPostsFromThem,
        hideTheirPostsFromMe: isChatOnly ? false : parsed.data.hideTheirPostsFromMe,
        updatedAt: new Date(),
      })
      .where(and(eq(aiCharacters.id, id), eq(aiCharacters.userId, userId)));
  } catch {
    return { error: '保存失败，请稍后重试' };
  }

  revalidatePath('/feed');
  revalidatePath('/characters');
  revalidatePath(`/characters/${id}`);
  revalidatePath(`/feed/${id}`);
  return { ok: true };
}

export async function deleteCharacter(id: string) {
  const userId = await requireUserId();
  const [char] = await db
    .select({ avatarUrl: aiCharacters.avatarUrl })
    .from(aiCharacters)
    .where(and(eq(aiCharacters.id, id), eq(aiCharacters.userId, userId)))
    .limit(1);

  if (char?.avatarUrl) {
    await deleteFromBlobStorage(char.avatarUrl);
  }

  await db.delete(aiCharacters).where(and(eq(aiCharacters.id, id), eq(aiCharacters.userId, userId)));
  revalidatePath('/characters');
  return { ok: true };
}

const relationshipSchema = z.object({
  fromCharacterId: z.string().min(1),
  toCharacterId: z.string().min(1),
  kind: z.string().trim().min(1, '关系类型必填').max(30),
  note: z.string().trim().max(200).optional().nullable(),
});

export async function setRelationship(input: z.input<typeof relationshipSchema>) {
  const userId = await requireUserId();
  const parsed = relationshipSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '保存失败' };
  }
  if (parsed.data.fromCharacterId === parsed.data.toCharacterId) {
    return { error: '不能和自己建立关系' };
  }

  // verify both characters belong to the user
  const chars = await db
    .select({ id: aiCharacters.id })
    .from(aiCharacters)
    .where(eq(aiCharacters.userId, userId));
  const ids = new Set(chars.map((c) => c.id));
  if (!ids.has(parsed.data.fromCharacterId) || !ids.has(parsed.data.toCharacterId)) {
    return { error: '角色不存在' };
  }

  // 好友关系是双向对等的（互加好友）：
  // 若反向记录已存在则原地更新，避免同一对好友出现两条记录
  const [reverse] = await db
    .select({ id: aiRelationships.id })
    .from(aiRelationships)
    .where(
      and(
        eq(aiRelationships.userId, userId),
        eq(aiRelationships.fromCharacterId, parsed.data.toCharacterId),
        eq(aiRelationships.toCharacterId, parsed.data.fromCharacterId),
      ),
    )
    .limit(1);

  if (reverse) {
    await db
      .update(aiRelationships)
      .set({ kind: parsed.data.kind, note: parsed.data.note || null })
      .where(eq(aiRelationships.id, reverse.id));
    revalidatePath('/characters');
    return { ok: true };
  }

  await db
    .insert(aiRelationships)
    .values({
      id: crypto.randomUUID(),
      userId,
      fromCharacterId: parsed.data.fromCharacterId,
      toCharacterId: parsed.data.toCharacterId,
      kind: parsed.data.kind,
      note: parsed.data.note || null,
    })
    .onConflictDoUpdate({
      target: [aiRelationships.fromCharacterId, aiRelationships.toCharacterId],
      set: { kind: parsed.data.kind, note: parsed.data.note || null },
    });
  revalidatePath('/characters');
  revalidatePath('/characters/relationships');
  revalidatePath('/characters/manage');
  return { ok: true };
}

export async function deleteRelationship(fromCharacterId: string, toCharacterId: string) {
  const userId = await requireUserId();
  // 双向删除：好友关系解除后双方好友列表同时移除
  await db
    .delete(aiRelationships)
    .where(
      and(
        eq(aiRelationships.userId, userId),
        or(
          and(
            eq(aiRelationships.fromCharacterId, fromCharacterId),
            eq(aiRelationships.toCharacterId, toCharacterId),
          ),
          and(
            eq(aiRelationships.fromCharacterId, toCharacterId),
            eq(aiRelationships.toCharacterId, fromCharacterId),
          ),
        ),
      ),
    );
  revalidatePath('/characters');
  revalidatePath('/characters/relationships');
  revalidatePath('/characters/manage');
  return { ok: true };
}

/**
 * Server action: Trigger manual daily memory distillation for a single AI character.
 */
export async function triggerCharacterDailyMemoryAction(characterId: string) {
  const userId = await requireUserId();
  try {
    const result = await summarizeDailyMemoriesForSingleCharacter(userId, characterId, { type: 'manual' });
    // Query fresh memories for this character
    const freshMemories = await db
      .select()
      .from(aiMemories)
      .where(and(eq(aiMemories.characterId, characterId), eq(aiMemories.userId, userId)))
      .orderBy(desc(aiMemories.importance), desc(aiMemories.createdAt))
      .limit(40);

    revalidatePath('/settings/developer');
    revalidatePath(`/characters/${characterId}`);
    revalidatePath('/characters/manage');
    return { ok: true, result, memories: freshMemories };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '总结失败';
    console.error(`[triggerCharacterDailyMemoryAction] failed for ${characterId}:`, err);
    return { ok: false, error: message };
  }
}
