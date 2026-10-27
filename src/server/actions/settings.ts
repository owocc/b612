'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { modelConfigs, providerConfigs } from '@/db/schema';
import { requireUserId } from '@/lib/session';
import { PROVIDER_TYPES, supportsVision } from '@/lib/providers-shared';
import {
  setSetting,
  setImageGenConfig,
  setNotificationPrefs,
  type CommunityConfig,
  type NotificationPrefs,
} from '@/server/settings';
import { generateCharacterImage } from '@/server/ai/image';
import { getProviderConfig, getModelPrice, fetchProviderModels } from '@/server/ai/providers';
import {
  resolveVisionModel,
  runVisionObject,
} from '@/server/ai/core';
import {
  formatAttachmentPromptBlock,
  imagePerceptionSchema,
  VISION_INTERPRETER_SYSTEM_PROMPT,
  compressImageBufferForVision,
  type ImagePerceptionData,
} from '@/server/ai/vision';
import {
  BUILTIN_VISION_PROFILES,
  VISION_PROFILE_KEYS,
  resolveAllVisionProfiles,
  getVisionProfileOverrides,
  setVisionProfileOverrides,
  type VisionProfileKey,
  type VisionProfileOverrides,
} from '@/server/ai/vision-profiles';
import { validateMediaFile, MAX_ATTACHMENT_SIZE } from '@/server/media';

const providerSchema = z.object({
  name: z.string().trim().min(1, '名称必填').max(50),
  providerType: z.enum(PROVIDER_TYPES),
  apiKey: z.string().trim().min(1, 'API Key 必填').max(300),
  baseUrl: z.string().trim().max(300).optional().nullable(),
});

export async function createProvider(input: z.input<typeof providerSchema>) {
  const userId = await requireUserId();
  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '创建失败' };
  }
  const id = crypto.randomUUID();
  const isFirst = !(await db.select({ id: providerConfigs.id }).from(providerConfigs).where(eq(providerConfigs.userId, userId)).limit(1)).length;
  await db.insert(providerConfigs).values({
    id,
    userId,
    ...parsed.data,
    baseUrl: parsed.data.baseUrl || null,
    isDefault: isFirst,
  });
  revalidatePath('/settings/providers');
  return { ok: true, id };
}

export async function updateProvider(
  id: string,
  input: Partial<z.input<typeof providerSchema>> & { enabled?: boolean; apiKey?: string },
) {
  const userId = await requireUserId();
  const [existing] = await db
    .select()
    .from(providerConfigs)
    .where(and(eq(providerConfigs.id, id), eq(providerConfigs.userId, userId)))
    .limit(1);
  if (!existing) return { error: 'Provider 不存在' };

  const patch: Partial<typeof providerConfigs.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.providerType !== undefined) patch.providerType = input.providerType;
  if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl || null;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  // only overwrite the key when a new one is provided; empty string keeps the old key
  if (input.apiKey !== undefined && input.apiKey.trim() !== '') patch.apiKey = input.apiKey.trim();

  await db
    .update(providerConfigs)
    .set(patch)
    .where(and(eq(providerConfigs.id, id), eq(providerConfigs.userId, userId)));
  revalidatePath('/settings/providers');
  return { ok: true };
}

export async function deleteProvider(id: string) {
  const userId = await requireUserId();
  await db
    .delete(providerConfigs)
    .where(and(eq(providerConfigs.id, id), eq(providerConfigs.userId, userId)));
  revalidatePath('/settings/providers');
  return { ok: true };
}

export async function setDefaultProvider(id: string) {
  const userId = await requireUserId();
  await db
    .update(providerConfigs)
    .set({ isDefault: false })
    .where(eq(providerConfigs.userId, userId));
  await db
    .update(providerConfigs)
    .set({ isDefault: true })
    .where(and(eq(providerConfigs.id, id), eq(providerConfigs.userId, userId)));
  revalidatePath('/settings/providers');
  return { ok: true };
}

const modelSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().trim().min(1, 'Model ID 必填').max(120),
  displayName: z.string().trim().max(80).optional().nullable(),
  inputPricePerMTok: z.coerce.number().min(0).max(10000).default(0),
  outputPricePerMTok: z.coerce.number().min(0).max(10000).default(0),
});

