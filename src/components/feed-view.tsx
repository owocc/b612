'use client';

import { useState, useRef, useTransition, useCallback } from 'react';
import * as stylex from '@stylexjs/stylex';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { UserAvatar } from '@/components/user-avatar';
import { SafeImage } from '@/components/safe-image';
import { Composer } from '@/components/composer';
import { PostCard } from '@/components/post-card';
import { FeedNotificationsPopover } from '@/components/feed-notifications-popover';
import { MediaCropModal } from '@/components/avatar-crop-modal';
import { useAppToast } from '@/lib/toast';
import {
  triggerFeedPulseAction,
  uploadFeedCoverAction,
  type NotificationItem,
} from '@/server/actions/feed';
import type { FeedPost } from '@/server/feed';
import { ArrowLeft, Camera, RotateCw } from 'lucide-react';

const styles = stylex.create({
  scroll: {
    position: 'relative',
    height: '100%',
    minHeight: 0,
    width: '100%',
    overflowY: 'auto',
    overflowX: 'hidden',
    backgroundColor: 'var(--color-background-surface)',
  },
  hiddenInput: {
    display: 'none',
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
    paddingInline: 16,
    transitionProperty: 'all',
    transitionDuration: '200ms',
    borderBottomWidth: 1,
    '@media (min-width: 640px)': {
      paddingInline: 24,
    },
  },
  headerScrolled: {
    borderBottomColor: 'var(--color-border)',
    backgroundColor: 'color-mix(in srgb, var(--color-background-surface) 95%, transparent)',
    backdropFilter: 'blur(12px)',
    color: 'var(--color-text-primary)',
  },
  headerTop: {
    borderBottomColor: 'transparent',
    backgroundColor: 'transparent',
    color: 'var(--color-on-dark)',
  },
  backContainer: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 70,
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
    transitionProperty: 'all',
    transitionDuration: '200ms',
    ':active': {
      transform: 'scale(0.95)',
    },
    '@media (hover: hover)': {
      ':hover': {
        color: 'var(--color-text-primary)',
        backgroundColor: 'var(--color-background-muted)',
      },
    },
  },
  backLinkTop: {
    color: 'rgb(255 255 255 / 90%)',
    '@media (hover: hover)': {
      ':hover': {
        color: 'var(--color-on-dark)',
        backgroundColor: 'rgb(255 255 255 / 20%)',
      },
    },
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    minWidth: 70,
    '@media (min-width: 640px)': {
      gap: 10,
    },
  },
  toolbarButton: {
    display: 'flex',
    height: 36,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    transitionProperty: 'all',
    transitionDuration: '200ms',
    ':active': {
      transform: 'scale(0.95)',
    },
  },
  toolbarButtonScrolled: {
    color: 'var(--color-text-secondary)',
    '@media (hover: hover)': {
      ':hover': {
        color: 'var(--color-text-primary)',
        backgroundColor: 'var(--color-background-muted)',
      },
    },
  },
  toolbarButtonTop: {
    color: 'rgb(255 255 255 / 90%)',
    '@media (hover: hover)': {
      ':hover': {
        color: 'var(--color-on-dark)',
        backgroundColor: 'rgb(255 255 255 / 20%)',
      },
    },
  },
  icon: {
    transitionProperty: 'transform',
    transitionDuration: '500ms',
  },
  iconRefreshing: {
    transform: 'rotate(360deg)',
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: '-0.025em',
    transitionProperty: 'opacity',
    transitionDuration: '200ms',
    userSelect: 'none',
  },
  titleVisible: {
    opacity: 1,
  },
  titleHidden: {
    opacity: 0,
    pointerEvents: 'none',
  },
  titleTop: {
    color: 'var(--color-on-dark)',
  },
  cover: {
    position: 'relative',
    width: '100%',
    height: 260,
    maxHeight: 320,
    marginTop: -56,
    userSelect: 'none',
    '@media (min-width: 640px)': {
      height: 300,
    },
  },
  coverArea: {
    position: 'relative',
    height: '100%',
    width: '100%',
    cursor: 'pointer',
    overflow: 'hidden',
    backgroundColor: 'var(--color-neutral)',
  },
  coverImage: {
    height: '100%',
    width: '100%',
    objectFit: 'cover',
    objectPosition: 'center',
    transitionProperty: 'transform',
    transitionDuration: '500ms',
    ':hover': {
      transform: 'scale(1.02)',
    },
  },
  gradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    pointerEvents: 'none',
    backgroundImage:
      'linear-gradient(to bottom, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0) 25%, rgba(0, 0, 0, 0) 75%, rgba(0, 0, 0, 0.5) 100%)',
  },
  coverHint: {
    position: 'absolute',
    bottom: 14,
    left: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    border: '1px solid rgb(255 255 255 / 15%)',
    borderRadius: 9999,
    backgroundColor: 'rgb(0 0 0 / 35%)',
    paddingBlock: 4,
    paddingInline: 12,
    fontSize: 12,
    fontWeight: 500,
    color: 'rgb(255 255 255 / 90%)',
    backdropFilter: 'blur(12px)',
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: '200ms',
  },
  coverHintVisible: {
    opacity: 1,
  },
  userInfo: {
    position: 'absolute',
    right: 24,
    bottom: -24,
    zIndex: 10,
    display: 'flex',
    alignItems: 'flex-end',
    gap: 12,
    pointerEvents: 'auto',
    '@media (min-width: 640px)': {
      right: 32,
    },
  },
  userName: {
    maxWidth: 200,
    marginBottom: 28,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: '0.025em',
    color: 'var(--color-on-dark)',
    '@media (min-width: 640px)': {
      fontSize: 18,
    },
  },
  avatarLink: {
    display: 'inline-flex',
    borderRadius: 'var(--radius-container, 12px)',
    transitionProperty: 'transform',
    transitionDuration: '200ms',
    userSelect: 'none',
    ':hover': {
      transform: 'scale(1.05)',
    },
  },
  posts: {
    width: '100%',
    maxWidth: 680,
    marginInline: 'auto',
    paddingTop: 48,
    paddingRight: 16,
    paddingBottom: 80,
    paddingLeft: 16,
    '@media (min-width: 640px)': {
      paddingRight: 24,
      paddingLeft: 24,
    },
  },
  mineBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 24,
    borderRadius: 12,
    backgroundColor: 'color-mix(in srgb, var(--color-background-muted) 70%, transparent)',
    paddingBlock: 10,
    paddingInline: 16,
    fontSize: 14,
    color: 'var(--color-text-secondary)',
  },
  mineBannerLabel: {
    fontWeight: 500,
  },
  mineBannerLink: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-text-accent)',
    ':hover': {
      textDecorationLine: 'underline',
    },
  },
  emptyPosts: {
    marginTop: 32,
  },
  postItemDivider: {
    borderTop: '1px solid var(--color-border)',
  },
});

