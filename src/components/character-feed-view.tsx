'use client';

import Link from 'next/link';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft, EyeOff, MessagesSquare, Settings2 } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { UserAvatar } from '@/components/user-avatar';
import { PostCard } from '@/components/post-card';
import type { FeedPost } from '@/server/feed';
import type { FriendPermission } from '@/server/friend-permissions';

const styles = stylex.create({
  scroll: {
    height: '100%',
    minHeight: 0,
    width: '100%',
    overflowY: 'auto',
    overflowX: 'hidden',
    backgroundColor: 'var(--color-background-surface)',
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 30,
    display: 'flex',
    height: 56,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'var(--color-border)',
    backgroundColor: 'color-mix(in srgb, var(--color-background-surface) 95%, transparent)',
    backdropFilter: 'blur(12px)',
    '@media (min-width: 640px)': { paddingInline: 24 },
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: 9999,
    paddingBlock: 4,
    paddingInline: 10,
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    textDecoration: 'none',
    ':hover': {
      backgroundColor: 'var(--color-background-muted)',
      color: 'var(--color-text-primary)',
    },
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: '-0.02em',
  },
  content: {
    width: '100%',
    maxWidth: 680,
    marginInline: 'auto',
    paddingTop: 24,
    paddingRight: 16,
    paddingBottom: 80,
    paddingLeft: 16,
    '@media (min-width: 640px)': { paddingRight: 24, paddingLeft: 24 },
  },
  profile: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--spacing-3)',
    paddingBottom: 20,
  },
  bio: {
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
    marginTop: 2,
  },
  banner: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 16,
    borderRadius: 12,
    backgroundColor: 'color-mix(in srgb, var(--color-background-muted) 70%, transparent)',
    paddingBlock: 10,
    paddingInline: 14,
  },
  bannerText: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: 'var(--color-text-secondary)',
  },
  bannerLink: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-text-accent)',
    ':hover': { textDecorationLine: 'underline' },
  },
  divider: { borderTop: '1px solid var(--color-border)' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    marginBottom: 4,
  },
});

export type CharacterFeedProfileData = {
  id: string;
  name: string;
  username: string;
  bio: string;
  avatarUrl: string | null;
  avatarEmoji: string;
  avatarColor: string;
  relationshipToUser: string | null;
  status: string;
  friendPermission: FriendPermission;
  hideMyPostsFromThem: boolean;
  hideTheirPostsFromMe: boolean;
};

/**
 * 单独查看某一个居民的朋友圈。
 * 「不看他」只是把 TA 从聚合列表里排除，这里仍可正常查看 TA 的全部动态。
 */
export function CharacterFeedView({
  character,
  posts,
  postCount,
}: {
  character: CharacterFeedProfileData;
  posts: FeedPost[];
  postCount: number;
}) {
  const isChatOnly = character.friendPermission === 'chat_only';
  const hiddenFromFeed = isChatOnly || character.hideTheirPostsFromMe;

  return (
    <div {...stylex.props(styles.scroll)}>
      <header {...stylex.props(styles.header)}>
        <Link href="/feed" {...stylex.props(styles.backLink)}>
          <ArrowLeft size={14} />
          <span>朋友圈</span>
        </Link>
        <span {...stylex.props(styles.title)}>{character.name} 的朋友圈</span>
        <Link href={`/characters/${character.id}`} style={{ textDecoration: 'none' }}>
          <Button label="设置" variant="ghost" size="sm" icon={<Settings2 size={14} />} />
        </Link>
      </header>

      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.profile)}>
          <UserAvatar
            name={character.name}
            emoji={character.avatarEmoji}
            color={character.avatarColor}
            url={character.avatarUrl}
            size={64}
            href={`/characters/${character.id}`}
          />
          <VStack gap={1}>
            <HStack gap={2} vAlign="center">
              <Text weight="bold" size="lg" as="span">
                {character.name}
              </Text>
              {character.relationshipToUser && (
                <Token label={character.relationshipToUser} color="teal" />
              )}
            </HStack>
            <Text type="supporting" size="sm" as="div">
              @{character.username} · {postCount} 条动态
            </Text>
            {character.bio && (
              <Text as="p" textWrap="wrap" xstyle={styles.bio}>
                {character.bio}
              </Text>
            )}
          </VStack>
          <div style={{ flex: 1 }} />
          <Link href={`/messages/${character.id}`} style={{ textDecoration: 'none' }}>
            <Button
              label="发消息"
              variant="secondary"
              size="sm"
              icon={<MessagesSquare size={14} />}
            />
          </Link>
        </div>

        {hiddenFromFeed && (
          <div {...stylex.props(styles.banner)}>
            <span {...stylex.props(styles.bannerText)}>
              <EyeOff size={14} />
              {isChatOnly
                ? '你和 TA 是「仅聊天」关系，TA 的动态不会出现在你的朋友圈。'
                : '你已设置「不看他」，TA 的动态不会出现在你的朋友圈。'}
            </span>
            <Link href={`/characters/${character.id}`} {...stylex.props(styles.bannerLink)}>
              去修改朋友权限 →
            </Link>
          </div>
        )}

        {posts.length === 0 ? (
          <EmptyState
            title="TA 还没有发过动态"
            description="居民会在朋友圈里分享生活，过一会儿再来看看吧"
          />
        ) : (
          <>
            <div {...stylex.props(styles.sectionTitle)}>TA 的动态</div>
            <div>
              {posts.map((post, index) => (
                <div key={post.id} {...stylex.props(index > 0 && styles.divider)}>
                  <PostCard post={post} isOwnerFeed={false} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
