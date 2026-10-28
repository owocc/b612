'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Text } from '@astryxdesign/core/Text';
import { Badge } from '@astryxdesign/core/Badge';
import {
  Archive,
  ArchiveRestore,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Mail,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import { UserAvatar } from '@/components/user-avatar';
import { TimeAgo } from '@/components/time-ago';
import { openConversation } from '@/server/actions/chat';
import {
  deleteChat,
  setChatArchived,
  setChatPinned,
  setChatRead,
} from '@/server/actions/chat-list';
import type { UnifiedChatItem } from '@/server/unified-chat';
import type { aiCharacters } from '@/db/schema';
import { useClientSync } from '@/components/client-sync-provider';
import { CreateMenu } from '@/components/create-menu';
import { ChatActionMenu, type ChatActionMenuItem } from '@/components/chat-action-menu';
import { useAppToast } from '@/lib/toast';
const styles = stylex.create({
  root: {display: 'flex', height: '100%', flexDirection: 'column'},
  hiddenMobile: {display: 'none', '@media (min-width: 640px)': {display: 'flex'}},
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-2)',
    paddingInline: 'var(--spacing-4)',
    paddingTop: 'var(--spacing-4)',
    paddingBottom: 'var(--spacing-2)',
  },
  headerTitle: {display: 'flex', minWidth: 0, alignItems: 'center', gap: 'var(--spacing-2)'},
  backButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 0,
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'transparent',
    padding: 'var(--spacing-1)',
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    ':hover': {'@media (hover: hover)': {backgroundColor: 'var(--color-overlay-hover)'}},
  },
  heading: {fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)', letterSpacing: '-0.025em'},
  contacts: {paddingInline: 'var(--spacing-3)', paddingTop: 'var(--spacing-1)', paddingBottom: 'var(--spacing-2)'},
  contactLabel: {paddingInline: 'var(--spacing-1)', paddingBottom: 'var(--spacing-1)'},
  contactList: {display: 'flex', gap: 'var(--spacing-2)', overflowX: 'auto', paddingBottom: 'var(--spacing-1)'},
  contact: {
    display: 'flex',
    width: '56px',
    flexShrink: 0,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 'var(--spacing-1)',
    border: 0,
    borderRadius: 'var(--radius-container)',
    backgroundColor: 'transparent',
    padding: 'var(--spacing-1)',
    outline: 'none',
    transition: 'background-color 175ms ease',
    ':focus': {outline: 'none'},
    ':focus-visible': {outline: 'none'},
    ':hover': {'@media (hover: hover)': {backgroundColor: 'var(--color-background-muted)'}},
  },
  contactName: {
    width: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'center',
    color: 'var(--color-text-secondary)',
    fontSize: '11px',
  },
  empty: {paddingInline: 'var(--spacing-6)', paddingBlock: 'var(--spacing-10)', textAlign: 'center'},
  nav: {flex: 1, overflowY: 'auto'},
  chatLink: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 'var(--spacing-3)',
    marginInline: 0,
    marginBottom: 0,
    borderRadius: 0,
    paddingInline: 'var(--spacing-4)',
    paddingBlock: '10px',
    outline: 'none',
    transition: 'color 175ms ease, background-color 175ms ease',
    // 长按弹出菜单时不要触发文本选择 / 系统菜单
    WebkitTouchCallout: 'none',
    userSelect: 'none',
    ':focus': {outline: 'none'},
    ':focus-visible': {outline: 'none'},
  },
  chatActive: {
    backgroundColor: 'var(--color-background-muted)',
    color: 'var(--color-text-primary)',
    fontWeight: 'var(--font-weight-medium)',
  },
  chatInactive: {
    color: 'var(--color-text-secondary)',
    ':hover': {'@media (hover: hover)': {backgroundColor: 'var(--color-overlay-hover)', color: 'var(--color-text-primary)'}},
  },
  chatInfo: {minWidth: 0, flex: 1},
  chatHeader: {display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--spacing-2)'},
  chatName: {display: 'flex', minWidth: 0, alignItems: 'center', gap: '6px'},
  chatNameText: {overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-medium)'},
  pinIcon: {display: 'flex', flexShrink: 0, color: 'var(--color-text-secondary)'},
  time: {flexShrink: 0, color: 'var(--color-text-secondary)', fontSize: '11px', lineHeight: '1.2'},
  previewRow: {display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-2)', marginTop: '2px'},
  preview: {overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)'},
  archiveRow: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 'var(--spacing-3)',
    border: 0,
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'var(--color-border)',
    backgroundColor: 'transparent',
    paddingInline: 'var(--spacing-4)',
    paddingBlock: '12px',
    color: 'var(--color-text-primary)',
    textAlign: 'left',
    cursor: 'pointer',
    ':hover': {'@media (hover: hover)': {backgroundColor: 'var(--color-overlay-hover)'}},
  },
  archiveIcon: {
    display: 'flex',
    width: '46px',
    height: '46px',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-container)',
    backgroundColor: 'var(--color-background-muted)',
    color: 'var(--color-text-secondary)',
  },
  archiveLabel: {flex: 1, fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-medium)'},
  archiveChevron: {display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)', color: 'var(--color-text-secondary)'},
});
type CharacterRow = typeof aiCharacters.$inferSelect;

