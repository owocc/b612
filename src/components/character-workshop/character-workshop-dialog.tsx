'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as stylex from '@stylexjs/stylex';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  SkipForward,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Banner } from '@astryxdesign/core/Banner';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Stepper, Step } from '@astryxdesign/core/Stepper';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { MediaImage } from '@/components/media-image';
import { useAppToast } from '@/lib/toast';
import {
  WORKSHOP_DETAIL_TARGETS,
  WORKSHOP_FULL_BODY_PROMPT,
  WORKSHOP_PROMPT_VERSION,
  WORKSHOP_STAGE_META,
  WORKSHOP_VIEW_TARGETS,
  getWorkshopTargetMeta,
  type WorkshopTarget,
} from '@/lib/character-workshop';
import { CHARACTER_ASSET_TYPE_META } from '@/lib/character-assets';
import type { CharacterAssetView } from '@/lib/character-assets';
import { WorkshopEmptyTile, WorkshopItemCard, type WorkshopItem } from './workshop-item-card';

const STEPS = [WORKSHOP_STAGE_META.base, WORKSHOP_STAGE_META.full_body, WORKSHOP_STAGE_META.derive];

const styles = stylex.create({
  headerPad: {
    paddingBlock: 'var(--spacing-4)',
    paddingInline: 'var(--spacing-5)',
  },
  body: {
    padding: 'var(--spacing-4) var(--spacing-5)',
    maxHeight: '76dvh',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-4)',
    '@media (max-width: 639px)': {
      paddingInline: 'var(--spacing-4)',
      maxHeight: '64dvh',
    },
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-3)',
    padding: 'var(--spacing-3) var(--spacing-5)',
    borderTop: '1px solid var(--color-border)',
    flexWrap: 'wrap',
    rowGap: 'var(--spacing-2)',
  },
  footerSide: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-2)',
    flexWrap: 'wrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
    gap: 'var(--spacing-3)',
  },
  gridWide: {
    gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
  },
  sectionTitle: {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text-primary)',
  },
  sectionHint: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
  },
  referenceBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-3)',
    padding: 'var(--spacing-3)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'var(--color-background-muted)',
  },
  referenceThumb: {
    width: '56px',
    height: '75px',
    borderRadius: 'var(--radius-element)',
    objectFit: 'cover',
    border: '1px solid var(--color-border)',
    flexShrink: 0,
  },
  promptBox: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11px',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'var(--color-text-secondary)',
    backgroundColor: 'var(--color-background-muted)',
    borderRadius: 'var(--radius-element)',
    padding: 'var(--spacing-3)',
    maxHeight: '180px',
    overflowY: 'auto',
    border: '1px solid var(--color-border)',
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
  grow: { flex: 1, minWidth: 0 },
  metaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
  },
});

export type WorkshopCharacter = {
  id: string;
  name: string;
  persona: string;
  personality: string;
  interests: string;
  relationshipToUser: string;
  bio: string | null;
};

type WorkshopItemRecord = WorkshopItem;

function defaultDescription(character: WorkshopCharacter): string {
  const parts = [character.persona, character.personality ? `性格：${character.personality}` : '', character.bio ?? '']
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.join('\n').slice(0, 1000);
}

function dedupe(items: WorkshopItemRecord[]): WorkshopItemRecord[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '操作失败，请重试';
}

/** 串行 + 小并发：单次生成失败不影响其余目标 */
async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit = 2): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      await tasks[index]();
    }
  });
  await Promise.all(workers);
}

export function CharacterWorkshopLauncher({
  character,
  label = '人设工坊',
  variant = 'secondary',
  size = 'sm',
  isIconOnly = false,
}: {
  character: WorkshopCharacter;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isIconOnly?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <Button
        label={label}
        variant={variant}
        size={size}
        isIconOnly={isIconOnly}
        icon={<Wand2 size={14} />}
        onClick={() => setIsOpen(true)}
      />
      {isOpen && (
        <CharacterWorkshopDialog
          character={character}
          isOpen={isOpen}
          onOpenChange={setIsOpen}
        />
      )}
    </>
  );
}

