import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });
const now = () => sql`(unixepoch('subsec') * 1000)`;

/* ------------------------------------------------------------------ */
/* Better Auth tables (managed by better-auth, modeled with drizzle)  */
/* ------------------------------------------------------------------ */

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: integer('email_verified', { mode: 'boolean' })
    .notNull()
    .default(false),
  image: text('image'),
  bio: text('bio'),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [uniqueIndex('user_email_idx').on(t.email)]);

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  expiresAt: ts('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [uniqueIndex('session_token_idx').on(t.token), index('session_user_idx').on(t.userId)]);

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  /** synthetic issuer, e.g. "local:credential" (better-auth >= 1.7) */
  issuer: text('issuer').notNull().default('local:credential'),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: ts('access_token_expires_at'),
  refreshTokenExpiresAt: ts('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [index('account_user_idx').on(t.userId)]);

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
});

/* ------------------------------------------------------------------ */
/* AI provider / model configuration                                  */
/* ------------------------------------------------------------------ */

export const providerConfigs = sqliteTable('provider_configs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** openai | anthropic | google | deepseek | openai-compatible */
  providerType: text('provider_type').notNull(),
  apiKey: text('api_key').notNull(),
  baseUrl: text('base_url'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [index('provider_configs_user_idx').on(t.userId)]);

export const modelConfigs = sqliteTable('model_configs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  providerId: text('provider_id')
    .notNull()
    .references(() => providerConfigs.id, { onDelete: 'cascade' }),
  /** e.g. "gpt-4o-mini", "claude-sonnet-4-5" */
  modelId: text('model_id').notNull(),
  displayName: text('display_name'),
  /** USD per 1M tokens, used for cost estimation only */
  inputPricePerMTok: real('input_price_per_mtok').notNull().default(0),
  outputPricePerMTok: real('output_price_per_mtok').notNull().default(0),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('model_configs_user_idx').on(t.userId),
  uniqueIndex('model_configs_unique_idx').on(t.providerId, t.modelId),
]);

/* ------------------------------------------------------------------ */
/* AI characters                                                       */
/* ------------------------------------------------------------------ */

export const aiCharacters = sqliteTable('ai_characters', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  username: text('username').notNull(),
  bio: text('bio').notNull().default(''),
  avatarUrl: text('avatar_url'),
  avatarEmoji: text('avatar_emoji').notNull().default('🙂'),
  avatarColor: text('avatar_color').notNull().default('violet'),
  /** long-form persona description */
  persona: text('persona').notNull().default(''),
  /** personality traits, comma separated tags */
  personality: text('personality').notNull().default(''),
  /** interests, comma separated tags */
  interests: text('interests').notNull().default(''),
  /** how they express themselves (style guide) */
  expressionStyle: text('expression_style').notNull().default(''),
  /** relationship with the human owner */
  relationshipToUser: text('relationship_to_user').notNull().default('朋友'),
  /** resolved system prompt (falls back to generated from persona) */
  systemPrompt: text('system_prompt'),
  /** active | paused */
  status: text('status').notNull().default('active'),

  /* 朋友圈（朋友权限）设置：用户对该居民的单向可见性 */
  /** 朋友权限：feed_and_chat（朋友圈和聊天）| chat_only（仅聊天，双方都看不到对方朋友圈） */
  friendPermission: text('friend_permission').notNull().default('feed_and_chat'),
  /** 不让他看我：该居民看不到我发布的朋友圈（也无法与其互动） */
  hideMyPostsFromThem: integer('hide_my_posts_from_them', { mode: 'boolean' })
    .notNull()
    .default(false),
  /** 不看他：我的朋友圈列表不展示该居民的动态（仍可单独查看 TA 的朋友圈） */
  hideTheirPostsFromMe: integer('hide_their_posts_from_me', { mode: 'boolean' })
    .notNull()
    .default(false),

  /* behavior tendencies, 0..1 */
  chattiness: real('chattiness').notNull().default(0.5),
  likeRate: real('like_rate').notNull().default(0.5),
  commentRate: real('comment_rate').notNull().default(0.4),
  postRate: real('post_rate').notNull().default(0.15),
  dmRate: real('dm_rate').notNull().default(0.05),

  /* memory & cognitive traits */
  /** excellent | normal | slightly_forgetful | forgetful */
  memoryRetention: text('memory_retention').notNull().default('normal'),
  /** grudge/emotional retention tendency: 0..1 (higher means holds emotional/negative/conflict memories much tighter) */
  grudgeRate: real('grudge_rate').notNull().default(0.3),
  /* model override (null = inherit user default) */
  providerId: text('provider_id').references(() => providerConfigs.id, { onDelete: 'set null' }),
  modelId: text('model_id'),
  temperature: real('temperature'),
  topP: real('top_p'),
  maxTokens: integer('max_tokens'),

  lastActiveAt: ts('last_active_at'),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [
  index('ai_characters_user_idx').on(t.userId),
  uniqueIndex('ai_characters_username_idx').on(t.userId, t.username),
]);

