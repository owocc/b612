'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { conversations, messages, transfers, user } from '@/db/schema';
import { requireUserId } from '@/lib/session';
import {
  MAX_SHARES,
  MAX_SINGLE_AMOUNT,
  MIN_SHARES,
  WalletError,
  acceptTransfer,
  claimRedPacket,
  createRedPacket,
  createTransfer,
  getOrCreateWalletAccount,
} from '@/server/wallet';
import { formatWalletMoney, parseWalletAmountToMinor } from '@/lib/wallet-currency';
import { appendMessageToTurn, tickTurns, QUIET_WINDOW_MS } from '@/server/ai/turn-engine';
/** 校验会话归属并取到角色 */
async function requireConversation(userId: string, conversationId: string) {
  const [conv] = await db
    .select({ id: conversations.id, characterId: conversations.characterId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  if (!conv) throw new WalletError('会话不存在');
  return conv;
}

async function createPayloadMessage(args: {
  conversationId: string;
  userId: string;
  type: 'transfer' | 'red_packet';
  payload: Record<string, unknown>;
  content?: string;
  messageId?: string;
}) {
  const id = args.messageId ?? crypto.randomUUID();
  await db.insert(messages).values({
    id,
    conversationId: args.conversationId,
    userId: args.userId,
    role: 'user',
    type: args.type,
    payload: JSON.stringify(args.payload),
    content: args.content ?? '',
  });
  return id;
}

const transferSchema = z.object({
  conversationId: z.string().min(1),
  amountYuan: z.number().positive(),
  note: z.string().trim().max(100).optional(),
});

/** 用户 → AI 转账：创建转账消息并冻结金额，对方确认收款后才入账 */
export async function sendTransferAction(input: z.input<typeof transferSchema>) {
  const userId = await requireUserId();
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? '转账失败' };
  const amount = parseWalletAmountToMinor(parsed.data.amountYuan);
  if (!amount) return { error: '金额无效' };
  if (amount > MAX_SINGLE_AMOUNT) {
    return { error: `单笔转账不能超过 ${formatWalletMoney(MAX_SINGLE_AMOUNT)}` };
  }

  try {
    const conv = await requireConversation(userId, parsed.data.conversationId);
    const transferId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await createTransfer({
      userId,
      from: { ownerType: 'user' },
      to: { ownerType: 'ai', characterId: conv.characterId },
      amount,
      note: parsed.data.note ?? null,
      messageId,
    });
    await createPayloadMessage({
      conversationId: conv.id,
      userId,
      type: 'transfer',
      payload: { transferId, amount, currency: 'nw', note: parsed.data.note ?? null },
      messageId,
    });

    // 更新会话最后消息时间
    const now = new Date();
    await db
      .update(conversations)
      .set({
        lastMessageAt: now,
        lastReadAt: now,
      })
      .where(eq(conversations.id, conv.id));

    // 转账入队 AI 轮次并触发后台异步回复
    await appendMessageToTurn({
      conversationId: conv.id,
      userId,
      characterId: conv.characterId,
      messageId,
    });

    after(async () => {
      try {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, QUIET_WINDOW_MS + 300);
        await promise;
        await tickTurns({ userId, conversationId: conv.id, limit: 2 });
      } catch (err) {
        console.error('[wallet/sendTransferAction] background turn processing error:', err);
      }
    });

    revalidatePath('/settings/wallet');
    return { ok: true as const, messageId };
  } catch (err) {
    if (err instanceof WalletError) return { error: err.message };
    console.error('[wallet] transfer failed', err);
    return { error: '转账失败，请稍后再试' };
  }
}

const redPacketSchema = z.object({
  conversationId: z.string().min(1),
  amountYuan: z.number().positive(),
  shareCount: z.number().int().min(MIN_SHARES).max(MAX_SHARES).default(1),
  greeting: z.string().trim().max(50).optional(),
});

