'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as stylex from '@stylexjs/stylex';
import {
  Check,
  ImagePlus,
  Images,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { SafeImage } from '@/components/safe-image';
import { MediaLightbox } from '@/components/media-lightbox';
import { useAppToast } from '@/lib/toast';
import {
  CHARACTER_ASSET_TYPE_META,
  CHARACTER_ASSET_TYPE_ORDER,
  MAX_CHARACTER_ASSETS_PER_REQUEST,
  type CharacterAssetType,
  type CharacterAssetView,
} from '@/lib/character-assets';

const spin = stylex.keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-4)',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-2)',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  toolbarSide: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-2)',
    flexWrap: 'wrap',
    minWidth: 0,
  },
  filter: {
    width: '168px',
    '@media (max-width: 639px)': {
      width: '100%',
    },
  },
  count: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
    gap: 'var(--spacing-3)',
    '@media (max-width: 639px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 'var(--spacing-2)',
    },
  },
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 'var(--radius-container)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-background-surface)',
    overflow: 'hidden',
    transition: 'border-color 150ms ease, box-shadow 150ms ease',
    ':hover': {
      borderColor: 'var(--color-border-emphasis, var(--color-border))',
      boxShadow: 'var(--shadow-low, 0 1px 2px rgba(0, 0, 0, 0.06))',
    },
  },
  cardDisabled: {
    borderStyle: 'dashed',
    backgroundColor: 'var(--color-background-muted)',
  },
  thumbButton: {
    position: 'relative',
    display: 'block',
    width: '100%',
    padding: 0,
    border: 'none',
    backgroundColor: 'var(--color-background-muted)',
    cursor: 'zoom-in',
    overflow: 'hidden',
  },
  thumb: {
    display: 'block',
    width: '100%',
    aspectRatio: '3 / 4',
    objectFit: 'cover',
    transition: 'filter 150ms ease, opacity 150ms ease',
  },
  thumbDisabled: {
    opacity: 0.45,
    filter: 'grayscale(1)',
  },
  badgeRow: {
    position: 'absolute',
    top: '6px',
    left: '6px',
    right: '6px',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '4px',
    pointerEvents: 'none',
  },
  tagStack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '3px',
    minWidth: 0,
  },
  switchWrap: {
    pointerEvents: 'auto',
    padding: '2px 4px',
    borderRadius: '9999px',
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    color: '#fff',
    display: 'inline-flex',
    alignItems: 'center',
  },
  busyOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
    color: '#fff',
    fontSize: 'var(--font-size-xs)',
  },
  disabledBanner: {
    position: 'absolute',
    left: '6px',
    bottom: '6px',
    padding: '1px 6px',
    borderRadius: '9999px',
    fontSize: '10px',
    color: 'var(--color-text-secondary)',
    backgroundColor: 'var(--color-background-surface)',
    border: '1px solid var(--color-border)',
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '8px 10px',
    minWidth: 0,
  },
  footerTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '4px',
    minWidth: 0,
  },
  meta: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    gap: '1px',
  },
  label: {
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-medium)',
    color: 'var(--color-text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sublabel: {
    fontSize: '10px',
    color: 'var(--color-text-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  iconActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '1px',
    flexShrink: 0,
  },
  iconButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    borderRadius: 'var(--radius-element)',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    transition: 'color 150ms ease, background-color 150ms ease',
    ':hover': {
      backgroundColor: 'var(--color-background-muted)',
      color: 'var(--color-text-primary)',
    },
    ':disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  },
  iconButtonDanger: {
    ':hover': {
      color: 'var(--color-error)',
    },
  },
  addCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: '180px',
    padding: '12px',
    borderRadius: 'var(--radius-container)',
    border: '1px dashed var(--color-border)',
    backgroundColor: 'transparent',
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    transition: 'border-color 150ms ease, color 150ms ease',
    ':hover': {
      borderColor: 'var(--color-accent)',
      color: 'var(--color-accent)',
    },
  },
  addCardTitle: {
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-medium)',
  },
  addCardHint: {
    fontSize: '10px',
    textAlign: 'center',
    lineHeight: 1.5,
  },
  spin: {
    animationName: spin,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  dialogHeader: {
    paddingBlock: 'var(--spacing-4)',
    paddingInline: 'var(--spacing-5)',
  },
  dialogBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-4)',
    padding: 'var(--spacing-4) var(--spacing-5)',
    maxHeight: '68dvh',
    overflowY: 'auto',
    '@media (max-width: 639px)': {
      paddingInline: 'var(--spacing-4)',
      maxHeight: '62dvh',
    },
  },
  dialogFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-3)',
    padding: 'var(--spacing-3) var(--spacing-5)',
    borderTop: '1px solid var(--color-border)',
    flexWrap: 'wrap',
    rowGap: 'var(--spacing-2)',
  },
  footerHint: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
  },
  dropZone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: 'var(--spacing-5)',
    borderRadius: 'var(--radius-container)',
    border: '1px dashed var(--color-border)',
    backgroundColor: 'var(--color-background-muted)',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 150ms ease, background-color 150ms ease',
    ':hover': {
      borderColor: 'var(--color-accent)',
    },
  },
  dropZoneActive: {
    borderColor: 'var(--color-accent)',
    backgroundColor: 'var(--color-background-surface)',
  },
  fileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    borderRadius: 'var(--radius-element)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-background-surface)',
  },
  fileThumb: {
    width: '36px',
    height: '48px',
    borderRadius: 'var(--radius-element)',
    objectFit: 'cover',
    flexShrink: 0,
    backgroundColor: 'var(--color-background-muted)',
  },
  fileMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
    flex: 1,
  },
  fileName: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileType: {
    width: '132px',
    flexShrink: 0,
    '@media (max-width: 639px)': {
      width: '108px',
    },
  },
  textArea: {
    width: '100%',
    minHeight: '92px',
    resize: 'vertical',
    padding: '10px 12px',
    borderRadius: 'var(--radius-element)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-background-surface)',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'inherit',
    lineHeight: 1.6,
    ':focus-visible': {
      outline: '2px solid var(--color-accent)',
      outlineOffset: '1px',
    },
  },
  fieldLabel: {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-medium)',
    color: 'var(--color-text-primary)',
  },
  fieldHint: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
  },
  confirmThumb: {
    width: '72px',
    height: '96px',
    borderRadius: 'var(--radius-element)',
    objectFit: 'cover',
    border: '1px solid var(--color-border)',
    flexShrink: 0,
  },
  hidden: {
    display: 'none',
  },
});

