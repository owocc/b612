import { and, asc, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { aiCharacters, groupMembers, groupMessages, groupReactions, groups, user } from '@/db/schema';
import { getMediaForGroupMessages, type MediaAssetView } from '@/server/media';
export type GroupView = {
  id: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  avatarEmoji: string;
  avatarColor: string;
  createdBy: string;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  isPinned: boolean;
  pinnedAt: Date | null;
  isArchived: boolean;
  archivedAt: Date | null;
  memberCount: number;
  memberAvatars: {
    name: string;
    emoji: string;
    color: string;
    isUser: boolean;
  }[];
};

export type GroupMemberView = {
  id: string;
  memberType: 'user' | 'ai';
  characterId: string | null;
  name: string;
  username: string;
  avatarUrl: string | null;
  avatarEmoji: string;
  avatarColor: string;
  bio: string;
  role: string;
  joinedAt: Date;
  lastReadAt: Date | null;
  lastReadMessageId: string | null;
  nextCheckAt: Date | null;
  status: string;
};

export type GroupMessageView = {
  id: string;
  groupId: string;
  senderType: 'user' | 'ai' | 'system';
  senderCharacterId: string | null;
  senderName: string;
  senderUsername: string;
  senderAvatarEmoji: string;
  senderAvatarColor: string;
  senderAvatarUrl: string | null;
  content: string;
  attachments: MediaAssetView[];
  replyTo: {
    id: string;
    senderName: string;
    content: string;
  } | null;
  mentions: {
    type: 'user' | 'ai';
    id: string;
    name: string;
    username: string;
  }[];
  reactions: {
    emoji: string;
    count: number;
    reactors: { type: string; id: string; name: string }[];
    hasReacted: boolean;
  }[];
  createdAt: Date;
};

/**
 * Get all groups for a user with unread counts and member previews.
 */
export async function getGroups(userId: string): Promise<GroupView[]> {
  // 1. Fetch user's group memberships
  const userMemberships = await db
    .select({
      groupId: groupMembers.groupId,
      lastReadAt: groupMembers.lastReadAt,
      isPinned: groupMembers.isPinned,
      pinnedAt: groupMembers.pinnedAt,
      isArchived: groupMembers.isArchived,
      archivedAt: groupMembers.archivedAt,
      isHidden: groupMembers.isHidden,
      hiddenAt: groupMembers.hiddenAt,
    })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.memberType, 'user')));

  if (userMemberships.length === 0) return [];

  const groupIds = userMemberships.map((m) => m.groupId);
  const membershipMap = new Map(userMemberships.map((m) => [m.groupId, m]));

  // 2. Fetch group details
  const groupRows = await db
    .select()
    .from(groups)
    .where(and(eq(groups.userId, userId), inArray(groups.id, groupIds)))
    .orderBy(desc(groups.lastMessageAt), desc(groups.updatedAt));

  // 3. Fetch all members for these groups
  const allMembers = await db
    .select({
      groupId: groupMembers.groupId,
      memberType: groupMembers.memberType,
      characterId: groupMembers.characterId,
      name: aiCharacters.name,
      emoji: aiCharacters.avatarEmoji,
      color: aiCharacters.avatarColor,
    })
    .from(groupMembers)
    .leftJoin(aiCharacters, eq(groupMembers.characterId, aiCharacters.id))
    .where(inArray(groupMembers.groupId, groupIds));

  // Group members by groupId
  const membersByGroup = new Map<string, typeof allMembers>();
  for (const m of allMembers) {
    const list = membersByGroup.get(m.groupId) ?? [];
    list.push(m);
    membersByGroup.set(m.groupId, list);
  }

  // 4. Calculate unread count for each group
  const results: GroupView[] = [];

  for (const g of groupRows) {
    const mem = membershipMap.get(g.id);
    // 软删除仅隐藏会话；群内出现新消息（last_message_at 晚于 hidden_at）后自动恢复
    if (
      mem?.isHidden &&
      (!g.lastMessageAt || !mem.hiddenAt || g.lastMessageAt.getTime() <= mem.hiddenAt.getTime())
    ) {
      continue;
    }
    let unreadCount = 0;

    if (mem?.lastReadAt) {
      const [unreadRes] = await db
        .select({ count: sql<number>`CAST(count(*) AS INTEGER)` })
        .from(groupMessages)
        .where(
          and(
            eq(groupMessages.groupId, g.id),
            gt(groupMessages.createdAt, new Date(mem.lastReadAt)),
            ne(groupMessages.senderType, 'user'),
          ),
        );
      unreadCount = unreadRes?.count ?? 0;
    } else {
      const [unreadRes] = await db
        .select({ count: sql<number>`CAST(count(*) AS INTEGER)` })
        .from(groupMessages)
        .where(and(eq(groupMessages.groupId, g.id), ne(groupMessages.senderType, 'user')));
      unreadCount = unreadRes?.count ?? 0;
    }

    const members = membersByGroup.get(g.id) ?? [];
    const memberAvatars = members.slice(0, 5).map((m) => ({
      name: m.memberType === 'user' ? '我' : m.name || 'AI',
      emoji: m.memberType === 'user' ? '👤' : m.emoji || '🙂',
      color: m.memberType === 'user' ? 'violet' : m.color || 'indigo',
      isUser: m.memberType === 'user',
    }));

    results.push({
      id: g.id,
      name: g.name,
      description: g.description || '',
      avatarUrl: g.avatarUrl,
      avatarEmoji: g.avatarEmoji || '💬',
      avatarColor: g.avatarColor || 'indigo',
      createdBy: g.createdBy,
      lastMessageAt: g.lastMessageAt ? new Date(g.lastMessageAt) : null,
      lastMessagePreview: g.lastMessagePreview,
      unreadCount,
      isPinned: mem?.isPinned ?? false,
      pinnedAt: mem?.pinnedAt ? new Date(mem.pinnedAt) : null,
      isArchived: mem?.isArchived ?? false,
      archivedAt: mem?.archivedAt ? new Date(mem.archivedAt) : null,
      memberCount: members.length,
      memberAvatars,
    });
  }

  return results;
}

