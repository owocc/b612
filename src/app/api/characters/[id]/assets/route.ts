import { z } from 'zod';
import { getSession } from '@/lib/session';
import {
  CHARACTER_ASSET_TYPES,
  MAX_CHARACTER_ASSETS_PER_REQUEST,
  MAX_CHARACTER_ASSET_SIZE,
  type CharacterAssetMetadata,
  type CharacterAssetType,
} from '@/lib/character-assets';
import {
  CharacterAssetError,
  createCharacterAssetsFromBuffers,
  importCharacterAssetsFromUrls,
  listCharacterAssets,
  type BatchAssetOutcome,
  type CharacterAssetBufferInput,
  type CharacterAssetUrlInput,
} from '@/server/character-assets';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const assetTypeSchema = z.enum(CHARACTER_ASSET_TYPES);
const metadataSchema = z.record(z.string(), z.unknown());

const assetPatchSchema = z.object({
  type: assetTypeSchema.optional(),
  isEnabled: z.boolean().optional(),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  metadata: metadataSchema.nullable().optional(),
});

// data URL 体积约为原始字节的 4/3，上限与单图大小限制保持一致
const MAX_ASSET_URL_LENGTH = Math.ceil((MAX_CHARACTER_ASSET_SIZE * 4) / 3) + 128;
const assetUrlSchema = z.string().trim().min(1).max(MAX_ASSET_URL_LENGTH);

const assetUrlItemSchema = assetPatchSchema.extend({
  url: assetUrlSchema,
  importMode: z.enum(['mirror', 'link']).optional(),
});

const assetUrlBodySchema = z.object({
  items: z.array(assetUrlItemSchema).min(1).max(MAX_CHARACTER_ASSETS_PER_REQUEST),
});

const assetUrlsBodySchema = z.object({
  urls: z.array(assetUrlSchema).min(1).max(MAX_CHARACTER_ASSETS_PER_REQUEST),
  type: assetTypeSchema.optional(),
  isEnabled: z.boolean().optional(),
  metadata: metadataSchema.nullable().optional(),
  importMode: z.enum(['mirror', 'link']).optional(),
});

function jsonError(message: string, status: number, code = 'bad_request') {
  return Response.json({ ok: false, error: message, code }, { status });
}

function parseOptionalBoolean(raw: string | null): boolean | undefined {
  if (raw === null || raw === '') return undefined;
  if (['true', '1', 'yes', 'on'].includes(raw.toLowerCase())) return true;
  if (['false', '0', 'no', 'off'].includes(raw.toLowerCase())) return false;
  throw new CharacterAssetError('isEnabled 必须是布尔值', 400, 'invalid_is_enabled');
}

function parseOptionalNumber(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new CharacterAssetError('sortOrder 必须是数字', 400, 'invalid_sort_order');
  }
  return Math.trunc(value);
}

function parseOptionalMetadata(raw: string | null): CharacterAssetMetadata | undefined {
  if (raw === null || raw === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as CharacterAssetMetadata;
  } catch {
    throw new CharacterAssetError('metadata 必须是合法的 JSON 对象', 400, 'invalid_metadata');
  }
}

function parseType(raw: string | null): CharacterAssetType | undefined {
  if (raw === null || raw === '') return undefined;
  const parsed = assetTypeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CharacterAssetError(
      `不支持的资产类型：${raw}`,
      400,
      'invalid_asset_type',
    );
  }
  return parsed.data;
}

function toOutcomeResponse(outcome: BatchAssetOutcome) {
  if (outcome.assets.length === 0) {
    return Response.json(
      {
        ok: false,
        error: outcome.failed[0]?.error ?? '没有可保存的图片',
        assets: [],
        failed: outcome.failed,
      },
      { status: 422 },
    );
  }
  return Response.json(
    {
      ok: true,
      assets: outcome.assets,
      failed: outcome.failed,
      created: outcome.assets.length,
      total: outcome.assets.length + outcome.failed.length,
    },
    { status: 201 },
  );
}

