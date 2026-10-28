import { generateImage, type DataContent, type ImageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  computeContentHash,
  createMediaAssetRecord,
  findImageByHash,
  uploadToBlobStorage,
  extractImageDimensions,
} from '@/server/media';
import { getImageGenConfig } from '@/server/settings';
import { getProviderConfig, getDefaultProvider, type ProviderConfigRow } from './providers';
import { recordUsage } from './core';
import { supportsImageGen } from '@/lib/providers-shared';

export { supportsImageGen, IMAGE_MODEL_SUGGESTIONS } from '@/lib/providers-shared';

function createImageModelFor(provider: ProviderConfigRow, modelId: string): ImageModel {
  switch (provider.providerType) {
    case 'openai': {
      const factory = createOpenAI({
        apiKey: provider.apiKey,
        baseURL: provider.baseUrl ?? undefined,
      });
      return factory.imageModel(modelId);
    }
    case 'openai-compatible': {
      if (!provider.baseUrl) {
        throw new Error(`Provider「${provider.name}」是自定义类型，必须填写 Base URL`);
      }
      const factory = createOpenAICompatible({
        name: provider.name,
        apiKey: provider.apiKey,
        baseURL: provider.baseUrl,
      });
      return factory.imageModel(modelId);
    }
    default:
      throw new Error(`服务商类型「${provider.providerType}」暂不支持生图，请使用 OpenAI 或 OpenAI 兼容类型`);
  }
}

export type ResolvedImageModel = {
  enabled: boolean;
  provider: ProviderConfigRow | null;
  modelId: string;
};

/**
 * 解析生图配置：专用配置 -> 用户默认 provider。
 * 未启用或未配置时返回 enabled=false，调用方据此完全跳过生图（不产生任何调用）。
 */
export async function resolveImageModel(userId: string): Promise<ResolvedImageModel> {
  const cfg = await getImageGenConfig(userId);
  if (!cfg.enabled) {
    return { enabled: false, provider: null, modelId: '' };
  }

  let provider: ProviderConfigRow | null = null;
  if (cfg.providerId) {
    provider = await getProviderConfig(userId, cfg.providerId);
  }
  if (!provider) {
    provider = await getDefaultProvider(userId);
  }
  if (!provider || !supportsImageGen(provider.providerType)) {
    return { enabled: false, provider: null, modelId: '' };
  }

  return { enabled: true, provider, modelId: cfg.modelId || 'gpt-image-1' };
}

export type GeneratedImage = {
  id: string | null;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
};

const MAX_REFERENCE_IMAGES = 4;
const REFERENCE_FETCH_TIMEOUT_MS = 15_000;
const MAX_REFERENCE_BYTES = 15 * 1024 * 1024;

function decodeImageDataUrl(url: string): DataContent {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(url);
  if (!match) throw new Error('参考图 data URL 格式不正确');
  return new Uint8Array(Buffer.from(match[2], 'base64'));
}

/**
 * 参考图 URL → AI SDK DataContent。
 * 支持 data URL（本地生成的预览图）与 http(s) 地址（自有 blob / 素材库）。
 */
async function loadReferenceImage(url: string): Promise<DataContent> {
  if (url.startsWith('data:')) return decodeImageDataUrl(url);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('参考图 URL 格式不正确');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('参考图仅支持 http(s) 或 data URL');
  }

  // 私有 Vercel Blob 需要携带 token 才能读取（与 /api/media/file 代理一致）
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const isBlobHost = /\.blob\.vercel-storage\.com$/i.test(parsed.hostname);
  const headers: Record<string, string> = { accept: 'image/*' };
  if (blobToken && isBlobHost) headers.authorization = `Bearer ${blobToken}`;

  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(REFERENCE_FETCH_TIMEOUT_MS),
      headers,
    });
  } catch {
    throw new Error('参考图读取失败或超时');
  }
  if (!response.ok) {
    throw new Error(`参考图读取失败（HTTP ${response.status}）`);
  }
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_REFERENCE_BYTES) {
    throw new Error('参考图超过 15MB 限制');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_REFERENCE_BYTES) {
    throw new Error('参考图超过 15MB 限制');
  }
  const mediaType = response.headers.get('content-type')?.split(';')[0] ?? 'image/png';
  if (!mediaType.startsWith('image/')) {
    throw new Error('参考图地址返回的不是图片');
  }
  return new Uint8Array(buffer);
}

