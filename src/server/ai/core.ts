import { generateText, generateObject, streamText, stepCountIs, type LanguageModelUsage, type ModelMessage } from 'ai';
import type { z } from 'zod';
import { db } from '@/db';
import { aiCharacters, aiUsage } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  createModelFor,
  getProviderConfig,
  getDefaultProvider,
  getModelPrice,
  type ProviderConfigRow,
} from './providers';
import { supportsVision } from '@/lib/providers-shared';
import { getDefaultAIConfig, getVisionConfig } from '@/server/settings';
export type CallType =
  | 'chat'
  | 'post_generation'
  | 'comment'
  | 'reply'
  | 'reaction_decision'
  | 'memory'
  | 'summary'
  | 'system'
  | 'image_understanding'
  | 'image_generation'
  | 'group_message'
  | 'group_attention'
  | 'group_decision'
  | 'group_digest'
  | 'group_reply'
  | 'group_reaction';
export type ResolvedModel = {
  provider: ProviderConfigRow;
  modelId: string;
  supportsVision: boolean;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
};
/**
 * Resolve which provider/model a call should use:
 * character override -> user default -> error.
 */
export async function resolveModel(
  userId: string,
  characterId?: string | null,
): Promise<ResolvedModel> {
  const defaults = await getDefaultAIConfig(userId);

  let character: {
    providerId: string | null;
    modelId: string | null;
    temperature: number | null;
    topP: number | null;
    maxTokens: number | null;
  } | null = null;
  if (characterId) {
    const [row] = await db
      .select({
        providerId: aiCharacters.providerId,
        modelId: aiCharacters.modelId,
        temperature: aiCharacters.temperature,
        topP: aiCharacters.topP,
        maxTokens: aiCharacters.maxTokens,
      })
      .from(aiCharacters)
      .where(eq(aiCharacters.id, characterId))
      .limit(1);
    character = row ?? null;
  }

  const providerId = character?.providerId ?? defaults.providerId ?? null;
  const modelId = character?.modelId ?? defaults.modelId ?? null;

  let provider: ProviderConfigRow | null = null;
  if (providerId) {
    provider = await getProviderConfig(userId, providerId);
  }
  if (!provider) {
    provider = await getDefaultProvider(userId);
  }
  if (!provider) {
    throw new NoProviderError();
  }

  const finalModelId = modelId ?? 'gpt-4o-mini';
  const isVision = supportsVision(provider.providerType, finalModelId);

  return {
    provider,
    modelId: finalModelId,
    supportsVision: isVision,
    temperature: character?.temperature ?? defaults.temperature ?? null,
    topP: character?.topP ?? defaults.topP ?? null,
    maxTokens: character?.maxTokens ?? defaults.maxTokens ?? null,
  };
}

/**
 * Pick default recommended vision model for a provider type
 */
export function getDefaultVisionModelForProvider(providerType: string): string {
  switch (providerType) {
    case 'openai':
      return 'gpt-4o-mini';
    case 'anthropic':
      return 'claude-3-5-haiku-20241022';
    case 'google':
      return 'gemini-1.5-flash';
    case 'deepseek':
      return 'deepseek-chat';
    case 'openai-compatible':
    default:
      return 'gpt-4o-mini';
  }
}

/**
 * Resolve dedicated vision model configuration:
 * vision config -> user default provider -> error.
 */
export async function resolveVisionModel(userId: string): Promise<ResolvedModel & { enabled: boolean }> {
  const visionCfg = await getVisionConfig(userId);
  if (!visionCfg.enabled) {
    return {
      enabled: false,
      provider: null as unknown as ProviderConfigRow,
      modelId: '',
      supportsVision: false,
      temperature: null,
      topP: null,
      maxTokens: null,
    };
  }

  let provider: ProviderConfigRow | null = null;
  if (visionCfg.providerId) {
    provider = await getProviderConfig(userId, visionCfg.providerId);
  }
  if (!provider) {
    provider = await getDefaultProvider(userId);
  }
  if (!provider) {
    throw new NoProviderError();
  }

  const modelId = visionCfg.modelId || getDefaultVisionModelForProvider(provider.providerType);
  const isVision = supportsVision(provider.providerType, modelId);

  return {
    enabled: true,
    provider,
    modelId,
    supportsVision: isVision,
    temperature: visionCfg.temperature ?? 0.2,
    topP: null,
    maxTokens: visionCfg.maxTokens ?? 800,
  };
}

export class NoProviderError extends Error {
  constructor() {
    super('尚未配置 AI Provider。请先在「设置 → AI Providers」中添加并启用一个 Provider。');
    this.name = 'NoProviderError';
  }
}

export type UsageMetrics = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
};

