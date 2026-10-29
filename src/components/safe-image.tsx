'use client';

import { useCallback, useMemo, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { colorVars, radiusVars, textSizeVars } from '@astryxdesign/core/theme/tokens.stylex';
import { ImageOff, RefreshCw } from 'lucide-react';
import { resolveMediaUrl } from '@/lib/utils';

const shimmer = stylex.keyframes({
  '0%': { backgroundPosition: '200% 0' },
  '100%': { backgroundPosition: '-200% 0' },
});

const spin = stylex.keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});

const styles = stylex.create({
  loading: {
    backgroundImage:
      'linear-gradient(90deg, var(--color-background-muted) 0%, var(--color-border) 50%, var(--color-background-muted) 100%)',
    backgroundSize: '200% 100%',
    animationName: shimmer,
    animationDuration: '1.4s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'linear',
  },
  fallback: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    height: '100%',
    minHeight: 32,
    padding: 8,
    boxSizing: 'border-box',
    overflow: 'hidden',
    color: colorVars['--color-text-secondary'],
    backgroundColor: colorVars['--color-background-muted'],
    fontSize: textSizeVars['--font-size-xs'],
    lineHeight: 1.4,
    textAlign: 'center',
  },
  fallbackCompact: {
    padding: 2,
    gap: 2,
    minHeight: 0,
  },
  fallbackIcon: {
    width: 20,
    height: 20,
    flexShrink: 0,
    opacity: 0.65,
  },
  fallbackIconCompact: {
    width: 16,
    height: 16,
  },
  retry: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    paddingBlock: 3,
    paddingInline: 8,
    borderRadius: radiusVars['--radius-full'],
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    backgroundColor: colorVars['--color-background-surface'],
    color: colorVars['--color-text-primary'],
    fontSize: textSizeVars['--font-size-xs'],
    cursor: 'pointer',
    ':hover': {
      backgroundColor: colorVars['--color-background-body'],
    },
  },
  retryIcon: {
    width: 12,
    height: 12,
  },
  retryIconSpin: {
    animationName: spin,
    animationDuration: '0.9s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'linear',
  },
  hidden: {
    display: 'none',
  },
});

export interface SafeImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'onError' | 'onLoad'> {
  /** Raw blob URL / path / data URL. Normalization (private blob → authenticated proxy) happens inside. */
  src?: string | null;
  /** Optional media asset id. When present, the authenticated proxy is addressed by id (ownership checked). */
  assetId?: string | null;
  alt: string;
  /** Alternate image shown once when the primary source fails (e.g. a default cover). */
  fallbackSrc?: string | null;
  /** Custom content rendered on failure. Defaults to a built-in placeholder with retry. */
  fallback?: React.ReactNode;
  /** Hide the built-in retry button (useful inside a clickable grid cell). */
  showRetry?: boolean;
  /** Compact fallback (icon only), used by small thumbnails. */
  compactFallback?: boolean;
  /** Disable the loading shimmer for tiny/local images. */
  showSkeleton?: boolean;
  xstyle?: stylex.StyleXStyles;
  onError?: React.ReactEventHandler<HTMLImageElement>;
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
}

/**
 * 项目内唯一允许直接渲染位图的组件。
 *
 * - 统一鉴权：私有 Vercel Blob / 需要 token 的图片自动走 `/api/media/file` 代理，
 *   调用方只传原始 URL（或 assetId），不再各自拼接代理地址。
 * - 完整状态：加载中骨架、加载成功、失败降级、点击重试。
 * - 属性透传：继承 `<img>` 全部属性；样式与布局仍可完全由调用方控制。
 */
