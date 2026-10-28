'use client';

import { useState, useRef } from 'react';
import {
  Sparkles,
  AlertCircle,
  Upload,
  Play,
  Check,
  Copy,
  FlaskConical,
} from 'lucide-react';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { SafeImage } from '@/components/safe-image';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { useAppToast } from '@/lib/toast';
import { testVisionModelAction, type TestVisionModelResult } from '@/server/actions/settings';
import type { VisionConfig } from '@/server/settings';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
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
  infoCard: {
    padding: '12px',
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-element)',
    border: '1px solid var(--color-border)',
  },
  uploadZone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    border: '2px dashed var(--color-border)',
    borderRadius: 'var(--radius-container)',
    backgroundColor: 'var(--color-surface)',
    cursor: 'pointer',
    transition: 'border-color 150ms ease, background-color 150ms ease',
    ':hover': {
      borderColor: 'var(--color-primary, #6366f1)',
      backgroundColor: 'var(--color-background-muted)',
    },
  },
  hiddenInput: {
    display: 'none',
  },
  previewRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '12px',
    borderRadius: 'var(--radius-element)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface)',
  },
  previewThumb: {
    width: '64px',
    height: '64px',
    borderRadius: 'var(--radius-element)',
    objectFit: 'cover',
    border: '1px solid var(--color-border)',
  },
  resultCard: {
    backgroundColor: 'var(--color-background-muted)',
    color: 'var(--color-text-primary)',
    borderRadius: 'var(--radius-element)',
    padding: '16px',
    fontSize: '13px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    border: '1px solid var(--color-border)',
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '8px',
  },
  errorCard: {
    padding: '12px',
    borderRadius: 'var(--radius-element)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  errorText: {
    color: 'rgb(220, 38, 38)',
  },
  selectorRow: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '12px',
    '@media (min-width: 640px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
});

