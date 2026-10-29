'use client';

import { useState } from 'react';
import Link from 'next/link';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, Images, MessageCircle, UserRound } from 'lucide-react';
import { UserAvatar } from '@/components/user-avatar';
import { SafeImage } from '@/components/safe-image';
import { MediaLightbox } from '@/components/media-lightbox';
import { SendMessageButton } from '@/components/send-message-button';
import type { PostMedia } from '@/server/feed';

const styles = stylex.create({
  page: {
    width: '100%',
    maxWidth: '32rem',
    marginInline: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-5)',
    paddingBottom: 'var(--spacing-4)',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 'var(--radius-container)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--color-border)',
    backgroundColor: 'var(--color-background-surface)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-4)',
    paddingInline: 'var(--spacing-5)',
    paddingBlock: 'var(--spacing-5)',
  },
  avatarButton: {
    display: 'inline-flex',
    flexShrink: 0,
    padding: 0,
    border: 'none',
    borderRadius: 'var(--radius-container)',
    background: 'transparent',
    cursor: 'zoom-in',
  },
  identity: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
    flex: 1,
  },
  nameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  name: {
    fontSize: 'var(--font-size-2xl)',
    fontWeight: 'var(--font-weight-semibold)',
    letterSpacing: '-0.025em',
    lineHeight: 1.25,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  handle: {
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-sm)',
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  signature: {
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-sm)',
    lineHeight: 1.5,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  section: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: 'var(--color-border)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-3)',
    paddingInline: 'var(--spacing-5)',
    paddingBlock: 'var(--spacing-3-5, 14px)',
    textDecoration: 'none',
    color: 'inherit',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    ':hover': {backgroundColor: 'var(--color-background-muted)'},
    ':active': {backgroundColor: 'var(--color-background-muted)'},
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: 'var(--color-border)',
    marginInline: 'var(--spacing-5)',
  },
  rowIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'var(--color-background-muted)',
    color: 'var(--color-text-secondary)',
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 'var(--font-size-md, 15px)',
    fontWeight: 'var(--font-weight-medium)',
  },
  rowMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  thumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  thumb: {
    position: 'relative',
    width: 34,
    height: 34,
    overflow: 'hidden',
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'var(--color-background-muted)',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  thumbEmpty: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'var(--color-background-muted)',
    color: 'var(--color-text-secondary)',
    flexShrink: 0,
  },
  chevron: {
    flexShrink: 0,
    color: 'var(--color-text-tertiary, var(--color-text-secondary))',
  },
  footer: {
    position: 'sticky',
    bottom: 0,
    zIndex: 10,
    display: 'flex',
    width: '100%',
    paddingTop: 'var(--spacing-3)',
    paddingBottom: 'var(--spacing-4)',
    backgroundColor: 'color-mix(in srgb, var(--color-background-body) 92%, transparent)',
    backdropFilter: 'blur(12px)',
  },
  emptyPhotos: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
  },
});

export type CharacterMiniProfileData = {
  id: string;
  name: string;
  username: string;
  bio: string | null;
  avatarUrl: string | null;
  avatarEmoji: string;
  avatarColor: string;
  relationshipToUser: string | null;
};

/**
 * 精简资料页：只保留经典 IM 名片的基础信息。
 * 头像可放大预览；「朋友圈」「完整资料」为二级入口；底部固定发起聊天。
 */
export function CharacterMiniProfile({
  character,
  recentPhotos,
}: {
  character: CharacterMiniProfileData;
  recentPhotos: PostMedia[];
}) {
  const [avatarPreview, setAvatarPreview] = useState(false);
  const signature = character.bio?.trim() || character.relationshipToUser?.trim() || '';
  const photos = recentPhotos.slice(0, 3);

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.card)}>
        {/* 头部：头像 + 昵称 + 签名 */}
        <div {...stylex.props(styles.header)}>
          {character.avatarUrl ? (
            <button
              type="button"
              aria-label={`查看 ${character.name} 的头像`}
              onClick={() => setAvatarPreview(true)}
              {...stylex.props(styles.avatarButton)}
            >
              <UserAvatar
                name={character.name}
                emoji={character.avatarEmoji}
                color={character.avatarColor}
                url={character.avatarUrl}
                size={80}
              />
            </button>
          ) : (
            <UserAvatar
              name={character.name}
              emoji={character.avatarEmoji}
              color={character.avatarColor}
              url={character.avatarUrl}
              size={80}
            />
          )}
          <div {...stylex.props(styles.identity)}>
            <div {...stylex.props(styles.nameRow)}>
              <span {...stylex.props(styles.name)}>{character.name}</span>
            </div>
            <span {...stylex.props(styles.handle)}>@{character.username}</span>
            {signature && <span {...stylex.props(styles.signature)}>{signature}</span>}
          </div>
        </div>

        {/* 信息条目：朋友圈 / 完整资料 */}
        <div {...stylex.props(styles.section)}>
          <Link href={`/feed/${character.id}`} {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.rowIcon)}>
              <Images size={16} />
            </span>
            <span {...stylex.props(styles.rowLabel)}>朋友圈</span>
            <span {...stylex.props(styles.rowMeta)}>
              {photos.length > 0 ? (
                <span {...stylex.props(styles.thumbs)}>
                  {photos.map((photo, index) => (
                    <span key={`${photo.id ?? photo.url}-${index}`} {...stylex.props(styles.thumb)}>
                      <SafeImage
                        src={photo.url}
                        assetId={photo.id}
                        alt={`朋友圈图片 ${index + 1}`}
                        showRetry={false}
                        compactFallback
                        xstyle={styles.thumbImage}
                      />
                    </span>
                  ))}
                </span>
              ) : (
                <span {...stylex.props(styles.emptyPhotos)}>暂无动态</span>
              )}
              <ChevronRight size={16} {...stylex.props(styles.chevron)} />
            </span>
          </Link>
          <div {...stylex.props(styles.rowDivider)} />
          <Link href={`/characters/${character.id}/profile`} {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.rowIcon)}>
              <UserRound size={16} />
            </span>
            <span {...stylex.props(styles.rowLabel)}>完整资料</span>
            <span {...stylex.props(styles.rowMeta)}>
              <ChevronRight size={16} {...stylex.props(styles.chevron)} />
            </span>
          </Link>
        </div>
      </div>

      {/* 底部主操作：发起聊天 */}
      <div {...stylex.props(styles.footer)}>
        <SendMessageButton
          characterId={character.id}
          label="发消息"
          icon={<MessageCircle size={17} />}
          width="100%"
          size="lg"
        />
      </div>

      <MediaLightbox
        media={avatarPreview && character.avatarUrl ? {url: character.avatarUrl} : null}
        onClose={() => setAvatarPreview(false)}
      />
    </div>
  );
}