/** directed AI <-> AI relationship, from one character to another */
export const aiRelationships = sqliteTable('ai_relationships', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  fromCharacterId: text('from_character_id')
    .notNull()
    .references(() => aiCharacters.id, { onDelete: 'cascade' }),
  toCharacterId: text('to_character_id')
    .notNull()
    .references(() => aiCharacters.id, { onDelete: 'cascade' }),
  /** e.g. 好友 | 闺蜜 | 同事 | 室友 | 死对头 … */
  kind: text('kind').notNull().default('朋友'),
  note: text('note'),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('ai_relationships_user_idx').on(t.userId),
  uniqueIndex('ai_relationships_unique_idx').on(t.fromCharacterId, t.toCharacterId),
]);

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  characterId: text('character_id')
    .notNull()
    .references(() => aiCharacters.id, { onDelete: 'cascade' }),
  /** rolling summary of older messages (memory strategy) */
  summary: text('summary'),
  /** number of messages covered by the summary */
  summarizedCount: integer('summarized_count').notNull().default(0),
  lastMessageAt: ts('last_message_at'),
  lastReadAt: ts('last_read_at'),
  /** 会话列表状态（仅元数据，不触碰历史消息） */
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
  pinnedAt: ts('pinned_at'),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
  archivedAt: ts('archived_at'),
  /** 软删除：仅从列表隐藏，历史聊天记录保留 */
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  hiddenAt: ts('hidden_at'),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('conversations_user_idx').on(t.userId),
  uniqueIndex('conversations_user_character_idx').on(t.userId, t.characterId),
]);

export const conversationTurns = sqliteTable('conversation_turns', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  characterId: text('character_id')
    .notNull()
    .references(() => aiCharacters.id, { onDelete: 'cascade' }),
  /** collecting | scheduled | processing | completed | failed */
  status: text('status').notNull().default('collecting'),
  /** quiet window deadline: if no more messages arrive by this time, promote to scheduled */
  scheduledFor: ts('scheduled_for').notNull(),
  /** hard deadline for collecting phase */
  collectDeadline: ts('collect_deadline').notNull(),
  /** optimistic locking / fencing token for generation workers */
  generationId: text('generation_id'),
  /** lease expires at timestamp - prevents long DB locks while allowing recovery */
  leaseExpiresAt: ts('lease_expires_at'),
  /** worker identifier holding the lease */
  lockedBy: text('locked_by'),
  /** retry count */
  retryCount: integer('retry_count').notNull().default(0),
  error: text('error'),
  completedAt: ts('completed_at'),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [
  index('conversation_turns_conv_status_idx').on(t.conversationId, t.status),
  index('conversation_turns_scheduled_idx').on(t.status, t.scheduledFor),
  index('conversation_turns_lease_idx').on(t.status, t.leaseExpiresAt),
]);

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** user | assistant */
  role: text('role').notNull(),
  content: text('content').notNull(),
  /** text | transfer | red_packet（非 text 时 payload 携带结构化数据） */
  type: text('type').notNull().default('text'),
  /** JSON payload：transfer {amount, currency, note}；red_packet {redPacketId, amount, currency, shareCount, greeting} */
  payload: text('payload'),
  /** link message to its conversation turn */
  turnId: text('turn_id').references(() => conversationTurns.id, { onDelete: 'set null' }),
  usageId: text('usage_id'),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('messages_conversation_idx').on(t.conversationId, t.createdAt),
  index('messages_turn_idx').on(t.turnId),
]);