export function VisionTestFactory({
  providers,
  modelsByProvider,
  vision,
}: {
  providers: { id: string; name: string; providerType: string }[];
  modelsByProvider: Record<string, string[]>;
  vision: VisionConfig;
}) {
  const toast = useAppToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [testFile, setTestFile] = useState<File | null>(null);
  const [testPreviewUrl, setTestPreviewUrl] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestVisionModelResult | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Provider/model selectors — default to current vision config
  const [selectedProviderId, setSelectedProviderId] = useState(vision.providerId ?? providers[0]?.id ?? '');
  const [selectedModelId, setSelectedModelId] = useState(vision.modelId ?? '');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (testPreviewUrl) URL.revokeObjectURL(testPreviewUrl);
    setTestFile(file);
    setTestPreviewUrl(URL.createObjectURL(file));
    setTestResult(null);
  };

  const runTest = async () => {
    if (!testFile) {
      toast.error('请先选择一张测试图片');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const formData = new FormData();
      formData.append('file', testFile);
      if (selectedProviderId) formData.append('providerId', selectedProviderId);
      if (selectedModelId) formData.append('modelId', selectedModelId);
      formData.append('prompt', '帮我解析这个图片');
      formData.append('temperature', '0.2');
      formData.append('maxTokens', '800');
      const result = await testVisionModelAction(formData);
      setTestResult(result);
      if (result.ok) {
        toast.success('视觉模型识别测试完成');
      } else {
        toast.error(result.error || '测试失败');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const copyPromptBlock = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(true);
    toast.success('已复制提示词');
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const currentModels = selectedProviderId ? modelsByProvider[selectedProviderId] ?? [] : [];

  return (
    <VStack gap={6}>
      {/* Page Header */}
      <div {...stylex.props(styles.header)}>
        <div>
          <HStack gap={1.5} vAlign="center">
            <FlaskConical size={18} color="var(--color-primary, #6366f1)" />
            <h1 {...stylex.props(styles.title)}>测试场</h1>
          </HStack>
          <p {...stylex.props(styles.subtitle)}>
            用于调试 AI 与图片理解
          </p>
        </div>
      </div>

      {/* Live Vision Model Testing Section */}
      <Card variant="default">
        <VStack gap={4}>
          <VStack gap={0.5}>
            <HStack gap={1.5} vAlign="center">
              <Sparkles size={18} color="var(--color-primary, #6366f1)" />
              <Text size="base" as="span">
                视觉模型在线测试 (Live Vision Test)
              </Text>
            </HStack>
            <Text type="supporting" size="sm" as="p">
              上传一张图片，实时测试当前视觉模型输出的客观感知内容、结构化数据与装配提示词。
            </Text>
          </VStack>

          {/* Provider / Model Selectors */}
          <div {...stylex.props(styles.selectorRow)}>
            <Selector
              label="测试 Provider"
              placeholder="（跟随系统默认）"
              hasClear
              value={selectedProviderId}
              onChange={(v) => {
                setSelectedProviderId(v ?? '');
                setSelectedModelId('');
              }}
              options={providers.map((p) => ({
                value: p.id,
                label: `${p.name}（${p.providerType}）`,
              }))}
            />
            <Selector
              label="测试 Model"
              placeholder="（使用 Provider 默认模型）"
              hasClear
              value={selectedModelId}
              onChange={(v) => setSelectedModelId(v ?? '')}
              options={currentModels.map((m) => ({ value: m, label: m }))}
            />
          </div>

          {/* Upload Area */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            {...stylex.props(styles.hiddenInput)}
            onChange={handleFileChange}
          />

          {!testPreviewUrl ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              {...stylex.props(styles.uploadZone)}
            >
              <VStack gap={2} hAlign="center">
                <Upload size={28} color="var(--color-text-secondary)" />
                <Text size="sm" as="span">
                  点击或拖拽上传测试图片
                </Text>
                <Text type="supporting" size="sm" as="span">
                  支持 JPG、PNG、WebP、GIF、AVIF 格式，最大 15MB
                </Text>
              </VStack>
            </div>
          ) : (
            <div {...stylex.props(styles.previewRow)}>
              <SafeImage
                src={testPreviewUrl}
                alt="测试预览"
                showSkeleton={false}
                showRetry={false}
                compactFallback
                xstyle={styles.previewThumb}
              />
              <VStack gap={0.5}>
                <Text size="sm" as="span">
                  {testFile?.name || '测试图片'}
                </Text>
                <Text type="supporting" size="sm" as="span">
                  文件大小：{testFile ? (testFile.size / 1024).toFixed(1) : 0} KB
                </Text>
              </VStack>
              <Button
                label="更换图片"
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                isDisabled={testing}
              />
            </div>
          )}

          <div>
            <Button
              label={testing ? '正在识别感知中…' : '开始测试图片理解'}
              variant="primary"
              size="sm"
              icon={<Play size={14} className={testing ? 'animate-spin' : ''} />}
              onClick={runTest}
              isDisabled={!testFile || testing}
              isLoading={testing}
            />
          </div>

          {/* Test Results View */}
          {testResult && (
            <VStack gap={3}>
              {testResult.ok && testResult.perception ? (
                <>
                  {/* Metrics Banner */}
                  <HStack hAlign="between" vAlign="center" width="100%">
                    <HStack gap={1.5} vAlign="center">
                      <Badge label="测试成功" variant="green" />
                      <Badge
                        label={`模型: ${testResult.usage?.model || selectedModelId || '(default)'}`}
                        variant="neutral"
                      />
                    </HStack>
                    <Text type="supporting" size="sm">
                      耗时: {(testResult.usage?.durationMs ? testResult.usage.durationMs / 1000 : 0).toFixed(2)}s · Token: {testResult.usage?.totalTokens ?? 0}
                    </Text>
                  </HStack>

                  {/* 1. Natural Language Summary */}
                  <VStack gap={1}>
                    <Text size="sm" as="span">
                      1. 客观自然语言摘要 (Summary)
                    </Text>
                    <div {...stylex.props(styles.infoCard)}>
                      <Text size="sm" as="p">
                        {testResult.perception.summary}
                      </Text>
                    </div>
                  </VStack>

                  {/* 2. Structured Perception Details */}
                  <VStack gap={1}>
                    <Text size="sm" as="span">
                      2. 结构化感知明细 (Structured Details)
                    </Text>
                    <div {...stylex.props(styles.detailsGrid)}>
                      <div {...stylex.props(styles.infoCard)}>
                        <Text type="supporting" size="sm" as="div">核心主体 (mainContent)</Text>
                        <Text size="sm" as="div">{testResult.perception.mainContent}</Text>
                      </div>
                      {testResult.perception.scene && (
                        <div {...stylex.props(styles.infoCard)}>
                          <Text type="supporting" size="sm" as="div">场景环境 (scene)</Text>
                          <Text size="sm" as="div">{testResult.perception.scene}</Text>
                        </div>
                      )}
                      {testResult.perception.imageType && (
                        <div {...stylex.props(styles.infoCard)}>
                          <Text type="supporting" size="sm" as="div">图片类型 (imageType)</Text>
                          <Text size="sm" as="div">{testResult.perception.imageType}</Text>
                        </div>
                      )}
                      {testResult.perception.mood && (
                        <div {...stylex.props(styles.infoCard)}>
                          <Text type="supporting" size="sm" as="div">画面氛围 (mood)</Text>
                          <Text size="sm" as="div">{testResult.perception.mood}</Text>
                        </div>
                      )}
                    </div>

                    {/* Objects Badges */}
                    {testResult.perception.objects && testResult.perception.objects.length > 0 && (
                      <VStack gap={1}>
                        <Text type="supporting" size="sm" as="span">识别物体与要素：</Text>
                        <HStack gap={1} wrap="wrap">
                          {testResult.perception.objects.map((obj, i) => (
                            <Badge key={i} label={obj} variant="blue" />
                          ))}
                        </HStack>
                      </VStack>
                    )}

                    {/* OCR Text if present */}
                    {testResult.perception.ocrText && (
                      <div {...stylex.props(styles.infoCard)}>
                        <Text type="supporting" size="sm" as="div">可见文字 (OCR)</Text>
                        <Text size="sm" as="div">
                          {testResult.perception.ocrText}
                        </Text>
                      </div>
                    )}
                  </VStack>

                  {/* 3. Formatted Prompt Block */}
                  {testResult.formattedPromptBlock && (
                    <VStack gap={1.5}>
                      <HStack hAlign="between" vAlign="center" width="100%">
                        <Text size="sm" as="span">
                          3. 装配到下游角色大模型的最终提示词块
                        </Text>
                        <Button
                          label={copiedPrompt ? '已复制' : '复制提示词块'}
                          variant="secondary"
                          size="sm"
                          icon={copiedPrompt ? <Check size={13} /> : <Copy size={13} />}
                          onClick={() => copyPromptBlock(testResult.formattedPromptBlock!)}
                        />
                      </HStack>
                      <div {...stylex.props(styles.resultCard)}>
                        {testResult.formattedPromptBlock}
                      </div>
                    </VStack>
                  )}
                </>
              ) : (
                <div {...stylex.props(styles.errorCard)}>
                  <HStack gap={1.5} vAlign="center">
                    <AlertCircle size={16} color="rgb(220, 38, 38)" />
                    <Text size="sm" as="span" xstyle={styles.errorText}>
                      测试失败
                    </Text>
                  </HStack>
                  <Text size="sm" as="p" xstyle={styles.errorText}>
                    {testResult.error || '未知错误'}
                  </Text>
                </div>
              )}
            </VStack>
          )}
        </VStack>
      </Card>
    </VStack>
  );
}