async function buildImagePrompt(
  text: string,
  referenceImages: string[] | undefined,
): Promise<string | { text: string; images: DataContent[] }> {
  const references = (referenceImages ?? []).filter((url) => url.trim().length > 0);
  if (references.length === 0) return text;
  const images = await Promise.all(
    references.slice(0, MAX_REFERENCE_IMAGES).map(loadReferenceImage),
  );
  return { text, images };
}

/**
 * 以某个角色（或系统）身份生成一张图片并落库为 media asset。
 * `persist=false` 时仅生成不入库（设置页测试用）。
 */
export async function generateCharacterImage(args: {
  userId: string;
  characterId: string | null;
  prompt: string;
  /** 图生图参考图（URL 或 data URL），最多 4 张 */
  referenceImages?: string[];
  persist?: boolean;
}): Promise<GeneratedImage> {
  const resolved = await resolveImageModel(args.userId);
  if (!resolved.enabled || !resolved.provider) {
    throw new Error('AI 生图未启用或未配置可用的服务商');
  }

  const start = Date.now();
  try {
    const result = await generateImage({
      model: createImageModelFor(resolved.provider, resolved.modelId),
      prompt: await buildImagePrompt(args.prompt, args.referenceImages),
      maxRetries: 1,
    });

    const mimeType = result.image.mediaType || 'image/png';
    const buffer = Buffer.from(result.image.uint8Array);
    const { width, height } = extractImageDimensions(buffer, mimeType);
    const usageData = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      success: true,
      durationMs: Date.now() - start,
    };
    await recordUsage({
      userId: args.userId,
      characterId: args.characterId,
      callType: 'image_generation',
      resolved: {
        provider: resolved.provider,
        modelId: resolved.modelId,
        supportsVision: false,
        temperature: null,
        topP: null,
        maxTokens: null,
      },
      usage: usageData,
    }).catch(console.error);

    if (args.persist === false) {
      const url =
        buffer.length < 2 * 1024 * 1024
          ? `data:${mimeType};base64,${buffer.toString('base64')}`
          : URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: mimeType }));
      return { id: null, url, mimeType, width, height };
    }

    const hash = computeContentHash(buffer);
    const dedupe = await findImageByHash(args.userId, hash, 'general');
    if (dedupe) {
      return {
        id: dedupe.id,
        url: dedupe.downloadUrl || dedupe.blobUrl,
        mimeType: dedupe.mimeType,
        width: dedupe.width,
        height: dedupe.height,
      };
    }

    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
    const uploaded = await uploadToBlobStorage({
      pathname: `users/${args.userId}/generated/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`,
      buffer,
      contentType: mimeType,
    });
    const asset = await createMediaAssetRecord({
      userId: args.userId,
      mediaType: 'image',
      blobUrl: uploaded.url,
      pathname: uploaded.pathname,
      downloadUrl: uploaded.downloadUrl,
      mimeType,
      fileSize: buffer.length,
      originalFilename: `ai-generated.${ext}`,
      width,
      height,
      purpose: 'general',
      status: 'ready',
      contentHash: hash,
      imageType: 'general',
    });

    return {
      id: asset.id,
      url: asset.downloadUrl || asset.blobUrl,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
    };
  } catch (err) {
    await recordUsage({
      userId: args.userId,
      characterId: args.characterId,
      callType: 'image_generation',
      resolved: {
        provider: resolved.provider,
        modelId: resolved.modelId,
        supportsVision: false,
        temperature: null,
        topP: null,
        maxTokens: null,
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      },
    }).catch(console.error);
    throw err;
  }
}