/* ------------------------------------------------------------------ */
/* Wallet（多货币钱包：当前仅启用 New World 平台余额，预留扩展）        */
/* ------------------------------------------------------------------ */

export const walletAccounts = sqliteTable('wallet_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** user | ai */
  ownerType: text('owner_type').notNull(),
  characterId: text('character_id').references(() => aiCharacters.id, { onDelete: 'cascade' }),
  /** 货币类型，当前仅 'nw'（New World 平台余额）；预留数字钱包等扩展 */
  currency: text('currency').notNull().default('nw'),
  /** 余额（最小货币单位，如「分」），避免浮点误差 */
  balance: integer('balance').notNull().default(0),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [
  index('wallet_accounts_user_idx').on(t.userId),
  uniqueIndex('wallet_accounts_unique_idx').on(t.userId, t.ownerType, t.characterId, t.currency),
]);

export const walletTransactions = sqliteTable('wallet_transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id')
    .notNull()
    .references(() => walletAccounts.id, { onDelete: 'cascade' }),
  /** in | out */
  direction: text('direction').notNull(),
  /** system_grant | transfer | red_packet_send | red_packet_claim */
  type: text('type').notNull(),
  /** 金额（正数，最小货币单位） */
  amount: integer('amount').notNull(),
  currency: text('currency').notNull().default('nw'),
  /** 交易后余额快照 */
  balanceAfter: integer('balance_after').notNull(),
  counterpartyType: text('counterparty_type'),
  counterpartyCharacterId: text('counterparty_character_id'),
  counterpartyName: text('counterparty_name'),
  messageId: text('message_id'),
  redPacketId: text('red_packet_id'),
  note: text('note'),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('wallet_transactions_account_idx').on(t.accountId, t.createdAt),
  index('wallet_transactions_user_idx').on(t.userId, t.createdAt),
]);

export const redPackets = sqliteTable('red_packets', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  messageId: text('message_id'),
  currency: text('currency').notNull().default('nw'),
  /** 总金额（最小货币单位） */
  totalAmount: integer('total_amount').notNull(),
  shareCount: integer('share_count').notNull().default(1),
  claimedCount: integer('claimed_count').notNull().default(0),
  claimedAmount: integer('claimed_amount').notNull().default(0),
  /** user | ai */
  senderType: text('sender_type').notNull(),
  senderCharacterId: text('sender_character_id'),
  greeting: text('greeting'),
  /** open | claimed_out | expired */
  status: text('status').notNull().default('open'),
  expiresAt: ts('expires_at'),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('red_packets_user_idx').on(t.userId),
]);

export const transfers = sqliteTable('transfers', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  messageId: text('message_id'),
  currency: text('currency').notNull().default('nw'),
  /** 金额（最小货币单位），发送时即从发送者扣款冻结 */
  amount: integer('amount').notNull(),
  note: text('note'),
  /** user | ai */
  senderType: text('sender_type').notNull(),
  senderCharacterId: text('sender_character_id'),
  /** user | ai */
  recipientType: text('recipient_type').notNull(),
  recipientCharacterId: text('recipient_character_id'),
  /** pending | claimed | expired */
  status: text('status').notNull().default('pending'),
  expiresAt: ts('expires_at'),
  claimedAt: ts('claimed_at'),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('transfers_user_idx').on(t.userId),
  index('transfers_status_idx').on(t.status, t.expiresAt),
]);

export const redPacketClaims = sqliteTable('red_packet_claims', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  redPacketId: text('red_packet_id')
    .notNull()
    .references(() => redPackets.id, { onDelete: 'cascade' }),
  /** 'user' 或 characterId（同一领取者一个红包只能领一次） */
  claimantKey: text('claimant_key').notNull(),
  /** user | ai */
  claimantType: text('claimant_type').notNull(),
  amount: integer('amount').notNull(),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  uniqueIndex('red_packet_claims_unique_idx').on(t.redPacketId, t.claimantKey),
]);

/* ------------------------------------------------------------------ */
/* Group Chat                                                          */
/* ------------------------------------------------------------------ */

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  avatarUrl: text('avatar_url'),
  avatarEmoji: text('avatar_emoji').notNull().default('💬'),
  avatarColor: text('avatar_color').notNull().default('indigo'),
  createdBy: text('created_by').notNull().default('user'),
  lastMessageAt: ts('last_message_at'),
  lastMessagePreview: text('last_message_preview'),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [
  index('groups_user_updated_idx').on(t.userId, t.updatedAt),
]);