/**
 * Get detailed info about a specific group and its members.
 */
export async function getGroupDetails(
  userId: string,
  groupId: string,
): Promise<{ group: typeof groups.$inferSelect; members: GroupMemberView[] } | null> {
  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.userId, userId)))
    .limit(1);

  if (!group) return null;

  const [humanUser] = await db
    .select({ name: user.name, email: user.email, image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  const memberRows = await db
    .select({
      member: groupMembers,
      character: aiCharacters,
    })
    .from(groupMembers)
    .leftJoin(aiCharacters, eq(groupMembers.characterId, aiCharacters.id))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.joinedAt));

  const members: GroupMemberView[] = memberRows.map(({ member, character }) => {
    const isUser = member.memberType === 'user';
    return {
      id: member.id,
      memberType: member.memberType as 'user' | 'ai',
      characterId: member.characterId,
      name: isUser ? humanUser?.name || '我' : character?.name || '未知居民',
      username: isUser ? 'me' : character?.username || 'ai',
      avatarUrl: isUser ? humanUser?.image ?? null : character?.avatarUrl ?? null,
      avatarEmoji: isUser ? '👤' : character?.avatarEmoji || '🙂',
      avatarColor: isUser ? 'violet' : character?.avatarColor || 'indigo',
      bio: isUser ? '社区创世者 / 真人用户' : character?.bio || '',
      role: member.role,
      joinedAt: new Date(member.joinedAt),
      lastReadAt: member.lastReadAt ? new Date(member.lastReadAt) : null,
      lastReadMessageId: member.lastReadMessageId,
      nextCheckAt: member.nextCheckAt ? new Date(member.nextCheckAt) : null,
      status: isUser ? 'active' : character?.status || 'active',
    };
  });

  return { group, members };
}

/**
 * Get messages in a group with reply quotes and reactions.
 */
