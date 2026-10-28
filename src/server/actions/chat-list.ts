'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { conversations, groupMembers } from '@/db/schema';
import { requireUserId } from '@/lib/session';
import { markConversationRead, markConversationUnread } from '@/server/chat';
import { markGroupRead, markGroupUnread } from '@/server/groups';

export type ChatListKind = 'dm' | 'group';

/**
 * 会话列表操作只改会话元数据：
 * 置顶、归档、已读/未读、软删除都不会写入消息、不会创建 turn，
 * 因此不会触发任何 Agent / 模型调用。
 */

async function updateDm(
  userId: string,
  conversationId: string,
  patch: Partial<typeof conversations.$inferInsert>,
) {
  await db
    .update(conversations)
    .set(patch)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
}

async function updateGroupMembership(
  userId: string,
  groupId: string,
  patch: Partial<typeof groupMembers.$inferInsert>,
) {
  await db
    .update(groupMembers)
    .set(patch)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.memberType, 'user'),
      ),
    );
}

function refreshLists() {
  revalidatePath('/messages', 'layout');
  revalidatePath('/');
}

export async function setChatPinned(kind: ChatListKind, id: string, pinned: boolean) {
  const userId = await requireUserId();
  const now = new Date();
  if (kind === 'dm') {
    await updateDm(userId, id, { isPinned: pinned, pinnedAt: pinned ? now : null });
  } else {
    await updateGroupMembership(userId, id, { isPinned: pinned, pinnedAt: pinned ? now : null });
  }
  refreshLists();
  return { ok: true };
}

export async function setChatArchived(kind: ChatListKind, id: string, archived: boolean) {
  const userId = await requireUserId();
  const now = new Date();
  if (kind === 'dm') {
    await updateDm(userId, id, { isArchived: archived, archivedAt: archived ? now : null });
  } else {
    await updateGroupMembership(userId, id, { isArchived: archived, archivedAt: archived ? now : null });
  }
  refreshLists();
  return { ok: true };
}

export async function setChatRead(kind: ChatListKind, id: string, read: boolean) {
  const userId = await requireUserId();
  if (kind === 'dm') {
    if (read) await markConversationRead(userId, id);
    else await markConversationUnread(userId, id);
  } else if (read) {
    await markGroupRead(userId, id);
  } else {
    await markGroupUnread(userId, id);
  }
  refreshLists();
  return { ok: true };
}

/** 软删除：只隐藏会话，历史消息全部保留；新消息到达后自动回到主列表 */
export async function deleteChat(kind: ChatListKind, id: string) {
  const userId = await requireUserId();
  const now = new Date();
  if (kind === 'dm') {
    await updateDm(userId, id, {
      isHidden: true,
      hiddenAt: now,
      isPinned: false,
      pinnedAt: null,
      isArchived: false,
      archivedAt: null,
    });
  } else {
    await updateGroupMembership(userId, id, {
      isHidden: true,
      hiddenAt: now,
      isPinned: false,
      pinnedAt: null,
      isArchived: false,
      archivedAt: null,
    });
  }
  refreshLists();
  return { ok: true };
}