export function extractUsage(usage: LanguageModelUsage | undefined): UsageMetrics {
  const u = usage as Record<string, unknown> | undefined;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    inputTokens: num(u?.inputTokens),
    outputTokens: num(u?.outputTokens),
    totalTokens: num(u?.totalTokens) || num(u?.inputTokens) + num(u?.outputTokens),
    cachedInputTokens: num(u?.cachedInputTokens),
    reasoningTokens: num(u?.reasoningTokens),
  };
}

export type UsageRecord = UsageMetrics & {
  success: boolean;
  errorMessage?: string;
  durationMs: number;
};

export async function recordUsage(args: {
  userId: string;
  characterId: string | null;
  callType: CallType;
  resolved: ResolvedModel;
  usage: UsageRecord;
}): Promise<string> {
  const price = await getModelPrice(args.userId, args.resolved.provider.id, args.resolved.modelId);
  const costUsd = price
    ? (args.usage.inputTokens / 1_000_000) * price.inputPricePerMTok +
      (args.usage.outputTokens / 1_000_000) * price.outputPricePerMTok
    : null;

  const id = crypto.randomUUID();
  await db.insert(aiUsage).values({
    id,
    userId: args.userId,
    characterId: args.characterId,
    callType: args.callType,
    providerType: args.resolved.provider.providerType,
    model: args.resolved.modelId,
    inputTokens: args.usage.inputTokens,
    outputTokens: args.usage.outputTokens,
    totalTokens: args.usage.totalTokens,
    cachedInputTokens: args.usage.cachedInputTokens,
    reasoningTokens: args.usage.reasoningTokens,
    costUsd,
    durationMs: args.usage.durationMs,
    success: args.usage.success,
    errorMessage: args.usage.errorMessage,
  });
  return id;
}

export type RunTextOptions = {
  userId: string;
  characterId?: string | null;
  callType: CallType;
  system: string;
  prompt?: string;
  messages?: ModelMessage[];
  tools?: Record<string, any>;
  /** 工具调用循环上限（传入 tools 时建议设置，默认 1 步即工具调用后直接结束） */
  maxSteps?: number;
  temperature?: number;
  maxOutputTokens?: number;
};

/** Single entry point for one-shot text generation with usage tracking. */
export async function runText(opts: RunTextOptions): Promise<string> {
  const resolved = await resolveModel(opts.userId, opts.characterId);
  const start = Date.now();
  try {
    const result = await generateText({
      model: createModelFor(resolved.provider, resolved.modelId),
      system: opts.system,
      ...(opts.messages && opts.messages.length > 0
        ? { messages: opts.messages }
        : { prompt: opts.prompt ?? '' }),
      ...(opts.tools
        ? {
            tools: opts.tools,
            stopWhen: stepCountIs(opts.maxSteps ?? 3),
          }
        : {}),
      temperature: opts.temperature ?? resolved.temperature ?? undefined,
      maxOutputTokens: opts.maxOutputTokens ?? resolved.maxTokens ?? undefined,
    });
    await recordUsage({
      userId: opts.userId,
      characterId: opts.characterId ?? null,
      callType: opts.callType,
      resolved,
      usage: { ...extractUsage(result.usage), success: true, durationMs: Date.now() - start },
    });
    return result.text;
  } catch (err) {
    await recordUsage({
      userId: opts.userId,
      characterId: opts.characterId ?? null,
      callType: opts.callType,
      resolved,
      usage: {
        ...extractUsage(undefined),
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      },
    });
    throw err;
  }
}

