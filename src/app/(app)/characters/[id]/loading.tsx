import * as stylex from '@stylexjs/stylex';

const pulse = stylex.keyframes({
  '0%, 100%': {opacity: 1},
  '50%': {opacity: 0.45},
});

const styles = stylex.create({
  page: {
    width: '100%',
    maxWidth: '32rem',
    marginInline: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-5)',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 'var(--radius-container)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--color-border)',
    backgroundColor: 'var(--color-background-surface)',
    animationName: pulse,
    animationDuration: '1.4s',
    animationIterationCount: 'infinite',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-4)',
    padding: 'var(--spacing-5)',
  },
  avatar: {
    width: 80,
    height: 80,
    flexShrink: 0,
    borderRadius: 'var(--radius-container)',
    backgroundColor: 'var(--color-background-muted)',
  },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    flex: 1,
  },
  lineWide: {
    width: '55%',
    height: 22,
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'var(--color-background-muted)',
  },
  line: {
    width: '35%',
    height: 13,
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'var(--color-background-muted)',
  },
  row: {
    height: 60,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: 'var(--color-border)',
  },
  button: {
    height: 44,
    borderRadius: 'var(--radius-container)',
    backgroundColor: 'var(--color-background-muted)',
    animationName: pulse,
    animationDuration: '1.4s',
    animationIterationCount: 'infinite',
  },
});

/** 精简资料页骨架屏：避免头像 / 朋友圈缩略图加载时页面跳动。 */
export default function CharacterLoading() {
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.header)}>
          <div {...stylex.props(styles.avatar)} />
          <div {...stylex.props(styles.lines)}>
            <div {...stylex.props(styles.lineWide)} />
            <div {...stylex.props(styles.line)} />
          </div>
        </div>
        <div {...stylex.props(styles.row)} />
        <div {...stylex.props(styles.row)} />
      </div>
      <div {...stylex.props(styles.button)} />
    </div>
  );
}
