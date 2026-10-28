'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Download from 'yet-another-react-lightbox/plugins/download';
import 'yet-another-react-lightbox/styles.css';

import * as stylex from '@stylexjs/stylex';
import { colorVars, radiusVars, shadowVars } from '@astryxdesign/core/theme/tokens.stylex';
import { Code2, Download as DownloadIcon, Info, X, ZoomIn, ZoomOut } from 'lucide-react';
import { resolveMediaUrl } from '@/lib/utils';
import { MediaPerceptionPanel } from '@/components/media-perception-panel';

const styles = stylex.create({
  toolbarBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: radiusVars['--radius-full'],
    color: '#ffffff',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transitionProperty: 'background-color, color, transform',
    transitionDuration: '150ms',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      color: '#ffffff',
    },
    ':active': {
      transform: 'scale(0.92)',
    },
  },
  toolbarBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    color: '#ffffff',
  },
  infoWrapper: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoPopover: {
    position: 'fixed',
    top: '60px',
    right: '20px',
    width: '320px',
    maxWidth: 'calc(100vw - 40px)',
    padding: '14px 16px',
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: 'rgba(24, 24, 27, 0.96)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    boxShadow: shadowVars['--shadow-high'],
    backdropFilter: 'blur(16px)',
    color: '#ffffff',
    fontSize: '13px',
    lineHeight: 1.6,
    zIndex: 10005,
    pointerEvents: 'auto',
    textAlign: 'left',
  },
  infoTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#93c5fd',
    marginBottom: '6px',
  },
  infoText: {
    color: 'rgba(255, 255, 255, 0.92)',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  },
  devSide: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 'min(420px, 92vw)',
    zIndex: 10002,
    backgroundColor: colorVars['--color-background-surface'],
    borderLeftWidth: '1px',
    borderLeftStyle: 'solid',
    borderLeftColor: colorVars['--color-border'],
    boxShadow: shadowVars['--shadow-high'],
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  devSideHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingInline: '16px',
    paddingBlock: '12px',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colorVars['--color-border'],
    backgroundColor: colorVars['--color-background-surface'],
  },
  devSideTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    fontWeight: 600,
    color: colorVars['--color-text-primary'],
  },
  devSideClose: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: radiusVars['--radius-element'],
    color: colorVars['--color-text-secondary'],
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transitionProperty: 'background-color, color',
    transitionDuration: '150ms',
    ':hover': {
      backgroundColor: colorVars['--color-background-muted'],
      color: colorVars['--color-text-primary'],
    },
  },
});

export type LightboxMediaItem = {
  id?: string | null;
  url: string;
  originalFilename?: string | null;
  width?: number | null;
  height?: number | null;
  perception?: { summary?: string | null; ocrText?: string | null; status?: string } | null;
};

/** Normalize a list of raw media records into lightbox slides (always via the auth proxy). */
export function toLightboxSlides(items: LightboxMediaItem[]) {
  return items
    .map((item) => {
      const src = resolveMediaUrl(item.url, item.id);
      if (!src) return null;
      return {
        src,
        download: item.originalFilename
          ? { filename: item.originalFilename, url: src }
          : undefined,
        width: item.width ?? undefined,
        height: item.height ?? undefined,
      };
    })
    .filter((slide): slide is NonNullable<typeof slide> => slide !== null);
}

/**
 * Unified lightbox for single images and galleries.
 * All slide URLs are resolved through `resolveMediaUrl`, so raw private blob URLs
 * never reach the browser (the historical cause of broken large-image previews).
 */
