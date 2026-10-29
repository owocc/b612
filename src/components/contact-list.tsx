'use client';

import {useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {UserCog, Users} from 'lucide-react';
import {Button} from '@astryxdesign/core/Button';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {UserAvatar} from '@/components/user-avatar';
import {groupByInitial} from '@/lib/pinyin';

export type ContactRow = {
  id: string;
  name: string;
  username: string;
  avatarEmoji: string;
  avatarColor: string;
  avatarUrl: string | null;
  status: string;
  relationshipToUser: string | null;
};

const styles = stylex.create({
  root: {display: 'flex', height: '100%', flexDirection: 'column'},
  hiddenMobile: {display: 'none', '@media (min-width: 640px)': {display: 'flex'}},
  header: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingInline: 'var(--spacing-4)',
    paddingTop: 'var(--spacing-4)',
    paddingBottom: 'var(--spacing-2)',
  },
  heading: {fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)', letterSpacing: '-0.025em'},
  count: {color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)'},
  searchWrap: {paddingInline: 'var(--spacing-3)', paddingBottom: 'var(--spacing-2)'},
  manageWrap: {paddingInline: 'var(--spacing-3)', paddingBottom: 'var(--spacing-3)'},
  manageLink: {display: 'block'},
  nav: {flex: 1, overflowY: 'auto', paddingBottom: 'var(--spacing-3)'},
  letterHeader: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    paddingInline: 'var(--spacing-4)',
    paddingBlock: 'var(--spacing-1)',
    backgroundColor: 'transparent',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-medium)',
  },
  row: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 'var(--spacing-3)',
    borderRadius: 0,
    paddingInline: 'var(--spacing-4)',
    paddingBlock: '8px',
    transition: 'color 175ms ease, background-color 175ms ease',
  },
  rowActive: {
    backgroundColor: 'var(--color-background-muted)',
    color: 'var(--color-text-primary)',
  },
  rowInactive: {
    color: 'var(--color-text-primary)',
    ':hover': {'@media (hover: hover)': {backgroundColor: 'var(--color-overlay-hover)'}},
  },
  name: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 'var(--font-size-base)',
    fontWeight: 'var(--font-weight-medium)',
  },
  namePaused: {color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-regular)'},
  pausedDot: {
    width: '6px',
    height: '6px',
    flexShrink: 0,
    borderRadius: 'var(--radius-full)',
    backgroundColor: 'var(--color-text-secondary)',
    opacity: 0.6,
  },
  empty: {paddingInline: 'var(--spacing-6)', paddingBlock: 'var(--spacing-6)', textAlign: 'center'},
});

export function ContactList({characters}: {characters: ContactRow[]}) {
  const pathname = usePathname();
  const [search, setSearch] = useState('');

  // on mobile, detail view takes over the whole screen
  const hiddenOnMobile = pathname !== '/characters';

  const q = search.trim().toLowerCase();
  const filtered = q
    ? characters.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.username.toLowerCase().includes(q) ||
          (c.relationshipToUser ?? '').toLowerCase().includes(q),
      )
    : characters;
  const groups = groupByInitial(filtered, (c) => c.name);

  return (
    <div {...stylex.props(styles.root, hiddenOnMobile && styles.hiddenMobile)}>
      <div {...stylex.props(styles.header)}>
        <h1 {...stylex.props(styles.heading)}>联系人</h1>
        <span {...stylex.props(styles.count)}>{characters.length}</span>
      </div>

      <div {...stylex.props(styles.searchWrap)}>
        <TextInput
          label="搜索联系人"
          isLabelHidden
          placeholder="搜索"
          value={search}
          onChange={setSearch}
          htmlName="contact-search"
        />
      </div>

      <div {...stylex.props(styles.manageWrap)}>
        <Link href="/characters/manage" {...stylex.props(styles.manageLink)}>
          <Button label="管理联系人" variant="secondary" size="sm" width="100%" icon={<UserCog size={15} />} />
        </Link>
      </div>

      {characters.length === 0 ? (
        <EmptyState
          icon={<Users size={40} strokeWidth={1.5} />}
          title="还没有联系人"
          description="去管理页创建你的第一个 AI 居民"
        />
      ) : groups.length === 0 ? (
        <div {...stylex.props(styles.empty)}>
          <Text type="supporting" as="p">没有匹配的联系人</Text>
        </div>
      ) : (
        <nav {...stylex.props(styles.nav)} aria-label="联系人列表">
          {groups.map((group) => (
            <div key={group.letter}>
              <div {...stylex.props(styles.letterHeader)}>{group.letter}</div>
              {group.items.map((c) => {
                const active =
                  pathname === `/characters/${c.id}` || pathname.startsWith(`/characters/${c.id}/`);
                const paused = c.status !== 'active';
                return (
                  <Link
                    key={c.id}
                    href={`/characters/${c.id}`}
                    aria-current={active ? 'page' : undefined}
                    {...stylex.props(styles.row, active ? styles.rowActive : styles.rowInactive)}
                  >
                    <UserAvatar
                      name={c.name}
                      emoji={c.avatarEmoji}
                      color={c.avatarColor}
                      url={c.avatarUrl}
                      size={40}
                      tooltip={false}
                    />
                    <span {...stylex.props(styles.name, paused && styles.namePaused)}>{c.name}</span>
                    {paused && <span {...stylex.props(styles.pausedDot)} aria-label="已禁用" />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}
