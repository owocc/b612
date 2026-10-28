'use client';

import { useEffect, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';

export type ChatActionMenuItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  destructive?: boolean;
};

const styles = stylex.create({
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 60,
    backgroundColor: 'var(--color-overlay)',
  },
  menu: {
    position: 'fixed',
    zIndex: 61,
    minWidth: '176px',
    paddingBlock: 'var(--spacing-1)',
    borderRadius: 'var(--radius-container)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--color-border)',
    backgroundColor: 'var(--color-background-popover)',
    boxShadow: 'var(--shadow-high)',
    outline: 'none',
  },
  sheet: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 61,
    paddingTop: 'var(--spacing-3)',
    paddingBottom: 'calc(var(--spacing-3) + env(safe-area-inset-bottom))',
    paddingInline: 'var(--spacing-2)',
    borderTopLeftRadius: 'var(--radius-container)',
    borderTopRightRadius: 'var(--radius-container)',
    backgroundColor: 'var(--color-background-popover)',
    boxShadow: 'var(--shadow-high)',
    outline: 'none',
  },
  item: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 'var(--spacing-3)',
    borderWidth: 0,
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'transparent',
    paddingInline: 'var(--spacing-3)',
    paddingBlock: 'var(--spacing-2)',
    textAlign: 'left',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--font-size-base)',
    outline: 'none',
    cursor: 'pointer',
    ':focus-visible': { outline: 'none', backgroundColor: 'var(--color-overlay-hover)' },
    ':hover': { '@media (hover: hover)': { backgroundColor: 'var(--color-overlay-hover)' } },
  },
  itemSheet: {
    paddingBlock: 'var(--spacing-3)',
    justifyContent: 'center',
    fontSize: 'var(--font-size-base)',
  },
  destructive: { color: 'var(--color-text-red)' },
  icon: { display: 'flex', flexShrink: 0 },
});

const ESTIMATED_ITEM_HEIGHT = 40;

export function ChatActionMenu({
  isOpen,
  x,
  y,
  isMobile,
  items,
  onSelect,
  onClose,
}: {
  isOpen: boolean;
  x: number;
  y: number;
  isMobile: boolean;
  items: ChatActionMenuItem[];
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部、滚动、Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onScroll = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // 延迟一帧挂载，避免触发菜单的那次右键 / 长按事件立刻把它关掉
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll);
      document.addEventListener('keydown', onKeyDown);
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const menuHeight = items.length * ESTIMATED_ITEM_HEIGHT + 12;
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
  const left = Math.max(8, Math.min(x, viewportWidth - 192));
  const top = Math.max(8, Math.min(y, viewportHeight - menuHeight - 8));

  const onItemKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      buttons[(index + 1 + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Tab') {
      onClose();
    }
  };

  return (
    <>
      {isMobile && <div {...stylex.props(styles.backdrop)} onClick={onClose} aria-hidden />}
      <div
        ref={menuRef}
        role="menu"
        aria-label="会话操作"
        tabIndex={-1}
        onKeyDown={onItemKeyDown}
        {...stylex.props(isMobile ? styles.sheet : styles.menu)}
        style={isMobile ? undefined : { left, top }}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            onClick={() => onSelect(item.key)}
            {...stylex.props(
              styles.item,
              isMobile && styles.itemSheet,
              item.destructive && styles.destructive,
            )}
          >
            <span {...stylex.props(styles.icon)}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
