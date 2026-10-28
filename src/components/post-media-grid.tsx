'use client';

import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import 'yet-another-react-lightbox/styles.css';
import { radiusVars } from '@astryxdesign/core/theme/tokens.stylex';
import { SafeImage } from '@/components/safe-image';
import { MediaLightbox } from '@/components/media-lightbox';
import type { PostMedia } from '@/server/feed';

const styles = stylex.create({
  wrapper: {
    marginTop: 8,
  },
  grid: {
    display: 'grid',
    gap: 4,
    overflow: 'hidden',
    borderRadius: radiusVars['--radius-element'],
  },
  grid2: {
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  },
  grid3: {
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  },
  cell: {
    position: 'relative',
    aspectRatio: '1 / 1',
    overflow: 'hidden',
    cursor: 'zoom-in',
    backgroundColor: 'var(--color-background-muted)',
  },
  cellImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  single: {
    display: 'block',
    maxHeight: 420,
    overflow: 'hidden',
    borderRadius: radiusVars['--radius-element'],
    cursor: 'zoom-in',
    backgroundColor: 'var(--color-background-muted)',
  },
  singleImage: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: 420,
    width: 'auto',
    height: 'auto',
    objectFit: 'contain',
  },
});

/**
 * 朋友圈动态图片九宫格：
 * 1 张独占大图（保持比例），2/4 张两列，其余三列；点击任意图片打开 Lightbox 浏览全部。
 * 缩略图与大图统一走 SafeImage / MediaLightbox，代理地址不再由业务层拼接。
 */
export function PostMediaGrid({ media }: { media: PostMedia[] }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (media.length === 0) return null;

  const cells =
    media.length === 1
      ? styles.single
      : [styles.grid, media.length === 2 || media.length === 4 ? styles.grid2 : styles.grid3];

  return (
    <div {...stylex.props(styles.wrapper)}>
      <div {...stylex.props(cells)}>
        {media.map((item, index) => (
          <button
            key={`${item.id ?? item.url}-${index}`}
            type="button"
            aria-label={`查看图片 ${index + 1}`}
            onClick={() => setLightboxIndex(index)}
            {...stylex.props(media.length === 1 ? styles.single : styles.cell)}
          >
            <SafeImage
              src={item.url}
              assetId={item.id}
              alt={`动态图片 ${index + 1}`}
              showRetry={false}
              xstyle={media.length === 1 ? styles.singleImage : styles.cellImage}
            />
          </button>
        ))}
      </div>

      <MediaLightbox
        media={lightboxIndex !== null ? media[lightboxIndex] ?? null : null}
        gallery={media}
        index={lightboxIndex ?? 0}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    </div>
  );
}