export function MediaLightbox({
  media,
  gallery,
  index = 0,
  onIndexChange,
  onClose,
  isDevMode = false,
  mediaAssetId,
}: {
  /** Active (or single) media item. */
  media: LightboxMediaItem | null;
  /** Optional gallery; when provided, prev/next navigation is enabled. */
  gallery?: LightboxMediaItem[];
  index?: number;
  onIndexChange?: (index: number) => void;
  onClose: () => void;
  isDevMode?: boolean;
  mediaAssetId?: string | null;
}) {
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [showInfoPopover, setShowInfoPopover] = useState(false);

  if (!media) return null;

  const items = gallery && gallery.length > 0 ? gallery : [media];
  const slides = toLightboxSlides(items);
  const isGallery = slides.length > 1;
  const hasPerception = Boolean(media.perception?.summary);

  const handleClose = () => {
    setShowDevPanel(false);
    setShowInfoPopover(false);
    onClose();
  };

  return (
    <>
      <Lightbox
        open={Boolean(media)}
        close={handleClose}
        index={isGallery ? index : 0}
        slides={slides}
        on={{
          view: ({ index: nextIndex }) => {
            if (isGallery && nextIndex !== index) onIndexChange?.(nextIndex);
          },
        }}
        plugins={[Zoom, Download]}
        controller={{ closeOnBackdropClick: true }}
        zoom={{
          // 默认展示适配尺寸，支持缩小至 0.2 倍，支持放大至 10 倍
          minZoom: 0.2,
          maxZoomPixelRatio: 10,
          scrollToZoom: true,
        }}
        render={{
          buttonPrev: isGallery ? undefined : () => null,
          buttonNext: isGallery ? undefined : () => null,
          iconDownload: () => <DownloadIcon size={20} color="#ffffff" />,
          iconClose: () => <X size={22} color="#ffffff" />,
          iconZoomIn: () => <ZoomIn size={20} color="#ffffff" />,
          iconZoomOut: () => <ZoomOut size={20} color="#ffffff" />,
          controls: () => (
            <>
              {hasPerception && showInfoPopover ? (
                <div
                  {...stylex.props(styles.infoPopover)}
                  onMouseEnter={() => setShowInfoPopover(true)}
                  onMouseLeave={() => setShowInfoPopover(false)}
                >
                  <div {...stylex.props(styles.infoTag)}>
                    <Info size={13} />
                    <span>AI 视觉感知</span>
                  </div>
                  <div {...stylex.props(styles.infoText)}>
                    {media.perception?.summary}
                  </div>
                </div>
              ) : null}
            </>
          ),
          buttonZoom: ({ zoom, maxZoom, minZoom, zoomIn, zoomOut }) => (
            <>
              <button
                type="button"
                className="yarl__button"
                onClick={zoomIn}
                disabled={zoom >= maxZoom}
                title="放大"
                aria-label="放大"
                style={{ color: '#ffffff' }}
              >
                <ZoomIn size={20} color="#ffffff" />
              </button>
              <button
                type="button"
                className="yarl__button"
                onClick={zoomOut}
                disabled={zoom <= minZoom}
                title="缩小"
                aria-label="缩小"
                style={{ color: '#ffffff' }}
              >
                <ZoomOut size={20} color="#ffffff" />
              </button>
            </>
          ),
        }}
        toolbar={{
          buttons: [
            hasPerception ? (
              <button
                key="info-btn"
                type="button"
                {...stylex.props(styles.toolbarBtn, showInfoPopover && styles.toolbarBtnActive)}
                onMouseEnter={() => setShowInfoPopover(true)}
                onMouseLeave={() => setShowInfoPopover(false)}
                onClick={() => setShowInfoPopover((prev) => !prev)}
                title="AI 视觉感知信息"
              >
                <Info size={20} color="#ffffff" />
              </button>
            ) : null,

            // 开发者模式 AI 视觉详情按钮
            isDevMode && mediaAssetId ? (
              <button
                key="dev-btn"
                type="button"
                {...stylex.props(styles.toolbarBtn, showDevPanel && styles.toolbarBtnActive)}
                onClick={() => setShowDevPanel((prev) => !prev)}
                title={showDevPanel ? '收起感知详情' : '打开 AI 视觉感知详情'}
              >
                <Code2 size={20} color="#ffffff" />
              </button>
            ) : null,

            'download',
            'close',
          ],
        }}
      />

      {/* 开发者模式：AI 视觉感知详情抽屉 (通过 Portal 渲染到顶级 body，彻底脱离 Lightbox 事件流) */}
      {isDevMode && mediaAssetId && showDevPanel
        ? createPortal(
            <div
              {...stylex.props(styles.devSide)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div {...stylex.props(styles.devSideHeader)}>
                <div {...stylex.props(styles.devSideTitle)}>
                  <Code2 size={16} />
                  <span>AI 视觉感知详情</span>
                </div>
                <button
                  type="button"
                  {...stylex.props(styles.devSideClose)}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setShowDevPanel(false);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="关闭详情面板"
                >
                  <X size={16} />
                </button>
              </div>
              <MediaPerceptionPanel mediaAssetId={mediaAssetId} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