const SOURCE_LABEL: Record<string, string> = {
  generated: '工坊生成',
  upload: '本地上传',
  external_url: '外部导入',
  seed: '预置素材',
};

const WORKSHOP_TARGET_LABEL: Record<string, string> = {
  base: '基础图',
  full_body: '全身图',
  front: '正面',
  side: '侧面',
  back: '背面',
  three_quarter: '四分之三视角',
  detail_face: '面部特写',
  detail_outfit: '服饰特写',
};

const TYPE_OPTIONS = CHARACTER_ASSET_TYPE_ORDER.map((type) => ({
  value: type,
  label: CHARACTER_ASSET_TYPE_META[type].label,
}));

type FilterValue = 'all' | 'enabled' | 'disabled' | CharacterAssetType;

function sortAssets(assets: CharacterAssetView[]): CharacterAssetView[] {
  const weight = (type: CharacterAssetType) => {
    const index = CHARACTER_ASSET_TYPE_ORDER.indexOf(type);
    return index === -1 ? CHARACTER_ASSET_TYPE_ORDER.length : index;
  };
  return assets
    .slice()
    .sort((a, b) => weight(a.type) - weight(b.type) || a.sortOrder - b.sortOrder);
}

function assetSubLabel(asset: CharacterAssetView): string {
  const target = asset.metadata?.workshopTarget;
  if (typeof target === 'string' && WORKSHOP_TARGET_LABEL[target]) {
    return WORKSHOP_TARGET_LABEL[target];
  }
  return SOURCE_LABEL[asset.source] ?? asset.source;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '网络异常，请稍后重试';
}