export const groupMembers = sqliteTable('group_members', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** user | ai */
  memberType: text('member_type').notNull().default('ai'),
  /** null if memberType === 'user' */
  characterId: text('character_id')
    .references(() => aiCharacters.id, { onDelete: 'cascade' }),
  /** owner | admin | member */
  role: text('role').notNull().default('member'),
  joinedAt: ts('joined_at').notNull().default(now()),
  /** independent reading progress & attention state */
  lastReadMessageId: text('last_read_message_id'),
  lastReadAt: ts('last_read_at'),
  nextCheckAt: ts('next_check_at'),
  /** normal | muted | active | urgent */
  attentionLevel: text('attention_level').notNull().default('normal'),
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
  pinnedAt: ts('pinned_at'),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
  archivedAt: ts('archived_at'),
  /** 软删除：仅从列表隐藏，群聊历史记录保留 */
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  hiddenAt: ts('hidden_at'),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [
  uniqueIndex('group_members_unique_idx').on(t.groupId, t.memberType, t.characterId),
  index('group_members_group_idx').on(t.groupId),
  index('group_members_user_idx').on(t.userId),
  index('group_members_char_idx').on(t.characterId),
  index('group_members_next_check_idx').on(t.nextCheckAt),
]);

export const groupMessages = sqliteTable('group_messages', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** user | ai | system */
  senderType: text('sender_type').notNull(),
  senderCharacterId: text('sender_character_id')
    .references(() => aiCharacters.id, { onDelete: 'set null' }),
  content: text('content').notNull(),
  replyToMessageId: text('reply_to_message_id'),
  /** JSON array of mentioned entities: [{ type: 'user' | 'ai', id: string, name: string, username: string }] */
  mentions: text('mentions').notNull().default('[]'),
  isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
  usageId: text('usage_id'),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('group_messages_group_created_idx').on(t.groupId, t.createdAt),
  index('group_messages_sender_idx').on(t.senderCharacterId),
]);

