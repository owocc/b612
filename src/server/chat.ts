import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { aiCharacters, conversations, messages, notifications } from '@/db/schema';
import { getMediaForMessages, type MediaAssetView } from '@/server/media';
export type ConversationView = {
  id: string;
  characterId: string;
  characterName: string;
  characterUsername: string;
  characterAvatarUrl: string | null;
  characterAvatarEmoji: string;
  characterAvatarColor: string;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  isPinned: boolean;
  pinnedAt: Date | null;
  isArchived: boolean;
  archivedAt: Date | null;
};

export async function getConversations(userId: string): Promise<ConversationView[]> {
  const rows = await db
    .select({
      id: conversations.id,
      characterId: aiCharacters.id,
      characterName: aiCharacters.name,
      characterUsername: aiCharacters.username,
      characterAvatarUrl: aiCharacters.avatarUrl,
      characterAvatarEmoji: aiCharacters.avatarEmoji,
      characterAvatarColor: aiCharacters.avatarColor,
      lastMessageAt: conversations.lastMessageAt,
      lastMessagePreview: sql<
        string | null
      >`(SELECT content FROM messages WHERE messages.conversation_id = conversations.id ORDER BY created_at DESC LIMIT 1)`,
      unreadCount: sql<number>`(SELECT CAST(count(*) AS INTEGER) FROM messages WHERE messages.conversation_id = conversations.id AND messages.role = 'assistant' AND (conversations.last_read_at IS NULL OR messages.created_at > conversations.last_read_at))`,
      isPinned: conversations.isPinned,
      pinnedAt: conversations.pinnedAt,
      isArchived: conversations.isArchived,
      archivedAt: conversations.archivedAt,
    })
    .from(conversations)
    .innerJoin(aiCharacters, eq(conversations.characterId, aiCharacters.id))
    .where(
      and(
        eq(conversations.userId, userId),
        // 软删除仅隐藏会话；收到新消息（last_message_at 晚于 hidden_at）后自动恢复可见
        sql`(${conversations.isHidden} = 0 OR (${conversations.lastMessageAt} IS NOT NULL AND ${conversations.lastMessageAt} > ${conversations.hiddenAt}))`,
      ),
    )
    .orderBy(desc(conversations.lastMessageAt));
  return rows;
}

export async function getConversation(userId: string, conversationId: string) {
  const [row] = await db
    .select({
      id: conversations.id,
      summary: conversations.summary,
      summarizedCount: conversations.summarizedCount,
      character: aiCharacters,
    })
    .from(conversations)
    .innerJoin(aiCharacters, eq(conversations.characterId, aiCharacters.id))
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getConversationByCharacter(userId: string, characterId: string) {
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.characterId, characterId)))
    .limit(1);
  return conv?.id ?? null;
}

export async function getOrCreateConversation(userId: string, characterId: string) {
  const [character] = await db
    .select()
    .from(aiCharacters)
    .where(and(eq(aiCharacters.id, characterId), eq(aiCharacters.userId, userId)))
    .limit(1);
  if (!character) return null;

  const existing = await getConversationByCharacter(userId, characterId);
  if (existing) {
    // 从联系人列表主动发起聊天时，软删除/归档的会话恢复可见
    await db
      .update(conversations)
      .set({ isHidden: false, hiddenAt: null, isArchived: false, archivedAt: null })
      .where(and(eq(conversations.id, existing), eq(conversations.userId, userId)));
    return existing;
  }

  const id = crypto.randomUUID();
  await db.insert(conversations).values({ id, userId, characterId });
  return id;
}

export type ChatMessageRow = {
  id: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  /** text | transfer | red_packet */
  type: string;
  payload: Record<string, unknown> | null;
  usageId: string | null;
  attachments: MediaAssetView[];
  createdAt: Date;
};

function parseMessagePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function getConversationMessages(conversationId: string, limit = 100): Promise<ChatMessageRow[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  const msgIds = rows.map((r) => r.id);
  const mediaMap = await getMediaForMessages(msgIds);

  const list: ChatMessageRow[] = rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    userId: r.userId,
    role: r.role as 'user' | 'assistant',
    content: r.content,
    type: r.type ?? 'text',
    payload: parseMessagePayload(r.payload ?? null),
    usageId: r.usageId,
    attachments: mediaMap.get(r.id) ?? [],
    createdAt: new Date(r.createdAt),
  }));

  return list.reverse();
}
export async function markConversationRead(userId: string, conversationId: string) {
  await db
    .update(conversations)
    // 打开会话即视为恢复可见（软删除后重新进入也能回到列表）
    .set({ lastReadAt: new Date(), isHidden: false, hiddenAt: null })
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  // 打开会话即视为看到消息：同步清除通知中心里该会话的未读通知（Telegram/QQ 逻辑）
  await db
    .update(notifications)
    .set({ read: true })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.conversationId, conversationId),
        eq(notifications.read, false),
      ),
    );
}

/**
 * 将 DM 标记为未读：把已读游标回退到最后一条 AI 消息之前。
 * 纯元数据变更，不触发任何 Agent 调用。
 */
export async function markConversationUnread(userId: string, conversationId: string) {
  const [lastAssistant] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, 'assistant')))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  await db
    .update(conversations)
    .set({
      lastReadAt: lastAssistant ? new Date(lastAssistant.createdAt.getTime() - 1) : null,
    })
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
}

export async function totalUnreadMessages(userId: string) {
  const [row] = await db
    .select({
      count: sql<number>`CAST(count(*) AS INTEGER)`,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.userId, userId),
        eq(messages.role, 'assistant'),
        gt(messages.createdAt, sql`COALESCE(conversations.last_read_at, unixepoch(0) * 1000)`),
        // 已软删除（且没有新消息）的会话不计入未读角标
        sql`(conversations.is_hidden = 0 OR (conversations.last_message_at IS NOT NULL AND conversations.last_message_at > conversations.hidden_at))`,
      ),
    );
  return row?.count ?? 0;
}
