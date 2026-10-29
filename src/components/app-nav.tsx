'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as stylex from '@stylexjs/stylex';
import { colorVars, radiusVars, shadowVars } from '@astryxdesign/core/theme/tokens.stylex';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { UserAvatar } from '@/components/user-avatar';
import {
  Compass,
  MessageCircle,
  Moon,
  Settings,
  Sun,
  SunMoon,
  Users,
  Check,
} from 'lucide-react';
import { useThemeMode } from '@/components/providers';
import { NotificationPopover } from '@/components/notification-popover';
import { MobileBackBar } from '@/components/mobile-back-bar';
import { useClientSync } from '@/components/client-sync-provider';
import type { NotificationItem } from '@/server/actions/feed';
const styles = stylex.create({
  shell: {
    display: 'flex',
    // 100vh 在手机浏览器上会包含地址栏区域导致底部栏被截断，优先使用动态视口单位
    height: stylex.firstThatWorks('100dvh', '100vh'),
    width: '100vw',
    overflow: 'hidden',
    backgroundColor: colorVars['--color-background-body'],
    '@media (max-width: 639px)': {
      flexDirection: 'column',
      // PWA standalone 模式下内容延伸到状态栏之下：状态栏区域与内容卡片
      // 同用 surface 色，避免交界处出现色差接缝
      backgroundColor: colorVars['--color-background-surface'],
      paddingTop: 'env(safe-area-inset-top)',
    },
  },
  rail: {
    display: 'flex',
    width: 64,
    flexShrink: 0,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: 14,
    userSelect: 'none',
    '@media (max-width: 639px)': {
      display: 'none',
    },
  },
  top: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: 8,
  },
  navGroup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: 8,
  },
  navItem: {
    position: 'relative',
    display: 'flex',
    height: 40,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radiusVars['--radius-element'],
    color: colorVars['--color-text-secondary'],
    transitionProperty: 'background-color, color',
    transitionDuration: '175ms',
    ':hover': {
      backgroundColor: colorVars['--color-background-muted'],
      color: colorVars['--color-text-primary'],
    },
    ':focus-visible': {
      outline: '2px solid',
      outlineColor: colorVars['--color-accent'],
      outlineOffset: 3,
    },
  },
  navSelected: {
    backgroundColor: colorVars['--color-background-muted'],
    color: colorVars['--color-text-primary'],
  },
  navIdle: {
    color: colorVars['--color-text-secondary'],
  },
  bottom: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: 12,
  },
  settings: {
    display: 'flex',
    height: 40,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radiusVars['--radius-element'],
    color: colorVars['--color-text-secondary'],
    transitionProperty: 'background-color, color',
    transitionDuration: '175ms',
    ':hover': {
      backgroundColor: colorVars['--color-background-muted'],
      color: colorVars['--color-text-primary'],
    },
    ':focus-visible': {
      outline: '2px solid',
      outlineColor: colorVars['--color-accent'],
      outlineOffset: 3,
    },
  },
  settingsActive: {
    backgroundColor: colorVars['--color-background-muted'],
    color: colorVars['--color-text-primary'],
  },
  settingsIdle: {
    color: colorVars['--color-text-secondary'],
  },
  unreadBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    display: 'flex',
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radiusVars['--radius-full'],
    backgroundColor: colorVars['--color-accent'],
    paddingInline: 4,
    color: colorVars['--color-on-accent'],
    fontSize: 10,
    fontWeight: 700,
    boxShadow: shadowVars['--shadow-low'],
  },
  main: {
    display: 'flex',
    minHeight: 0,
    minWidth: 0,
    flex: 1,
    padding: 12,
    paddingLeft: 0,
    '@media (max-width: 639px)': {
      flexDirection: 'column',
      padding: 0,
    },
  },
  card: {
    display: 'flex',
    height: '100%',
    minHeight: 0,
    width: '100%',
    flex: 1,
    overflow: 'hidden',
    border: '1px solid',
    borderColor: colorVars['--color-border'],
    borderRadius: radiusVars['--radius-page'],
    backgroundColor: colorVars['--color-background-surface'],
    '@media (max-width: 639px)': {
      border: 'none',
      borderRadius: 0,
    },
  },
  bottomBar: {
    display: 'none',
    '@media (max-width: 639px)': {
      display: 'flex',
      flexShrink: 0,
      alignItems: 'stretch',
      justifyContent: 'space-around',
      width: '100%',
      borderTop: '1px solid',
      borderTopColor: colorVars['--color-border'],
      backgroundColor: colorVars['--color-background-surface'],
      paddingBottom: 'env(safe-area-inset-bottom)',
      userSelect: 'none',
      zIndex: 50,
    },
  },
  tab: {
    position: 'relative',
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingBlock: 8,
    color: colorVars['--color-text-secondary'],
    textDecoration: 'none',
    transitionProperty: 'color',
    transitionDuration: '150ms',
    ':focus-visible': {
      outline: '2px solid',
      outlineColor: colorVars['--color-accent'],
      outlineOffset: -2,
    },
  },
  tabActive: {
    color: colorVars['--color-text-accent'],
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: 500,
    lineHeight: 1.2,
  },
  tabBadge: {
    position: 'absolute',
    top: 4,
    right: 'calc(50% - 20px)',
    display: 'flex',
    minWidth: 15,
    height: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radiusVars['--radius-full'],
    backgroundColor: colorVars['--color-accent'],
    paddingInline: 4,
    color: colorVars['--color-on-accent'],
    fontSize: 9,
    fontWeight: 700,
    boxShadow: shadowVars['--shadow-low'],
  },
});