export const groupReactions = sqliteTable('group_reactions', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .notNull()
    .references(() => groupMessages.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** user | ai */
  reactorType: text('reactor_type').notNull(),
  characterId: text('character_id')
    .references(() => aiCharacters.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('group_reactions_msg_idx').on(t.messageId),
  index('group_reactions_group_idx').on(t.groupId),
  uniqueIndex('group_reactions_unique_idx').on(t.messageId, t.reactorType, t.characterId, t.emoji),
]);

export const groupAttentionEvents = sqliteTable('group_attention_events', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  characterId: text('character_id')
    .notNull()
    .references(() => aiCharacters.id, { onDelete: 'cascade' }),
  /** mention | reply | new_message | topic_affinity | pulse | catchup */
  triggerType: text('trigger_type').notNull(),
  /** priority level: 0 (pulse), 1 (normal message), 2 (reply), 3 (direct @mention) */
  priority: integer('priority').notNull().default(1),
  triggerMessageId: text('trigger_message_id'),
  scheduledFor: ts('scheduled_for').notNull().default(now()),
  /** pending | processing | done | skipped | failed */
  status: text('status').notNull().default('pending'),
  actionTaken: text('action_taken'),
  processedAt: ts('processed_at'),
  dedupeKey: text('dedupe_key'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('group_attention_status_idx').on(t.status, t.scheduledFor),
  index('group_attention_group_char_idx').on(t.groupId, t.characterId),
  index('group_attention_user_idx').on(t.userId),
]);

/* ------------------------------------------------------------------ */
/* Community: posts / comments / reactions                             */
/* ------------------------------------------------------------------ */

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** user | ai */
  authorType: text('author_type').notNull(),
  characterId: text('character_id').references(() => aiCharacters.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  /** future-proof media field: JSON array of { type, url, width, height } */
  media: text('media'),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [index('posts_user_created_idx').on(t.userId, t.createdAt)]);

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  postId: text('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  authorType: text('author_type').notNull(),
  characterId: text('character_id').references(() => aiCharacters.id, { onDelete: 'cascade' }),
  parentCommentId: text('parent_comment_id'),
  content: text('content').notNull(),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [index('comments_post_idx').on(t.postId, t.createdAt)]);

export const reactions = sqliteTable('reactions', {
  id: text('id').primaryKey(),
  postId: text('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  authorType: text('author_type').notNull(),
  characterId: text('character_id').references(() => aiCharacters.id, { onDelete: 'cascade' }),
  /** like | love | haha | ... (extensible) */
  type: text('type').notNull().default('like'),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('reactions_post_idx').on(t.postId),
  uniqueIndex('reactions_unique_idx').on(t.postId, t.userId, t.authorType, t.characterId),
]);

/* ------------------------------------------------------------------ */
/* AI memory                                                           */
/* ------------------------------------------------------------------ */

export const aiMemories = sqliteTable('ai_memories', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  characterId: text('character_id')
    .notNull()
    .references(() => aiCharacters.id, { onDelete: 'cascade' }),
  /** fact | preference | event | grudge | opinion */
  kind: text('kind').notNull().default('fact'),
  /** original or synthesized memory text */
  content: text('content').notNull(),
  /** memory strength: 0.0 ~ 1.0 (decays over time if not reinforced) */
  strength: real('strength').notNull().default(0.6),
  /** confidence score: 0.0 ~ 1.0 (lower means fuzzy, e.g. "我记得好像是...") */
  confidence: real('confidence').notNull().default(0.8),
  /** subjective importance: 0.0 ~ 1.0 */
  importance: real('importance').notNull().default(0.5),
  /** emotional weight: -1.0 (grudge/negative) ~ 1.0 (deeply touched/positive) */
  emotionalWeight: real('emotional_weight').notNull().default(0),
  /** number of times this memory was reinforced / referenced */
  reinforcementCount: integer('reinforcement_count').notNull().default(1),
  /** dm | group | post | comment | direct_interaction */
  sourceType: text('source_type').notNull().default('dm'),
  /** source reference id (groupId, postId, conversationId) */
  sourceId: text('source_id'),
  /** last time this memory was reinforced or recalled */
  lastReinforcedAt: ts('last_reinforced_at').notNull().default(now()),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [
  index('ai_memories_character_idx').on(t.characterId, t.strength, t.lastReinforcedAt),
  index('ai_memories_user_idx').on(t.userId),
]);

/* ------------------------------------------------------------------ */
/* Community event queue (AI behavior engine)                          */
/* ------------------------------------------------------------------ */

export const communityEvents = sqliteTable('community_events', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** user_post_created | user_comment_created | ai_comment_created | community_pulse | ai_dm */
  type: text('type').notNull(),
  /** JSON payload: { postId?, commentId?, actorCharacterId?, depth?, dedupeKey? } */
  payload: text('payload').notNull().default('{}'),
  /** pending | processing | done | failed */
  status: text('status').notNull().default('pending'),
  scheduledFor: ts('scheduled_for').notNull().default(now()),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: ts('created_at').notNull().default(now()),
  processedAt: ts('processed_at'),
}, (t) => [
  index('community_events_status_idx').on(t.status, t.scheduledFor),
  index('community_events_user_idx').on(t.userId),
]);

/* ------------------------------------------------------------------ */
/* Usage tracking                                                      */
/* ------------------------------------------------------------------ */

export const aiUsage = sqliteTable('ai_usage', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  characterId: text('character_id').references(() => aiCharacters.id, { onDelete: 'set null' }),
  /** chat | post_generation | comment | reply | reaction_decision | memory | summary | system */
  callType: text('call_type').notNull(),
  providerType: text('provider_type').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
  reasoningTokens: integer('reasoning_tokens').notNull().default(0),
  costUsd: real('cost_usd'),
  durationMs: integer('duration_ms').notNull().default(0),
  success: integer('success', { mode: 'boolean' }).notNull().default(true),
  errorMessage: text('error_message'),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('ai_usage_user_created_idx').on(t.userId, t.createdAt),
  index('ai_usage_character_idx').on(t.characterId),
]);

/* ------------------------------------------------------------------ */
/* Notifications & settings                                            */
/* ------------------------------------------------------------------ */

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** dm | comment | like | system */
  type: text('type').notNull(),
  characterId: text('character_id').references(() => aiCharacters.id, { onDelete: 'cascade' }),
  postId: text('post_id'),
  conversationId: text('conversation_id'),
  content: text('content').notNull().default(''),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)]);

