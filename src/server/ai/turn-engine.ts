import { and, asc, desc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import {
  aiCharacters,
  conversations,
  conversationTurns,
  messages,
  notifications,
  user,
} from '@/db/schema';
import { runText, runObject } from './core';
import { characterSystemPrompt, chatMemoryBlock } from './prompts';
import {
  buildChatContext,
  getForgetfulnessProfile,
  maybeSummarizeConversation,
  extractMemories,
} from './memory';
import { createHistoryRecallTool } from './recall';
import { createImageGenTool } from './image-tool';
import type { GeneratedImage } from './image';
import { formatAttachmentPromptBlock, waitForMediaPerceptions } from './vision';
import { getVisionConfig } from '@/server/settings';
import { getMediaForMessages, type MediaAssetView } from '@/server/media';
import { messageAttachments } from '@/db/schema';
import {
  acceptTransfer,
  claimRedPacket,
  createRedPacket,
  createTransfer,
  getFriendListForCharacter,
  getOrCreateWalletAccount,
  getPendingTransfersForCharacter,
  getTransferStatuses,
  getUnclaimedRedPacketsForCharacter,
  getWalletNoticesForCharacter,
  refundExpiredRedPackets,
  WalletError,
  type WalletOwnerType,
} from '@/server/wallet';
import { formatWalletMoney } from '@/lib/wallet-currency';
import type { ModelMessage } from 'ai';

/**
 * Turn configuration constants
 */
export const QUIET_WINDOW_MS = 2500; // 2.5s of no new messages triggers scheduled status
export const MAX_COLLECT_WINDOW_MS = 15000; // 15s max collect duration before forcing scheduled
export const LEASE_DURATION_MS = 60000; // 60s lease for worker execution
export const MAX_MESSAGES_PER_TURN = 4; // Max AI message bubbles per turn to avoid spamming

type FallbackTurnResult = {
  messages: string[];
  claimRedPacketIds: string[];
  acceptTransferIds: string[];
  transferOut: { to: string; amount: number; note: string | null } | null;
  redPacketOut: { to: string; amount: number; shares: number | null; greeting: string | null } | null;
};

/**
 * runText 兜底输出的解析：模型按提示词可能整段输出固定 JSON（常带 ```json 围栏），
 * 这里统一解析成气泡与钱包动作，绝不让原始 JSON 文本落进消息内容。
 */
export function parseFallbackTurnResponse(
  rawText: string,
  valid: { redPacketIds: string[]; transferIds: string[] },
): FallbackTurnResult {
  const result: FallbackTurnResult = {
    messages: [],
    claimRedPacketIds: [],
    acceptTransferIds: [],
    transferOut: null,
    redPacketOut: null,
  };
  const text = rawText.trim();
  if (!text) return result;

  const applyObject = (obj: Record<string, unknown>) => {
    if (Array.isArray(obj.messages)) {
      const bubbles = obj.messages.filter(
        (m): m is string => typeof m === 'string' && m.trim().length > 0,
      );
      if (bubbles.length > 0) result.messages = bubbles.slice(0, MAX_MESSAGES_PER_TURN);
    }
    if (Array.isArray(obj.claim_red_packet_ids)) {
      result.claimRedPacketIds = obj.claim_red_packet_ids.filter(
        (id): id is string => typeof id === 'string' && valid.redPacketIds.includes(id),
      );
    }
    if (Array.isArray(obj.accept_transfer_ids)) {
      result.acceptTransferIds = obj.accept_transfer_ids.filter(
        (id): id is string => typeof id === 'string' && valid.transferIds.includes(id),
      );
    }
    if (obj.transfer_out && typeof obj.transfer_out === 'object') {
      const t = obj.transfer_out as Record<string, unknown>;
      if (typeof t.to === 'string' && typeof t.amount === 'number' && t.amount > 0) {
        result.transferOut = {
          to: t.to,
          amount: t.amount,
          note: typeof t.note === 'string' ? t.note : null,
        };
      }
    }
    if (obj.red_packet_out && typeof obj.red_packet_out === 'object') {
      const r = obj.red_packet_out as Record<string, unknown>;
      if (typeof r.to === 'string' && typeof r.amount === 'number' && r.amount > 0) {
        result.redPacketOut = {
          to: r.to,
          amount: r.amount,
          shares: typeof r.shares === 'number' ? r.shares : 1,
          greeting: typeof r.greeting === 'string' ? r.greeting : '恭喜发财，大吉大利',
        };
      }
    }
  };

  // 1) 优先提取 ```json 围栏块
  let plain = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    plain = (text.slice(0, fence.index ?? 0) + ' ' + text.slice((fence.index ?? 0) + fence[0].length)).trim();
    try {
      applyObject(JSON.parse(fence[1]) as Record<string, unknown>);
    } catch {
      // 围栏内容不是合法 JSON，按普通文本处理
    }
  }

  // 2) 剩余文本整体是 JSON 也尝试解析
  if (result.messages.length === 0 && plain) {
    try {
      applyObject(JSON.parse(plain) as Record<string, unknown>);
      if (result.messages.length > 0) plain = '';
    } catch {
      // 普通文本
    }
  }

  // 3) 剩余普通文本拆成气泡
  if (result.messages.length === 0 && plain) {
    result.messages = plain
      .split(/\n\n+|\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_MESSAGES_PER_TURN);
  }
  return result;
}
export const MAX_RETRY_COUNT = 3; // Max retries before failing a turn

