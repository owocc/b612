'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { SafeImage } from '@/components/safe-image';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { useAppToast } from '@/lib/toast';
import { nativeAttrs } from '@/lib/native-attrs';
import { saveImageGenConfig, testImageGenAction } from '@/server/actions/settings';
import { supportsImageGen, IMAGE_MODEL_SUGGESTIONS } from '@/lib/providers-shared';
import * as stylex from '@stylexjs/stylex';

const spin = stylex.keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});

const styles = stylex.create({
  spin: {
    animationName: spin,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    borderBottom: '1px solid var(--color-border)',
    paddingBottom: '12px',
  },
  title: {
    fontSize: 'var(--font-size-xl)',
    fontWeight: 'var(--font-weight-semibold)',
    letterSpacing: '-0.01em',
  },
  subtitle: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
  },
  infoBanner: {
    padding: '16px',
    backgroundColor: 'var(--color-background-muted)',
    borderRadius: 'var(--radius-container)',
    border: '1px solid var(--color-border)',
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '9999px',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-medium)',
  },
  statusReady: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    color: 'rgb(22, 163, 74)',
  },
  statusWarn: {
    backgroundColor: 'rgba(234, 179, 8, 0.12)',
    color: 'rgb(202, 138, 4)',
  },
  statusDisabled: {
    backgroundColor: 'var(--color-background-muted)',
    color: 'var(--color-text-secondary)',
  },
  preview: {
    maxWidth: 320,
    maxHeight: 320,
    borderRadius: 'var(--radius-element)',
    border: '1px solid var(--color-border)',
  },
});

export function ImageGenSettings({
  config,
  providers,
}: {
  config: { enabled: boolean; providerId: string | null; modelId: string | null };
  providers: { id: string; name: string; providerType: string }[];
}) {
  const router = useRouter();
  const toast = useAppToast();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testImageUrl, setTestImageUrl] = useState<string | null>(null);
  const [cfg, setCfg] = useState({
    enabled: config.enabled ?? false,
    providerId: config.providerId ?? '',
    modelId: config.modelId ?? '',
  });

  const selectedProvider = providers.find((p) => p.id === cfg.providerId);
  const canImageGen = selectedProvider ? supportsImageGen(selectedProvider.providerType) : false;
  const suggestions = selectedProvider
    ? IMAGE_MODEL_SUGGESTIONS[selectedProvider.providerType] ?? []
    : [];

  const saveConfig = async () => {
    setSaving(true);
    const res = await saveImageGenConfig({
      enabled: cfg.enabled,
      providerId: cfg.providerId || null,
      modelId: cfg.modelId || null,
    });
    setSaving(false);
    if (res?.error) {
      toast.error(res.error);
    } else {
      toast.success('AI 生图配置已保存');
      router.refresh();
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestImageUrl(null);
    const res = await testImageGenAction({
      enabled: cfg.enabled,
      providerId: cfg.providerId || null,
      modelId: cfg.modelId || null,
    });
    setTesting(false);
    if (res.ok) {
      setTestImageUrl(res.imageUrl);
      toast.success('生图测试成功');
    } else {
      toast.error(res.error);
    }
  };

  return (
    <VStack gap={6}>
      {/* Page Header */}
      <div {...stylex.props(styles.header)}>
        <div>
          <h1 {...stylex.props(styles.title)}>AI 生图 (Image Generation)</h1>
          <p {...stylex.props(styles.subtitle)}>
            配置统一的图片生成模型，AI 居民可以依人设与上下文自主决定配图
          </p>
        </div>
      </div>

      <div {...stylex.props(styles.infoBanner)}>
        <HStack gap={1.5} vAlign="center">
          <ImagePlus size={18} color="var(--color-primary, #6366f1)" />
          <Text size="sm" as="span">
            {'\u201C配置后，AI 居民在发朋友圈或私聊时可以自己生成图片\u201D'}
          </Text>
        </HStack>
        <Text type="supporting" size="sm" as="p">
          启用后，AI 居民在发朋友圈动态、私聊时会根据你的人设和当前语境判断是否需要配一张图，并自动生成图片加配文。
          未启用或未配置时，所有 AI 完全不会调用生图。当前支持 OpenAI 与 OpenAI 兼容类型的服务商。
        </Text>
      </div>

      <Card variant="default">
        <VStack gap={5}>
          <HStack hAlign="between" vAlign="center" width="100%">
            <Switch
              label="启用 AI 生图"
              labelPosition="start"
              labelSpacing="spread"
              value={cfg.enabled}
              onChange={(checked) => setCfg((s) => ({ ...s, enabled: checked }))}
            />
            <div
              {...stylex.props(
                styles.statusBadge,
                !cfg.enabled
                  ? styles.statusDisabled
                  : canImageGen
                    ? styles.statusReady
                    : styles.statusWarn,
              )}
            >
              {!cfg.enabled ? (
                <span>已停用</span>
              ) : canImageGen ? (
                <>
                  <CheckCircle2 size={13} />
                  <span>生图已就绪</span>
                </>
              ) : (
                <>
                  <AlertCircle size={13} />
                  <span>当前服务商类型不支持生图</span>
                </>
              )}
            </div>
          </HStack>

          {cfg.enabled && (
            <VStack gap={4}>
              <Selector
                label="生图 Provider"
                placeholder="（跟随系统默认 AI 服务商）"
                hasClear
                value={cfg.providerId}
                onChange={(v) => setCfg((s) => ({ ...s, providerId: v ?? '', modelId: '' }))}
                options={providers.map((p) => ({
                  value: p.id,
                  label: `${p.name}（${p.providerType}）${supportsImageGen(p.providerType) ? '' : ' · 不支持生图'}`,
                }))}
              />

              <div>
                <TextInput
                  label="生图 Model ID"
                  value={cfg.modelId}
                  onChange={(v) => setCfg((s) => ({ ...s, modelId: v }))}
                  placeholder="例如 gpt-image-1 / dall-e-3 / flux-schnell"
                  {...nativeAttrs({ list: `image-models-${cfg.providerId}` })}
                  htmlName="image-model-id"
                />
                <datalist id={`image-models-${cfg.providerId}`}>
                  {suggestions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>

              <HStack gap={2}>
                <Button
                  label={testing ? '生成中…' : '测试生图'}
                  variant="secondary"
                  size="sm"
                  icon={testing ? <Loader2 size={13} {...stylex.props(styles.spin)} /> : <ImagePlus size={13} />}
                  isDisabled={testing}
                  isLoading={testing}
                  onClick={runTest}
                />
              </HStack>

              {testImageUrl && (
                <SafeImage
                  src={testImageUrl}
                  alt="生图测试结果"
                  showSkeleton={false}
                  xstyle={styles.preview}
                />
              )}
            </VStack>
          )}

          <div>
            <Button
              label="保存 AI 生图配置"
              variant="primary"
              onClick={saveConfig}
              isDisabled={saving}
              isLoading={saving}
            />
          </div>
        </VStack>
      </Card>
    </VStack>
  );
}
