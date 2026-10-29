'use client';

import { useState } from 'react';
import Link from 'next/link';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, Images, IdCard, MessageCircle, Sparkles } from 'lucide-react';
import { Text } from '@astryxdesign/core/Text';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { UserAvatar } from '@/components/user-avatar';
import { SafeImage } from '@/components/safe-image';
import { MediaLightbox } from '@/components/media-lightbox';
import type { PostMedia } from '@/server/feed';
import type { FriendPermission } from '@/server/friend-permissions';

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-4)',
    width: '100%',
    maxWidth: '34rem',
    marginInline: 'auto',
    paddingBottom: 'var(--spacing-8)',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 'var(--radius-container)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-background-surface)',
    overflow: 'hidden',
  },
  hero: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-4)',
    padding: 'var(--spacing-5)',
  },
  avatarButton: {
    display: 'inline-flex',
    padding: 0,
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'zoom-in',
    borderRadius: 'var(--radius-full)',
  },
  identity: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
    flex: 1,
  },
  nameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  name: {
    fontSize: 'var(--font-size-2xl)',
    fontWeight: 'var(--font-weight-semibold)',
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
    color: 'var(--color-text-primary)',
  },
  username: {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary)',
  },
  bio: {
    marginTop: '2px',
    fontSize: 'var(--font-size-sm)',
    lineHeight: 1.5,
    color: 'var(--color-text-secondary)',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-3)',
    minHeight: '56px',
    paddingBlock: 'var(--spacing-2)',
    paddingInline: 'var(--spacing-4)',
    textDecoration: 'none',
    color: 'var(--color-text-primary)',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    ':hover': { backgroundColor: 'var(--color-background-muted)' },
    ':active': { backgroundColor: 'var(--color-background-muted)' },
  },
  rowIcon: {
    display: 'flex',
    width: '32px',
    height: '32px',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'var(--color-background-muted)',
    color: 'var(--color-text-accent)',
  },
  rowBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: 'var(--font-size-base)',
    fontWeight: 'var(--font-weight-medium)',
  },
  rowHint: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
  },
  thumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
  },
  thumb: {
    width: '34px',
    height: '34px',
    borderRadius: 'var(--radius-element)',
    objectFit: 'cover',
    backgroundColor: 'var(--color-background-muted)',
  },
  chevron: {
    display: 'flex',
    flexShrink: 0,
    color: 'var(--color-text-tertiary, var(--color-text-secondary))',
  },
  divider: {
    height: '1px',
    marginInline: 'var(--spacing-4)',
    backgroundColor: 'var(--color-border)',
  },
  actionBar: {
    display: 'flex',
    paddingInline: 'var(--spacing-2)',
  },
});

export type CompactCharacter = {
  id: string;
  name: string;
  username: string;
  bio: string | null;
  relationshipToUser: string | null;
  avatarUrl: string | null;
  avatarEmoji: string;
  avatarColor: string;
  status: string;
  friendPermission: FriendPermission;
};

/**
 * 第一层「精简资料页」：对标经典 IM 的个人名片。
 * 只展示头像、昵称、签名、朋友圈缩略图、完整资料入口与发消息按钮，
 * 所有复杂人设 / 模型参数收敛到 `/characters/[id]/profile`。
 */
