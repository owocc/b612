'use client';

import * as stylex from '@stylexjs/stylex';
import { Check, Loader2, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { MediaImage } from '@/components/media-image';
import type { WorkshopTarget } from '@/lib/character-workshop';

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: 0,
  },
  thumbButton: {
    position: 'relative',
    display: 'block',
    width: '100%',
    padding: 0,
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-element)',
    overflow: 'hidden',
    backgroundColor: 'var(--color-background-muted)',
    cursor: 'pointer',
    transition: 'box-shadow 150ms ease, border-color 150ms ease',
  },
  thumbButtonSelected: {
    borderColor: 'var(--color-accent)',
    boxShadow: '0 0 0 2px var(--color-accent)',
  },
  thumb: {
    display: 'block',
    width: '100%',
    aspectRatio: '3 / 4',
    objectFit: 'cover',
  },
  checkBadge: {
    position: 'absolute',
    top: '6px',
    left: '6px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    padding: '2px 6px',
    borderRadius: '9999px',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-medium)',
    color: '#fff',
    backgroundColor: 'var(--color-accent)',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '6px',
    minHeight: '24px',
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    minWidth: 0,
  },
  label: {
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-medium)',
    color: 'var(--color-text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  saved: {
    fontSize: '10px',
    padding: '1px 5px',
    borderRadius: '9999px',
    color: 'var(--color-text-secondary)',
    backgroundColor: 'var(--color-background-muted)',
    flexShrink: 0,
  },
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    flexShrink: 0,
  },
  warning: {
    fontSize: '10px',
    lineHeight: 1.45,
    color: 'var(--color-text-secondary)',
  },
  emptyTile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    aspectRatio: '3 / 4',
    border: '1px dashed var(--color-border)',
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'var(--color-background-muted)',
    padding: '8px',
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
  },
  spin: {
    animationName: stylex.keyframes({
      from: { transform: 'rotate(0deg)' },
      to: { transform: 'rotate(360deg)' },
    }),
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
});

export type WorkshopItem = {
  /** 前端临时 id；已入库的素材直接用资产 id */
  id: string;
  url: string;
  target: WorkshopTarget;
  label: string;
  prompt: string;
  warning?: string | null;
  /** 是否已经写入角色资产表（上传即入库 / 已持久化的候选） */
  saved: boolean;
  source: 'generated' | 'upload' | 'existing';
};

export function WorkshopItemCard({
  item,
  selected,
  isBusy,
  onSelect,
  onRegenerate,
  onUpload,
  isUploading,
}: {
  item: WorkshopItem;
  selected: boolean;
  isBusy?: boolean;
  onSelect: () => void;
  onRegenerate?: () => void;
  onUpload?: () => void;
  isUploading?: boolean;
}) {
  return (
    <div {...stylex.props(styles.card)}>
      <button
        type="button"
        onClick={onSelect}
        {...stylex.props(styles.thumbButton, selected && styles.thumbButtonSelected)}
        aria-pressed={selected}
      >
        <MediaImage
          src={item.url}
          alt={item.label}
          xstyle={styles.thumb}
          loading="lazy"
        />
        {selected && (
          <span {...stylex.props(styles.checkBadge)}>
            <Check size={10} />
            已选用
          </span>
        )}
      </button>
      <div {...stylex.props(styles.footer)}>
        <div {...stylex.props(styles.meta)}>
          <span {...stylex.props(styles.label)}>{item.label}</span>
          {item.saved && <span {...stylex.props(styles.saved)}>已入库</span>}
        </div>
        <div {...stylex.props(styles.actionRow)}>
          {onRegenerate && (
            <Button
              label="重新生成"
              isIconOnly
              variant="ghost"
              size="sm"
              icon={
                isBusy ? (
                  <Loader2 size={12} {...stylex.props(styles.spin)} />
                ) : (
                  <RefreshCw size={12} />
                )
              }
              isDisabled={isBusy}
              onClick={onRegenerate}
            />
          )}
          {onUpload && (
            <Button
              label="手动上传"
              isIconOnly
              variant="ghost"
              size="sm"
              icon={
                isUploading ? (
                  <Loader2 size={12} {...stylex.props(styles.spin)} />
                ) : (
                  <Upload size={12} />
                )
              }
              isDisabled={isUploading}
              onClick={onUpload}
            />
          )}
        </div>
      </div>
      {item.warning && <p {...stylex.props(styles.warning)}>{item.warning}</p>}
    </div>
  );
}

export function WorkshopEmptyTile({
  title,
  onGenerate,
  onUpload,
  isBusy,
}: {
  title: string;
  onGenerate: () => void;
  onUpload: () => void;
  isBusy?: boolean;
}) {
  return (
    <div {...stylex.props(styles.emptyTile)}>
      <span {...stylex.props(styles.emptyTitle)}>{title}</span>
      <Button
        label={isBusy ? '生成中…' : '生成'}
        variant="secondary"
        size="sm"
        isLoading={isBusy}
        isDisabled={isBusy}
        onClick={onGenerate}
      />
      <Button label="上传" variant="ghost" size="sm" onClick={onUpload} isDisabled={isBusy} />
    </div>
  );
}