export const DEFAULT_FEED_COVER =
  'https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=1200&auto=format&fit=crop';

export interface FeedViewProps {
  userName: string;
  userImage: string | null;
  coverUrl: string | null;
  posts: FeedPost[];
  isMine?: boolean;
  initialNotifications?: NotificationItem[];
  initialUnreadCount?: number;
}

export function FeedView({
  userName,
  userImage,
  coverUrl,
  posts,
  isMine = false,
  initialNotifications = [],
  initialUnreadCount = 0,
}: FeedViewProps) {
  const router = useRouter();
  const toast = useAppToast();

  const [composerOpen, setComposerOpen] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  const [currentCover, setCurrentCover] = useState<string>(coverUrl || DEFAULT_FEED_COVER);
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [, startCoverTransition] = useTransition();

  const [isScrolled, setIsScrolled] = useState(false);
  const [isCoverHovered, setIsCoverHovered] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayCover = currentCover || DEFAULT_FEED_COVER;

  // Track scroll position on container
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setIsScrolled(el.scrollTop > 40);
  }, []);

  // Handle manual refresh / heartbeat pulse
  const handleRefresh = useCallback(() => {
    startRefreshTransition(async () => {
      try {
        await triggerFeedPulseAction();
        toast.success('已刷新居民心跳与动态');
        router.refresh();
      } catch {
        toast.error('刷新失败，请稍后重试');
      }
    });
  }, [router, toast]);

  // Handle local file selection -> open 16:9 crop modal
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      toast.error('图片大小不能超过 15MB');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setCropImageSrc(objectUrl);
    setCropModalOpen(true);
    e.target.value = '';
  };

  // Handle cropped image confirmation & upload
  const handleCropConfirm = async (croppedBlob: Blob) => {
    startCoverTransition(async () => {
      try {
        const formData = new FormData();
        formData.append('file', croppedBlob, 'cover.jpg');

        const res = await uploadFeedCoverAction(formData);
        if (res.ok) {
          setCurrentCover(res.coverUrl);
          setCropModalOpen(false);
          if (cropImageSrc) URL.revokeObjectURL(cropImageSrc);
          setCropImageSrc(null);
          toast.success('朋友圈背景已更新');
          router.refresh();
        } else {
          toast.error(res.error || '背景上传失败');
        }
      } catch (err) {
        console.error('[FeedView] cover upload error', err);
        toast.error('上传失败，请稍后重试');
      }
    });
  };

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      {...stylex.props(styles.scroll)}
    >
      {/* Hidden file input for cover upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        {...stylex.props(styles.hiddenInput)}
        onChange={handleFileSelect}
      />

      {/* 
        Sticky Top Header:
        Fixed at the top of the scroll pane.
        When scrollY === 0: transparent with ghosty buttons over the cover.
        When scrollY > 40: overlays the surface with a translucent blur, title fades in, buttons adapt to surface theme.
      */}
      <header
        {...stylex.props(styles.header, isScrolled ? styles.headerScrolled : styles.headerTop)}
      >
        {/* Left: Back button when viewing my moments */}
        <div {...stylex.props(styles.backContainer)}>
          {isMine && (
            <Link
              href="/feed"
              {...stylex.props(styles.backLink, isScrolled ? undefined : styles.backLinkTop)}
            >
              <ArrowLeft size={14} />
              <span>全部</span>
            </Link>
          )}
        </div>
        {/* Center: Title (Only visible when scrolled down or when in mine mode) */}
        <div
          {...stylex.props(
            styles.title,
            isScrolled || isMine ? styles.titleVisible : styles.titleHidden,
            !isScrolled && styles.titleTop,
          )}
        >
          {isMine ? '我的朋友圈' : '朋友圈'}
        </div>
        {/* Right: Action Buttons Toolbar (Ghosty Style) */}
        <div {...stylex.props(styles.toolbar)}>
          {/* 1. Refresh Button */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="刷新动态与居民心跳"
            aria-label="刷新动态"
            {...stylex.props(
              styles.toolbarButton,
              isScrolled ? styles.toolbarButtonScrolled : styles.toolbarButtonTop,
            )}
          >
            <RotateCw
              size={17}
              strokeWidth={2}
              {...stylex.props(styles.icon, isRefreshing && styles.iconRefreshing)}
            />
          </button>
          {/* 2. Moments Notifications Popover (朋友圈专用通知) */}
          <FeedNotificationsPopover
            initialNotifications={initialNotifications}
            initialUnreadCount={initialUnreadCount}
            scrolled={isScrolled}
          />
          {/* 3. Send / Camera Button (收纳发送按钮) */}
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            title="发布朋友圈动态"
            aria-label="发布动态"
            {...stylex.props(
              styles.toolbarButton,
              isScrolled ? styles.toolbarButtonScrolled : styles.toolbarButtonTop,
            )}
          >
            <Camera size={17} strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* 
        Cover Banner Container:
        Negative top spacing pulls the cover all the way up behind the transparent header.
        Strict height constraint (280px-320px) guarantees proper proportion.
      */}
      <div {...stylex.props(styles.cover)}>
        {/* Cover Image Area - clicking directly opens image cropper */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onMouseEnter={() => setIsCoverHovered(true)}
          onMouseLeave={() => setIsCoverHovered(false)}
          {...stylex.props(styles.coverArea)}
          title="点击更换朋友圈背景"
        >
          <SafeImage
            src={displayCover}
            alt="朋友圈背景图"
            fallbackSrc={DEFAULT_FEED_COVER}
            {...stylex.props(styles.coverImage)}
          />
          <div
            {...stylex.props(styles.gradient)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 2,
              pointerEvents: 'none',
              backgroundImage:
                'linear-gradient(to bottom, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0) 25%, rgba(0, 0, 0, 0) 75%, rgba(0, 0, 0, 0.5) 100%)',
            }}
          />
          <div {...stylex.props(styles.coverHint, isCoverHovered && styles.coverHintVisible)}>
            <Camera size={13} />
            <span>更换背景</span>
          </div>
        </div>
        <div {...stylex.props(styles.userInfo)}>
          <span {...stylex.props(styles.userName)}>{userName}</span>
          <Link
            href={isMine ? '/feed' : '/feed?filter=mine'}
            title={isMine ? '点击返回全部朋友圈' : '点击查看我的朋友圈'}
            {...stylex.props(styles.avatarLink)}
          >
            <UserAvatar name={userName} url={userImage} size={68} />
          </Link>
        </div>
      </div>
      <div {...stylex.props(styles.posts)}>
        {isMine && (
          <div {...stylex.props(styles.mineBanner)}>
            <span {...stylex.props(styles.mineBannerLabel)}>
              我的朋友圈（仅显示自己发布的动态）
            </span>
            <Link href="/feed" {...stylex.props(styles.mineBannerLink)}>
              查看全部动态 →
            </Link>
          </div>
        )}
        {posts.length === 0 ? (
          <div {...stylex.props(styles.emptyPosts)}>
            <EmptyState
              title={isMine ? '你还没有发布过动态' : '朋友圈还静悄悄的'}
              description={
                isMine
                  ? '点击右上角相机发布第一条动态吧'
                  : '点击右上角相机发布第一条动态，和 AI 居民们分享你的今天吧'
              }
            />
          </div>
        ) : (
          <div>
            {posts.map((post, index) => (
              <div key={post.id} {...stylex.props(index > 0 && styles.postItemDivider)}>
                <PostCard post={post} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer Dialog Triggered by the Top-Right Camera Button */}
      <Composer
        userName={userName}
        userImage={userImage}
        isOpen={composerOpen}
        onOpenChange={setComposerOpen}
        hideDefaultTrigger
      />

      {/* 16:9 Media Cropper Modal - Reused from avatar crop component with 16:9 aspect */}
      <MediaCropModal
        isOpen={cropModalOpen}
        imageSrc={cropImageSrc}
        onClose={() => {
          setCropModalOpen(false);
          if (cropImageSrc) URL.revokeObjectURL(cropImageSrc);
          setCropImageSrc(null);
        }}
        onConfirm={handleCropConfirm}
        aspect={16 / 9}
        title="裁剪朋友圈背景"
      />
    </div>
  );
}