const LONG_PRESS_MS = 480;

function timeValue(value: UnifiedChatItem['lastMessageAt']): number {
  if (!value) return 0;
  return new Date(value as unknown as string | Date).getTime();
}

/** 置顶会话永远在上方（多个置顶按置顶时间倒序），其余按最近消息时间倒序 */
function compareChats(a: UnifiedChatItem, b: UnifiedChatItem): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  if (a.isPinned) {
    const diff = (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
    if (diff !== 0) return diff;
  }
  return timeValue(b.lastMessageAt) - timeValue(a.lastMessageAt);
}

type MenuState = { chat: UnifiedChatItem; x: number; y: number; isMobile: boolean };

export function ConversationList({
  chats,
  contacts = [],
}: {
  chats: UnifiedChatItem[];
  contacts?: CharacterRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sync = useClientSync();
  const toast = useAppToast();
  const activeChats = sync.chats.length > 0 ? sync.chats : chats;
  // on mobile, detail view takes over the whole screen
  const hiddenOnMobile = pathname !== '/messages';

  const [showArchived, setShowArchived] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const suppressTimer = useRef<number | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStart.current = null;
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
      if (suppressTimer.current !== null) window.clearTimeout(suppressTimer.current);
    };
  }, []);

  // 点击「归档聊天」进入二级列表后，若归档被清空则自动退回主列表
  const archivedChats = activeChats.filter((c) => c.isArchived).sort(compareChats);
  const mainChats = activeChats.filter((c) => !c.isArchived).sort(compareChats);

  // 归档列表为空时自动回到主列表（无需额外渲染周期）
  const view = showArchived && archivedChats.length > 0 ? 'archived' : 'main';

  const startChat = async (characterId: string) => {
    const res = await openConversation(characterId);
    if (res.id) router.push(`/messages/${res.id}`);
  };

  const suppressNextClick = () => {
    suppressClick.current = true;
    if (suppressTimer.current !== null) window.clearTimeout(suppressTimer.current);
    suppressTimer.current = window.setTimeout(() => {
      suppressClick.current = false;
    }, 700);
  };

  const openMenu = (chat: UnifiedChatItem, x: number, y: number, isMobile: boolean) => {
    setMenu({ chat, x, y, isMobile });
  };

  const handleContextMenu = (chat: UnifiedChatItem) => (event: React.MouseEvent) => {
    event.preventDefault();
    clearLongPress();
    suppressNextClick();
    openMenu(chat, event.clientX, event.clientY, false);
  };

  const handlePointerDown = (chat: UnifiedChatItem) => (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    clearLongPress();
    longPressStart.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      suppressNextClick();
      openMenu(chat, event.clientX, event.clientY, true);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!longPressStart.current) return;
    const dx = event.clientX - longPressStart.current.x;
    const dy = event.clientY - longPressStart.current.y;
    if (Math.hypot(dx, dy) > 10) clearLongPress();
  };

  const handleClick = (event: React.MouseEvent) => {
    if (suppressClick.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = false;
    }
  };

  const menuItems: ChatActionMenuItem[] = menu
    ? [
        menu.chat.isPinned
          ? { key: 'unpin', label: '取消置顶', icon: <PinOff size={15} /> }
          : { key: 'pin', label: '置顶聊天', icon: <Pin size={15} /> },
        menu.chat.unreadCount > 0
          ? { key: 'read', label: '标为已读', icon: <CheckCheck size={15} /> }
          : { key: 'unread', label: '标为未读', icon: <Mail size={15} /> },
        menu.chat.isArchived
          ? { key: 'unarchive', label: '取消归档', icon: <ArchiveRestore size={15} /> }
          : { key: 'archive', label: '归档聊天', icon: <Archive size={15} /> },
        { key: 'delete', label: '删除聊天', icon: <Trash2 size={15} />, destructive: true },
      ]
    : [];

  const handleMenuSelect = async (key: string) => {
    const chat = menu?.chat;
    setMenu(null);
    if (!chat) return;

    try {
      if (key === 'pin') await setChatPinned(chat.kind, chat.id, true);
      else if (key === 'unpin') await setChatPinned(chat.kind, chat.id, false);
      else if (key === 'read') await setChatRead(chat.kind, chat.id, true);
      else if (key === 'unread') await setChatRead(chat.kind, chat.id, false);
      else if (key === 'archive') await setChatArchived(chat.kind, chat.id, true);
      else if (key === 'unarchive') await setChatArchived(chat.kind, chat.id, false);
      else if (key === 'delete') {
        await deleteChat(chat.kind, chat.id);
        if (pathname === chat.href || pathname === `/messages/${chat.id}`) router.push('/messages');
      }
      await sync.refresh();
      router.refresh();
    } catch (err) {
      console.error('[conversation-list] action failed', err);
      toast.error('操作失败，请稍后重试');
    }
  };

  const renderChat = (chat: UnifiedChatItem) => {
    const isActive =
      pathname === chat.href ||
      (chat.kind === 'dm' && pathname === `/messages/${chat.id}`) ||
      (chat.kind === 'group' &&
        (pathname === `/messages/group/${chat.id}` || pathname === `/groups/${chat.id}`));

    return (
      <Link
        key={`${chat.kind}-${chat.id}`}
        href={chat.href}
        aria-current={isActive ? 'page' : undefined}
        onContextMenu={handleContextMenu(chat)}
        onPointerDown={handlePointerDown(chat)}
        onPointerMove={handlePointerMove}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onClick={handleClick}
        {...stylex.props(styles.chatLink, isActive ? styles.chatActive : styles.chatInactive)}
      >
        <UserAvatar
          name={chat.name}
          emoji={chat.avatarEmoji}
          color={chat.avatarColor}
          url={chat.avatarUrl}
          size={46}
        />
        <div {...stylex.props(styles.chatInfo)}>
          <div {...stylex.props(styles.chatHeader)}>
            <div {...stylex.props(styles.chatName)}>
              {chat.isPinned && (
                <span {...stylex.props(styles.pinIcon)} aria-hidden>
                  <Pin size={11} />
                </span>
              )}
              <span {...stylex.props(styles.chatNameText)}>{chat.name}</span>
            </div>
            {chat.lastMessageAt && (
              <TimeAgo
                date={chat.lastMessageAt}
                short
                xstyle={styles.time}
                style={{ fontSize: '11px', lineHeight: 1.2, color: 'var(--color-text-secondary)' }}
              />
            )}
          </div>
          <div {...stylex.props(styles.previewRow)}>
            <span {...stylex.props(styles.preview)}>
              {chat.lastMessagePreview ?? (chat.kind === 'group' ? '群聊已创建' : '开始对话吧')}
            </span>
            {chat.unreadCount > 0 && (
              <Badge
                variant="orange"
                label={chat.unreadCount > 99 ? '99+' : String(chat.unreadCount)}
              />
            )}
          </div>
        </div>
      </Link>
    );
  };

  return (
    <div {...stylex.props(styles.root, hiddenOnMobile && styles.hiddenMobile)}>
      {/* Header — 聊天 / 归档聊天二级列表 */}
      <div {...stylex.props(styles.header)}>
        {view === 'archived' ? (
          <div {...stylex.props(styles.headerTitle)}>
            <button
              type="button"
              aria-label="返回聊天列表"
              onClick={() => setShowArchived(false)}
              {...stylex.props(styles.backButton)}
            >
              <ChevronLeft size={20} />
            </button>
            <h1 {...stylex.props(styles.heading)}>归档聊天</h1>
          </div>
        ) : (
          <h1 {...stylex.props(styles.heading)}>聊天</h1>
        )}
        {view === 'main' && <CreateMenu />}
      </div>

      {/* Quick contacts for unstarted DMs */}
      {view === 'main' && contacts.length > 0 && (
        <div {...stylex.props(styles.contacts)}>
          <Text type="supporting" size="sm" as="div" xstyle={styles.contactLabel}>
            快捷私信
          </Text>
          <div {...stylex.props(styles.contactList)}>
            {contacts.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => startChat(c.id)}
                {...stylex.props(styles.contact)}
              >
                <UserAvatar
                  name={c.name}
                  emoji={c.avatarEmoji}
                  color={c.avatarColor}
                  url={c.avatarUrl}
                  size={40}
                  tooltip={false}
                />
                <span {...stylex.props(styles.contactName)}>{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Conversation List / Archived List */}
      {view === 'main' && activeChats.length === 0 ? (
        <div {...stylex.props(styles.empty)}>
          <Text type="supporting" as="p">
            还没有聊天会话，点击右上角新建群聊或从居民列表中开始对话吧
          </Text>
        </div>
      ) : view === 'archived' && archivedChats.length === 0 ? (
        <div {...stylex.props(styles.empty)}>
          <Text type="supporting" as="p">归档里的聊天会显示在这里</Text>
        </div>
      ) : (
        <nav {...stylex.props(styles.nav)} aria-label={view === 'archived' ? '归档聊天列表' : '聊天会话列表'}>
          {(view === 'archived' ? archivedChats : mainChats).map(renderChat)}

          {view === 'main' && archivedChats.length > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived(true)}
              {...stylex.props(styles.archiveRow)}
            >
              <span {...stylex.props(styles.archiveIcon)}>
                <Inbox size={20} />
              </span>
              <span {...stylex.props(styles.archiveLabel)}>归档聊天</span>
              <span {...stylex.props(styles.archiveChevron)}>
                <Badge
                  variant="neutral"
                  label={archivedChats.length > 99 ? '99+' : String(archivedChats.length)}
                />
                <ChevronRight size={16} />
              </span>
            </button>
          )}
        </nav>
      )}

      <ChatActionMenu
        isOpen={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        isMobile={menu?.isMobile ?? false}
        items={menuItems}
        onSelect={handleMenuSelect}
        onClose={closeMenu}
      />
    </div>
  );
}