export function SafeImage({
  src,
  assetId,
  alt,
  fallbackSrc,
  fallback,
  showRetry = true,
  compactFallback = false,
  showSkeleton = true,
  xstyle,
  className,
  style,
  onError,
  onLoad,
  ...props
}: SafeImageProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSources, setFailedSources] = useState<Record<string, true>>({});
  const [retryCount, setRetryCount] = useState(0);

  const primarySrc = useMemo(() => resolveMediaUrl(src, assetId), [src, assetId]);
  const alternateSrc = useMemo(() => resolveMediaUrl(fallbackSrc), [fallbackSrc]);

  // Derived state: switching `src` naturally returns to the loading state, and a failed
  // primary source transparently falls back to `fallbackSrc` exactly once.
  const primaryFailed = Boolean(primarySrc && failedSources[primarySrc]);
  const resolvedSrc =
    primaryFailed && alternateSrc && alternateSrc !== primarySrc && !failedSources[alternateSrc]
      ? alternateSrc
      : primarySrc;
  const status: 'loading' | 'loaded' | 'error' =
    resolvedSrc && loadedSrc === resolvedSrc
      ? 'loaded'
      : resolvedSrc && failedSources[resolvedSrc]
        ? 'error'
        : 'loading';

  const handleLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      if (resolvedSrc) setLoadedSrc(resolvedSrc);
      onLoad?.(event as React.SyntheticEvent<HTMLImageElement>);
    },
    [onLoad, resolvedSrc],
  );

  const handleError = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      if (resolvedSrc) {
        setFailedSources((previous) => ({ ...previous, [resolvedSrc]: true }));
      }
      onError?.(event as React.SyntheticEvent<HTMLImageElement>);
    },
    [onError, resolvedSrc],
  );

  const retry = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setFailedSources({});
    setLoadedSrc(null);
    setRetryCount((count) => count + 1);
  }, []);

  if (!resolvedSrc) {
    return (
      <span
        role="img"
        aria-label={alt}
        {...stylex.props(styles.fallback, compactFallback && styles.fallbackCompact, xstyle)}
        className={className}
      >
        <ImageOff
          aria-hidden
          {...stylex.props(styles.fallbackIcon, compactFallback && styles.fallbackIconCompact)}
        />
      </span>
    );
  }

  if (status === 'error') {
    if (fallback) {
      return (
        <span
          aria-label={alt}
          {...stylex.props(xstyle)}
          className={className}
          style={style}
        >
          {fallback}
        </span>
      );
    }
    return (
      <span
        role="img"
        aria-label={`${alt}（加载失败）`}
        {...stylex.props(styles.fallback, compactFallback && styles.fallbackCompact, xstyle)}
        className={className}
        style={style}
      >
        <ImageOff
          aria-hidden
          {...stylex.props(styles.fallbackIcon, compactFallback && styles.fallbackIconCompact)}
        />
        {!compactFallback ? <span>图片加载失败</span> : null}
        {showRetry ? (
          <span
            role="button"
            tabIndex={0}
            onClick={retry}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') retry(event as unknown as React.MouseEvent);
            }}
            {...stylex.props(styles.retry)}
          >
            <RefreshCw aria-hidden {...stylex.props(styles.retryIcon)} />
            重试
          </span>
        ) : null}
      </span>
    );
  }

  const displaySrc =
    retryCount > 0 && resolvedSrc.startsWith('/api/media/file')
      ? `${resolvedSrc}${resolvedSrc.includes('?') ? '&' : '?'}retry=${retryCount}`
      : resolvedSrc;

  const imageProps = stylex.props(xstyle);
  const loadingClassName = status === 'loading' && showSkeleton ? stylex.props(styles.loading).className : null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- 图片需经鉴权代理 / 私有 Blob，无法交给 next/image 优化器
    <img
      {...imageProps}
      // 重试时更换 key，强制浏览器重新发起被缓存的失败请求。
      key={retryCount}
      src={displaySrc}
      alt={alt}
      // 合并 xstyle 的 className，而不是覆盖它：否则调用方传入的尺寸 / 圆角 / objectFit 会全部失效。
      className={[imageProps.className, className, loadingClassName].filter(Boolean).join(' ') || undefined}
      style={{ ...imageProps.style, ...style }}
      onLoad={handleLoad}
      onError={handleError}
      decoding="async"
      {...props}
    />
  );
}