export async function saveModel(input: z.input<typeof modelSchema>) {
  const userId = await requireUserId();
  const parsed = modelSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '保存失败' };
  }
  const [owned] = await db
    .select({ id: providerConfigs.id })
    .from(providerConfigs)
    .where(and(eq(providerConfigs.id, parsed.data.providerId), eq(providerConfigs.userId, userId)))
    .limit(1);
  if (!owned) return { error: 'Provider 不存在' };

  await db
    .insert(modelConfigs)
    .values({
      id: crypto.randomUUID(),
      userId,
      providerId: parsed.data.providerId,
      modelId: parsed.data.modelId,
      displayName: parsed.data.displayName || null,
      inputPricePerMTok: parsed.data.inputPricePerMTok,
      outputPricePerMTok: parsed.data.outputPricePerMTok,
    })
    .onConflictDoUpdate({
      target: [modelConfigs.providerId, modelConfigs.modelId],
      set: {
        displayName: parsed.data.displayName || null,
        inputPricePerMTok: parsed.data.inputPricePerMTok,
        outputPricePerMTok: parsed.data.outputPricePerMTok,
      },
    });
  revalidatePath('/settings/providers');
  return { ok: true };
}

export async function deleteModel(id: string) {
  const userId = await requireUserId();
  await db.delete(modelConfigs).where(and(eq(modelConfigs.id, id), eq(modelConfigs.userId, userId)));
  revalidatePath('/settings/providers');
  return { ok: true };
}

const defaultAISchema = z.object({
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
  temperature: z.number().min(0).max(2).nullable(),
  topP: z.number().min(0).max(1).nullable(),
  maxTokens: z.number().int().min(50).max(16000).nullable(),
});

export async function saveDefaultAIConfig(input: z.input<typeof defaultAISchema>) {
  const userId = await requireUserId();
  const parsed = defaultAISchema.safeParse(input);
  if (!parsed.success) return { error: '保存失败' };
  await setSetting(userId, 'ai_default', parsed.data);
  revalidatePath('/settings/defaults');
  return { ok: true };
}

const visionConfigSchema = z.object({
  enabled: z.boolean(),
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
  prompt: z.string().trim().max(1000).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().int().min(50).max(16000).nullable().optional(),
});

export async function saveVisionConfig(input: z.input<typeof visionConfigSchema>) {
  const userId = await requireUserId();
  const parsed = visionConfigSchema.safeParse(input);
  if (!parsed.success) return { error: '保存失败' };
  await setSetting(userId, 'ai_vision', parsed.data);
  revalidatePath('/settings/vision');
  return { ok: true };
}

const imageGenConfigSchema = z.object({
  enabled: z.boolean(),
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
});

export async function saveImageGenConfig(input: z.input<typeof imageGenConfigSchema>) {
  const userId = await requireUserId();
  const parsed = imageGenConfigSchema.safeParse(input);
  if (!parsed.success) return { error: '保存失败' };
  await setImageGenConfig(userId, parsed.data);
  revalidatePath('/settings/image');
  return { ok: true };
}

/**
 * Server Action: 用一句固定提示词测试生图配置是否可用，返回预览图 URL。
 */