export async function getGroupMessages(
  userId: string,
  groupId: string,
  limit = 80,
): Promise<GroupMessageView[]> {
  const [humanUser] = await db
    .select({ name: user.name, image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const userName = humanUser?.name || '我';

  // Fetch messages
  const msgRows = await db
    .select({
      msg: groupMessages,
      char: aiCharacters,
    })
    .from(groupMessages)
    .leftJoin(aiCharacters, eq(groupMessages.senderCharacterId, aiCharacters.id))
    .where(eq(groupMessages.groupId, groupId))
    .orderBy(asc(groupMessages.createdAt))
    .limit(limit);

  if (msgRows.length === 0) return [];

  const msgIds = msgRows.map((r) => r.msg.id);
  const msgMap = new Map(msgRows.map((r) => [r.msg.id, r]));
  const mediaMap = await getMediaForGroupMessages(msgIds);
  // Fetch reactions
  const rxRows = await db
    .select({
      reaction: groupReactions,
      char: aiCharacters,
    })
    .from(groupReactions)
    .leftJoin(aiCharacters, eq(groupReactions.characterId, aiCharacters.id))
    .where(inArray(groupReactions.messageId, msgIds));

  // Map reactions by messageId
  const rxByMsg = new Map<string, typeof rxRows>();
  for (const rx of rxRows) {
    const list = rxByMsg.get(rx.reaction.messageId) ?? [];
    list.push(rx);
    rxByMsg.set(rx.reaction.messageId, list);
  }

  return msgRows.map(({ msg, char }) => {
    const isUser = msg.senderType === 'user';
    const senderName = isUser ? userName : char?.name || 'AI 居民';
    const senderUsername = isUser ? 'me' : char?.username || 'ai';
    const senderAvatarEmoji = isUser ? '👤' : char?.avatarEmoji || '🙂';
    const senderAvatarColor = isUser ? 'violet' : char?.avatarColor || 'indigo';
    const senderAvatarUrl = isUser ? humanUser?.image ?? null : char?.avatarUrl ?? null;

    let replyTo: GroupMessageView['replyTo'] = null;
    if (msg.replyToMessageId) {
      const parent = msgMap.get(msg.replyToMessageId);
      if (parent) {
        const pSender = parent.msg.senderType === 'user' ? userName : parent.char?.name || '某人';
        replyTo = {
          id: parent.msg.id,
          senderName: pSender,
          content: parent.msg.content.slice(0, 60),
        };
      }
    }

    let parsedMentions: GroupMessageView['mentions'] = [];
    try {
      if (msg.mentions) parsedMentions = JSON.parse(msg.mentions);
    } catch {
      parsedMentions = [];
    }

    // Aggregate reactions for this message
    const msgRx = rxByMsg.get(msg.id) ?? [];
    const emojiMap = new Map<
      string,
      { emoji: string; count: number; reactors: { type: string; id: string; name: string }[]; hasReacted: boolean }
    >();

    for (const { reaction, char: rxChar } of msgRx) {
      const emoji = reaction.emoji;
      const reactorIsUser = reaction.reactorType === 'user';
      const reactorName = reactorIsUser ? userName : rxChar?.name || 'AI';
      const reactorId = reactorIsUser ? userId : reaction.characterId || '';

      const entry = emojiMap.get(emoji) ?? {
        emoji,
        count: 0,
        reactors: [],
        hasReacted: false,
      };

      entry.count++;
      entry.reactors.push({ type: reaction.reactorType, id: reactorId, name: reactorName });
      if (reactorIsUser) entry.hasReacted = true;

      emojiMap.set(emoji, entry);
    }

    return {
      id: msg.id,
      groupId: msg.groupId,
      senderType: msg.senderType as 'user' | 'ai' | 'system',
      senderCharacterId: msg.senderCharacterId,
      senderName,
      senderUsername,
      senderAvatarEmoji,
      senderAvatarColor,
      senderAvatarUrl,
      content: msg.content,
      attachments: mediaMap.get(msg.id) ?? [],
      replyTo,
      mentions: parsedMentions,
      reactions: Array.from(emojiMap.values()),
      createdAt: new Date(msg.createdAt),
    };
  });
}

/**
 * Mark a group as unread for the human user (pure metadata change, no agent turn).
 */
export async function markGroupUnread(userId: string, groupId: string): Promise<void> {
  const [latest] = await db
    .select({ createdAt: groupMessages.createdAt })
    .from(groupMessages)
    .where(and(eq(groupMessages.groupId, groupId), ne(groupMessages.senderType, 'user')))
    .orderBy(desc(groupMessages.createdAt))
    .limit(1);

  await db
    .update(groupMembers)
    .set({
      lastReadAt: latest ? new Date(latest.createdAt.getTime() - 1) : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.memberType, 'user'),
      ),
    );
}

/**
 * Mark a group as read for the human user.
 */
export async function markGroupRead(userId: string, groupId: string): Promise<void> {
  const now = new Date();
  const [latest] = await db
    .select({ id: groupMessages.id })
    .from(groupMessages)
    .where(eq(groupMessages.groupId, groupId))
    .orderBy(desc(groupMessages.createdAt))
    .limit(1);

  await db
    .update(groupMembers)
    .set({
      lastReadAt: now,
      lastReadMessageId: latest?.id ?? null,
      // 打开群聊即视为恢复可见（软删除后重新进入也能回到列表）
      isHidden: false,
      hiddenAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        eq(groupMembers.memberType, 'user'),
      ),
    );
}

/**
 * Total unread group messages for user across all groups.
 */
export async function totalUnreadGroupMessages(userId: string): Promise<number> {
  const groupsList = await getGroups(userId);
  return groupsList.reduce((acc, g) => acc + g.unreadCount, 0);
}
