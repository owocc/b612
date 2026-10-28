import { getConversations } from '@/server/chat';
import { getGroups } from '@/server/groups';

export type UnifiedChatItem = {
  id: string;
  kind: 'dm' | 'group';
  name: string;
  username?: string;
  avatarUrl: string | null;
  avatarEmoji: string;
  avatarColor: string;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  isPinned: boolean;
  /** 置顶时间（epoch ms），用于多个置顶项按置顶时间倒序 */
  pinnedAt: number | null;
  isArchived: boolean;
  archivedAt: number | null;
  // DM specific
  characterId?: string;
  // Group specific
  memberCount?: number;
  href: string;
};

/**
 * Get unified chat list containing both DMs and Group Chats,
 * sorted chronologically by latest message timestamp.
 */
export async function getUnifiedChats(userId: string): Promise<UnifiedChatItem[]> {
  const [conversations, groups] = await Promise.all([
    getConversations(userId),
    getGroups(userId),
  ]);

  const dmItems: UnifiedChatItem[] = conversations.map((c) => ({
    id: c.id,
    kind: 'dm',
    name: c.characterName,
    username: c.characterUsername,
    avatarUrl: c.characterAvatarUrl,
    avatarEmoji: c.characterAvatarEmoji,
    avatarColor: c.characterAvatarColor,
    lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt) : null,
    lastMessagePreview: c.lastMessagePreview,
    unreadCount: c.unreadCount,
    isPinned: c.isPinned,
    pinnedAt: c.pinnedAt ? new Date(c.pinnedAt).getTime() : null,
    isArchived: c.isArchived,
    archivedAt: c.archivedAt ? new Date(c.archivedAt).getTime() : null,
    characterId: c.characterId,
    href: `/messages/${c.id}`,
  }));

  const groupItems: UnifiedChatItem[] = groups.map((g) => ({
    id: g.id,
    kind: 'group',
    name: g.name,
    avatarUrl: g.avatarUrl,
    avatarEmoji: g.avatarEmoji,
    avatarColor: g.avatarColor,
    lastMessageAt: g.lastMessageAt ? new Date(g.lastMessageAt) : null,
    lastMessagePreview: g.lastMessagePreview,
    unreadCount: g.unreadCount,
    isPinned: g.isPinned,
    pinnedAt: g.pinnedAt ? g.pinnedAt.getTime() : null,
    isArchived: g.isArchived,
    archivedAt: g.archivedAt ? g.archivedAt.getTime() : null,
    memberCount: g.memberCount,
    href: `/messages/group/${g.id}`,
  }));

  const all = [...dmItems, ...groupItems];

  // 置顶会话始终在最前（按置顶时间倒序），其余按最新消息时间倒序
  all.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (a.isPinned) {
      const pA = a.pinnedAt ?? 0;
      const pB = b.pinnedAt ?? 0;
      if (pA !== pB) return pB - pA;
    }
    const tA = a.lastMessageAt ? a.lastMessageAt.getTime() : 0;
    const tB = b.lastMessageAt ? b.lastMessageAt.getTime() : 0;
    return tB - tA;
  });

  return all;
}