export async function testImageGenAction(
  input: z.input<typeof imageGenConfigSchema> & { prompt?: string },
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  const userId = await requireUserId();
  const parsed = imageGenConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '配置无效' };
  try {
    const asset = await generateCharacterImage({
      userId,
      characterId: null,
      prompt: input.prompt?.trim() || 'a cute cat sitting on a windowsill, warm afternoon light, photo',
      persist: false,
    });
    return { ok: true, imageUrl: asset.url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type VisionProfileSettingsView = {
  key: VisionProfileKey;
  label: string;
  description: string;
  builtinSystemPrompt: string;
  builtinUserPrompt: string;
  /** Effective prompts after merging the user override (what the pipeline actually uses) */
  systemPrompt: string;
  userPrompt: string;
  /** The raw override stored in DB, if any (null when using built-in) */
  overrideSystemPrompt: string | null;
  overrideUserPrompt: string | null;
  isOverridden: boolean;
};

/**
 * Server Action: Load all vision profiles (built-in + user overrides) for the
 * settings UI. Profiles define per-image-type system prompts; users can override
 * each and the override is persisted to the database.
 */
export async function getVisionProfilesAction(): Promise<{
  ok: true;
  profiles: VisionProfileSettingsView[];
} | { ok: false; error: string }> {
  const userId = await requireUserId();
  const overrides = await getVisionProfileOverrides(userId);
  const resolved = await resolveAllVisionProfiles(userId);

  const profiles: VisionProfileSettingsView[] = VISION_PROFILE_KEYS.map((key) => {
    const base = BUILTIN_VISION_PROFILES[key];
    const o = overrides[key];
    const eff = resolved.find((r) => r.key === key)!;
    return {
      key,
      label: base.label,
      description: base.description,
      builtinSystemPrompt: base.systemPrompt,
      builtinUserPrompt: base.userPrompt,
      systemPrompt: eff.systemPrompt,
      userPrompt: eff.userPrompt,
      overrideSystemPrompt: o?.systemPrompt ?? null,
      overrideUserPrompt: o?.userPrompt ?? null,
      isOverridden: eff.isOverridden,
    };
  });

  return { ok: true, profiles };
}

const visionProfilePromptSchema = z.object({
  key: z.enum(VISION_PROFILE_KEYS as unknown as [string, ...string[]]),
  systemPrompt: z.string().max(8000).nullable().optional(),
  userPrompt: z.string().max(2000).nullable().optional(),
});

/**
 * Server Action: Save (override) the prompts for a single vision profile.
 * Empty/null values fall back to the built-in prompts.
 */
export async function saveVisionProfilePromptsAction(input: z.input<typeof visionProfilePromptSchema>) {
  const userId = await requireUserId();
  const parsed = visionProfilePromptSchema.safeParse(input);
  if (!parsed.success) return { error: '保存失败' };

  const key = parsed.data.key as VisionProfileKey;
  const overrides = await getVisionProfileOverrides(userId);
  const next: VisionProfileOverrides = { ...overrides };
  next[key] = {
    systemPrompt: parsed.data.systemPrompt?.trim() || null,
    userPrompt: parsed.data.userPrompt?.trim() || null,
  };
  await setVisionProfileOverrides(userId, next);
  revalidatePath('/settings/vision');
  return { ok: true };
}

/**
 * Server Action: Reset a vision profile back to its built-in system prompts by
 * removing the stored user override.
 */
export async function resetVisionProfileAction(key: VisionProfileKey) {
  const userId = await requireUserId();
  if (!VISION_PROFILE_KEYS.includes(key)) return { error: '无效的 Profile' };
  const overrides = await getVisionProfileOverrides(userId);
  const next: VisionProfileOverrides = { ...overrides };
  delete next[key];
  await setVisionProfileOverrides(userId, next);
  revalidatePath('/settings/vision');
  return { ok: true };
}

export type TestVisionModelResult = {
  ok: boolean;
  error?: string;
  perception?: ImagePerceptionData;
  formattedPromptBlock?: string;
  usage?: {
    model: string;
    providerName: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number | null;
  };
};

export async function testVisionModelAction(formData: FormData): Promise<TestVisionModelResult> {
  const userId = await requireUserId();
  const file = formData.get('file') as File | null;
  const providerId = (formData.get('providerId') as string) || null;
  const modelId = (formData.get('modelId') as string) || null;
  const promptText = (formData.get('prompt') as string)?.trim() || '帮我解析这个图片';
  const temperatureStr = formData.get('temperature') as string | null;
  const maxTokensStr = formData.get('maxTokens') as string | null;

  if (!file) {
    return { ok: false, error: '请先选择需要测试的图片' };
  }
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const validation = validateMediaFile({
    buffer,
    mimeType: file.type || 'image/jpeg',
    originalFilename: file.name || 'test.jpg',
    purpose: 'attachment',
  });

  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }
  const mime = validation.verifiedMime || 'image/jpeg';
  const compressed = await compressImageBufferForVision(buffer);
  const base64Data = `data:${compressed.mimeType};base64,${compressed.buffer.toString('base64')}`;
  let provider = null;
  if (providerId) {
    provider = await getProviderConfig(userId, providerId);
    if (!provider) return { ok: false, error: '指定的 Provider 不存在' };
  } else {
    const visionResolved = await resolveVisionModel(userId);
    if (!visionResolved.enabled && !modelId) {
      return { ok: false, error: '图片理解功能已停用，请先勾选启用或选择测试模型' };
    }
  }

  try {
    const result = await runVisionObject({
      userId,
      system: VISION_INTERPRETER_SYSTEM_PROMPT,
      prompt: promptText,
      imageUrl: base64Data,
      mimeType: compressed.mimeType,
      schema: imagePerceptionSchema,
      temperature: temperatureStr ? parseFloat(temperatureStr) : undefined,
      maxOutputTokens: maxTokensStr ? parseInt(maxTokensStr, 10) : undefined,
      providerOverride: provider ?? undefined,
      modelIdOverride: modelId ?? undefined,
    });

    const price = await getModelPrice(userId, result.resolved.provider.id, result.resolved.modelId);
    const costUsd = price
      ? (result.usage.inputTokens / 1_000_000) * price.inputPricePerMTok +
        (result.usage.outputTokens / 1_000_000) * price.outputPricePerMTok
      : null;

    const perception = result.object as ImagePerceptionData;
    const formattedPromptBlock = formatAttachmentPromptBlock([
      {
        id: 'test-preview',
        originalFilename: file.name || 'test-image.png',
        perception: {
          status: 'ready',
          summary: perception.summary,
          perception: JSON.stringify(perception),
          ocrText: perception.ocrText || null,
        },
      },
    ]);

    return {
      ok: true,
      perception,
      formattedPromptBlock,
      usage: {
        model: result.resolved.modelId,
        providerName: result.resolved.provider.name,
        durationMs: result.usage.durationMs,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        costUsd,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

const developerConfigSchema = z.object({
  enabled: z.boolean(),
  showRawPrompts: z.boolean().optional(),
  showTokenStats: z.boolean().optional(),
});

export async function saveDeveloperConfig(input: z.input<typeof developerConfigSchema>) {
  const userId = await requireUserId();
  const parsed = developerConfigSchema.safeParse(input);
  if (!parsed.success) return { error: '保存失败' };
  await setSetting(userId, 'developer_config', parsed.data);
  revalidatePath('/settings/developer');
  revalidatePath('/messages');
  return { ok: true };
}

export async function saveCommunityConfig(input: CommunityConfig) {
  const userId = await requireUserId();
  const parsed = z
    .object({
      enabled: z.boolean(),
      pulseIntervalMinutes: z.number().int().min(5).max(1440),
      maxActorsPerPost: z.number().int().min(0).max(10),
      aiReplyChainRate: z.number().min(0).max(1),
      maxPostsPerPulse: z.number().int().min(0).max(5),
    })
    .safeParse(input);
  if (!parsed.success) return { error: '保存失败' };
  await setSetting(userId, 'community', parsed.data);
  revalidatePath('/settings/defaults');
  return { ok: true };
}

const profileSchema = z.object({
  name: z.string().trim().min(1, '昵称必填').max(50),
  bio: z.string().trim().max(200).default(''),
});

export async function updateProfile(input: z.input<typeof profileSchema>) {
  const userId = await requireUserId();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? '保存失败' };
  const { user } = await import('@/db/schema');
  const { auth } = await import('@/lib/auth');
  await db
    .update(user)
    .set({ name: parsed.data.name, bio: parsed.data.bio || null, updatedAt: new Date() })
    .where(eq(user.id, userId));
  revalidatePath('/settings/account');
  revalidatePath('/feed');
  return { ok: true };
}

export async function changePassword(input: { currentPassword: string; newPassword: string }) {
  const userId = await requireUserId();
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, '新密码至少 8 位'),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? '修改失败' };

  const { auth } = await import('@/lib/auth');
  const { headers } = await import('next/headers');
  const res = await auth.api.changePassword({
    headers: await headers(),
    body: { currentPassword: input.currentPassword, newPassword: input.newPassword },
  });
  if (!res) return { error: '修改失败，请检查当前密码' };
  return { ok: true };
}

/**
 * Server Action: Fetch models from a provider's REST API and upsert them into
 * modelConfigs. Only updates displayName on conflict (preserves user-set prices).
 */
export async function syncProviderModels(providerId: string) {
  const userId = await requireUserId();
  const provider = await getProviderConfig(userId, providerId);
  if (!provider) return { error: 'Provider 不存在' };

  let remoteModels;
  try {
    remoteModels = await fetchProviderModels(provider);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  }

  for (const m of remoteModels) {
    await db
      .insert(modelConfigs)
      .values({
        id: crypto.randomUUID(),
        userId,
        providerId,
        modelId: m.id,
        displayName: m.name || null,
        inputPricePerMTok: 0,
        outputPricePerMTok: 0,
      })
      .onConflictDoUpdate({
        target: [modelConfigs.providerId, modelConfigs.modelId],
        set: {
          displayName: m.name || null,
        },
      });
  }

  revalidatePath('/settings/providers');
  revalidatePath('/settings/providers');
  return { ok: true as const, count: remoteModels.length };
}

export async function saveNotificationPrefs(prefs: NotificationPrefs) {
  const userId = await requireUserId();
  await setNotificationPrefs(userId, prefs);
  revalidatePath('/settings/notifications');
  return { ok: true };
}
