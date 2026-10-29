'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft } from 'lucide-react';

const TABS = [
  { key: 'settings', label: '角色设定' },
  { key: 'assets', label: '形象资产' },
  { key: 'security', label: '权限与设置' },
] as const;

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    width: '100%',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-2)',
    paddingBlock: 'var(--spacing-2)',
    paddingInline: 'var(--spacing-1)',
    flexShrink: 0,
  },
  back: {
    display: 'inline-flex',
    width: '32px',
    height: '32px',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-element)',
    color: 'var(--color-text-primary)',
    textDecoration: 'none',
    ':hover': { backgroundColor: 'var(--color-background-muted)' },
  },
  titleGroup: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flex: 1,
  },
  title: {
    fontSize: 'var(--font-size-lg)',
    fontWeight: 'var(--font-weight-semibold)',
    letterSpacing: '-0.01em',
    lineHeight: 1.3,
    color: 'var(--color-text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  subtitle: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
  },
  tabBar: {
    position: 'relative',
    display: 'flex',
    flexShrink: 0,
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--color-border)',
  },
  tabButton: {
    position: 'relative',
    flex: 1,
    paddingBlock: '10px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-medium)',
    color: 'var(--color-text-secondary)',
    transitionProperty: 'color',
    transitionDuration: '160ms',
    ':hover': { color: 'var(--color-text-primary)' },
  },
  tabButtonActive: {
    color: 'var(--color-text-primary)',
    fontWeight: 'var(--font-weight-semibold)',
  },
  indicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: '2px',
    borderRadius: 'var(--radius-full)',
    backgroundColor: 'var(--color-accent)',
    transitionProperty: 'transform',
    transitionDuration: '220ms',
    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  viewport: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    touchAction: 'pan-y',
  },
  track: {
    display: 'flex',
    width: '300%',
    height: '100%',
    transitionProperty: 'transform',
    transitionDuration: '260ms',
    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  panel: {
    width: '33.3333%',
    height: '100%',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    paddingBlock: 'var(--spacing-4)',
    paddingInline: '2px',
    WebkitOverflowScrolling: 'touch',
  },
});

/**
 * 完整资料页的三大 Tab：角色设定 / 形象资产 / 权限与设置。
 * 三个面板同时挂载在横向轨道上，各自维护独立滚动位置；
 * 支持点击与左右滑动切换，指示条跟随动画。
 */
export function CharacterArchiveTabs({
  characterId,
  characterName,
  settings,
  assets,
  security,
  assetCount,
}: {
  characterId: string;
  characterName: string;
  settings: ReactNode;
  assets: ReactNode;
  security: ReactNode;
  assetCount: number;
}) {
  const [index, setIndex] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const labels = TABS.map((tab) =>
    tab.key === 'assets' && assetCount > 0 ? `${tab.label} (${assetCount})` : tab.label,
  );

  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    setIndex((current) => {
      if (dx < 0) return Math.min(TABS.length - 1, current + 1);
      return Math.max(0, current - 1);
    });
  };

  return (
    <div {...stylex.props(styles.root)}>
      <header {...stylex.props(styles.header)}>
        <Link href={`/characters/${characterId}`} aria-label="返回精简资料" {...stylex.props(styles.back)}>
          <ArrowLeft size={19} />
        </Link>
        <div {...stylex.props(styles.titleGroup)}>
          <span {...stylex.props(styles.title)}>完整资料</span>
          <span {...stylex.props(styles.subtitle)}>{characterName} 的深度档案</span>
        </div>
      </header>

      <div role="tablist" aria-label="完整资料分类" {...stylex.props(styles.tabBar)}>
        {TABS.map((tab, i) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`archive-tab-${tab.key}`}
            aria-selected={index === i}
            aria-controls={`archive-panel-${tab.key}`}
            onClick={() => setIndex(i)}
            {...stylex.props(styles.tabButton, index === i && styles.tabButtonActive)}
          >
            {labels[i]}
          </button>
        ))}
        <span
          aria-hidden
          {...stylex.props(styles.indicator)}
          style={{ width: `${100 / TABS.length}%`, transform: `translateX(${index * 100}%)` }}
        />
      </div>

      <div
        {...stylex.props(styles.viewport)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div {...stylex.props(styles.track)} style={{ transform: `translateX(-${index * (100 / TABS.length)}%)` }}>
          <section
            role="tabpanel"
            id="archive-panel-settings"
            aria-labelledby="archive-tab-settings"
            {...stylex.props(styles.panel)}
          >
            {settings}
          </section>
          <section
            role="tabpanel"
            id="archive-panel-assets"
            aria-labelledby="archive-tab-assets"
            {...stylex.props(styles.panel)}
          >
            {assets}
          </section>
          <section
            role="tabpanel"
            id="archive-panel-security"
            aria-labelledby="archive-tab-security"
            {...stylex.props(styles.panel)}
          >
            {security}
          </section>
        </div>
      </div>
    </div>
  );
}