export type ShellUser = {
  name: string;
  email: string;
  image: string | null;
};
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span {...stylex.props(styles.unreadBadge)}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(href + '/');

// 移动端二级页面（详情/子路由）隐藏底部 Tab 栏，更像原生应用；
// 返回值为该二级页面的上级页面地址，用于渲染通用返回栏
const mobileBackTarget = (pathname: string): string | null => {
  // 完整资料页的上一级是精简名片页，而不是联系人列表
  const characterProfile = pathname.match(/^\/characters\/([^/]+)\/profile$/);
  if (characterProfile) return `/characters/${characterProfile[1]}`;
  if (pathname.startsWith('/post/')) return '/feed';
  if (pathname.startsWith('/groups/')) return '/messages';
  if (pathname.startsWith('/usage')) return '/settings';
  if (pathname.startsWith('/settings/developer/test-factory')) return '/settings/developer';
  if (pathname.startsWith('/characters/relationships')) return '/characters/manage';
  const root = ['/messages', '/characters', '/settings', '/notifications'].find((segment) =>
    pathname.startsWith(`${segment}/`),
  );
  return root ?? null;
};

// 角色详情全屏页自带导航栏（返回键需要回到来源页，故由 CharacterDetailShell 渲染）
const CHARACTER_DETAIL_PATH = /^\/characters\/(?!manage$|relationships$)[^/]+(?:\/profile)?$/;

// 自带移动端返回按钮的二级页面（聊天窗口、动态详情、角色详情），无需通用返回栏
const hasOwnMobileBack = (pathname: string) =>
  pathname.startsWith('/messages/') ||
  pathname.startsWith('/post/') ||
  CHARACTER_DETAIL_PATH.test(pathname);