export function CharacterWorkshopDialog({
  character,
  isOpen,
  onOpenChange,
}: {
  character: WorkshopCharacter;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const toast = useAppToast();

  const [step, setStep] = useState(0);
  const [description, setDescription] = useState(() => defaultDescription(character));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [baseItems, setBaseItems] = useState<WorkshopItemRecord[]>([]);
  const [baseSelectedId, setBaseSelectedId] = useState<string | null>(null);
  const [fullItems, setFullItems] = useState<WorkshopItemRecord[]>([]);
  const [fullSelectedId, setFullSelectedId] = useState<string | null>(null);
  const [deriveItems, setDeriveItems] = useState<WorkshopItemRecord[]>([]);
  const [deriveSelection, setDeriveSelection] = useState<Record<string, string>>({});

  const [generatingTargets, setGeneratingTargets] = useState<WorkshopTarget[]>([]);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUpload = useRef<{ target: WorkshopTarget; multiple: boolean } | null>(null);

  const selectedBase = baseItems.find((item) => item.id === baseSelectedId) ?? null;
  const selectedFull = fullItems.find((item) => item.id === fullSelectedId) ?? null;
  const fullReferenceUrl = selectedBase?.url ?? null;
  const deriveReferenceUrl = selectedFull?.url ?? selectedBase?.url ?? null;

  const isGenerating = (target: WorkshopTarget) => generatingTargets.includes(target);

  /* ---------------- 已有资产 ---------------- */

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/characters/${character.id}/assets`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled || !data.ok) return;
        const assets = (data.assets ?? []) as CharacterAssetView[];
        const toItem = (asset: CharacterAssetView, target: WorkshopTarget): WorkshopItemRecord => ({
          id: asset.id,
          url: asset.url,
          target,
          label: CHARACTER_ASSET_TYPE_META[asset.type].shortLabel,
          prompt: typeof asset.metadata?.prompt === 'string' ? asset.metadata.prompt : '',
          warning: null,
          saved: true,
          source: 'existing',
        });
        const baseAssets = assets.filter((asset) => asset.type === 'base');
        const fullAssets = assets.filter((asset) => asset.type === 'full_body');
        const deriveAssets = assets.filter((asset) =>
          ['three_view', 'detail_face', 'detail_outfit'].includes(asset.type),
        );
        const deriveMap: Record<string, WorkshopTarget> = {
          front: 'front',
          side: 'side',
          back: 'back',
          three_quarter: 'three_quarter',
          detail_face: 'detail_face',
          detail_outfit: 'detail_outfit',
        };
        const existingDerive = deriveAssets
          .map((asset) => {
            const rawTarget = asset.metadata?.workshopTarget;
            const target = typeof rawTarget === 'string' ? deriveMap[rawTarget] : undefined;
            if (!target) return null;
            return toItem(asset, target);
          })
          .filter((item): item is WorkshopItemRecord => item !== null);
        if (!cancelled) {
          setBaseItems((prev) => dedupe([...baseAssets.map((asset) => toItem(asset, 'base')), ...prev]));
          setFullItems((prev) => dedupe([...fullAssets.map((asset) => toItem(asset, 'full_body')), ...prev]));
          setDeriveItems((prev) => dedupe([...existingDerive, ...prev]));
        }
      } catch {
        // 已有资产加载失败不阻断向导
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, character.id]);

  /* ---------------- 生成 ---------------- */

  const addItem = useCallback((item: WorkshopItemRecord) => {
    if (item.target === 'base') {
      setBaseItems((prev) => [item, ...prev.filter((entry) => entry.id !== item.id)]);
      setBaseSelectedId(item.id);
      return;
    }
    if (item.target === 'full_body') {
      setFullItems((prev) => [item, ...prev.filter((entry) => entry.id !== item.id)]);
      setFullSelectedId(item.id);
      return;
    }
    setDeriveItems((prev) => [item, ...prev.filter((entry) => entry.id !== item.id)]);
    setDeriveSelection((prev) => ({ ...prev, [item.target]: item.id }));
  }, []);

  const generate = useCallback(
    async (
      target: WorkshopTarget,
      references: string[],
      options?: { withDescription?: boolean },
    ) => {
      setError(null);
      setGeneratingTargets((prev) => [...prev, target]);
      try {
        const res = await fetch(`/api/characters/${character.id}/workshop/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            target,
            description: options?.withDescription ? description : undefined,
            referenceUrls: references.filter((url) => url.trim().length > 0),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || '生成失败，请稍后重试');
        }
        const preview = data.preview as {
          id: string;
          url: string;
          label: string;
          prompt: string;
          warning: string | null;
        };
        addItem({
          id: preview.id,
          url: preview.url,
          target,
          label: preview.label,
          prompt: preview.prompt,
          warning: preview.warning,
          saved: false,
          source: 'generated',
        });
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setGeneratingTargets((prev) => prev.filter((entry) => entry !== target));
      }
    },
    [addItem, character.id, description],
  );

  const generateDeriveBatch = useCallback(
    async (targets: WorkshopTarget[]) => {
      if (!deriveReferenceUrl) {
        setError('还没有可作为参考的全身图 / 基础形象：请先在上一步生成或上传一张');
        return;
      }
      await runWithConcurrency(
        targets.map((target) => () => generate(target, [deriveReferenceUrl])),
        2,
      );
    },
    [deriveReferenceUrl, generate],
  );

  /* ---------------- 上传（上传即入库） ---------------- */

  const openFilePicker = (target: WorkshopTarget, multiple = false) => {
    pendingUpload.current = { target, multiple };
    if (fileInputRef.current) {
      fileInputRef.current.multiple = multiple;
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFilesPicked = async (fileList: FileList | null) => {
    const pending = pendingUpload.current;
    pendingUpload.current = null;
    if (!pending || !fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setError(null);
    setUploadingKey(pending.target === 'base' || pending.target === 'full_body' ? pending.target : `${pending.target}`);
    try {
      for (const file of files) {
        const meta = getWorkshopTargetMeta(pending.target);
        const form = new FormData();
        form.append('files', file);
        form.append('type', meta.assetType);
        form.append(
          'metadata',
          JSON.stringify({
            workshop: true,
            workshopStage: meta.stage,
            workshopTarget: meta.target,
            promptVersion: WORKSHOP_PROMPT_VERSION,
            uploadedAt: new Date().toISOString(),
          }),
        );
        const res = await fetch(`/api/characters/${character.id}/assets`, {
          method: 'POST',
          body: form,
        });
        const data = await res.json();
        if (!res.ok || !data.ok || !data.assets?.length) {
          throw new Error(data.error || '上传失败');
        }
        const asset = data.assets[0] as CharacterAssetView;
        addItem({
          id: asset.id,
          url: asset.url,
          target: pending.target,
          label: pending.target === 'base' ? '本地上传' : meta.label,
          prompt: '',
          warning: null,
          saved: true,
          source: 'upload',
        });
      }
      toast.success(files.length > 1 ? `已上传 ${files.length} 张图片并入库` : '图片已上传并入库');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploadingKey(null);
    }
  };

  /* ---------------- 入库 ---------------- */

  const persistItems = useCallback(
    async (items: WorkshopItemRecord[]): Promise<WorkshopItemRecord[]> => {
      const pending = items.filter((item) => !item.saved);
      if (pending.length === 0) return items;
      const res = await fetch(`/api/characters/${character.id}/workshop/assets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: pending.map((item) => ({
            url: item.url,
            target: item.target,
            prompt: item.prompt,
            characterName: character.name,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || '素材入库失败');
      }
      const savedUrls = new Set<string>((data.assets ?? []).map((asset: CharacterAssetView) => asset.url));
      return items.map((item) =>
        savedUrls.has(item.url) || item.saved ? { ...item, saved: true } : item,
      );
    },
    [character.id, character.name],
  );

  const goNext = async () => {
    setError(null);
    if (step === 2) {
      await finish();
      return;
    }
    setSaving(true);
    try {
      if (step === 0 && selectedBase && !selectedBase.saved) {
        const saved = await persistItems([selectedBase]);
        setBaseItems((prev) =>
          prev.map((item) => saved.find((entry) => entry.id === item.id) ?? item),
        );
      }
      if (step === 1 && selectedFull && !selectedFull.saved) {
        const saved = await persistItems([selectedFull]);
        setFullItems((prev) =>
          prev.map((item) => saved.find((entry) => entry.id === item.id) ?? item),
        );
      }
      setStep((prev) => Math.min(prev + 1, 2));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const skipStep = async () => {
    setError(null);
    if (step === 2) {
      await finish();
      return;
    }
    setStep((prev) => Math.min(prev + 1, 2));
  };

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      const selectedDerive = deriveItems.filter(
        (item) => deriveSelection[item.target] === item.id,
      );
      const pendingCount = selectedDerive.filter((item) => !item.saved).length;
      if (selectedDerive.length > 0) {
        const saved = await persistItems(selectedDerive);
        setDeriveItems((prev) =>
          prev.map((item) => saved.find((entry) => entry.id === item.id) ?? item),
        );
      }
      if (pendingCount > 0) {
        toast.success(`已同步 ${pendingCount} 张素材到角色资产`);
      } else if (selectedDerive.length > 0) {
        toast.success('向导已完成，所选素材均已在资产表中');
      } else {
        toast.success('向导已完成，未新增素材');
      }
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    setError(null);
    setStep((prev) => Math.max(prev - 1, 0));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      purpose="form"
      width={1080}
      maxHeight="92dvh"
      padding={0}
    >
      <DialogHeader
        title={`人设工坊 · ${character.name}`}
        subtitle="三步锁定角色形象：基础形象 → 稳定全身图 → 多视角与细节拆解，任意步骤都可跳过或手动上传"
        onOpenChange={onOpenChange}
        xstyle={styles.headerPad}
      />

      <div {...stylex.props(styles.body)}>
        <Stepper activeStep={step} onStepClick={(index) => index < step && setStep(index)}>
          {STEPS.map((meta, index) => (
            <Step key={meta.title} step={index} label={meta.title} description={meta.subtitle} />
          ))}
        </Stepper>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            void handleFilesPicked(event.target.files);
          }}
        />

        {error && (
          <Banner
            status="error"
            title="这一步没有完成"
            description={error}
            isDismissable
            onDismiss={() => setError(null)}
          />
        )}

        {step === 0 && (
          <VStack gap={4}>
            <TextArea
              label="形象描述"
              description="写外貌、年龄感、发型、穿搭与气质；留空时会自动读取角色人设字段"
              rows={4}
              value={description}
              onChange={setDescription}
              htmlName="workshop-description"
              placeholder="例如：25 岁，短发，圆框眼镜，米色针织开衫，安静但眼神很亮"
            />

            <HStack gap={2} vAlign="center" wrap="wrap">
              <Button
                label={isGenerating('base') ? '生成中…' : '生成基础形象'}
                variant="primary"
                icon={
                  isGenerating('base') ? (
                    <Loader2 size={14} {...stylex.props(styles.spin)} />
                  ) : (
                    <Sparkles size={14} />
                  )
                }
                isLoading={isGenerating('base')}
                isDisabled={isGenerating('base')}
                onClick={() => void generate('base', [], { withDescription: true })}
              />
              <Button
                label={uploadingKey === 'base' ? '上传中…' : '上传图片作为基础形象'}
                variant="secondary"
                icon={<Upload size={14} />}
                isDisabled={uploadingKey === 'base'}
                onClick={() => openFilePicker('base', true)}
              />
              <Text size="sm" type="supporting" as="span">
                支持单张 / 多张，上传即自动入库并标注为「基础形象」
              </Text>
            </HStack>

            {baseItems.length > 0 ? (
              <div {...stylex.props(styles.grid)}>
                {baseItems.map((item) => (
                  <WorkshopItemCard
                    key={item.id}
                    item={item}
                    selected={baseSelectedId === item.id}
                    isBusy={isGenerating('base')}
                    isUploading={uploadingKey === 'base'}
                    onSelect={() => setBaseSelectedId(item.id)}
                    onRegenerate={() => void generate('base', [], { withDescription: true })}
                    onUpload={() => openFilePicker('base', true)}
                  />
                ))}
              </div>
            ) : (
              <div {...stylex.props(styles.referenceBar)}>
                <ImagePlus size={18} color="var(--color-text-secondary)" />
                <div {...stylex.props(styles.grow)}>
                  <div {...stylex.props(styles.sectionTitle)}>还没有候选项</div>
                  <div {...stylex.props(styles.sectionHint)}>
                    点「生成基础形象」得到初版形象，或直接上传已有参考图。跳过则沿用角色现有资产。
                  </div>
                </div>
              </div>
            )}
          </VStack>
        )}

        {step === 1 && (
          <VStack gap={4}>
            <div {...stylex.props(styles.referenceBar)}>
              {fullReferenceUrl ? (
                <MediaImage
                  src={fullReferenceUrl}
                  alt="基础形象参考"
                  xstyle={styles.referenceThumb}
                />
              ) : (
                <ImagePlus size={20} color="var(--color-text-secondary)" />
              )}
              <div {...stylex.props(styles.grow)}>
                <div {...stylex.props(styles.sectionTitle)}>
                  {fullReferenceUrl ? '已携带基础形象作为参考图' : '未选择基础形象'}
                </div>
                <div {...stylex.props(styles.sectionHint)}>
                  {fullReferenceUrl
                    ? '固定全身提示词会强制：full body standing pose, neutral white background, defined height proportions, head-to-toe shot'
                    : '将仅按固定全身提示词生成；也可以返回上一步选择基础形象，或在此处手动上传全身图。'}
                </div>
              </div>
            </div>

            <Collapsible trigger={`查看固定全身提示词（${WORKSHOP_PROMPT_VERSION}）`} defaultIsOpen={false}>
              <div {...stylex.props(styles.promptBox)}>{WORKSHOP_FULL_BODY_PROMPT}</div>
            </Collapsible>

            <HStack gap={2} vAlign="center" wrap="wrap">
              <Button
                label={isGenerating('full_body') ? '生成中…' : '生成全身标准图'}
                variant="primary"
                icon={
                  isGenerating('full_body') ? (
                    <Loader2 size={14} {...stylex.props(styles.spin)} />
                  ) : (
                    <Sparkles size={14} />
                  )
                }
                isLoading={isGenerating('full_body')}
                isDisabled={isGenerating('full_body')}
                onClick={() =>
                  void generate(
                    'full_body',
                    fullReferenceUrl ? [fullReferenceUrl] : [],
                  )
                }
              />
              <Button
                label={uploadingKey === 'full_body' ? '上传中…' : '手动上传全身图'}
                variant="secondary"
                icon={<Upload size={14} />}
                isDisabled={uploadingKey === 'full_body'}
                onClick={() => openFilePicker('full_body')}
              />
              <Text size="sm" type="supporting" as="span">
                外部平台（Midjourney 等）已画好全身图时，可直接上传接力
              </Text>
            </HStack>

            {fullItems.length > 0 ? (
              <div {...stylex.props(styles.grid)}>
                {fullItems.map((item) => (
                  <WorkshopItemCard
                    key={item.id}
                    item={item}
                    selected={fullSelectedId === item.id}
                    isBusy={isGenerating('full_body')}
                    isUploading={uploadingKey === 'full_body'}
                    onSelect={() => setFullSelectedId(item.id)}
                    onRegenerate={() =>
                      void generate(
                        'full_body',
                        fullReferenceUrl ? [fullReferenceUrl] : [],
                      )
                    }
                    onUpload={() => openFilePicker('full_body')}
                  />
                ))}
              </div>
            ) : (
              <div {...stylex.props(styles.referenceBar)}>
                <Wand2 size={18} color="var(--color-text-secondary)" />
                <div {...stylex.props(styles.grow)}>
                  <div {...stylex.props(styles.sectionTitle)}>全身图用于锁定骨骼与身材比例</div>
                  <div {...stylex.props(styles.sectionHint)}>
                    生成后会作为第三阶段四视角与特写的唯一参考图。
                  </div>
                </div>
              </div>
            )}
          </VStack>
        )}

        {step === 2 && (
          <VStack gap={4}>
            <div {...stylex.props(styles.referenceBar)}>
              {deriveReferenceUrl ? (
                <MediaImage
                  src={deriveReferenceUrl}
                  alt="全身图参考"
                  xstyle={styles.referenceThumb}
                />
              ) : (
                <ImagePlus size={20} color="var(--color-text-secondary)" />
              )}
              <div {...stylex.props(styles.grow)}>
                <div {...stylex.props(styles.sectionTitle)}>以全身图为基准拆解四视角与特写</div>
                <div {...stylex.props(styles.sectionHint)}>
                  {deriveReferenceUrl
                    ? '每个目标共用身份锁定模板，只改变机位 / 裁切范围，保证脸与服装高度一致。'
                    : '没有可用参考图：可以先返回上一步生成全身图，或直接手动上传各视角素材。'}
                </div>
              </div>
              <Button
                label="批量生成全部"
                variant="secondary"
                icon={<Sparkles size={14} />}
                isDisabled={!deriveReferenceUrl || generatingTargets.length > 0}
                onClick={() =>
                  void generateDeriveBatch([
                    ...WORKSHOP_VIEW_TARGETS.map((item) => item.target),
                    ...WORKSHOP_DETAIL_TARGETS.map((item) => item.target),
                  ])
                }
              />
            </div>

            <VStack gap={2}>
              <span {...stylex.props(styles.sectionTitle)}>多视角全身（4）</span>
              <span {...stylex.props(styles.sectionHint)}>
                正面 / 侧面 / 背面 / 3/4 侧面，构图与全身图完全对齐
              </span>
            </VStack>
            <div {...stylex.props(styles.grid, styles.gridWide)}>
              {WORKSHOP_VIEW_TARGETS.map((meta) => {
                const item = deriveItems.find((entry) => entry.target === meta.target) ?? null;
                return (
                  <div key={meta.target}>
                    <div {...stylex.props(styles.metaRow)}>
                      <span>{meta.label}</span>
                      <span>{meta.description}</span>
                    </div>
                    {item ? (
                      <WorkshopItemCard
                        item={item}
                        selected={deriveSelection[meta.target] === item.id}
                        isBusy={isGenerating(meta.target)}
                        isUploading={uploadingKey === meta.target}
                        onSelect={() =>
                          setDeriveSelection((prev) => ({
                            ...prev,
                            [meta.target]:
                              prev[meta.target] === item.id ? '' : item.id,
                          }))
                        }
                        onRegenerate={() =>
                          void generate(
                            meta.target,
                            deriveReferenceUrl ? [deriveReferenceUrl] : [],
                          )
                        }
                        onUpload={() => openFilePicker(meta.target)}
                      />
                    ) : (
                      <WorkshopEmptyTile
                        title={meta.label}
                        isBusy={isGenerating(meta.target)}
                        onGenerate={() =>
                          void generate(
                            meta.target,
                            deriveReferenceUrl ? [deriveReferenceUrl] : [],
                          )
                        }
                        onUpload={() => openFilePicker(meta.target)}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <VStack gap={2}>
              <span {...stylex.props(styles.sectionTitle)}>关键特写（2）</span>
              <span {...stylex.props(styles.sectionHint)}>五官 / 发型 / 眼睛与服饰材质、配饰、logo 位置</span>
            </VStack>
            <div {...stylex.props(styles.grid, styles.gridWide)}>
              {WORKSHOP_DETAIL_TARGETS.map((meta) => {
                const item = deriveItems.find((entry) => entry.target === meta.target) ?? null;
                return (
                  <div key={meta.target}>
                    <div {...stylex.props(styles.metaRow)}>
                      <span>{meta.label}</span>
                      <span>{meta.description}</span>
                    </div>
                    {item ? (
                      <WorkshopItemCard
                        item={item}
                        selected={deriveSelection[meta.target] === item.id}
                        isBusy={isGenerating(meta.target)}
                        isUploading={uploadingKey === meta.target}
                        onSelect={() =>
                          setDeriveSelection((prev) => ({
                            ...prev,
                            [meta.target]:
                              prev[meta.target] === item.id ? '' : item.id,
                          }))
                        }
                        onRegenerate={() =>
                          void generate(
                            meta.target,
                            deriveReferenceUrl ? [deriveReferenceUrl] : [],
                          )
                        }
                        onUpload={() => openFilePicker(meta.target)}
                      />
                    ) : (
                      <WorkshopEmptyTile
                        title={meta.label}
                        isBusy={isGenerating(meta.target)}
                        onGenerate={() =>
                          void generate(
                            meta.target,
                            deriveReferenceUrl ? [deriveReferenceUrl] : [],
                          )
                        }
                        onUpload={() => openFilePicker(meta.target)}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div {...stylex.props(styles.metaRow)}>
              <Check size={12} />
              已选用 {Object.values(deriveSelection).filter(Boolean).length} 张，完成时统一入库
            </div>
          </VStack>
        )}

        <div {...stylex.props(styles.metaRow)}>
          <span>提示词版本 {WORKSHOP_PROMPT_VERSION} · 固定模板不可修改，只把形象描述作为变量</span>
        </div>
      </div>

      <div {...stylex.props(styles.footer)}>
        <div {...stylex.props(styles.footerSide)}>
          <Button
            label={STEPS[step].skipHint}
            variant="ghost"
            size="sm"
            icon={<SkipForward size={14} />}
            isDisabled={saving}
            onClick={() => void skipStep()}
          />
        </div>
        <div {...stylex.props(styles.footerSide)}>
          <Button
            label="上一步"
            variant="secondary"
            size="sm"
            icon={<ChevronLeft size={14} />}
            isDisabled={step === 0 || saving}
            onClick={goBack}
          />
          <Button
            label={step === 2 ? '完成并保存' : '下一步'}
            variant="primary"
            size="sm"
            icon={
              saving ? (
                <Loader2 size={14} {...stylex.props(styles.spin)} />
              ) : step === 2 ? (
                <Check size={14} />
              ) : (
                <ChevronRight size={14} />
              )
            }
            isLoading={saving}
            isDisabled={saving}
            onClick={() => void goNext()}
          />
        </div>
      </div>
    </Dialog>
  );
}
