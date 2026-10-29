'use client';

import { useEffect, useMemo, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import {
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Slider } from '@astryxdesign/core/Slider';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Badge } from '@astryxdesign/core/Badge';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { nativeAttrs } from '@/lib/native-attrs';
import { useAppToast } from '@/lib/toast';
import { updateCharacterProfileFields, type CharacterProfilePatch } from '@/server/actions/characters';
import type { CharacterMemoryItem } from '@/components/character-profile';

const spin = stylex.keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-5)',
    paddingBottom: 'var(--spacing-6)',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-3)',
    padding: 'var(--spacing-4)',
    borderRadius: 'var(--radius-container)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-background-surface)',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-2)',
    flexWrap: 'wrap',
  },
  sectionTitle: {
    fontSize: 'var(--font-size-base)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text-primary)',
  },
  sectionHint: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
    lineHeight: 1.5,
  },
  saveState: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-secondary)',
    flexShrink: 0,
  },
  spin: {
    animationName: spin,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  promptBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-2)',
    borderRadius: 'var(--radius-element)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-background-muted)',
    padding: 'var(--spacing-3)',
  },
  promptPreview: {
    position: 'relative',
    maxHeight: '8.5rem',
    overflow: 'hidden',
  },
  promptText: {
    margin: 0,
    fontSize: 'var(--font-size-sm)',
    lineHeight: 1.65,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  },
  promptFade: {
    position: 'absolute',
    insetInline: 0,
    bottom: 0,
    height: '3rem',
    backgroundImage:
      'linear-gradient(to bottom, rgba(0,0,0,0), var(--color-background-muted))',
  },
  promptActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-2)',
    flexWrap: 'wrap',
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 'var(--spacing-3)',
    '@media (min-width: 640px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  grid3: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 'var(--spacing-3)',
    '@media (min-width: 640px)': { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  },
  memoryCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
    borderRadius: 'var(--radius-element)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-background-muted)',
  },
  memoryMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    flexWrap: 'wrap',
  },
  memoryText: {
    fontSize: 'var(--font-size-sm)',
    lineHeight: 1.55,
    color: 'var(--color-text-primary)',
  },
  empty: {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
  },
});

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export type ArchiveSettingsCharacter = {
  id: string;
  bio: string;
  relationshipToUser: string;
  persona: string;
  personality: string;
  interests: string;
  expressionStyle: string;
  memoryRetention: 'excellent' | 'normal' | 'slightly_forgetful' | 'forgetful';
  grudgeRate: number;
  systemPrompt: string | null;
  providerId: string | null;
  modelId: string | null;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
};