export function CharacterCompactProfile({
  character,
  recentMedia,
  postCount,
  onSendMessage,
}: {
  character: CompactCharacter;
  recentMedia: PostMedia[];
  postCount: number;
  onSendMessage: React.ReactNode;
}) {
  const [avatarOpen, setAvatarOpen] = useState(false);
  const active = character.status === 'active';
  const canShowFeed = character.friendPermission !== 'chat_only';
  const thumbnails = recentMedia.slice(0, 3);

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.hero)}>
          {character.avatarUrl ? (
            <button
              type="button"
              aria-label={`查看 ${character.name} 的头像大图`}
              onClick={() => setAvatarOpen(true)}
              {...stylex.props(styles.avatarButton)}
            >
              <UserAvatar
                name={character.name}
                emoji={character.avatarEmoji}
                color={character.avatarColor}
                url={character.avatarUrl}
                size={88}
              />
            </button>
          ) : (
            <UserAvatar
              name={character.name}
              emoji={character.avatarEmoji}
              color={character.avatarColor}
              size={88}
            />
          )}
          <div {...stylex.props(styles.identity)}>
            <div {...stylex.props(styles.nameRow)}>
              <span {...stylex.props(styles.name)}>{character.name}</span>
              <StatusDot variant={active ? 'success' : 'neutral'} label={active ? '活跃' : '已禁用'} />
            </div>
            <span {...stylex.props(styles.username)}>@{character.username}</span>
            <span {...stylex.props(styles.bio)}>
              {character.bio?.trim() || `与你的关系：${character.relationshipToUser || '朋友'}`}
            </span>
          </div>
        </div>

        <div {...stylex.props(styles.divider)} />

        <div {...stylex.props(styles.section)}>
          {canShowFeed ? (
            <Link href={`/feed/${character.id}`} {...stylex.props(styles.row)}>
              <span {...stylex.props(styles.rowIcon)}>
                <Images size={17} />
              </span>
              <span {...stylex.props(styles.rowBody)}>
                <span {...stylex.props(styles.rowLabel)}>朋友圈</span>
                <span {...stylex.props(styles.rowHint)}>
                  {postCount > 0 ? `共 ${postCount} 条动态` : '还没有发布动态'}
                </span>
              </span>
              {thumbnails.length > 0 && (
                <span {...stylex.props(styles.thumbs)}>
                  {thumbnails.map((media, index) => (
                    <SafeImage
                      key={`${media.id ?? media.url}-${index}`}
                      src={media.url}
                      assetId={media.id}
                      alt=""
                      showRetry={false}
                      xstyle={styles.thumb}
                    />
                  ))}
                </span>
              )}
              <span {...stylex.props(styles.chevron)}>
                <ChevronRight size={18} />
              </span>
            </Link>
          ) : (
            <div {...stylex.props(styles.row)} aria-disabled>
              <span {...stylex.props(styles.rowIcon)}>
                <Images size={17} />
              </span>
              <span {...stylex.props(styles.rowBody)}>
                <span {...stylex.props(styles.rowLabel)}>朋友圈</span>
                <span {...stylex.props(styles.rowHint)}>仅聊天模式下朋友圈已关闭</span>
              </span>
            </div>
          )}

          <div {...stylex.props(styles.divider)} />

          <Link href={`/characters/${character.id}/profile`} {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.rowIcon)}>
              <IdCard size={17} />
            </span>
            <span {...stylex.props(styles.rowBody)}>
              <span {...stylex.props(styles.rowLabel)}>完整资料</span>
              <span {...stylex.props(styles.rowHint)}>角色设定 · 形象资产 · 权限与设置</span>
            </span>
            <span {...stylex.props(styles.chevron)}>
              <ChevronRight size={18} />
            </span>
          </Link>
        </div>
      </div>

      <div {...stylex.props(styles.actionBar)}>{onSendMessage}</div>

      <MediaLightbox
        media={avatarOpen && character.avatarUrl ? { url: character.avatarUrl, width: 1024, height: 1024 } : null}
        onClose={() => setAvatarOpen(false)}
      />
    </div>
  );
}

/** 精简页底部的欢迎提示（占位，保持卡片纯粹的 IM 观感）。 */
export function CompactProfileFootNote() {
  return (
    <Text type="supporting" size="sm" as="p" style={{ textAlign: 'center' }}>
      <Sparkles size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: '-2px' }} />
      AI 居民由你的设定驱动，聊天内容仅保存在你的账户中
      <MessageCircle size={12} style={{ display: 'inline', marginLeft: 4, verticalAlign: '-2px' }} />
    </Text>
  );
}