/** 用户发红包：立即扣款，创建红包消息；对方点开即领取 */
export async function sendRedPacketAction(input: z.input<typeof redPacketSchema>) {
  const userId = await requireUserId();
  const parsed = redPacketSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? '发送失败' };
  const totalAmount = parseWalletAmountToMinor(parsed.data.amountYuan);
  if (!totalAmount) return { error: '金额无效' };
  if (totalAmount > MAX_SINGLE_AMOUNT) {
    return { error: `单个红包不能超过 ${formatWalletMoney(MAX_SINGLE_AMOUNT)}` };
  }
  if (totalAmount < parsed.data.shareCount) {
    return { error: '总金额至少要够每份 0.01' };
  }

  try {
    const conv = await requireConversation(userId, parsed.data.conversationId);
    const greeting = parsed.data.greeting?.trim() || '恭喜发财，大吉大利';
    const messageId = crypto.randomUUID();
    const { id: redPacketId } = await createRedPacket({
      userId,
      sender: { ownerType: 'user' },
      totalAmount,
      shareCount: parsed.data.shareCount,
      greeting,
      messageId,
    });
    await createPayloadMessage({
      conversationId: conv.id,
      userId,
      type: 'red_packet',
      payload: { redPacketId, totalAmount, currency: 'nw', shareCount: parsed.data.shareCount, greeting },
      content: greeting,
      messageId,
    });

    // 更新会话最后消息时间
    const now = new Date();
    await db
      .update(conversations)
      .set({
        lastMessageAt: now,
        lastReadAt: now,
      })
      .where(eq(conversations.id, conv.id));

    // 红包入队 AI 轮次并触发后台异步回复
    await appendMessageToTurn({
      conversationId: conv.id,
      userId,
      characterId: conv.characterId,
      messageId,
    });

    after(async () => {
      try {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, QUIET_WINDOW_MS + 300);
        await promise;
        await tickTurns({ userId, conversationId: conv.id, limit: 2 });
      } catch (err) {
        console.error('[wallet/sendRedPacketAction] background turn processing error:', err);
      }
    });

    revalidatePath('/settings/wallet');
    return { ok: true as const, messageId };
  } catch (err) {
    if (err instanceof WalletError) return { error: err.message };
    console.error('[wallet] red packet failed', err);
    return { error: '发送失败，请稍后再试' };
  }
}

const claimSchema = z.object({ id: z.string().min(1) });

/** 用户拆 AI（或自己发出后由 AI 领取体系之外）的红包 */
export async function claimRedPacketAction(input: z.input<typeof claimSchema>) {
  const userId = await requireUserId();
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) return { error: '领取失败' };

  try {
    const result = await claimRedPacket({
      userId,
      redPacketId: parsed.data.id,
      claimant: { ownerType: 'user' },
    });
    revalidatePath('/settings/wallet');
    return { ok: true as const, amount: result.amount, currency: result.currency };
  } catch (err) {
    if (err instanceof WalletError) return { error: err.message };
    console.error('[wallet] claim failed', err);
    return { error: '领取失败，请稍后再试' };
  }
}

/** 用户确认收款（AI 发来的转账） */
export async function acceptTransferAction(input: z.input<typeof claimSchema>) {
  const userId = await requireUserId();
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) return { error: '收款失败' };

  try {
    const result = await acceptTransfer({
      userId,
      transferId: parsed.data.id,
      acceptor: { ownerType: 'user' },
    });

    // 如果该转账关联了会话消息，写入一条系统提示并触发 AI 对话轮次
    const [transferRow] = await db
      .select({ messageId: transfers.messageId, note: transfers.note })
      .from(transfers)
      .where(and(eq(transfers.id, parsed.data.id), eq(transfers.userId, userId)))
      .limit(1);

    if (transferRow?.messageId) {
      const [origMsg] = await db
        .select({ conversationId: messages.conversationId })
        .from(messages)
        .where(eq(messages.id, transferRow.messageId))
        .limit(1);

      if (origMsg?.conversationId) {
        const [conv] = await db
          .select({ id: conversations.id, characterId: conversations.characterId })
          .from(conversations)
          .where(and(eq(conversations.id, origMsg.conversationId), eq(conversations.userId, userId)))
          .limit(1);

        if (conv) {
          const [u] = await db
            .select({ name: user.name })
            .from(user)
            .where(eq(user.id, userId))
            .limit(1);
          const userName = u?.name || '朋友';

          const now = new Date();
          const systemMsgId = crypto.randomUUID();
          const noticeContent = `${userName} 已确认收下了你的转账（金额：${formatWalletMoney(result.amount, result.currency)}${transferRow.note ? `，备注：${transferRow.note}` : ''}）`;

          await db.insert(messages).values({
            id: systemMsgId,
            conversationId: conv.id,
            userId,
            role: 'system',
            content: noticeContent,
            createdAt: now,
          });

          await db
            .update(conversations)
            .set({
              lastMessageAt: now,
              lastReadAt: now,
            })
            .where(eq(conversations.id, conv.id));

          await appendMessageToTurn({
            conversationId: conv.id,
            userId,
            characterId: conv.characterId,
            messageId: systemMsgId,
          });

          after(async () => {
            try {
              const { promise, resolve } = Promise.withResolvers<void>();
              setTimeout(resolve, QUIET_WINDOW_MS + 300);
              await promise;
              await tickTurns({ userId, conversationId: conv.id, limit: 2 });
            } catch (err) {
              console.error('[wallet/acceptTransferAction] background turn processing error:', err);
            }
          });
        }
      }
    }

    revalidatePath('/settings/wallet');
    return { ok: true as const, amount: result.amount, currency: result.currency };
  } catch (err) {
    if (err instanceof WalletError) return { error: err.message };
    console.error('[wallet] accept transfer failed', err);
    return { error: '收款失败，请稍后再试' };
  }
}
/** 确保当前用户主钱包存在（聊天页首次打开时调用） */
export async function ensureUserWalletAction() {
  const userId = await requireUserId();
  const account = await getOrCreateWalletAccount({ userId, ownerType: 'user' });
  return { ok: true as const, balance: account.balance };
}
