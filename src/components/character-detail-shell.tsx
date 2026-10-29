'use client';

import { useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as stylex from '@stylexjs/stylex';
import { colorVars } from '@astryxdesign/core/theme/tokens.stylex';
import { ArrowLeft } from 'lucide-react';

const styles = stylex.create({
  root: {
    display: 'flex',
    width: '100%',
    flexDirection: 'column',
  },
  bar: {
    display: 'none',
    // 仅手机端出现（< 768px）；平板/桌面沿用双栏详情或聊天内的侧边浮层
    '@media (max-width: 767px)': {
      position: 'sticky',
      top: 0,
      zIndex: 20,
      display: 'flex',
      flexShrink: 0,
      alignItems: 'center',
      gap: 'var(--spacing-1)',
      minHeight: '52px',
      // 抵消 SplitLayout 详情区的内边距，让导航栏贴合屏幕边缘
      marginInline: 'calc(var(--spacing-6) * -1)',
      marginTop: 'calc(var(--spacing-6) * -1)',
      marginBottom: 'var(--spacing-4)',
      paddingInline: 'var(--spacing-2)',
      paddingBlock: 'var(--spacing-1)',
      backgroundColor: colorVars['--color-background-surface'],
      borderBottomWidth: '1px',
      borderBottomStyle: 'solid',
      borderBottomColor: colorVars['--color-border'],
    },
  },
  back: {
    display: 'flex',
    height: '40px',
    width: '40px',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 'var(--radius-element)',
    padding: 0,
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    cursor: 'pointer',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    ':hover': {backgroundColor: colorVars['--color-background-muted']},
    ':focus-visible': {
      outline: '2px solid',
      outlineColor: colorVars['--color-accent'],
      outlineOffset: 2,
    },
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    paddingInline: 'var(--spacing-1)',
    color: colorVars['--color-text-primary'],
    fontSize: 'var(--font-size-base)',
    fontWeight: 'var(--font-weight-semibold)',
  },
  spacer: {width: '40px', flexShrink: 0},
  desktopBack: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginBottom: 'var(--spacing-3)',
    fontSize: 'var(--font-size-sm)',
    color: colorVars['--color-text-secondary'],
    textDecoration: 'none',
    ':hover': {color: colorVars['--color-text-primary']},
    '@media (max-width: 767px)': {display: 'none'},
  },
});

/**
 * 角色详情页容器：手机端渲染全屏资料页的导航栏（返回键 + 标题），
 * 返回时优先走浏览器历史回到来源页（聊天窗口 / 联系人列表）；
 * 桌面端不渲染导航栏，保持原有双栏详情排版。
 */
export function CharacterDetailShell({
  title,
  fallbackHref,
  desktopBackHref,
  children,
}: {
  title: string;
  /** 没有浏览历史（直接刷新 / 深度链接打开）时的返回目标 */
  fallbackHref: string;
  /** 桌面端二级详情页（如完整资料）的返回入口；手机端由顶部导航栏负责 */
  desktopBackHref?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  const handleBack = useCallback(() => {
    // 优先走浏览器回退：返回聊天窗口或联系人列表时保留来源页现场（列表滚动位置、会话状态）
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }, [fallbackHref, router]);

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.bar)} role="navigation" aria-label="资料页导航">
        <button type="button" onClick={handleBack} aria-label="返回" {...stylex.props(styles.back)}>
          <ArrowLeft size={20} />
        </button>
        <span {...stylex.props(styles.title)}>{title}</span>
        <span {...stylex.props(styles.spacer)} aria-hidden="true" />
      </div>
      {desktopBackHref && (
        <Link href={desktopBackHref} {...stylex.props(styles.desktopBack)}>
          <ArrowLeft size={15} />
          <span>返回名片</span>
        </Link>
      )}
      {children}
    </div>
  );
}