export function AppNav({
  user,
  unreadMessages,
  unreadGroups = 0,
  unreadNotifications,
  initialNotifications = [],
  children,
}: {
  user: ShellUser;
  unreadMessages: number;
  unreadGroups?: number;
  unreadNotifications: number;
  initialNotifications?: NotificationItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { mode, setMode } = useThemeMode();
  const sync = useClientSync();
  // 移动端二级页面：隐藏底部 Tab 栏，无自带返回按钮的页面渲染通用返回栏
  const backTarget = mobileBackTarget(pathname);
  const isMobileSecondary = backTarget !== null;
  const showMobileBackBar = isMobileSecondary && !hasOwnMobileBack(pathname);
  const liveUnreadMessages = sync.unread.messages ?? unreadMessages;
  const liveUnreadGroups = sync.unread.groups ?? unreadGroups;
  const liveUnreadNotifications = sync.unread.notifications ?? unreadNotifications;
  const totalUnreadChats = liveUnreadMessages + liveUnreadGroups;
  const NAV_ITEMS = [
    {
      href: '/messages',
      label: '聊天',
      icon: MessageCircle,
      badge: totalUnreadChats,
      selected: isActive(pathname, '/messages') || isActive(pathname, '/groups'),
    },
    {
      href: '/characters',
      label: '联系人',
      icon: Users,
      selected: isActive(pathname, '/characters'),
    },
    {
      href: '/feed',
      label: '朋友圈',
      icon: Compass,
      selected: isActive(pathname, '/feed') || isActive(pathname, '/post'),
    },
  ];

  // 手机端底部标签栏：消息 / 联系人 / 朋友圈 / 设置
  // （通知入口已收纳到聊天/群聊列表头部的「新建」下拉菜单，见 create-menu.tsx）
  const MOBILE_TABS = [
    ...NAV_ITEMS,
    {
      href: '/settings',
      label: '设置',
      icon: Settings,
      badge: 0,
      selected:
        isActive(pathname, '/settings') ||
        isActive(pathname, '/usage'),
    },
  ];

  return (
    <div {...stylex.props(styles.shell)}>
      <nav {...stylex.props(styles.rail)} aria-label="主导航">
        <div {...stylex.props(styles.top)}>
          {/* Navigation Items */}
          <div {...stylex.props(styles.navGroup)}>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  {...stylex.props(styles.navItem, item.selected ? styles.navSelected : styles.navIdle)}
                >
                  <Icon size={20} />
                  {item.badge ? <UnreadBadge count={item.badge} /> : null}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Bottom: Settings, Theme & User Avatar */}
        <div {...stylex.props(styles.bottom)}>
          <NotificationPopover
            initialNotifications={initialNotifications}
            initialUnreadCount={liveUnreadNotifications}
          />

          <Link
            href="/settings"
            title="系统设置"
            {...stylex.props(
              styles.settings,
              isActive(pathname, '/settings') || isActive(pathname, '/usage')
                ? styles.settingsActive
                : styles.settingsIdle,
            )}
          >
            <Settings size={20} />
          </Link>

          <DropdownMenu
            button={{
              label: '切换主题',
              isIconOnly: true,
              variant: 'ghost',
              icon:
                mode === 'dark' ? (
                  <Moon size={18} />
                ) : mode === 'light' ? (
                  <Sun size={18} />
                ) : (
                  <SunMoon size={18} />
                ),
            }}
            hasChevron={false}
            items={[
              {
                label: '浅色',
                icon: <Sun size={16} />,
                endContent: mode === 'light' ? <Check size={15} /> : undefined,
                onClick: () => setMode('light'),
              },
              {
                label: '深色',
                icon: <Moon size={16} />,
                endContent: mode === 'dark' ? <Check size={15} /> : undefined,
                onClick: () => setMode('dark'),
              },
              {
                label: '跟随系统',
                icon: <SunMoon size={16} />,
                endContent: mode === 'system' ? <Check size={15} /> : undefined,
                onClick: () => setMode('system'),
              },
            ]}
          />

          <UserAvatar
            name={user.name}
            url={user.image}
            size={32}
            tooltip={user.name}
            href="/settings/account"
          />
        </div>
      </nav>

      {/* Main Area */}
      <main {...stylex.props(styles.main)}>
        {showMobileBackBar && <MobileBackBar href={backTarget} />}
        <div {...stylex.props(styles.card)}>
          {children}
        </div>
      </main>

      {/* Mobile Bottom Tab Bar（移动端二级页面隐藏，返回上级后恢复） */}
      {!isMobileSecondary && (
        <nav {...stylex.props(styles.bottomBar)} aria-label="底部导航">
        {MOBILE_TABS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={item.selected ? 'page' : undefined}
              {...stylex.props(styles.tab, item.selected ? styles.tabActive : styles.navIdle)}
            >
              <Icon size={22} strokeWidth={item.selected ? 2.2 : 1.8} />
              <span {...stylex.props(styles.tabLabel)}>{item.label}</span>
              {item.badge ? <UnreadBadge count={item.badge} /> : null}
            </Link>
          );
        })}
        </nav>
      )}
    </div>
  );
}