export function CharacterSettingsPanel({
  character,
  providers,
  modelsByProvider,
  memories,
}: {
  character: ArchiveSettingsCharacter;
  providers: { id: string; name: string; providerType: string }[];
  modelsByProvider: Record<string, string[]>;
  memories: CharacterMemoryItem[];
}) {
  const toast = useAppToast();
  const [values, setValues] = useState({
    bio: character.bio,
    relationshipToUser: character.relationshipToUser,
    persona: character.persona,
    personality: character.personality,
    interests: character.interests,
    expressionStyle: character.expressionStyle,
    memoryRetention: character.memoryRetention,
    grudgeRate: character.grudgeRate,
    systemPrompt: character.systemPrompt ?? '',
    providerId: character.providerId ?? '',
    modelId: character.modelId ?? '',
    temperature: character.temperature,
    topP: character.topP,
    maxTokens: character.maxTokens,
  });
  const [saved, setSaved] = useState({ ...values });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [localMemories, setLocalMemories] = useState(memories);
  const [summarizing, setSummarizing] = useState(false);

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const persist = async (patch: CharacterProfilePatch) => {
    setSaveState('saving');
    const res = await updateCharacterProfileFields(character.id, patch);
    if (res?.error) {
      setSaveState('error');
      toast.error(res.error);
      return;
    }
    setSaved((current) => {
      const next: Record<string, unknown> = { ...current };
      const applied = patch as Record<string, unknown>;
      for (const key of Object.keys(applied)) {
        const value = applied[key];
        if (value === undefined) continue;
        if (key === 'systemPrompt' || key === 'providerId' || key === 'modelId') {
          next[key] = (value as string | null) ?? '';
        } else {
          next[key] = value;
        }
      }
      return next as typeof current;
    });
    setSaveState('saved');
    window.setTimeout(() => setSaveState((state) => (state === 'saved' ? 'idle' : state)), 1800);
  };

  const saveText = (key: 'bio' | 'relationshipToUser' | 'persona' | 'personality' | 'interests' | 'expressionStyle' | 'systemPrompt') => {
    if (values[key] === saved[key]) return;
    void persist({ [key]: values[key] } as CharacterProfilePatch);
  };

  const saveModel = () => {
    const patch: CharacterProfilePatch = {
      providerId: values.providerId || null,
      modelId: values.modelId || null,
      temperature: values.temperature,
      topP: values.topP,
      maxTokens: values.maxTokens,
    };
    if (
      patch.providerId === (saved.providerId || null) &&
      patch.modelId === (saved.modelId || null) &&
      patch.temperature === saved.temperature &&
      patch.topP === saved.topP &&
      patch.maxTokens === saved.maxTokens
    ) {
      return;
    }
    void persist(patch);
  };

  // 数值类字段（模型参数 / 情绪执念度）用防抖自动保存，避免每次拖动都打接口
  useEffect(() => {
    const timer = setTimeout(() => {
      if (
        values.grudgeRate !== saved.grudgeRate
      ) {
        void persist({ grudgeRate: values.grudgeRate });
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [values.grudgeRate, saved.grudgeRate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const patch: CharacterProfilePatch = {
        providerId: values.providerId || null,
        modelId: values.modelId || null,
        temperature: values.temperature,
        topP: values.topP,
        maxTokens: values.maxTokens,
      };
      if (
        patch.providerId === (saved.providerId || null) &&
        patch.modelId === (saved.modelId || null) &&
        patch.temperature === saved.temperature &&
        patch.topP === saved.topP &&
        patch.maxTokens === saved.maxTokens
      ) {
        return;
      }
      void persist(patch);
    }, 700);
    return () => clearTimeout(timer);
  }, [
    values.providerId,
    values.modelId,
    values.temperature,
    values.topP,
    values.maxTokens,
    saved.providerId,
    saved.modelId,
    saved.temperature,
    saved.topP,
    saved.maxTokens,
  ]);

  const copyPrompt = async () => {
    const text = values.systemPrompt.trim();
    if (!text) {
      toast.error('当前没有可复制的提示词');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制 System Prompt');
    } catch {
      toast.error('复制失败，请手动选择文本');
    }
  };

  const triggerSummary = async () => {
    setSummarizing(true);
    try {
      const res = await fetch(`/api/characters/${character.id}/memories/summarize`, { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.result) {
        if (data.memories) setLocalMemories(data.memories);
        const { dmCount, groupCount, memoryCount } = data.result;
        toast.success(`总结完成！读取对话: ${dmCount + groupCount} 条，已覆写长期记忆: ${memoryCount} 条`);
      } else {
        toast.error(data.error || '记忆总结失败');
      }
    } catch {
      toast.error('网络异常，记忆总结失败');
    } finally {
      setSummarizing(false);
    }
  };

  const modelOptions = useMemo(
    () => (values.providerId ? (modelsByProvider[values.providerId] ?? []) : []),
    [modelsByProvider, values.providerId],
  );

  const promptEmpty = !values.systemPrompt.trim();

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.sectionHeader)}>
        <Text type="supporting" size="sm" as="span">
          修改后自动保存，无需手动提交
        </Text>
        <span {...stylex.props(styles.saveState)} aria-live="polite">
          {saveState === 'saving' && (
            <>
              <Loader2 size={12} {...stylex.props(styles.spin)} /> 保存中…
            </>
          )}
          {saveState === 'saved' && (
            <>
              <Check size={12} /> 已保存
            </>
          )}
          {saveState === 'error' && '保存失败，请重试'}
        </span>
      </div>

      <section {...stylex.props(styles.section)}>
        <h2 {...stylex.props(styles.sectionTitle)}>基本名片</h2>
        <div {...stylex.props(styles.grid2)}>
          <TextInput
            label="个性签名"
            value={values.bio}
            onChange={(value) => set('bio', value)}
            {...nativeAttrs({ maxLength: 200, onBlur: () => saveText('bio') })}
            htmlName="archive-bio"
          />
          <TextInput
            label="与你的关系"
            value={values.relationshipToUser}
            onChange={(value) => set('relationshipToUser', value)}
            {...nativeAttrs({ maxLength: 100, onBlur: () => saveText('relationshipToUser') })}
            htmlName="archive-relationship"
          />
        </div>
      </section>

      <section {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.sectionHeader)}>
          <h2 {...stylex.props(styles.sectionTitle)}>人设背景</h2>
          <Text type="supporting" size="sm" as="span">
            越具体，TA 越有个性
          </Text>
        </div>
        <TextArea
          label="背景故事 / 身份设定"
          description="成长经历、职业、生活习惯、世界观…"
          rows={6}
          value={values.persona}
          onChange={(value) => set('persona', value)}
          {...nativeAttrs({ maxLength: 3000, onBlur: () => saveText('persona') })}
          htmlName="archive-persona"
        />
        <div {...stylex.props(styles.grid2)}>
          <TextInput
            label="性格特征"
            description="用逗号分隔，例如：慢热, 毒舌, 心软"
            value={values.personality}
            onChange={(value) => set('personality', value)}
            {...nativeAttrs({ maxLength: 200, onBlur: () => saveText('personality') })}
            htmlName="archive-personality"
          />
          <TextInput
            label="兴趣标签"
            description="用逗号分隔，TA 会更积极参与相关话题"
            value={values.interests}
            onChange={(value) => set('interests', value)}
            {...nativeAttrs({ maxLength: 200, onBlur: () => saveText('interests') })}
            htmlName="archive-interests"
          />
        </div>
        <TextArea
          label="口吻描述"
          description="口头禅、语气、句式偏好，会直接影响聊天风格"
          rows={3}
          value={values.expressionStyle}
          onChange={(value) => set('expressionStyle', value)}
          {...nativeAttrs({ maxLength: 500, onBlur: () => saveText('expressionStyle') })}
          htmlName="archive-expression"
        />
      </section>

      <section {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.sectionHeader)}>
          <h2 {...stylex.props(styles.sectionTitle)}>专属 System Prompt</h2>
          <Badge label={promptEmpty ? '自动生成' : '自定义'} variant={promptEmpty ? 'neutral' : 'blue'} />
        </div>
        <Text type="supporting" size="sm" as="p">
          留空时由人设自动生成；填写后将覆盖自动生成的人设部分。
        </Text>
        <div {...stylex.props(styles.promptBox)}>
          {promptExpanded ? (
            <TextArea
              label="System Prompt"
              isLabelHidden
              rows={12}
              value={values.systemPrompt}
              onChange={(value) => set('systemPrompt', value)}
              {...nativeAttrs({ maxLength: 4000, onBlur: () => saveText('systemPrompt') })}
              placeholder="例如：你叫林小满，25 岁，是一名插画师……"
              htmlName="archive-system-prompt"
            />
          ) : (
            <div {...stylex.props(styles.promptPreview)}>
              <p {...stylex.props(styles.promptText)}>
                {promptEmpty ? '未设置自定义提示词，AI 会依据上方人设自动生成。' : values.systemPrompt}
              </p>
              {!promptEmpty && values.systemPrompt.length > 180 && (
                <span {...stylex.props(styles.promptFade)} aria-hidden />
              )}
            </div>
          )}
          <div {...stylex.props(styles.promptActions)}>
            <Button
              label={promptExpanded ? '收起' : '展开编辑'}
              variant="secondary"
              size="sm"
              icon={promptExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              onClick={() => setPromptExpanded((value) => !value)}
            />
            <Button
              label="复制"
              variant="ghost"
              size="sm"
              icon={<ClipboardCopy size={14} />}
              onClick={copyPrompt}
            />
            <span {...stylex.props(styles.sectionHint)}>{values.systemPrompt.length} / 4000</span>
          </div>
        </div>
      </section>

      <section {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.sectionHeader)}>
          <h2 {...stylex.props(styles.sectionTitle)}>认知与情绪</h2>
          <Text type="supporting" size="sm" as="span">
            影响记忆形成与情绪记忆的保留
          </Text>
        </div>
        <Selector
          label="记忆力 / 健忘程度"
          value={values.memoryRetention}
          onChange={(value) => {
            const next = (value as ArchiveSettingsCharacter['memoryRetention']) || 'normal';
            set('memoryRetention', next);
            if (next !== saved.memoryRetention) void persist({ memoryRetention: next });
          }}
          options={[
            { value: 'excellent', label: '★★★★★ 过目不忘' },
            { value: 'normal', label: '★★★☆☆ 普通记忆' },
            { value: 'slightly_forgetful', label: '★★☆☆☆ 有点健忘' },
            { value: 'forgetful', label: '★☆☆☆☆ 鱼的记忆' },
          ]}
        />
        <Slider
          label="记仇 / 情绪执念度"
          description="数值越高，争吵、感动等情绪记忆保留得越久越深"
          min={0}
          max={100}
          step={5}
          value={Math.round(values.grudgeRate * 100)}
          onChange={(value: number) => set('grudgeRate', value / 100)}
          formatValue={(value: number) => `${Math.round(value)}%`}
          valueDisplay="text"
        />
      </section>

      <section {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.sectionHeader)}>
          <h2 {...stylex.props(styles.sectionTitle)}>模型参数</h2>
          <Text type="supporting" size="sm" as="span">
            留空继承全局默认
          </Text>
        </div>
        <div {...stylex.props(styles.grid2)}>
          <Selector
            label="模型服务商"
            placeholder="（继承全局默认）"
            hasClear
            value={values.providerId}
            onChange={(value) => {
              set('providerId', value ?? '');
              set('modelId', '');
            }}
            options={providers.map((provider) => ({
              value: provider.id,
              label: `${provider.name}（${provider.providerType}）`,
            }))}
          />
          <div>
            <TextInput
              label="Model ID"
              value={values.modelId}
              onChange={(value) => {
                set('modelId', value);
              }}
              placeholder="例如 gpt-4o-mini"
              {...nativeAttrs({ maxLength: 120, list: `archive-models-${values.providerId}` })}
              htmlName="archive-model"
            />
            <datalist id={`archive-models-${values.providerId}`}>
              {modelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </div>
        </div>
        <div {...stylex.props(styles.grid3)}>
          <NumberInput
            label="Temperature"
            isOptional
            value={values.temperature}
            min={0}
            max={2}
            step={0.1}
            onChange={(value) => {
              set('temperature', value);
            }}
            {...nativeAttrs({ onBlur: saveModel })}
          />
          <NumberInput
            label="Top P"
            isOptional
            value={values.topP}
            min={0}
            max={1}
            step={0.05}
            onChange={(value) => {
              set('topP', value);
            }}
            {...nativeAttrs({ onBlur: saveModel })}
          />
          <NumberInput
            label="Max Tokens"
            isOptional
            value={values.maxTokens}
            min={50}
            max={16000}
            step={50}
            onChange={(value) => {
              set('maxTokens', value);
            }}
            {...nativeAttrs({ onBlur: saveModel })}
          />
        </div>
      </section>

      <section {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.sectionHeader)}>
          <HStack gap={2} vAlign="center">
            <Brain size={16} color="var(--color-text-accent)" />
            <h2 {...stylex.props(styles.sectionTitle)}>长期记忆 ({localMemories.length})</h2>
          </HStack>
          {character.id && (
            <Button
              label={summarizing ? '正在总结…' : '触发今日记忆总结'}
              variant="secondary"
              size="sm"
              icon={
                summarizing ? (
                  <Loader2 size={13} {...stylex.props(styles.spin)} />
                ) : (
                  <Sparkles size={13} />
                )
              }
              isDisabled={summarizing}
              isLoading={summarizing}
              onClick={triggerSummary}
            />
          )}
        </div>
        {localMemories.length === 0 ? (
          <p {...stylex.props(styles.empty)}>
            暂无已沉淀的长期记忆。每天 00:00 会自动总结今日对话，也可以手动触发提炼。
          </p>
        ) : (
          <VStack gap={2}>
            {localMemories.map((memory) => (
              <div key={memory.id} {...stylex.props(styles.memoryCard)}>
                <div {...stylex.props(styles.memoryMeta)}>
                  <HStack gap={1.5} vAlign="center" style={{ flexWrap: 'wrap' }}>
                    <Badge
                      label={`${memory.kind} · 重要度 ${Math.round(memory.importance * 100)}%`}
                      variant={memory.kind === 'grudge' ? 'red' : memory.isFuzzy ? 'neutral' : 'blue'}
                    />
                    {memory.strength !== undefined && (
                      <Badge label={`强度 ${Math.round(memory.strength * 100)}%`} variant="neutral" />
                    )}
                    {memory.isFuzzy && <Badge label="模糊记忆" variant="neutral" />}
                  </HStack>
                  <span {...stylex.props(styles.sectionHint)}>
                    {new Date(memory.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p {...stylex.props(styles.memoryText)}>{memory.content}</p>
              </div>
            ))}
          </VStack>
        )}
      </section>
    </div>
  );
}
