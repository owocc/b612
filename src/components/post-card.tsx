'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState, useTransition} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Heart, MessageCircle, Trash2} from 'lucide-react';
import {Text} from '@astryxdesign/core/Text';
import {IconButton} from '@astryxdesign/core/IconButton';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {useAppToast} from '@/lib/toast';
import {UserAvatar} from '@/components/user-avatar';
import {TimeAgo} from '@/components/time-ago';
import {deletePost, toggleLike} from '@/server/actions/feed';
import {PostMediaGrid} from '@/components/post-media-grid';
import type {FeedPost} from '@/server/feed';

const pulse = stylex.keyframes({
  '0%, 100%': {opacity: 0.45},
  '50%': {opacity: 1},
});
const styles = stylex.create({
  article: {
    display: 'flex',
    gap: 12,
    paddingBlock: 16,
  },
  content: {
    minWidth: 0,
    flex: 1,
  },
  authorRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 2,
  },
  authorLink: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 15,
    fontWeight: 600,
    ':hover': {
      textDecorationLine: 'underline',
    },
  },
  time: {
    flexShrink: 0,
    fontSize: 12,
    color: 'var(--color-text-secondary)',
  },
  postLink: {
    display: 'block',
    marginTop: 4,
  },
  postText: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    lineHeight: 1.625,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  count: {
    marginLeft: -4,
  },
  spacer: {
    flex: 1,
  },
  likedIcon: {
    color: 'var(--color-error)',
  },
  skeleton: {
    display: 'flex',
    gap: 12,
    paddingBlock: 16,
    animationName: pulse,
    animationDuration: '2s',
    animationIterationCount: 'infinite',
  },
  skeletonAvatar: {
    flexShrink: 0,
    width: 42,
    height: 42,
    borderRadius: 9999,
    backgroundColor: 'var(--color-background-muted)',
  },
  skeletonContent: {
    flex: 1,
    paddingBlock: 4,
  },
  skeletonLine: {
    height: 16,
    width: 128,
    borderRadius: 4,
    backgroundColor: 'var(--color-background-muted)',
  },
  skeletonLineSmall: {
    height: 14,
    width: '100%',
    marginTop: 10,
    borderRadius: 4,
    backgroundColor: 'var(--color-background-muted)',
  },
  skeletonLineShort: {
    height: 14,
    width: '75%',
    marginTop: 10,
    borderRadius: 4,
    backgroundColor: 'var(--color-background-muted)',
  },
});

export function PostCard({post, isOwnerFeed = true}: {post: FeedPost; isOwnerFeed?: boolean}) {
  const router = useRouter();
  const toast = useAppToast();
  const [liked, setLiked] = useState(post.viewerLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [, startTransition] = useTransition();

  // 点击头像/作者名进入智能体详情页（朋友圈可见性、朋友权限都在那里设置）
  const authorHref =
    post.authorType === 'ai' && post.characterId
      ? `/characters/${post.characterId}`
      : '/settings/account';

  const onLike = () => {
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    startTransition(async () => {
      try {
        await toggleLike(post.id);
      } catch {
        setLiked(!next);
        setLikeCount((c) => c + (next ? -1 : 1));
        toast.error('操作失败');
      }
    });
  };

  const onDelete = () => {
    if (!confirm('确定删除这条动态吗？')) return;
    startTransition(async () => {
      await deletePost(post.id);
      router.refresh();
    });
  };

  return (
    <article {...stylex.props(styles.article)}>
      <UserAvatar
        name={post.authorName}
        emoji={post.authorAvatarEmoji}
        color={post.authorAvatarColor}
        url={post.authorAvatarUrl}
        size={42}
        href={authorHref}
      />
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.authorRow)}>
          <Link href={authorHref} {...stylex.props(styles.authorLink)}>
            {post.authorName}
          </Link>
          <Text type="supporting" size="sm" as="span">
            @{post.authorUsername}
          </Text>
          <span {...stylex.props(styles.time)}>
            <TimeAgo date={post.createdAt} live />
          </span>
        </div>
        <Link href={`/post/${post.id}`} {...stylex.props(styles.postLink)}>
          <Text as="p" textWrap="wrap" xstyle={styles.postText}>
            {post.content}
          </Text>
        </Link>
        <PostMediaGrid media={post.media ?? []} />
        <div {...stylex.props(styles.actions)}>
          <IconButton
            label={liked ? '取消点赞' : '点赞'}
            variant="ghost"
            size="sm"
            icon={
              <Heart
                size={17}
                fill={liked ? 'currentColor' : 'none'}
                {...stylex.props(liked && styles.likedIcon)}
              />
            }
            onClick={onLike}
          />
          {likeCount > 0 && (
            <Text type="supporting" size="sm" as="span" xstyle={styles.count}>
              {likeCount}
            </Text>
          )}
          <Link href={`/post/${post.id}`} aria-label="查看评论">
            <IconButton label="评论" variant="ghost" size="sm" icon={<MessageCircle size={17} />} />
          </Link>
          {post.commentCount > 0 && (
            <Text type="supporting" size="sm" as="span" xstyle={styles.count}>
              {post.commentCount}
            </Text>
          )}
          <div {...stylex.props(styles.spacer)} />
          {post.authorType === 'user' && isOwnerFeed && (
            <MoreMenu
              label="动态操作"
              size="sm"
              items={[
                {
                  label: '删除动态',
                  icon: <Trash2 size={15} />,
                  variant: 'destructive',
                  onClick: onDelete,
                },
              ]}
            />
          )}
        </div>
      </div>
    </article>
  );
}

export function PostCardSkeleton() {
  return (
    <div {...stylex.props(styles.skeleton)} aria-hidden>
      <div {...stylex.props(styles.skeletonAvatar)} />
      <div {...stylex.props(styles.skeletonContent)}>
        <div {...stylex.props(styles.skeletonLine)} />
        <div {...stylex.props(styles.skeletonLineSmall)} />
        <div {...stylex.props(styles.skeletonLineShort)} />
      </div>
    </div>
  );
}