export type TurnStatus = 'collecting' | 'scheduled' | 'processing' | 'completed' | 'failed';

/**
 * Enqueue or append a user message into a ConversationTurn.
 * If there's an active 'collecting' turn, append to it and push the quiet window deadline.
 * If no 'collecting' turn exists (e.g. previous turn is processing or completed), create a new collecting turn.
 */
export async function appendMessageToTurn(args: {
  conversationId: string;
  userId: string;
  characterId: string;
  messageId: string;
}): Promise<{ turnId: string; status: TurnStatus }> {
  const now = new Date();
  const nowMs = now.getTime();

  // Check for an existing collecting turn in this conversation
  const [existingTurn] = await db
    .select()
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.conversationId, args.conversationId),
        eq(conversationTurns.status, 'collecting'),
      ),
    )
    .limit(1);

  if (existingTurn) {
    const collectDeadlineMs = new Date(existingTurn.collectDeadline).getTime();
    // If quiet window is within maximum collection window, extend scheduledFor
    const newScheduledMs = Math.min(nowMs + QUIET_WINDOW_MS, collectDeadlineMs);

    await db
      .update(conversationTurns)
      .set({
        scheduledFor: new Date(newScheduledMs),
        updatedAt: now,
      })
      .where(eq(conversationTurns.id, existingTurn.id));

    // Link message to turn
    await db
      .update(messages)
      .set({ turnId: existingTurn.id })
      .where(eq(messages.id, args.messageId));

    return { turnId: existingTurn.id, status: 'collecting' };
  }

  // Create a brand new collecting turn
  const newTurnId = crypto.randomUUID();
  const scheduledFor = new Date(nowMs + QUIET_WINDOW_MS);
  const collectDeadline = new Date(nowMs + MAX_COLLECT_WINDOW_MS);

  await db.insert(conversationTurns).values({
    id: newTurnId,
    conversationId: args.conversationId,
    userId: args.userId,
    characterId: args.characterId,
    status: 'collecting',
    scheduledFor,
    collectDeadline,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  // Link message to turn
  await db
    .update(messages)
    .set({ turnId: newTurnId })
    .where(eq(messages.id, args.messageId));

  return { turnId: newTurnId, status: 'collecting' };
}

/**
 * Claim and acquire a processing lease on a turn.
 * Uses atomic UPDATE with fencing generationId and expiration check.
 * Returns the acquired turn if successful, or null if another worker claimed it or state changed.
 */
export async function claimTurnLease(
  turnId: string,
  options?: { workerId?: string; force?: boolean },
): Promise<{
  acquired: boolean;
  generationId?: string;
  turn?: typeof conversationTurns.$inferSelect;
}> {
  const workerId = options?.workerId || `worker-${crypto.randomUUID().slice(0, 8)}`;
  const force = options?.force ?? false;
  const now = new Date();
  const nowMs = now.getTime();
  const leaseExpiresAt = new Date(nowMs + LEASE_DURATION_MS);
  const generationId = crypto.randomUUID();

  // Atomically claim turn if:
  // 1. status is 'scheduled' OR 'collecting' (and scheduledFor <= now)
  // 2. OR status is 'processing' but lease has expired (stale recovery)
  const result = await db
    .update(conversationTurns)
    .set({
      status: 'processing',
      generationId,
      leaseExpiresAt,
      lockedBy: workerId,
      updatedAt: now,
    })
    .where(
      and(
        eq(conversationTurns.id, turnId),
        force
          ? sql`1=1`
          : or(
              eq(conversationTurns.status, 'scheduled'),
              and(
                eq(conversationTurns.status, 'collecting'),
                lte(conversationTurns.scheduledFor, now),
              ),
              and(
                eq(conversationTurns.status, 'processing'),
                lt(conversationTurns.leaseExpiresAt, now),
              ),
            ),
      ),
    )
    .returning();
  const claimed = result[0];
  if (!claimed) {
    return { acquired: false };
  }

  return {
    acquired: true,
    generationId,
    turn: claimed,
  };
}

/**
 * Process a single conversation turn:
 * 1. Acquire lease (fencing token generationId)
 * 2. Gather fresh context AT GENERATION TIME:
 *    - Persona, Relationship, Current Time
 *    - Unsummarized recent messages + Current Turn user messages
 *    - Relevant memory + forgetfulness profile + history recall tool
 * 3. Call model to generate 1 to N natural message responses
 * 4. Verify lease validity before committing messages (fencing protection against slow zombie workers)
 * 5. Commit assistant messages, mark turn completed, update conversation timestamp, create notification
 */
export async function processTurn(
  turnId: string,
  options?: { workerId?: string; callerUserId?: string; force?: boolean },
): Promise<{ success: boolean; messageCount?: number; error?: string }> {
  // Step 1: Claim lease
  const claim = await claimTurnLease(turnId, { workerId: options?.workerId, force: options?.force });
  if (!claim.acquired || !claim.turn || !claim.generationId) {
    return { success: false, error: 'Failed to acquire turn lease or turn already claimed' };
  }

  const { turn, generationId } = claim;
  const conversationId = turn.conversationId;
  const userId = turn.userId;
  const characterId = turn.characterId;

  try {
    // Fetch character, conversation and user info
    const [character] = await db
      .select()
      .from(aiCharacters)
      .where(eq(aiCharacters.id, characterId))
      .limit(1);

    if (!character) {
      throw new Error(`Character ${characterId} not found`);
    }

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!conv) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const [userInfo] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    const userName = userInfo?.name || '朋友';

    // Step 2: Build real-time context dynamically
    // Wait for any media perception in recent user messages (only when vision is enabled)
    const visionCfg = await getVisionConfig(userId);
    const turnUserMessages = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.turnId, turnId),
          eq(messages.role, 'user'),
        ),
      )
      .orderBy(asc(messages.createdAt));

    const turnMsgIds = turnUserMessages.map((m) => m.id);
    const mediaMap = await getMediaForMessages(turnMsgIds);
    const allAttachments: MediaAssetView[] = [];
    for (const atts of mediaMap.values()) {
      allAttachments.push(...atts);
    }

    if (visionCfg.enabled && allAttachments.length > 0) {
      await waitForMediaPerceptions(
        userId,
        allAttachments.map((a) => a.id),
        25000,
      );
    }

    // Assemble memory-aware context
    const { recent, memories } = await buildChatContext({
      userId,
      characterId,
      conversationId,
    });

    // 钱包上下文：余额、待领红包（AI 自主决定是否领取）、AI 间到账通知、好友名单
    const moneyContextParts: string[] = [];
    let walletBalance = 0;
    const unclaimedRedPacketIds: string[] = [];
    const pendingTransferIds: string[] = [];
    let friendList: Array<{ id: string; name: string }> = [];
    try {
      const account = await getOrCreateWalletAccount({ userId, ownerType: 'ai', characterId });
      walletBalance = account.balance;

      // 过期未领完的红包先退回，保证上下文里的红包都还可领
      await refundExpiredRedPackets(userId).catch(() => {});

      const unclaimed = await getUnclaimedRedPacketsForCharacter({
        userId,
        conversationId,
        characterId,
      });
      for (const packet of unclaimed) {
        moneyContextParts.push(
          `${userName} 给你发了一个红包还没领：id=${packet.id}，共 ${formatWalletMoney(packet.totalAmount, packet.currency)} / ${packet.shareCount} 份（剩余 ${packet.shareCount - packet.claimedCount} 份），祝福语「${packet.greeting ?? '恭喜发财'}」。是否领取由你决定；过期未领完的部分会退回给对方。`,
        );
        unclaimedRedPacketIds.push(packet.id);
      }

      // 待收款的转账（AI 自主决定是否收款；超时未收退回给对方）
      const pendingTransfers = await getPendingTransfersForCharacter({
        userId,
        conversationId,
        characterId,
      });
      for (const transfer of pendingTransfers) {
        moneyContextParts.push(
          `${userName} 给你转了一笔转账：id=${transfer.id}，金额 ${formatWalletMoney(transfer.amount, transfer.currency)}${transfer.note ? `，备注「${transfer.note}」` : ''}，当前状态为【待你收款】。你可以在本次回复中决定是否收款（将 id 填入 accept_transfer_ids 即可收款），也可以拒绝或暂时不收。请务必在你的回复消息中对这笔转账做出自然的人设反馈（如表示感谢、惊喜、或者推脱等），响应当前转账状态！`,
        );
        pendingTransferIds.push(transfer.id);
      }

      // AI 间好友转账到账通知（用户转账会以消息形式出现在对话里，无需在此重复）
      const notices = await getWalletNoticesForCharacter({ userId, characterId });
      moneyContextParts.push(...notices);

      if (walletBalance > 0) {
        moneyContextParts.push(`你的钱包余额：${formatWalletMoney(walletBalance)}（New World 平台余额）。`);
      }

      friendList = await getFriendListForCharacter({ userId, characterId });
      if (friendList.length > 0) {
        moneyContextParts.push(
          `你的好友：${friendList.map((f) => f.name).join('、')}。你们互为好友，可以通过 transfer_out 直接转账给她们（to 填好友名字）。`,
        );
      }
    } catch (walletErr) {
      console.warn('[turn-engine] wallet context skipped', walletErr);
    }
    const walletBlock = moneyContextParts.length
      ? `\n\n【钱包】\n${moneyContextParts.join('\n')}`
      : '';

    const memoryBlock = chatMemoryBlock(memories, conv.summary);
    const profile = getForgetfulnessProfile(character.memoryRetention);
    const nowStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    const system =
      characterSystemPrompt(character, userName, {
        currentTime: nowStr,
        retentionLabel: profile.label,
      }) +
      (memoryBlock ? `\n\n${memoryBlock}` : '') +
      walletBlock +
      `\n\n【异步即时消息回复规则】
你现在正在微信/即时聊天软件中与 ${userName} 私聊。
对方可能连续给你发送了 1 条或多条消息。请根据你的性格、关系、当前情绪自然组织回复。
要求：
1. 像真人发即时消息一样聊天，可以是一句话，也可以根据语境分成 1~${MAX_MESSAGES_PER_TURN} 条简短连续的气泡消息（例如先吐槽/表达情绪，再回答具体事情，或自然分句）。
2. 不要长篇大论说教，不要把所有回答生硬塞成一个巨型小论文。
3. 请以 JSON 数组格式返回你的消息列表，每条代表一个发送气泡：
\`\`\`json
{
  "messages": [
    "啊？？？",
    "又是昨天那个人？",
    "他是不是有病"
  ]
}
\`\`\`
最多不超过 ${MAX_MESSAGES_PER_TURN} 条。如果没有特殊需要拆分，返回 1~2 条最自然。内容不要带多余的 markdown json 外壳，直接按 schema 生成。
输出为一段固定 JSON，钱包相关字段说明（根据你的性格、当前话题及钱包上下文自主决定，不需要操作时留空或不填）：
- "accept_transfer_ids"：决定收款的转账 id 列表（对应【钱包】上下文里待收款的转账。若对方给你转账，你可以选择在回复中收款，也可以拒绝或暂不收；如果收了款，在回复里可以自然表达感谢或调侃）；
- "claim_red_packet_ids"：决定领取的红包 id 列表（对应【钱包】上下文里待领的红包）；
- "transfer_out"：{"to": "user 或好友名字", "amount": 金额元, "note": "备注"}，主动给当前用户或好友转账（例如还钱、请客、打赏、送零花钱等）；
- "red_packet_out"：{"to": "user", "amount": 金额元, "shares": 份数, "greeting": "祝福语"}，主动给当前用户发红包（例如过节、祝贺、活跃气氛等）。
重要规则：
1. 转账与发红包必须在你当前拥有的钱包余额范围内，单笔金额不超过 N$200。
2. 当收到用户的转账或对方已确认收款时，请在 messages 气泡中根据当前状态自然地给予人设契合的情绪反馈（如收到转账时感谢、惊喜、推辞；对方收款后询问、寒暄或表达开心），明确响应当前的状态，不要假装没看见。
3. 若你执行了转账(transfer_out)或发红包(red_packet_out)，系统会自动生成对应的转账/红包卡片，你的 messages 只需要说你的心里话，不要在文本里手写假卡片格式。`;
    const recallTool = createHistoryRecallTool({
      userId,
      characterId,
      currentConversationId: conversationId,
    });

    // AI 生图工具与能力检测
    const collectedImages: GeneratedImage[] = [];
    const imageToolSet = await createImageGenTool({
      userId,
      characterId,
      collected: collectedImages,
    });
    const hasImageGen = Object.keys(imageToolSet).length > 0;
    const tools = {
      searchHistory: recallTool,
      ...imageToolSet,
    };

    const imageCapabilityBlock = hasImageGen
      ? `\n\n【AI 生图能力】当前系统已支持 AI 生图功能。你拥有 generate_image 工具，当你在与 ${userName} 聊天过程中适合配图（例如你主动分享生活画面、展示看到或创作的内容、发表情包、或对方希望看图）时，你可以自主决定调用 generate_image 工具，并由你自己编写具体的生图提示词（prompt）。调用后图片会自动随你的消息发送给对方。`
      : '';
    const fullSystem = system + imageCapabilityBlock;

    // 获取历史转账状态，注入实时上下文
    const parseMsgPayload = (raw: unknown): Record<string, unknown> => {
      if (!raw) return {};
      if (typeof raw === 'object') return raw as Record<string, unknown>;
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
        } catch {
          return {};
        }
      }
      return {};
    };

    const recentTransferIds: string[] = [];
    for (const m of recent) {
      if (m.type === 'transfer') {
        const p = parseMsgPayload(m.payload);
        if (typeof p.transferId === 'string' && p.transferId) {
          recentTransferIds.push(p.transferId);
        }
      }
    }
    const transferStatusMap = await getTransferStatuses(userId, recentTransferIds);

    // Map recent history into ModelMessage format
    const contextMessages: ModelMessage[] = recent.map((m) => {
      const isAssistant = m.role === 'assistant';
      const isSystem = m.role === 'system';
      const promptBlocks: string[] = [];

      if (visionCfg.enabled && !isAssistant && !isSystem && m.attachments && m.attachments.length > 0) {
        const attachmentBlock = formatAttachmentPromptBlock(m.attachments);
        if (attachmentBlock) promptBlocks.push(attachmentBlock);
      }

      // 转账/红包消息（content 为空或仅祝福语）转成 AI 可读的结构化描述并标注实时状态
      if (m.type === 'transfer') {
        const payload = parseMsgPayload(m.payload);
        const transferId = String(payload.transferId || '');
        const statusInfo = transferStatusMap.get(transferId);
        const status = statusInfo?.status ?? 'pending';
        const statusLabel =
          status === 'claimed'
            ? (isAssistant ? '对方已收款' : '你已收款')
            : status === 'expired'
              ? '已超时退回'
              : (isAssistant ? '待对方收款' : '待你收款');
        const amount = typeof payload.amount === 'number' ? payload.amount : 0;
        const moneyText = `[转账] ${isAssistant ? `你给 ${userName} 转账了` : `${userName} 给你转账了`}${amount ? ` ${formatWalletMoney(amount)}` : ''}（当前状态：${statusLabel}）${typeof payload.note === 'string' && payload.note ? `，备注：${payload.note}` : ''}`;
        promptBlocks.push(moneyText);
      } else if (m.type === 'red_packet') {
        const payload = parseMsgPayload(m.payload);
        const amount = typeof payload.amount === 'number' ? payload.amount : typeof payload.totalAmount === 'number' ? payload.totalAmount : 0;
        const moneyText = `[红包] ${isAssistant ? `你发给 ${userName}` : `${userName} 发给你`}一个红包${typeof payload.greeting === 'string' && payload.greeting ? `「${payload.greeting}」` : ''}${amount ? `，共 ${formatWalletMoney(amount)}` : ''}${typeof payload.shareCount === 'number' ? ` / ${payload.shareCount} 份` : ''}`;
        promptBlocks.push(moneyText);
      }

      if (m.content) {
        if (isSystem) {
          if (m.content.includes('已确认收下了你的转账')) {
            promptBlocks.push(`[系统提示：${m.content}。对方已经成功收款，请根据当前状态自然回应对方（如询问是否收到、表达开心、提醒买点喜欢的等）]`);
          } else {
            promptBlocks.push(`[系统提示：${m.content}。如果之前有没说完的话或对方正在等你的消息，请自然接着回复]`);
          }
        } else {
          promptBlocks.push(m.content);
        }
      }

      return {
        role: isAssistant ? 'assistant' : 'user',
        content: promptBlocks.join('\n\n'),
      };
    });

    // Step 3: Run model generation
    const responseSchema = z.object({
      messages: z
        .array(z.string().trim().min(1))
        .min(1)
        .max(MAX_MESSAGES_PER_TURN)
        .describe('List of separate message bubbles to send in order'),
      claim_red_packet_ids: z
        .array(z.string())
        .max(5)
        .nullable()
        .optional()
        .describe('决定领取的红包 id 列表（不领就不填或留空）'),
      accept_transfer_ids: z
        .array(z.string())
        .max(5)
        .nullable()
        .optional()
        .describe('决定收款的转账 id 列表（不收就不填或留空）'),
      transfer_out: z
        .object({
          to: z.string().describe('转账对象：字面量 "user" 表示当前聊天用户，或直接填好友名字'),
          amount: z.number().min(0.01).max(200),
          note: z.string().max(50).nullable().optional(),
        })
        .nullable()
        .optional()
        .describe('给当前用户或好友发起转账（对方确认收款后到账）'),
      red_packet_out: z
        .object({
          to: z.string().describe('目前仅支持字面量 "user"'),
          amount: z.number().min(0.01).max(200),
          shares: z.number().int().min(1).max(5).nullable().optional(),
          greeting: z.string().max(50).nullable().optional(),
        })
        .nullable()
        .optional()
        .describe('给当前用户发红包'),
    });

    let generatedBubbleTexts: string[] = [];
    let claimRedPacketIds: string[] = [];
    let acceptTransferIds: string[] = [];
    let transferOut: { to: string; amount: number; note: string | null } | null = null;
    let redPacketOut: { to: string; amount: number; shares: number | null; greeting: string | null } | null = null;
    let usageId: string | undefined;

    // 优先调用具备生图工具的对话轮次
    if (hasImageGen) {
      try {
        const rawText = await runText({
          userId,
          characterId,
          callType: 'chat',
          system: fullSystem,
          messages: contextMessages,
          tools,
          maxSteps: 5,
        });

        if (rawText && rawText.trim()) {
          const parsed = parseFallbackTurnResponse(rawText, {
            redPacketIds: unclaimedRedPacketIds,
            transferIds: pendingTransferIds,
          });
          generatedBubbleTexts = parsed.messages;
          claimRedPacketIds = parsed.claimRedPacketIds;
          acceptTransferIds = parsed.acceptTransferIds;
          transferOut = parsed.transferOut;
          redPacketOut = parsed.redPacketOut;
        }
      } catch (toolRunErr) {
        console.warn('[turn-engine] generation with image tool failed, falling back to structured run', toolRunErr);
      }
    }

    if (generatedBubbleTexts.length === 0) {
      try {
        const generated = await runObject({
          userId,
          characterId,
          callType: 'chat',
          system: fullSystem,
          messages: contextMessages,
          schema: responseSchema,
          schemaName: 'TurnResponse',
          schemaDescription: 'Natural chat response broken into separate message bubbles',
          tools,
        });

        generatedBubbleTexts = (generated?.messages || []).filter((t) => t && t.trim().length > 0);
        // 钱包协议（固定 JSON 字段，服务端只认本会话确实有效的 id）
        claimRedPacketIds = (generated?.claim_red_packet_ids ?? []).filter((id: string) =>
          unclaimedRedPacketIds.includes(id),
        );
        acceptTransferIds = (generated?.accept_transfer_ids ?? []).filter((id: string) =>
          pendingTransferIds.includes(id),
        );
        transferOut =
          generated?.transfer_out && generated.transfer_out.amount > 0
            ? {
                to: generated.transfer_out.to ?? 'user',
                amount: generated.transfer_out.amount,
                note: generated.transfer_out.note ?? null,
              }
            : null;
        redPacketOut =
          generated?.red_packet_out && generated.red_packet_out.amount > 0
            ? {
                to: generated.red_packet_out.to ?? 'user',
                amount: generated.red_packet_out.amount,
                shares: generated.red_packet_out.shares ?? 1,
                greeting: generated.red_packet_out.greeting ?? '恭喜发财，大吉大利',
              }
            : null;
      } catch (objErr) {
        // Fallback: If structured generation fails, generate text and split on double newlines
        console.warn('[turn-engine] structured generation fallback to text generation', objErr);
        const rawText = await runText({
          userId,
          characterId,
          callType: 'chat',
          system: fullSystem,
          messages: contextMessages,
          tools,
          maxSteps: 3,
        });

        if (rawText && rawText.trim()) {
          // 模型可能整段输出固定 JSON（常带 ```json 围栏），统一解析，
          // 绝不让原始 JSON 文本落进消息内容
          const parsed = parseFallbackTurnResponse(rawText, {
            redPacketIds: unclaimedRedPacketIds,
            transferIds: pendingTransferIds,
          });
          generatedBubbleTexts = parsed.messages;
          claimRedPacketIds = parsed.claimRedPacketIds;
          acceptTransferIds = parsed.acceptTransferIds;
          transferOut = parsed.transferOut;
          redPacketOut = parsed.redPacketOut;
        }
      }
    }

    if (generatedBubbleTexts.length === 0) {
      generatedBubbleTexts = ['嗯。'];
    }

    // AI 生图结果（由模型在对话中自主调用 generate_image 工具收集生成）
    const chatImage: GeneratedImage | null = collectedImages[0] ?? null;

    // Step 4: Fencing check & Commit messages atomically
    const commitTime = new Date();

    // Verify lease is still ours before writing
    const [currentTurn] = await db
      .select()
      .from(conversationTurns)
      .where(eq(conversationTurns.id, turnId))
      .limit(1);

    if (!currentTurn || currentTurn.generationId !== generationId) {
      console.warn(
        `[turn-engine] Generation ${generationId} for turn ${turnId} discarded due to lease fencing mismatch.`,
      );
      return { success: false, error: 'Fencing check failed - lease was lost or expired' };
    }

    // Write all AI message bubbles
    const createdMsgIds: string[] = [];
    for (let i = 0; i < generatedBubbleTexts.length; i++) {
      const text = generatedBubbleTexts[i];
      const msgId = crypto.randomUUID();
      // Space out timestamps slightly to ensure deterministic ordering
      const msgCreatedAt = new Date(commitTime.getTime() + i * 150);

      await db.insert(messages).values({
        id: msgId,
        conversationId,
        userId,
        role: 'assistant',
        content: text,
        turnId,
        usageId,
        createdAt: msgCreatedAt,
      });
      createdMsgIds.push(msgId);
    }

    // 生图结果挂到最后一条 AI 消息上（复用聊天气泡的附件渲染）
    if (chatImage?.id && createdMsgIds.length > 0) {
      await db.insert(messageAttachments).values({
        id: crypto.randomUUID(),
        messageId: createdMsgIds[createdMsgIds.length - 1],
        mediaAssetId: chatImage.id,
        order: 0,
      });
    }

    // 处理 AI 决定领取的红包 / 决定收款的转账（固定 JSON 字段）
    for (const redPacketId of claimRedPacketIds) {
      try {
        await claimRedPacket({
          userId,
          redPacketId,
          claimant: { ownerType: 'ai', characterId },
        });
      } catch (claimErr) {
        console.warn('[turn-engine] ai claim red packet skipped', redPacketId, claimErr);
      }
    }
    for (const transferId of acceptTransferIds) {
      try {
        await acceptTransfer({
          userId,
          transferId,
          acceptor: { ownerType: 'ai', characterId },
        });
      } catch (acceptErr) {
        console.warn('[turn-engine] ai accept transfer skipped', transferId, acceptErr);
      }
    }

    // 钱包协议：处理主回复固定 JSON 里的 transfer_out / red_packet_out
    //（金额与余额服务端强校验；发红包目前仅面向当前用户；好友转账不产生气泡，
    //  对方会在下回合的「钱包到账通知」里收到金额与备注）
    let moneyMessageDate: Date | null = null;
    const moneyMsgCreatedAt = () => new Date(commitTime.getTime() + generatedBubbleTexts.length * 150 + 150);

    if (transferOut) {
      let target: { ownerType: WalletOwnerType; characterId?: string | null } = { ownerType: 'user' };
      let toUser = transferOut.to === 'user';
      if (!toUser) {
        const friend = friendList.find(
          (f) => f.name === transferOut?.to.trim() || f.id === transferOut?.to.trim(),
        );
        if (!friend) {
          console.warn('[turn-engine] transfer_out friend not found:', transferOut.to);
        } else {
          target = { ownerType: 'ai', characterId: friend.id };
          toUser = false;
        }
      }
      if (toUser || target.ownerType === 'ai') {
        const amountCents = Math.max(1, Math.round(transferOut.amount * 100));
        const moneyMsgId = crypto.randomUUID();
        const moneyCreatedAt = moneyMsgCreatedAt();
        try {
          const { id: newTransferId } = await createTransfer({
            userId,
            from: { ownerType: 'ai', characterId },
            to: target,
            amount: amountCents,
            note: transferOut.note,
            messageId: toUser ? moneyMsgId : null,
          });
          if (toUser) {
            // 给用户的转账要显示一条转账消息（待收款状态）
            await db.insert(messages).values({
              id: moneyMsgId,
              conversationId,
              userId,
              role: 'assistant',
              type: 'transfer',
              payload: JSON.stringify({
                transferId: newTransferId,
                amount: amountCents,
                currency: 'nw',
                note: transferOut.note,
              }),
              content: '',
              turnId,
              createdAt: moneyCreatedAt,
            });
            moneyMessageDate = moneyCreatedAt;
          }
        } catch (sendErr) {
          if (sendErr instanceof WalletError) {
            console.warn('[turn-engine] ai transfer_out skipped:', sendErr.message);
          } else {
            throw sendErr;
          }
        }
      }
    }

    if (redPacketOut && (redPacketOut.to === 'user' || !friendList.some((f) => f.name === redPacketOut?.to))) {
      const amountCents = Math.max(1, Math.round(redPacketOut.amount * 100));
      const moneyMsgId = crypto.randomUUID();
      const moneyCreatedAt = moneyMsgCreatedAt();
      try {
        const { id: redPacketId } = await createRedPacket({
          userId,
          sender: { ownerType: 'ai', characterId },
          totalAmount: amountCents,
          shareCount: redPacketOut.shares ?? 1,
          greeting: redPacketOut.greeting ?? '恭喜发财，大吉大利',
          messageId: moneyMsgId,
        });
        await db.insert(messages).values({
          id: moneyMsgId,
          conversationId,
          userId,
          role: 'assistant',
          type: 'red_packet',
          payload: JSON.stringify({
            redPacketId,
            totalAmount: amountCents,
            currency: 'nw',
            shareCount: redPacketOut.shares ?? 1,
            greeting: redPacketOut.greeting ?? '恭喜发财，大吉大利',
          }),
          content: redPacketOut.greeting ?? '恭喜发财，大吉大利',
          turnId,
          createdAt: moneyCreatedAt,
        });
        moneyMessageDate = moneyCreatedAt;
      } catch (sendErr) {
        if (sendErr instanceof WalletError) {
          console.warn('[turn-engine] red_packet_out skipped:', sendErr.message);
        } else {
          throw sendErr;
        }
      }
    }

    // Update conversation lastMessageAt（金钱消息时间晚于文字气泡）
    let lastMsgDate = new Date(commitTime.getTime() + (generatedBubbleTexts.length - 1) * 150);
    if (moneyMessageDate && moneyMessageDate.getTime() > lastMsgDate.getTime()) {
      lastMsgDate = moneyMessageDate;
    }
    await db
      .update(conversations)
      .set({
        lastMessageAt: lastMsgDate,
      })
      .where(eq(conversations.id, conversationId));

    // Mark Turn completed
    await db
      .update(conversationTurns)
      .set({
        status: 'completed',
        completedAt: lastMsgDate,
        updatedAt: lastMsgDate,
        error: null,
      })
      .where(and(eq(conversationTurns.id, turnId), eq(conversationTurns.generationId, generationId)));

    // Create notification only if the conversation is not already read up to this message
    // (user actively viewing the chat keeps lastReadAt fresh, so no notification needed)
    const previewContent = generatedBubbleTexts.join(' ');
    const [convReadState] = await db
      .select({ lastReadAt: conversations.lastReadAt })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    const alreadySeen =
      convReadState?.lastReadAt != null &&
      new Date(convReadState.lastReadAt).getTime() >= lastMsgDate.getTime();
    if (!alreadySeen) {
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        userId,
        type: 'dm',
        characterId,
        conversationId,
        content: previewContent.slice(0, 100),
        read: false,
        createdAt: lastMsgDate,
      });
    }

    // Step 5: Post-turn memory extraction & summary (asynchronously)
    try {
      const [{ count }] = await db
        .select({ count: sql<number>`CAST(count(*) AS INTEGER)` })
        .from(messages)
        .where(eq(messages.conversationId, conversationId));

      if (count % 8 === 0) {
        await extractMemories({
          userId,
          characterId,
          conversationId,
        }).catch(console.error);
      }
      await maybeSummarizeConversation({ conversationId, userId }).catch(console.error);
    } catch (postErr) {
      console.warn('[turn-engine] post-turn memory/summary update failed', postErr);
    }

    return {
      success: true,
      messageCount: generatedBubbleTexts.length,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[turn-engine] Error processing turn ${turnId}:`, err);

    // Update turn state with error and increment retry count
    const [currentTurn] = await db
      .select({ retryCount: conversationTurns.retryCount })
      .from(conversationTurns)
      .where(eq(conversationTurns.id, turnId))
      .limit(1);

    const retryCount = (currentTurn?.retryCount ?? 0) + 1;
    const shouldFailPermanently = retryCount >= MAX_RETRY_COUNT;

    await db
      .update(conversationTurns)
      .set({
        status: shouldFailPermanently ? 'failed' : 'scheduled',
        retryCount,
        error: errorMsg,
        leaseExpiresAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(conversationTurns.id, turnId));

    return { success: false, error: errorMsg };
  }
}

/**
 * Check and promote collecting turns whose quiet window or max collection window has elapsed.
 */
export async function promoteDueCollectingTurns(limit = 20): Promise<number> {
  const now = new Date();

  // Find collecting turns that are past scheduledFor or collectDeadline
  const dueCollecting = await db
    .select({ id: conversationTurns.id })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.status, 'collecting'),
        or(
          lte(conversationTurns.scheduledFor, now),
          lte(conversationTurns.collectDeadline, now),
        ),
      ),
    )
    .limit(limit);

  if (dueCollecting.length === 0) return 0;

  const ids = dueCollecting.map((t) => t.id);
  await db
    .update(conversationTurns)
    .set({
      status: 'scheduled',
      updatedAt: now,
    })
    .where(inArray(conversationTurns.id, ids));

  return ids.length;
}

/**
 * Process all due turns for a given user or conversation, or globally across active turns.
 */
export async function tickTurns(options?: {
  userId?: string;
  conversationId?: string;
  limit?: number;
}): Promise<{ processed: number; turns: string[] }> {
  const now = new Date();
  const limit = options?.limit ?? 6;

  // 1. Promote any due collecting turns
  await promoteDueCollectingTurns(limit);

  // 2. Find scheduled turns or expired processing turns
  const conditions = [
    or(
      eq(conversationTurns.status, 'scheduled'),
      and(
        eq(conversationTurns.status, 'processing'),
        lt(conversationTurns.leaseExpiresAt, now),
      ),
    ),
  ];

  if (options?.userId) {
    conditions.push(eq(conversationTurns.userId, options.userId));
  }
  if (options?.conversationId) {
    conditions.push(eq(conversationTurns.conversationId, options.conversationId));
  }

  const candidateTurns = await db
    .select({ id: conversationTurns.id, conversationId: conversationTurns.conversationId })
    .from(conversationTurns)
    .where(and(...conditions))
    .orderBy(asc(conversationTurns.scheduledFor))
    .limit(limit);

  const processedIds: string[] = [];

  for (const t of candidateTurns) {
    const res = await processTurn(t.id, { callerUserId: options?.userId });
    if (res.success) {
      processedIds.push(t.id);
    }
  }

  return {
    processed: processedIds.length,
    turns: processedIds,
  };
}

/**
 * Derives current dynamic typing and pending status for a conversation.
 * If a turn is actively collecting, scheduled, or processing under a valid unexpired lease,
 * typing is TRUE. If the lease expired or the turn completed/failed, typing is automatically FALSE.
 */
export async function getConversationTurnState(conversationId: string): Promise<{
  isTyping: boolean;
  status: TurnStatus | 'idle';
  turnId?: string;
  scheduledFor?: Date;
  leaseExpiresAt?: Date;
}> {
  const now = new Date();

  // Look for any active turn in collecting, scheduled, or processing
  const [activeTurn] = await db
    .select()
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.conversationId, conversationId),
        inArray(conversationTurns.status, ['collecting', 'scheduled', 'processing']),
      ),
    )
    .orderBy(desc(conversationTurns.createdAt))
    .limit(1);

  if (!activeTurn) {
    return { isTyping: false, status: 'idle' };
  }

  // If processing, verify lease has not expired
  if (activeTurn.status === 'processing') {
    const isLeaseValid = activeTurn.leaseExpiresAt && new Date(activeTurn.leaseExpiresAt) > now;
    if (isLeaseValid) {
      return {
        isTyping: true,
        status: 'processing',
        turnId: activeTurn.id,
        leaseExpiresAt: new Date(activeTurn.leaseExpiresAt!),
      };
    } else {
      // Lease expired, not currently actively typing (will be recovered on tick)
      return {
        isTyping: false,
        status: 'processing',
        turnId: activeTurn.id,
      };
    }
  }

  // If collecting or scheduled
  return {
    isTyping: true,
    status: activeTurn.status as TurnStatus,
    turnId: activeTurn.id,
    scheduledFor: new Date(activeTurn.scheduledFor),
  };
}
