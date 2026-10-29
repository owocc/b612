'use client';

import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as stylex from '@stylexjs/stylex';
import {
  Archive,
  ArrowUpRight,
  MessageCircle,
  Pin,
  RotateCcw,
  Settings2,
  Trash2,
  Wallet,
} from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { HStack } from '@astryxdesign/core/Stack';
import { useAppToast } from '@/lib/toast';
import { formatWalletMoney } from '@/lib/wallet-currency';
import { setCharacterStatus } from '@/server/actions/characters';
import { deleteChat, setChatArchived, setChatPinned } from '@/server/actions/chat-list';

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-4)',
    paddingBottom: 'var(--spacing-6)',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-3)',
    padding: 'var(--spacing-4)',
    borderRadius: 'var(--radius-container)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-background-surface)',
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: 'var(--font-size-base)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text-primary)',
  },
  hint: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
    lineHeight: 1.55,
  },
  balance: {
    fontSize: 'var(--font-size-2xl)',
    fontWeight: 'var(--font-weight-semibold)',
    letterSpacing: '-0.03em',
  },
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-3)',
    flexWrap: 'wrap',
  },
  actionText: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
    flex: 1,
  },
  actionLabel: {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-medium)',
    color: 'var(--color-text-primary)',
  },
  linkRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-3)',
    padding: '10px 0',
    textDecoration: 'none',
    color: 'var(--color-text-primary)',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'var(--color-border)',
  },
  linkLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-medium)',
  },
  linkArrow: {
    color: 'var(--color-text-secondary)',
    display: 'inline-flex',
  },
  friendRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 0',
    textDecoration: 'none',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--font-size-sm)',
  },
});

export type ArchiveConversation = {
  id: string;
  isPinned: boolean;
  isArchived: boolean;
} | null;

