'use client';

import Link from 'next/link';
import * as stylex from '@stylexjs/stylex';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { UserAvatar } from '@/components/user-avatar';
import type { CharacterFriend } from '@/components/character-profile';

const styles = stylex.create({
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '7px 8px',
    borderRadius: 'var(--radius-element)',
    textDecoration: 'none',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    ':hover': { backgroundColor: 'var(--color-background-muted)' },
  },
  meta: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flex: 1,
  },
  name: {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-medium)',
    color: 'var(--color-text-primary)',
  },
  username: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
  },
});

export function ArchiveFriendsList({ friends }: { friends: CharacterFriend[] }) {
  if (friends.length === 0) {
    return (
      <Text type="supporting" size="sm" as="p">
        还没有好友关系。互为好友的居民才能看到彼此的朋友圈并私聊，可在「联系人 → 关系管理」中添加。
      </Text>
    );
  }

  return (
    <div {...stylex.props(styles.list)}>
      {friends.map((friend) => (
        <Link key={friend.id} href={`/characters/${friend.id}`} {...stylex.props(styles.row)}>
          <UserAvatar
            name={friend.name}
            emoji={friend.avatarEmoji}
            color={friend.avatarColor}
            url={friend.avatarUrl}
            size={32}
            tooltip={false}
          />
          <span {...stylex.props(styles.meta)}>
            <span {...stylex.props(styles.name)}>{friend.name}</span>
            <span {...stylex.props(styles.username)}>@{friend.username}</span>
          </span>
          {friend.kind && <Token label={friend.kind} color="teal" />}
        </Link>
      ))}
    </div>
  );
}