/**
 * GET /api/characters/[id]/assets
 *
 * 查询参数：
 * - enabled=1 仅返回已启用资产
 * - type=base,full_body 按类型过滤（逗号分隔）
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) return jsonError('请先登录', 401, 'unauthorized');
  const userId = session.user.id;
  const { id: characterId } = await params;

  try {
    const url = new URL(req.url);
    const enabledOnly = ['1', 'true'].includes(
      (url.searchParams.get('enabled') ?? '').toLowerCase(),
    );
    const typeParam = url.searchParams.get('type');
    const typeFilter = typeParam
      ? typeParam
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [];

    let assets = await listCharacterAssets(userId, characterId);
    if (enabledOnly) assets = assets.filter((asset) => asset.isEnabled);
    if (typeFilter.length > 0) {
      const allowed = new Set<string>(typeFilter);
      assets = assets.filter((asset) => allowed.has(asset.type));
    }

    return Response.json({ ok: true, assets, total: assets.length });
  } catch (err) {
    return handleError(err, `GET /api/characters/${characterId}/assets`);
  }
}

/**
 * POST /api/characters/[id]/assets
 *
 * 支持三种批量导入方式：
 * 1. multipart/form-data：`files`（可重复） + 可选 `type` / `isEnabled` / `sortOrder` / `metadata`
 *    也可用 `items` 字段传 JSON 数组，按顺序为每张图单独指定属性。
 * 2. application/json：`{ items: [{ url, type?, isEnabled?, metadata?, importMode? }] }`
 * 3. application/json：`{ urls: [...], type?, isEnabled?, metadata?, importMode? }`
 *
 * `url` 支持 http(s) 外链和 `data:image/...;base64,...`。
 * 默认 mirror（下载转存），`importMode: 'link'` 仅记录外链。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) return jsonError('请先登录', 401, 'unauthorized');
  const userId = session.user.id;
  const { id: characterId } = await params;
  const contentType = req.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const files = [...form.getAll('files'), ...form.getAll('file')].filter(
        (entry): entry is File => typeof entry === 'object' && entry !== null && 'arrayBuffer' in entry,
      );
      if (files.length === 0) {
        return jsonError('未找到上传文件（字段名：files）', 400, 'no_files');
      }
      if (files.length > MAX_CHARACTER_ASSETS_PER_REQUEST) {
        return jsonError(
          `单次最多上传 ${MAX_CHARACTER_ASSETS_PER_REQUEST} 张图片`,
          400,
          'too_many_files',
        );
      }

      const defaultType = parseType(form.get('type') as string | null);
      const defaultEnabled = parseOptionalBoolean(form.get('isEnabled') as string | null);
      const defaultSortOrder = parseOptionalNumber(form.get('sortOrder') as string | null);
      const defaultMetadata = parseOptionalMetadata(form.get('metadata') as string | null);

      let perFileItems: unknown[] = [];
      const rawItems = form.get('items');
      if (typeof rawItems === 'string' && rawItems.trim()) {
        try {
          const parsed: unknown = JSON.parse(rawItems);
          if (!Array.isArray(parsed)) throw new Error('items must be an array');
          perFileItems = parsed;
        } catch {
          return jsonError('items 必须是合法的 JSON 数组', 400, 'invalid_items');
        }
      }

      const bufferInputs: CharacterAssetBufferInput[] = [];
      for (const [index, file] of files.entries()) {
        const rawItem = perFileItems[index];
        let itemType = defaultType;
        let itemEnabled = defaultEnabled;
        let itemSortOrder = defaultSortOrder;
        let itemMetadata = defaultMetadata;

        if (rawItem && typeof rawItem === 'object') {
          const parsedItem = assetPatchSchema
            .extend({
              filename: z.string().trim().max(200).optional(),
            })
            .safeParse(rawItem);
          if (!parsedItem.success) {
            throw new CharacterAssetError('items 中存在非法字段', 400, 'invalid_items');
          }
          if (parsedItem.data.type !== undefined) itemType = parsedItem.data.type;
          if (parsedItem.data.isEnabled !== undefined) itemEnabled = parsedItem.data.isEnabled;
          if (parsedItem.data.sortOrder !== undefined) itemSortOrder = parsedItem.data.sortOrder;
          if (parsedItem.data.metadata !== undefined) {
            itemMetadata = parsedItem.data.metadata ?? undefined;
          }
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        bufferInputs.push({
          buffer,
          mimeType: file.type || 'image/jpeg',
          filename: file.name || `asset-${index + 1}`,
          type: itemType,
          isEnabled: itemEnabled,
          sortOrder: itemSortOrder,
          metadata: itemMetadata,
          source: 'upload',
        });
      }

      const outcome = await createCharacterAssetsFromBuffers(
        userId,
        characterId,
        bufferInputs,
      );
      return toOutcomeResponse(outcome);
    }

    if (contentType.includes('application/json')) {
      const body: unknown = await req.json();

      // 形式 2：{ items: [...] }
      const itemsParsed = assetUrlBodySchema.safeParse(body);
      if (itemsParsed.success) {
        const inputs: CharacterAssetUrlInput[] = itemsParsed.data.items.map((item) => ({
          url: item.url,
          type: item.type,
          isEnabled: item.isEnabled,
          sortOrder: item.sortOrder,
          metadata: item.metadata ?? undefined,
          importMode: item.importMode,
        }));
        const outcome = await importCharacterAssetsFromUrls(userId, characterId, inputs);
        return toOutcomeResponse(outcome);
      }

      // 形式 3：{ urls: [...], type?, ... }
      const urlsParsed = assetUrlsBodySchema.safeParse(body);
      if (urlsParsed.success) {
        const inputs: CharacterAssetUrlInput[] = urlsParsed.data.urls.map((url) => ({
          url,
          type: urlsParsed.data.type,
          isEnabled: urlsParsed.data.isEnabled,
          metadata: urlsParsed.data.metadata ?? undefined,
          importMode: urlsParsed.data.importMode,
        }));
        const outcome = await importCharacterAssetsFromUrls(userId, characterId, inputs);
        return toOutcomeResponse(outcome);
      }

      return jsonError(
        '请求体格式不正确：请传 { items: [{ url }] } 或 { urls: [] }',
        400,
        'invalid_body',
      );
    }

    return jsonError('仅支持 multipart/form-data 或 application/json', 415, 'unsupported_media_type');
  } catch (err) {
    return handleError(err, `POST /api/characters/${characterId}/assets`);
  }
}

function handleError(err: unknown, scope: string): Response {
  if (err instanceof CharacterAssetError) {
    return jsonError(err.message, err.status, err.code);
  }
  console.error(`[${scope}] error:`, err);
  return jsonError('服务器内部错误，请稍后重试', 500, 'internal_error');
}