/** One-shot structured (JSON) generation with usage tracking. */
export async function runObject<T extends z.ZodType>(opts: {
  userId: string;
  characterId?: string | null;
  callType: CallType;
  system: string;
  prompt?: string;
  messages?: ModelMessage[];
  tools?: Record<string, any>;
  schema: T;
  schemaName?: string;
  schemaDescription?: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<z.infer<T>> {
  const resolved = await resolveModel(opts.userId, opts.characterId);
  const start = Date.now();
  try {
    const model = createModelFor(resolved.provider, resolved.modelId);
    const result = await generateObject({
      model,
      system: opts.system,
      ...(opts.messages && opts.messages.length > 0
        ? { messages: opts.messages }
        : { prompt: opts.prompt ?? '' }),
      schema: opts.schema,
      schemaName: opts.schemaName,
      schemaDescription: opts.schemaDescription,
      temperature: opts.temperature ?? resolved.temperature ?? undefined,
      maxOutputTokens: opts.maxOutputTokens ?? resolved.maxTokens ?? undefined,
    });
    await recordUsage({
      userId: opts.userId,
      characterId: opts.characterId ?? null,
      callType: opts.callType,
      resolved,
      usage: { ...extractUsage(result.usage), success: true, durationMs: Date.now() - start },
    });
    return result.object as z.infer<T>;
  } catch (err) {
    await recordUsage({
      userId: opts.userId,
      characterId: opts.characterId ?? null,
      callType: opts.callType,
      resolved,
      usage: {
        ...extractUsage(undefined),
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      },
    });
    throw err;
  }
}

/** Structured vision analysis with usage tracking using AI SDK standard API */
export async function runVisionObject<T extends z.ZodType>(opts: {
  userId: string;
  system: string;
  prompt: string;
  imageUrl: string;
  mimeType?: string;
  schema: T;
  temperature?: number;
  maxOutputTokens?: number;
  providerOverride?: ProviderConfigRow;
  modelIdOverride?: string;
}): Promise<{ object: z.infer<T>; usageId: string; usage: UsageRecord; resolved: ResolvedModel }> {
  let resolved: ResolvedModel;
  if (opts.providerOverride) {
    const effectiveModelId = opts.modelIdOverride || getDefaultVisionModelForProvider(opts.providerOverride.providerType);
    resolved = {
      provider: opts.providerOverride,
      modelId: effectiveModelId,
      supportsVision: supportsVision(opts.providerOverride.providerType, effectiveModelId),
      temperature: opts.temperature ?? 0.2,
      topP: null,
      maxTokens: opts.maxOutputTokens ?? 800,
    };
  } else {
    const visionResolved = await resolveVisionModel(opts.userId);
    if (!visionResolved.enabled) {
      throw new Error('图片理解功能已停用');
    }
    resolved = visionResolved;
  }
  const start = Date.now();
  try {
    const isHttpUrl = opts.imageUrl.startsWith('http://') || opts.imageUrl.startsWith('https://');
    const filePart = {
      type: 'file' as const,
      data: isHttpUrl ? new URL(opts.imageUrl) : opts.imageUrl,
      mediaType: opts.mimeType || 'image/jpeg',
    };

    const result = await generateObject({
      model: createModelFor(resolved.provider, resolved.modelId),
      system: opts.system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: opts.prompt },
            filePart,
          ],
        },
      ],
      schema: opts.schema,
      temperature: opts.temperature ?? resolved.temperature ?? undefined,
      maxOutputTokens: opts.maxOutputTokens ?? resolved.maxTokens ?? undefined,
    });
    const usageData = { ...extractUsage(result.usage), success: true, durationMs: Date.now() - start };
    const usageId = await recordUsage({
      userId: opts.userId,
      characterId: null,
      callType: 'image_understanding',
      resolved,
      usage: usageData,
    });
    return {
      object: result.object as z.infer<T>,
      usageId,
      usage: usageData,
      resolved,
    };
  } catch (err) {
    const usageData = {
      ...extractUsage(undefined),
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
    const usageId = await recordUsage({
      userId: opts.userId,
      characterId: null,
      callType: 'image_understanding',
      resolved,
      usage: usageData,
    });
    throw err;
  }
}

/** Streaming generation for chat; usage is recorded on finish. */
export async function runStream(opts: RunTextOptions & {
  messages: ModelMessage[];
  tools?: Record<string, any>;
  maxSteps?: number;
  onFinish?: (text: string) => void | Promise<void>;
}) {
  const resolved = await resolveModel(opts.userId, opts.characterId);
  const start = Date.now();
  const streamOptions: any = {
    model: createModelFor(resolved.provider, resolved.modelId),
    system: opts.system,
    messages: opts.messages,
    temperature: opts.temperature ?? resolved.temperature ?? undefined,
    maxOutputTokens: opts.maxOutputTokens ?? resolved.maxTokens ?? undefined,
    onError: ({ error }: any) => {
      console.error('[ai] stream error', error);
    },
    onFinish: async ({ usage, text }: any) => {
      await recordUsage({
        userId: opts.userId,
        characterId: opts.characterId ?? null,
        callType: opts.callType,
        resolved,
        usage: { ...extractUsage(usage), success: true, durationMs: Date.now() - start },
      }).catch(console.error);
      await opts.onFinish?.(text);
    },
  };
  if (opts.tools) {
    streamOptions.tools = opts.tools;
    streamOptions.maxSteps = opts.maxSteps ?? 5;
  }
  const result = streamText(streamOptions);
  return result;
}

/** Check whether a user has any usable provider configured. */
export async function hasProvider(userId: string) {
  const defaults = await getDefaultAIConfig(userId);
  if (defaults.providerId) {
    const p = await getProviderConfig(userId, defaults.providerId);
    if (p?.enabled) return true;
  }
  const def = await getDefaultProvider(userId);
  return !!def;
}
