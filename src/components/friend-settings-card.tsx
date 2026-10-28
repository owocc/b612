'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import * as stylex from '@stylexjs/stylex';
import { UsersRound, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Switch } from '@astryxdesign/core/Switch';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import { useAppToast } from '@/lib/toast';
import {
  updateCharacterFriendSettings,
  type FriendSettingsInput,
} from '@/server/actions/characters';
import type { FriendPermission } from '@/server/friend-permissions';

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-4)',
    padding: 'var(--spacing-4)',
    borderRadius: 'var(--radius-container)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-background-surface)',
  },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-2)',
  },
  feedLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-medium)',
    color: 'var(--color-text-accent)',
    textDecoration: 'none',
    ':hover': { textDecorationLine: 'underline' },
  },
  swtiches: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-3)',
    paddingTop: 'var(--spacing-1)',
  },
});

export type FriendSettingsCardProps = {
  characterId: string;
  friendPermission: FriendPermission;
  hideMyPostsFromThem: boolean;
  hideTheirPostsFromMe: boolean;
};

/**
 * 智能体详情页的「朋友权限 / 朋友圈状态」设置。
 * 修改即时保存；「仅聊天」下朋友圈已关闭，两个可见性开关会被禁用。
 */
export function FriendSettingsCard({
  characterId,
  friendPermission,
  hideMyPostsFromThem,
  hideTheirPostsFromMe,
}: FriendSettingsCardProps) {
  const toast = useAppToast();
  const [pending, startTransition] = useTransition();
  const [permission, setPermission] = useState<FriendPermission>(friendPermission);
  const [hideMine, setHideMine] = useState(hideMyPostsFromThem);
  const [hideTheirs, setHideTheirs] = useState(hideTheirPostsFromMe);

  const isChatOnly = permission === 'chat_only';

  const save = (next: FriendSettingsInput, previous: () => void) => {
    startTransition(async () => {
      const res = await updateCharacterFriendSettings(characterId, next);
      if (res?.error) {
        previous();
        toast.error(res.error);
        return;
      }
      toast.success('朋友圈设置已更新');
    });
  };

  const changePermission = (value: string) => {
    const next = value === 'chat_only' ? 'chat_only' : 'feed_and_chat';
    const previous = permission;
    setPermission(next);
    if (next === 'chat_only') {
      // 仅聊天 = 朋友圈关闭，两个开关一并归零（服务端同样会归一）
      setHideMine(false);
      setHideTheirs(false);
    }
    save(
      {
        friendPermission: next,
        hideMyPostsFromThem: next === 'chat_only' ? false : hideMine,
        hideTheirPostsFromMe: next === 'chat_only' ? false : hideTheirs,
      },
      () => setPermission(previous),
    );
  };

  const changeHideMine = (checked: boolean) => {
    setHideMine(checked);
    save(
      {
        friendPermission: permission,
        hideMyPostsFromThem: checked,
        hideTheirPostsFromMe: hideTheirs,
      },
      () => setHideMine(!checked),
    );
  };

  const changeHideTheirs = (checked: boolean) => {
    setHideTheirs(checked);
    save(
      {
        friendPermission: permission,
        hideMyPostsFromThem: hideMine,
        hideTheirPostsFromMe: checked,
      },
      () => setHideTheirs(!checked),
    );
  };

  return (
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.header)}>
        <HStack gap={2} vAlign="center">
          <UsersRound size={16} color="var(--color-primary, #6366f1)" />
          <Text weight="medium" as="span">
            朋友权限与朋友圈
          </Text>
        </HStack>
        <Link href={`/feed/${characterId}`} {...stylex.props(styles.feedLink)}>
          查看 TA 的朋友圈
          <ArrowUpRight size={13} />
        </Link>
      </div>

      <VStack gap={1.5}>
        <Text weight="medium" as="div">
          朋友权限
        </Text>
        <SegmentedControl
          label="朋友权限"
          value={permission}
          onChange={changePermission}
          isDisabled={pending}
          layout="fill"
        >
          <SegmentedControlItem value="feed_and_chat" label="朋友圈和聊天" />
          <SegmentedControlItem value="chat_only" label="仅聊天" />
        </SegmentedControl>
        <Text type="supporting" size="sm" as="p">
          {isChatOnly
            ? '仅聊天：TA 看不到你的朋友圈，也不会评论 / 点赞；TA 的动态不会出现在你的朋友圈，聊天和转账不受影响。'
            : '朋友圈和聊天：彼此可见朋友圈动态，可继续单独设置下面的朋友圈状态。'}
        </Text>
      </VStack>

      <div {...stylex.props(styles.swtiches)}>
        <HStack gap={1.5} vAlign="center">
          <ShieldCheck size={14} color="var(--color-text-secondary)" />
          <Text type="supporting" size="sm" as="span">
            朋友圈状态
          </Text>
        </HStack>
        <Switch
          label="不让他看我"
          description="TA 看不到你发布的朋友圈，也无法评论 / 点赞"
          value={hideMine}
          onChange={changeHideMine}
          isDisabled={isChatOnly || pending}
          disabledMessage="仅聊天模式下朋友圈已关闭"
          size="sm"
          labelSpacing="spread"
        />
        <Switch
          label="不看他"
          description="TA 的动态不出现在你的朋友圈列表，仍可单独查看 TA 的朋友圈"
          value={hideTheirs}
          onChange={changeHideTheirs}
          isDisabled={isChatOnly || pending}
          disabledMessage="仅聊天模式下朋友圈已关闭"
          size="sm"
          labelSpacing="spread"
        />
      </div>
    </div>
  );
}