export function CharacterSecurityPanel({
  characterId,
  status,
  friendSettings,
  friendsNode,
  walletBalance,
  conversation,
}: {
  characterId: string;
  status: string;
  friendSettings: ReactNode;
  friendsNode: ReactNode;
  walletBalance: number | null;
  conversation: ArchiveConversation;
}) {
  const router = useRouter();
  const toast = useAppToast();
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState(status === 'active');
  const [pinned, setPinned] = useState(Boolean(conversation?.isPinned));
  const [archived, setArchived] = useState(Boolean(conversation?.isArchived));

  const toggleStatus = (checked: boolean) => {
    setActive(checked);
    startTransition(async () => {
      await setCharacterStatus(characterId, checked ? 'active' : 'paused');
      toast.success(checked ? '居民已恢复活跃' : '居民已暂停自主活动');
      router.refresh();
    });
  };

  const togglePinned = (checked: boolean) => {
    if (!conversation) return;
    setPinned(checked);
    startTransition(async () => {
      await setChatPinned('dm', conversation.id, checked);
      toast.success(checked ? '会话已置顶' : '已取消置顶');
      router.refresh();
    });
  };

  const toggleArchived = (checked: boolean) => {
    if (!conversation) return;
    setArchived(checked);
    startTransition(async () => {
      await setChatArchived('dm', conversation.id, checked);
      toast.success(checked ? '会话已归档' : '已移出归档');
      router.refresh();
    });
  };

  const removeConversation = () => {
    if (!conversation) return;
    if (!window.confirm('删除会话只会从聊天列表移除，历史消息仍会保留。确定继续吗？')) return;
    startTransition(async () => {
      await deleteChat('dm', conversation.id);
      toast.success('会话已从列表移除');
      router.push('/messages');
      router.refresh();
    });
  };

  const clearLocalCache = async () => {
    if (!window.confirm('将清除浏览器本地缓存（主题、列表宽度等偏好会重置），不会影响账号与聊天记录。继续吗？')) {
      return;
    }
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
      if ('caches' in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      }
      toast.success('本地缓存已清理，正在刷新…');
      window.setTimeout(() => window.location.reload(), 600);
    } catch {
      toast.error('清理失败，请检查浏览器权限');
    }
  };

  return (
    <div {...stylex.props(styles.root)}>
      <section {...stylex.props(styles.section)}>
        <h2 {...stylex.props(styles.sectionTitle)}>
          <Settings2 size={16} color="var(--color-text-accent)" />
          居民状态
        </h2>
        <Switch
          label="允许自主活动"
          description="关闭后 TA 不再主动发动态或私信，仍可正常聊天"
          labelSpacing="spread"
          value={active}
          onChange={toggleStatus}
          isDisabled={pending}
        />
      </section>

      {friendSettings}

      <section {...stylex.props(styles.section)}>
        <h2 {...stylex.props(styles.sectionTitle)}>会话管理</h2>
        {conversation ? (
          <>
            <Switch
              label="置顶会话"
              description="让 TA 固定显示在聊天列表顶部"
              labelSpacing="spread"
              value={pinned}
              onChange={togglePinned}
              isDisabled={pending}
            />
            <Switch
              label="归档会话"
              description="归档后从主列表收起，有新消息时自动回来"
              labelSpacing="spread"
              value={archived}
              onChange={toggleArchived}
              isDisabled={pending}
            />
            <div {...stylex.props(styles.actionRow)}>
              <div {...stylex.props(styles.actionText)}>
                <span {...stylex.props(styles.actionLabel)}>删除会话</span>
                <span {...stylex.props(styles.hint)}>仅从列表移除，历史消息仍保留在数据库中</span>
              </div>
              <Button
                label="删除"
                variant="ghost"
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={removeConversation}
                isDisabled={pending}
              />
            </div>
          </>
        ) : (
          <Text type="supporting" size="sm" as="p">
            还没有与 TA 的会话。发送第一条消息后即可在这里管理会话。
          </Text>
        )}

        <Link href={`/messages`} {...stylex.props(styles.linkRow)}>
          <span {...stylex.props(styles.linkLabel)}>
            <MessageCircle size={15} /> 前往聊天列表
          </span>
          <span {...stylex.props(styles.linkArrow)}>
            <ArrowUpRight size={15} />
          </span>
        </Link>
      </section>

      {walletBalance !== null && (
        <section {...stylex.props(styles.section)}>
          <HStack gap={2} vAlign="center">
            <Wallet size={16} color="var(--color-text-accent)" />
            <h2 {...stylex.props(styles.sectionTitle)}>钱包</h2>
          </HStack>
          <span {...stylex.props(styles.balance)}>{formatWalletMoney(walletBalance)}</span>
          <Text type="supporting" size="sm" as="p">
            与 TA 聊天时可以互发转账 / 红包；余额属于 New World 平台钱包。
          </Text>
          <div>
            <Link href="/settings/wallet" style={{ textDecoration: 'none' }}>
              <Button label="查看钱包明细" variant="secondary" size="sm" icon={<ArrowUpRight size={14} />} />
            </Link>
          </div>
        </section>
      )}

      <section {...stylex.props(styles.section)}>
        <h2 {...stylex.props(styles.sectionTitle)}>好友与朋友圈</h2>
        {friendsNode}
      </section>

      <section {...stylex.props(styles.section)}>
        <h2 {...stylex.props(styles.sectionTitle)}>高级操作</h2>
        <div {...stylex.props(styles.actionRow)}>
          <div {...stylex.props(styles.actionText)}>
            <span {...stylex.props(styles.actionLabel)}>清理本地缓存</span>
            <span {...stylex.props(styles.hint)}>重置主题与本地偏好，不影响账号和聊天记录</span>
          </div>
          <Button
            label="清理"
            variant="secondary"
            size="sm"
            icon={<RotateCcw size={14} />}
            onClick={clearLocalCache}
          />
        </div>
        <Link href={`/characters/${characterId}?edit=1`} {...stylex.props(styles.linkRow)}>
          <span {...stylex.props(styles.linkLabel)}>
            <Pin size={15} /> 编辑姓名 / 头像 / 行为倾向
          </span>
          <span {...stylex.props(styles.linkArrow)}>
            <ArrowUpRight size={15} />
          </span>
        </Link>
        <Link href="/characters/manage" {...stylex.props(styles.linkRow)}>
          <span {...stylex.props(styles.linkLabel)}>
            <Archive size={15} /> 联系人管理
          </span>
          <span {...stylex.props(styles.linkArrow)}>
            <ArrowUpRight size={15} />
          </span>
        </Link>
      </section>
    </div>
  );
}