type PendingFile = {
  id: string;
  file: File;
  previewUrl: string;
  type: CharacterAssetType;
};

type ImportResponse = {
  ok?: boolean;
  error?: string;
  assets?: CharacterAssetView[];
  failed?: { index: number; error: string }[];
};

export function CharacterAssetsPanel({
  characterId,
  initialAssets,
}: {
  characterId: string;
  initialAssets: CharacterAssetView[];
}) {
  const toast = useAppToast();
  const router = useRouter();
  const [assets, setAssets] = useState(() => sortAssets(initialAssets));
  const [filter, setFilter] = useState<FilterValue>('all');
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [lightboxAsset, setLightboxAsset] = useState<CharacterAssetView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CharacterAssetView | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const replaceInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // 服务端刷新（导入 / 删除后）时同步本地列表
  useEffect(() => {
    setAssets(sortAssets(initialAssets));
  }, [initialAssets]);

  const filtered = useMemo(() => {
    if (filter === 'all') return assets;
    if (filter === 'enabled') return assets.filter((asset) => asset.isEnabled);
    if (filter === 'disabled') return assets.filter((asset) => !asset.isEnabled);
    return assets.filter((asset) => asset.type === filter);
  }, [assets, filter]);

  const enabledCount = assets.filter((asset) => asset.isEnabled).length;

  const markBusy = (id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleEnabled = async (asset: CharacterAssetView, nextEnabled: boolean) => {
    markBusy(asset.id, true);
    setAssets((prev) =>
      prev.map((item) => (item.id === asset.id ? { ...item, isEnabled: nextEnabled } : item)),
    );
    try {
      const res = await fetch(`/api/characters/${characterId}/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isEnabled: nextEnabled }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? '保存失败');
      setAssets((prev) =>
        prev.map((item) =>
          item.id === asset.id ? { ...item, ...(data.asset as CharacterAssetView) } : item,
        ),
      );
      toast.success(nextEnabled ? '已启用，将参与后续生图' : '已禁用，不会参与后续生图');
    } catch (err) {
      setAssets((prev) =>
        prev.map((item) =>
          item.id === asset.id ? { ...item, isEnabled: asset.isEnabled } : item,
        ),
      );
      toast.error(errorMessage(err));
    } finally {
      markBusy(asset.id, false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/characters/${characterId}/assets/${deleteTarget.id}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? '删除失败');
      setAssets((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      toast.success('已删除素材');
      setDeleteTarget(null);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  };

  const pickReplacement = (asset: CharacterAssetView) => {
    setReplacingId(asset.id);
    replaceInputRef.current?.click();
  };

  const handleReplaceFile = async (files: FileList | null) => {
    const assetId = replacingId;
    const file = files?.[0];
    setReplacingId(null);
    if (replaceInputRef.current) replaceInputRef.current.value = '';
    if (!assetId || !file) return;

    const target = assets.find((item) => item.id === assetId);
    if (!target) return;

    markBusy(assetId, true);
    try {
      const form = new FormData();
      form.append('files', file);
      form.append('type', target.type);
      form.append('sortOrder', String(target.sortOrder));
      form.append(
        'metadata',
        JSON.stringify({
          ...(target.metadata ?? {}),
          replacedAssetId: target.id,
          replacedAt: new Date().toISOString(),
        }),
      );

      const uploadRes = await fetch(`/api/characters/${characterId}/assets`, {
        method: 'POST',
        body: form,
      });
      const uploadData: ImportResponse = await uploadRes
        .json()
        .catch(() => ({ ok: false, error: '上传响应解析失败' }));
      const created = uploadData.assets?.[0];
      if (!uploadRes.ok || !uploadData.ok || !created) {
        throw new Error(uploadData.error ?? uploadData.failed?.[0]?.error ?? '上传失败');
      }

      // 先上传新图再删除旧图，避免替换过程中卡片短暂消失
      const deleteRes = await fetch(
        `/api/characters/${characterId}/assets/${target.id}`,
        { method: 'DELETE' },
      );
      if (!deleteRes.ok) {
        const deleteData = await deleteRes.json().catch(() => null);
        console.warn('旧素材删除失败，请手动删除', deleteData);
      }

      setAssets((prev) => sortAssets(prev.map((item) => (item.id === target.id ? created : item))));
      toast.success('素材已替换');
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      markBusy(assetId, false);
    }
  };

  const closeImport = () => {
    if (importState.importing) return;
    setImportOpen(false);
    setImportState((prev) => {
      prev.files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return { ...prev, files: [], urls: '', defaultType: 'base', dragActive: false };
    });
  };

  const [importState, setImportState] = useState<{
    files: PendingFile[];
    urls: string;
    defaultType: CharacterAssetType;
    importing: boolean;
    dragActive: boolean;
    error: string | null;
  }>({
    files: [],
    urls: '',
    defaultType: 'base',
    importing: false,
    dragActive: false,
    error: null,
  });

  const addFiles = (picked: FileList | File[] | null) => {
    const list = picked ? Array.from(picked) : [];
    if (list.length === 0) return;
    setImportState((prev) => {
      const room = MAX_CHARACTER_ASSETS_PER_REQUEST - prev.files.length;
      const accepted = list
        .filter((file) => file.type.startsWith('image/'))
        .slice(0, Math.max(room, 0))
        .map((file) => ({
          id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          type: prev.defaultType,
        }));
      return {
        ...prev,
        files: [...prev.files, ...accepted],
        error:
          accepted.length < list.length
            ? `单次最多 ${MAX_CHARACTER_ASSETS_PER_REQUEST} 张，已忽略超出部分`
            : null,
      };
    });
  };

  const updatePendingType = (id: string, type: CharacterAssetType) => {
    setImportState((prev) => ({
      ...prev,
      files: prev.files.map((item) => (item.id === id ? { ...item, type } : item)),
    }));
  };

  const removePendingFile = (id: string) => {
    setImportState((prev) => {
      const target = prev.files.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return { ...prev, files: prev.files.filter((item) => item.id !== id) };
    });
  };

  const handleImport = async () => {
    const urlList = importState.urls
      .split(/\s+/)
      .map((value) => value.trim())
      .filter((value) => /^https?:\/\//i.test(value));
    if (importState.files.length === 0 && urlList.length === 0) {
      setImportState((prev) => ({ ...prev, error: '请先选择图片或填写图片 URL' }));
      return;
    }

    setImportState((prev) => ({ ...prev, importing: true, error: null }));
    const collected: CharacterAssetView[] = [];
    const failed: string[] = [];

    try {
      if (importState.files.length > 0) {
        const form = new FormData();
        for (const item of importState.files) {
          form.append('files', item.file);
        }
        form.append(
          'items',
          JSON.stringify(
            importState.files.map((item) => ({
              type: item.type,
              metadata: {
                importBatch: 'external_set',
                importedAt: new Date().toISOString(),
              },
            })),
          ),
        );
        const res = await fetch(`/api/characters/${characterId}/assets`, {
          method: 'POST',
          body: form,
        });
        const data: ImportResponse = await res
          .json()
          .catch(() => ({ ok: false, error: '上传响应解析失败' }));
        if (data.assets?.length) collected.push(...data.assets);
        if (data.failed?.length) failed.push(...data.failed.map((item) => item.error));
        if (!res.ok && !data.assets?.length) {
          throw new Error(data.error ?? data.failed?.[0]?.error ?? '导入失败');
        }
      }

      if (urlList.length > 0) {
        const res = await fetch(`/api/characters/${characterId}/assets`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            items: urlList.slice(0, MAX_CHARACTER_ASSETS_PER_REQUEST).map((url) => ({
              url,
              type: importState.defaultType,
              metadata: {
                importBatch: 'external_set',
                importedAt: new Date().toISOString(),
              },
            })),
          }),
        });
        const data: ImportResponse = await res
          .json()
          .catch(() => ({ ok: false, error: '导入响应解析失败' }));
        if (data.assets?.length) collected.push(...data.assets);
        if (data.failed?.length) failed.push(...data.failed.map((item) => item.error));
        if (!res.ok && !data.assets?.length) {
          throw new Error(data.error ?? data.failed?.[0]?.error ?? 'URL 导入失败');
        }
      }

      if (collected.length === 0) {
        throw new Error(failed[0] ?? '没有导入任何素材');
      }

      setAssets((prev) => sortAssets([...prev, ...collected]));
      toast.success(
        failed.length > 0
          ? `已导入 ${collected.length} 张，${failed.length} 张失败`
          : `已导入 ${collected.length} 张素材`,
      );
      setImportState((prev) => {
        prev.files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        return {
          ...prev,
          files: [],
          urls: '',
          importing: false,
          dragActive: false,
          error: null,
        };
      });
      setImportOpen(false);
      router.refresh();
    } catch (err) {
      // 部分成功时也把已入库的素材合并进列表，避免界面与后端不一致
      if (collected.length > 0) {
        setAssets((prev) => sortAssets([...prev, ...collected]));
        toast.success(
          `已导入 ${collected.length} 张${failed.length > 0 ? `，${failed.length} 张失败` : ''}`,
        );
        router.refresh();
      }
      setImportState((prev) => {
        if (collected.length > 0) {
          prev.files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        }
        return {
          ...prev,
          files: collected.length > 0 ? [] : prev.files,
          importing: false,
          error: `${errorMessage(err)}${failed.length > 0 ? `（失败 ${failed.length} 张）` : ''}`,
        };
      });
    }
  };

  const filterOptions = [
    { value: 'all', label: `全部类型 (${assets.length})` },
    { value: 'enabled', label: `已启用 (${enabledCount})` },
    { value: 'disabled', label: `已禁用 (${assets.length - enabledCount})` },
    ...CHARACTER_ASSET_TYPE_ORDER.map((type) => ({
      value: type,
      label: `${CHARACTER_ASSET_TYPE_META[type].label} (${assets.filter((a) => a.type === type).length})`,
    })),
  ];

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.toolbar)}>
        <div {...stylex.props(styles.toolbarSide)}>
          <div {...stylex.props(styles.filter)}>
            <Selector
              label="筛选"
              isLabelHidden
              size="sm"
              value={filter}
              onChange={(value) => setFilter((value as FilterValue) || 'all')}
              options={filterOptions}
            />
          </div>
          <span {...stylex.props(styles.count)}>
            共 {assets.length} 张 · {enabledCount} 张参与生图
          </span>
        </div>
        <div {...stylex.props(styles.toolbarSide)}>
          <Button
            label="导入外部设定图"
            variant="secondary"
            size="sm"
            icon={<Images size={14} />}
            onClick={() => setImportOpen(true)}
          />
          <Button
            label="添加素材"
            variant="primary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => setImportOpen(true)}
          />
        </div>
      </div>

      {assets.length === 0 ? (
        <EmptyState
          icon={<ImagePlus size={36} strokeWidth={1.5} />}
          title="还没有形象资产"
          description="用人设工坊生成全身图与四视角，或直接上传外部平台已画好的成套设定图。"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Images size={36} strokeWidth={1.5} />}
          title="当前筛选下没有素材"
          description="切换筛选条件查看其他资产。"
        />
      ) : (
        <div {...stylex.props(styles.grid)}>
          {filtered.map((asset) => {
            const busy = busyIds.has(asset.id);
            return (
              <div
                key={asset.id}
                {...stylex.props(styles.card, !asset.isEnabled && styles.cardDisabled)}
              >
                <button
                  type="button"
                  {...stylex.props(styles.thumbButton)}
                  onClick={() => setLightboxAsset(asset)}
                  aria-label={`查看大图：${CHARACTER_ASSET_TYPE_META[asset.type].label}`}
                >
                  <SafeImage
                    src={asset.url}
                    alt={CHARACTER_ASSET_TYPE_META[asset.type].label}
                    xstyle={styles.thumb}
                    loading="lazy"
                  />
                  {!asset.isEnabled && (
                    <span {...stylex.props(styles.disabledBanner)}>已禁用 · 不参与生图</span>
                  )}
                  {busy && (
                    <span {...stylex.props(styles.busyOverlay)}>
                      <Loader2 size={16} {...stylex.props(styles.spin)} />
                      保存中…
                    </span>
                  )}
                </button>

                <div {...stylex.props(styles.badgeRow)}>
                  <div {...stylex.props(styles.tagStack)}>
                    <Token
                      label={CHARACTER_ASSET_TYPE_META[asset.type].shortLabel}
                      color={asset.isEnabled ? 'blue' : 'gray'}
                    />
                  </div>
                  <div {...stylex.props(styles.switchWrap)}>
                    <SwitchControl
                      enabled={asset.isEnabled}
                      busy={busy}
                      onToggle={(next) => void toggleEnabled(asset, next)}
                    />
                  </div>
                </div>

                <div {...stylex.props(styles.footer)}>
                  <div {...stylex.props(styles.footerTop)}>
                    <div {...stylex.props(styles.meta)}>
                      <span {...stylex.props(styles.label)}>{assetSubLabel(asset)}</span>
                      <span {...stylex.props(styles.sublabel)}>
                        {asset.isEnabled ? '已启用' : '已禁用'} · {SOURCE_LABEL[asset.source] ?? asset.source}
                      </span>
                    </div>
                    <div {...stylex.props(styles.iconActions)}>
                      <button
                        type="button"
                        {...stylex.props(styles.iconButton)}
                        title="重新上传替换"
                        aria-label="重新上传替换"
                        disabled={busy}
                        onClick={() => pickReplacement(asset)}
                      >
                        <RefreshCw size={13} />
                      </button>
                      <button
                        type="button"
                        {...stylex.props(styles.iconButton, styles.iconButtonDanger)}
                        title="删除素材"
                        aria-label="删除素材"
                        disabled={busy}
                        onClick={() => setDeleteTarget(asset)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            {...stylex.props(styles.addCard)}
            onClick={() => setImportOpen(true)}
          >
            <Plus size={22} />
            <span {...stylex.props(styles.addCardTitle)}>添加素材</span>
            <span {...stylex.props(styles.addCardHint)}>多选上传或从 URL 批量导入</span>
          </button>
        </div>
      )}

      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        {...stylex.props(styles.hidden)}
        onChange={(event) => void handleReplaceFile(event.target.files)}
      />

      {/* 删除确认 */}
      <Dialog
        isOpen={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteTarget(null);
        }}
        purpose="form"
        width={420}
        padding={0}
      >
        {deleteTarget && (
          <>
            <DialogHeader
              title="删除这张素材？"
              subtitle="删除后无法恢复，自有存储中的图片也会一并清理。"
              onOpenChange={(open) => {
                if (!open && !isDeleting) setDeleteTarget(null);
              }}
              hasDivider
              xstyle={styles.dialogHeader}
            />
            <div {...stylex.props(styles.dialogBody)}>
              <HStack gap={3} vAlign="center">
                <SafeImage
                  src={deleteTarget.url}
                  alt="待删除素材"
                  xstyle={styles.confirmThumb}
                />
                <VStack gap={1}>
                  <Text weight="medium" as="div">
                    {CHARACTER_ASSET_TYPE_META[deleteTarget.type].label}
                  </Text>
                  <Text type="supporting" size="sm" as="div">
                    {SOURCE_LABEL[deleteTarget.source] ?? deleteTarget.source} ·{' '}
                    {deleteTarget.isEnabled ? '当前已启用' : '当前已禁用'}
                  </Text>
                  <Text type="supporting" size="sm" as="div">
                    如果只是暂时不用，建议关闭开关而不是删除。
                  </Text>
                </VStack>
              </HStack>
            </div>
            <div {...stylex.props(styles.dialogFooter)}>
              <Text type="supporting" size="sm" as="span">
                此操作不可撤销
              </Text>
              <HStack gap={2}>
                <Button
                  label="取消"
                  variant="secondary"
                  size="sm"
                  isDisabled={isDeleting}
                  onClick={() => setDeleteTarget(null)}
                />
                <Button
                  label={isDeleting ? '删除中…' : '确认删除'}
                  variant="primary"
                  size="sm"
                  isLoading={isDeleting}
                  isDisabled={isDeleting}
                  onClick={() => void confirmDelete()}
                />
              </HStack>
            </div>
          </>
        )}
      </Dialog>

      {/* 导入 / 添加素材 */}
      <Dialog
        isOpen={importOpen}
        onOpenChange={(open) => {
          if (!open) closeImport();
        }}
        purpose="form"
        width={680}
        padding={0}
      >
        <DialogHeader
          title="导入形象素材"
          subtitle="支持多选上传，可逐张打标；也可以直接粘贴外部平台生成的图片 URL。"
          onOpenChange={(open) => {
            if (!open) closeImport();
          }}
          hasDivider
          xstyle={styles.dialogHeader}
        />

        <div {...stylex.props(styles.dialogBody)}>
          <VStack gap={2}>
            <span {...stylex.props(styles.fieldLabel)}>上传图片</span>
            <div
              {...stylex.props(
                styles.dropZone,
                importState.dragActive && styles.dropZoneActive,
              )}
              role="button"
              tabIndex={0}
              onClick={() => importInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  importInputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setImportState((prev) => ({ ...prev, dragActive: true }));
              }}
              onDragLeave={() => setImportState((prev) => ({ ...prev, dragActive: false }))}
              onDrop={(event) => {
                event.preventDefault();
                setImportState((prev) => ({ ...prev, dragActive: false }));
                addFiles(event.dataTransfer.files);
              }}
            >
              <Upload size={22} />
              <span {...stylex.props(styles.fieldLabel)}>点击选择，或把图片拖到这里</span>
              <span {...stylex.props(styles.fieldHint)}>
                支持 JPG / PNG / WebP，单张最大 15MB，单次最多 {MAX_CHARACTER_ASSETS_PER_REQUEST} 张
              </span>
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept="image/*"
              multiple
              {...stylex.props(styles.hidden)}
              onChange={(event) => {
                addFiles(event.target.files);
                if (importInputRef.current) importInputRef.current.value = '';
              }}
            />
          </VStack>

          {importState.files.length > 0 && (
            <VStack gap={2}>
              <HStack hAlign="between" vAlign="center" width="100%">
                <span {...stylex.props(styles.fieldLabel)}>
                  已选择 {importState.files.length} 张
                </span>
                <Button
                  label="清空"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setImportState((prev) => {
                      prev.files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
                      return { ...prev, files: [] };
                    })
                  }
                />
              </HStack>
              <div {...stylex.props(styles.fileList)}>
                {importState.files.map((item) => (
                  <div key={item.id} {...stylex.props(styles.fileRow)}>
                    <SafeImage
                      src={item.previewUrl}
                      alt={item.file.name}
                      xstyle={styles.fileThumb}
                    />
                    <div {...stylex.props(styles.fileMeta)}>
                      <span {...stylex.props(styles.fileName)}>{item.file.name}</span>
                      <span {...stylex.props(styles.sublabel)}>
                        {(item.file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </div>
                    <div {...stylex.props(styles.fileType)}>
                      <Selector
                        label="素材类型"
                        isLabelHidden
                        size="sm"
                        value={item.type}
                        onChange={(value) =>
                          updatePendingType(item.id, (value as CharacterAssetType) || 'custom')
                        }
                        options={TYPE_OPTIONS}
                      />
                    </div>
                    <button
                      type="button"
                      {...stylex.props(styles.iconButton)}
                      aria-label="移除"
                      title="移除"
                      onClick={() => removePendingFile(item.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </VStack>
          )}

          <VStack gap={2}>
            <span {...stylex.props(styles.fieldLabel)}>外部图片 URL（可选）</span>
            <span {...stylex.props(styles.fieldHint)}>
              每行一个链接，会下载并转存到自有存储；适合外部平台已生成整套设定图的情况。
            </span>
            <textarea
              {...stylex.props(styles.textArea)}
              value={importState.urls}
              placeholder={'https://example.com/full-body.png\nhttps://example.com/front-view.png'}
              onChange={(event) =>
                setImportState((prev) => ({ ...prev, urls: event.target.value }))
              }
            />
          </VStack>

          <VStack gap={2}>
            <span {...stylex.props(styles.fieldLabel)}>URL 素材的默认类型</span>
            <Selector
              label="默认类型"
              isLabelHidden
              value={importState.defaultType}
              onChange={(value) =>
                setImportState((prev) => ({
                  ...prev,
                  defaultType: (value as CharacterAssetType) || 'custom',
                }))
              }
              options={TYPE_OPTIONS}
            />
          </VStack>

          {importState.error && (
            <Text type="supporting" size="sm" as="p">
              {importState.error}
            </Text>
          )}
        </div>

        <div {...stylex.props(styles.dialogFooter)}>
          <span {...stylex.props(styles.footerHint)}>
            上传后默认启用；不想让某张参与生图时，回到面板关掉它的开关即可。
          </span>
          <HStack gap={2}>
            <Button
              label="取消"
              variant="secondary"
              size="sm"
              isDisabled={importState.importing}
              onClick={closeImport}
            />
            <Button
              label={importState.importing ? '导入中…' : '导入'}
              variant="primary"
              size="sm"
              isLoading={importState.importing}
              isDisabled={importState.importing}
              icon={
                importState.importing ? (
                  <Loader2 size={13} {...stylex.props(styles.spin)} />
                ) : (
                  <Check size={13} />
                )
              }
              onClick={() => void handleImport()}
            />
          </HStack>
        </div>
      </Dialog>

      <MediaLightbox
        media={
          lightboxAsset
            ? {
                url: lightboxAsset.url,
                originalFilename: `${CHARACTER_ASSET_TYPE_META[lightboxAsset.type].label}.${lightboxAsset.mimeType.split('/')[1] ?? 'png'}`,
                width: lightboxAsset.width,
                height: lightboxAsset.height,
              }
            : null
        }
        onClose={() => setLightboxAsset(null)}
      />
    </div>
  );
}

/**
 * 卡片右上角的紧凑开关：Astryx Switch 的 label 视觉隐藏但保留给读屏器。
 * 外层容器负责保证它在图片上有足够对比度。
 */
function SwitchControl({
  enabled,
  busy,
  onToggle,
}: {
  enabled: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Switch
      label={enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
      isLabelHidden
      size="sm"
      value={enabled}
      isLoading={busy}
      isDisabled={busy}
      onChange={(next) => onToggle(next)}
    />
  );
}
