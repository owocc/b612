import { after } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { conversations, messages, transfers, user } from '@/db/schema';
import { getSession } from '@/lib/session';
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

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const transferSchema = z.object({
  action: z.literal('transfer'),
  conversationId: z.string().min(1),
  amountYuan: z.number().positive(),
  note: z.string().trim().max(100).optional(),
});

const redPacketSchema = z.object({
  action: z.literal('red_packet'),
  conversationId: z.string().min(1),
  amountYuan: z.number().positive(),
  shareCount: z.number().int().min(MIN_SHARES).max(MAX_SHARES).default(1),
  greeting: z.string().trim().max(50).optional(),
});

const acceptTransferSchema = z.object({
  action: z.literal('accept_transfer'),
  transferId: z.string().min(1),
});

const claimRedPacketSchema = z.object({
  action: z.literal('claim_red_packet'),
  redPacketId: z.string().min(1),
});

const bodySchema = z.discriminatedUnion('action', [
  transferSchema,
  redPacketSchema,
  acceptTransferSchema,
  claimRedPacketSchema,
]);

async function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const rawBody = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? '参数无效' },
        { status: 400 },
      );
    }

    const data = parsed.data;

    // 1. 发起转账给 AI (action: "transfer")
    if (data.action === 'transfer') {
      const amount = parseWalletAmountToMinor(data.amountYuan);
      if (!amount) {
        return Response.json({ ok: false, error: '金额无效' }, { status: 400 });
      }
      if (amount > MAX_SINGLE_AMOUNT) {
        return Response.json(
          { ok: false, error: `单笔转账不能超过 ${formatWalletMoney(MAX_SINGLE_AMOUNT)}` },
          { status: 400 },
        );
      }

      const [conv] = await db
        .select({ id: conversations.id, characterId: conversations.characterId })
        .from(conversations)
        .where(and(eq(conversations.id, data.conversationId), eq(conversations.userId, userId)))
        .limit(1);

      if (!conv) {
        return Response.json({ ok: false, error: '会话不存在' }, { status: 404 });
      }

      const transferId = crypto.randomUUID();
      const messageId = crypto.randomUUID();

      await createTransfer({
        userId,
        from: { ownerType: 'user' },
        to: { ownerType: 'ai', characterId: conv.characterId },
        amount,
        note: data.note ?? null,
        messageId,
      });

      await db.insert(messages).values({
        id: messageId,
        conversationId: conv.id,
        userId,
        role: 'user',
        type: 'transfer',
        payload: JSON.stringify({ transferId, amount, currency: 'nw', note: data.note ?? null }),
        content: '',
      });

      const now = new Date();
      await db
        .update(conversations)
        .set({
          lastMessageAt: now,
          lastReadAt: now,
        })
        .where(eq(conversations.id, conv.id));

      const turnResult = await appendMessageToTurn({
        conversationId: conv.id,
        userId,
        characterId: conv.characterId,
        messageId,
      });

      after(async () => {
        try {
          await delay(QUIET_WINDOW_MS + 300);
          await tickTurns({ userId, conversationId: conv.id, limit: 2 });
        } catch (err) {
          console.error('[api/wallet] background turn processing error:', err);
        }
      });

      return Response.json({
        ok: true,
        action: 'transfer',
        transferId,
        messageId,
        turn: turnResult,
      });
    }

    // 2. 发红包 (action: "red_packet")
    if (data.action === 'red_packet') {
      const totalAmount = parseWalletAmountToMinor(data.amountYuan);
      if (!totalAmount) {
        return Response.json({ ok: false, error: '金额无效' }, { status: 400 });
      }
      if (totalAmount > MAX_SINGLE_AMOUNT) {
        return Response.json(
          { ok: false, error: `单个红包不能超过 ${formatWalletMoney(MAX_SINGLE_AMOUNT)}` },
          { status: 400 },
        );
      }
      if (totalAmount < data.shareCount) {
        return Response.json({ ok: false, error: '总金额至少要够每份 0.01' }, { status: 400 });
      }

      const [conv] = await db
        .select({ id: conversations.id, characterId: conversations.characterId })
        .from(conversations)
        .where(and(eq(conversations.id, data.conversationId), eq(conversations.userId, userId)))
        .limit(1);

      if (!conv) {
        return Response.json({ ok: false, error: '会话不存在' }, { status: 404 });
      }

      const greeting = data.greeting?.trim() || '恭喜发财，大吉大利';
      const messageId = crypto.randomUUID();

      const { id: redPacketId } = await createRedPacket({
        userId,
        sender: { ownerType: 'user' },
        totalAmount,
        shareCount: data.shareCount,
        greeting,
        messageId,
      });

      await db.insert(messages).values({
        id: messageId,
        conversationId: conv.id,
        userId,
        role: 'user',
        type: 'red_packet',
        payload: JSON.stringify({
          redPacketId,
          totalAmount,
          currency: 'nw',
          shareCount: data.shareCount,
          greeting,
        }),
        content: greeting,
      });

      const now = new Date();
      await db
        .update(conversations)
        .set({
          lastMessageAt: now,
          lastReadAt: now,
        })
        .where(eq(conversations.id, conv.id));

      const turnResult = await appendMessageToTurn({
        conversationId: conv.id,
        userId,
        characterId: conv.characterId,
        messageId,
      });

      after(async () => {
        try {
          await delay(QUIET_WINDOW_MS + 300);
          await tickTurns({ userId, conversationId: conv.id, limit: 2 });
        } catch (err) {
          console.error('[api/wallet] background turn processing error:', err);
        }
      });

      return Response.json({
        ok: true,
        action: 'red_packet',
        redPacketId,
        messageId,
        turn: turnResult,
      });
    }

    // 3. 用户确认收款 (action: "accept_transfer")
    if (data.action === 'accept_transfer') {
      const result = await acceptTransfer({
        userId,
        transferId: data.transferId,
        acceptor: { ownerType: 'user' },
      });

      // 如果该转账关联了会话消息，写入系统提示并触发 AI 对话轮次
      const [transferRow] = await db
        .select({ messageId: transfers.messageId, note: transfers.note })
        .from(transfers)
        .where(and(eq(transfers.id, data.transferId), eq(transfers.userId, userId)))
        .limit(1);

      let turnResult = null;
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

            turnResult = await appendMessageToTurn({
              conversationId: conv.id,
              userId,
              characterId: conv.characterId,
              messageId: systemMsgId,
            });

            after(async () => {
              try {
                await delay(QUIET_WINDOW_MS + 300);
                await tickTurns({ userId, conversationId: conv.id, limit: 2 });
              } catch (err) {
                console.error('[api/wallet/accept_transfer] background turn processing error:', err);
              }
            });
          }
        }
      }

      return Response.json({
        ok: true,
        action: 'accept_transfer',
        amount: result.amount,
        currency: result.currency,
        claimedAt: result.claimedAt,
        turn: turnResult,
      });
    }

    // 4. 用户领取红包 (action: "claim_red_packet")
    if (data.action === 'claim_red_packet') {
      const result = await claimRedPacket({
        userId,
        redPacketId: data.redPacketId,
        claimant: { ownerType: 'user' },
      });

      return Response.json({
        ok: true,
        action: 'claim_red_packet',
        amount: result.amount,
        currency: result.currency,
        balanceAfter: result.balanceAfter,
      });
    }
  } catch (err) {
    if (err instanceof WalletError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error('[api/wallet] request failed', err);
    return Response.json({ ok: false, error: '操作失败，请稍后再试' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const { searchParams } = new URL(req.url);
    const characterId = searchParams.get('characterId');

    const account = await getOrCreateWalletAccount({
      userId,
      ownerType: characterId ? 'ai' : 'user',
      characterId: characterId || null,
    });

    return Response.json({
      ok: true,
      account: {
        id: account.id,
        ownerType: account.ownerType,
        characterId: account.characterId,
        currency: account.currency,
        balance: account.balance,
      },
    });
  } catch (err) {
    console.error('[api/wallet] GET failed', err);
    return Response.json({ ok: false, error: '获取钱包信息失败' }, { status: 500 });
  }
}