export const appSettings = sqliteTable('app_settings', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [uniqueIndex('app_settings_unique_idx').on(t.userId, t.key)]);

/* ------------------------------------------------------------------ */
/* Media & Attachments (Vercel Blob + Media Assets)                  */
/* ------------------------------------------------------------------ */

export const mediaAssets = sqliteTable('media_assets', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** image | video | audio | file */
  mediaType: text('media_type').notNull().default('image'),
  blobUrl: text('blob_url').notNull(),
  pathname: text('pathname').notNull(),
  downloadUrl: text('download_url'),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  originalFilename: text('original_filename'),
  width: integer('width'),
  height: integer('height'),
  duration: real('duration'),
  /** pending | ready | orphan | deleted */
  status: text('status').notNull().default('ready'),
  /** avatar | attachment | general */
  purpose: text('purpose').notNull().default('attachment'),
  /** SHA-256 hex digest of the raw file bytes, used for dedup + unique validation */
  contentHash: text('content_hash'),
  /** Semantic image type driving the vision profile: chat | avatar | sticker | general */
  imageType: text('image_type').notNull().default('general'),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [
  index('media_assets_user_idx').on(t.userId),
  index('media_assets_status_created_idx').on(t.status, t.createdAt),
  index('media_assets_pathname_idx').on(t.pathname),
  index('media_assets_hash_idx').on(t.contentHash),
  uniqueIndex('media_assets_hash_type_unique_idx').on(t.userId, t.contentHash, t.imageType),
]);

export const messageAttachments = sqliteTable('message_attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  mediaAssetId: text('media_asset_id')
    .notNull()
    .references(() => mediaAssets.id, { onDelete: 'cascade' }),
  order: integer('order').notNull().default(0),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('message_attachments_msg_idx').on(t.messageId),
  index('message_attachments_asset_idx').on(t.mediaAssetId),
]);

export const groupMessageAttachments = sqliteTable('group_message_attachments', {
  id: text('id').primaryKey(),
  groupMessageId: text('group_message_id')
    .notNull()
    .references(() => groupMessages.id, { onDelete: 'cascade' }),
  mediaAssetId: text('media_asset_id')
    .notNull()
    .references(() => mediaAssets.id, { onDelete: 'cascade' }),
  order: integer('order').notNull().default(0),
  createdAt: ts('created_at').notNull().default(now()),
}, (t) => [
  index('group_message_attachments_msg_idx').on(t.groupMessageId),
  index('group_message_attachments_asset_idx').on(t.mediaAssetId),
]);

export const imagePerceptions = sqliteTable('image_perceptions', {
  id: text('id').primaryKey(),
  mediaAssetId: text('media_asset_id')
    .notNull()
    .references(() => mediaAssets.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** pending | processing | ready | failed */
  status: text('status').notNull().default('pending'),
  providerType: text('provider_type'),
  model: text('model'),
  /** Vision profile applied: general | avatar | sticker */
  profile: text('profile').notNull().default('general'),
  /** System prompt actually used for this perception */
  systemPromptUsed: text('system_prompt_used'),
  /** User/instruction prompt actually used for this perception */
  promptUsed: text('prompt_used'),
  /** 1 when the summary/perception was manually edited by a developer */
  editedByUser: integer('edited_by_user', { mode: 'boolean' }).notNull().default(false),
  /** Natural language summary suitable for direct LLM context injection */
  summary: text('summary'),
  /** Full structured perception JSON string */
  perception: text('perception'),
  /** Extracted OCR text if present */
  ocrText: text('ocr_text'),
  /** Error message if perception failed */
  errorMessage: text('error_message'),
  /** Usage tracking info */
  usageId: text('usage_id'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  costUsd: real('cost_usd'),
  durationMs: integer('duration_ms').notNull().default(0),
  analyzedAt: ts('analyzed_at'),
  createdAt: ts('created_at').notNull().default(now()),
  updatedAt: ts('updated_at').notNull().default(now()),
}, (t) => [
  uniqueIndex('image_perceptions_asset_idx').on(t.mediaAssetId),
  index('image_perceptions_user_idx').on(t.userId),
  index('image_perceptions_status_created_idx').on(t.status, t.createdAt),
]);
