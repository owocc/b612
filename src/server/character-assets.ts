import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  aiCharacters,
  characterAssets,
  type CharacterAssetSource,
  type CharacterAssetType,
} from '@/db/schema';
import {
  MAX_CHARACTER_ASSET_SIZE,
  parseCharacterAssetMetadata,
  type CharacterAssetMetadata,
  type CharacterAssetView,
} from '@/lib/character-assets';
import {
  deleteFromBlobStorage,
  sanitizeFilename,
  uploadToBlobStorage,
  validateMediaFile,
} from '@/server/media';

export class CharacterAssetError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'bad_request') {
    super(message);
    this.name = 'CharacterAssetError';
    this.status = status;
    this.code = code;
  }
}

type CharacterAssetRow = typeof characterAssets.$inferSelect;

type UploadedBlob = {
  url: string;
  pathname: string;
  downloadUrl: string;
};

export type CharacterAssetInputBase = {
  type?: CharacterAssetType;
  isEnabled?: boolean;
  /** 显式排序权重；不传则追加到当前列表末尾 */
  sortOrder?: number;
  metadata?: CharacterAssetMetadata | null;
  source?: CharacterAssetSource;
};

export type CharacterAssetBufferInput = CharacterAssetInputBase & {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
};

export type CharacterAssetUrlInput = CharacterAssetInputBase & {
  url: string;
  /** mirror = 下载并转存到自有存储（默认，防外链失效）；link = 仅记录外链 */
  importMode?: 'mirror' | 'link';
};

export type CharacterAssetPatch = {
  type?: CharacterAssetType;
  isEnabled?: boolean;
  sortOrder?: number;
  /** 整体替换 metadata */
  metadata?: CharacterAssetMetadata | null;
  /** 浅合并进现有 metadata */
  metadataPatch?: CharacterAssetMetadata | null;
};

export type BatchAssetOutcome = {
  assets: CharacterAssetView[];
  failed: { index: number; error: string }[];
};

const MAX_METADATA_BYTES = 8 * 1024;
const EXTERNAL_FETCH_TIMEOUT_MS = 20_000;

function toView(row: CharacterAssetRow): CharacterAssetView {
  return {
    id: row.id,
    characterId: row.characterId,
    type: row.type as CharacterAssetType,
    url: row.url,
    blobPathname: row.blobPathname,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    width: row.width,
    height: row.height,
    isEnabled: row.isEnabled,
    sortOrder: row.sortOrder,
    metadata: parseCharacterAssetMetadata(row.metadata),
    source: row.source as CharacterAssetSource,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeMetadata(
  metadata: CharacterAssetMetadata | null | undefined,
): string | null {
  if (metadata == null) return null;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new CharacterAssetError('metadata 必须是 JSON 对象', 400, 'invalid_metadata');
  }
  let json: string;
  try {
    json = JSON.stringify(metadata);
  } catch {
    throw new CharacterAssetError('metadata 无法序列化为 JSON', 400, 'invalid_metadata');
  }
  if (Buffer.byteLength(json, 'utf8') > MAX_METADATA_BYTES) {
    throw new CharacterAssetError(
      `metadata 过大（上限 ${MAX_METADATA_BYTES / 1024}KB）`,
      400,
      'invalid_metadata',
    );
  }
  return json;
}

/** 校验角色归当前用户所有；不存在与无权访问统一返回 404，避免信息泄露。 */
export async function requireOwnedCharacter(userId: string, characterId: string): Promise<void> {
  const [row] = await db
    .select({ id: aiCharacters.id })
    .from(aiCharacters)
    .where(and(eq(aiCharacters.id, characterId), eq(aiCharacters.userId, userId)))
    .limit(1);
  if (!row) {
    throw new CharacterAssetError('角色不存在或无权访问', 404, 'character_not_found');
  }
}

async function nextSortOrder(characterId: string): Promise<number> {
  const [row] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${characterAssets.sortOrder}), 0)` })
    .from(characterAssets)
    .where(eq(characterAssets.characterId, characterId));
  return Number(row?.maxOrder ?? 0) + 10;
}

/**
 * 获取指定角色的全部视觉资产。
 * 默认按 sort_order 升序，其次按创建时间。
 */
export async function listCharacterAssets(
  userId: string,
  characterId: string,
): Promise<CharacterAssetView[]> {
  await requireOwnedCharacter(userId, characterId);
  const rows = await db
    .select()
    .from(characterAssets)
    .where(
      and(eq(characterAssets.userId, userId), eq(characterAssets.characterId, characterId)),
    )
    .orderBy(asc(characterAssets.sortOrder), asc(characterAssets.createdAt));
  return rows.map(toView);
}

/**
 * 获取「已启用」的资产，供后续生图注入参考图使用。
 */
export async function listEnabledCharacterAssets(
  userId: string,
  characterId: string,
  options?: { types?: CharacterAssetType[]; limit?: number },
): Promise<CharacterAssetView[]> {
  await requireOwnedCharacter(userId, characterId);
  const conditions = [
    eq(characterAssets.userId, userId),
    eq(characterAssets.characterId, characterId),
    eq(characterAssets.isEnabled, true),
  ];
  if (options?.types && options.types.length > 0) {
    conditions.push(inArray(characterAssets.type, options.types));
  }
  const query = db
    .select()
    .from(characterAssets)
    .where(and(...conditions))
    .orderBy(asc(characterAssets.sortOrder), asc(characterAssets.createdAt));
  const rows = options?.limit ? await query.limit(options.limit) : await query;
  return rows.map(toView);
}

/**
 * Stage 4 会用到：按优先级返回已启用资产的可访问 URL 列表。
 * 基础形象始终排在最前面，其余按 sort_order。
 */
export async function getCharacterReferenceImageUrls(
  userId: string,
  characterId: string,
  options?: { limit?: number },
): Promise<string[]> {
  // 先取全部已启用资产再排序，确保 base 不会被 limit 截断
  const assets = await listEnabledCharacterAssets(userId, characterId);
  const weight = (type: CharacterAssetType): number => (type === 'base' ? 0 : 1);
  const sorted = assets
    .slice()
    .sort((a, b) => weight(a.type) - weight(b.type) || a.sortOrder - b.sortOrder);
  const limit = options?.limit && options.limit > 0 ? options.limit : sorted.length;
  return sorted.slice(0, limit).map((asset) => asset.url);
}

/** 单条资产查询（供 PATCH / DELETE 归属校验使用） */
export async function getCharacterAsset(
  userId: string,
  characterId: string,
  assetId: string,
): Promise<CharacterAssetView | null> {
  const [row] = await db
    .select()
    .from(characterAssets)
    .where(
      and(
        eq(characterAssets.id, assetId),
        eq(characterAssets.userId, userId),
        eq(characterAssets.characterId, characterId),
      ),
    )
    .limit(1);
  return row ? toView(row) : null;
}

function guessExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/avif':
      return 'avif';
    default:
      return 'jpg';
  }
}

function buildPathname(args: {
  userId: string;
  characterId: string;
  index: number;
  filename: string;
  mimeType: string;
}): string {
  const clean = sanitizeFilename(args.filename || 'asset').replace(/\.(jpe?g|png|webp|gif|avif)$/i, '');
  return `users/${args.userId}/character-assets/${args.characterId}/${Date.now()}-${args.index}-${clean}.${guessExtension(args.mimeType)}`;
}

/** 先把一张图落到存储，再写库；写库失败时回滚已上传的 blob。 */
async function persistUploadedAsset(args: {
  userId: string;
  characterId: string;
  index: number;
  buffer: Buffer;
  verifiedMime: string;
  width: number | null;
  height: number | null;
  filename: string;
  input: CharacterAssetInputBase;
  defaultSortOrder: number;
}): Promise<CharacterAssetView> {
  const pathname = buildPathname({
    userId: args.userId,
    characterId: args.characterId,
    index: args.index,
    filename: args.filename,
    mimeType: args.verifiedMime,
  });

  const uploaded: UploadedBlob = await uploadToBlobStorage({
    pathname,
    buffer: args.buffer,
    contentType: args.verifiedMime,
  });

  const now = new Date();
  const id = crypto.randomUUID();
  const type = args.input.type ?? 'custom';
  const sortOrder = args.input.sortOrder ?? args.defaultSortOrder;

  try {
    await db.insert(characterAssets).values({
      id,
      userId: args.userId,
      characterId: args.characterId,
      type,
      url: uploaded.url,
      blobPathname: uploaded.pathname,
      mimeType: args.verifiedMime,
      fileSize: args.buffer.length,
      width: args.width,
      height: args.height,
      isEnabled: args.input.isEnabled ?? true,
      sortOrder,
      metadata: serializeMetadata(args.input.metadata),
      source: args.input.source ?? 'upload',
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    await deleteFromBlobStorage(uploaded.url);
    throw err;
  }

  return {
    id,
    characterId: args.characterId,
    type,
    url: uploaded.url,
    blobPathname: uploaded.pathname,
    mimeType: args.verifiedMime,
    fileSize: args.buffer.length,
    width: args.width,
    height: args.height,
    isEnabled: args.input.isEnabled ?? true,
    sortOrder,
    metadata: args.input.metadata ?? null,
    source: args.input.source ?? 'upload',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * 批量保存本地上传的图片（多文件一次请求）。
 * 采用「部分成功」语义：单张失败不影响其余图片入库。
 */
export async function createCharacterAssetsFromBuffers(
  userId: string,
  characterId: string,
  items: CharacterAssetBufferInput[],
): Promise<BatchAssetOutcome> {
  await requireOwnedCharacter(userId, characterId);
  const assets: CharacterAssetView[] = [];
  const failed: { index: number; error: string }[] = [];
  let order = await nextSortOrder(characterId);

  for (const [index, item] of items.entries()) {
    const validation = validateMediaFile({
      buffer: item.buffer,
      mimeType: item.mimeType,
      originalFilename: item.filename ?? 'asset',
      purpose: 'general',
    });
    if (!validation.valid) {
      failed.push({ index, error: validation.error });
      continue;
    }
    try {
      const asset = await persistUploadedAsset({
        userId,
        characterId,
        index,
        buffer: item.buffer,
        verifiedMime: validation.verifiedMime,
        width: validation.width,
        height: validation.height,
        filename: item.filename ?? 'asset',
        input: { ...item, source: item.source ?? 'upload' },
        defaultSortOrder: order,
      });
      order += 10;
      assets.push(asset);
    } catch (err) {
      failed.push({
        index,
        error: err instanceof Error ? err.message : '图片保存失败',
      });
    }
  }

  return { assets, failed };
}

/** 单张上传便捷入口 */
export async function uploadCharacterAsset(
  userId: string,
  characterId: string,
  input: CharacterAssetBufferInput,
): Promise<CharacterAssetView> {
  const outcome = await createCharacterAssetsFromBuffers(userId, characterId, [input]);
  const asset = outcome.assets[0];
  if (!asset) {
    throw new CharacterAssetError(
      outcome.failed[0]?.error ?? '图片保存失败',
      422,
      'upload_failed',
    );
  }
  return asset;
}

/** data URL → buffer（支持 base64 编码的图片） */
function decodeDataUrl(url: string): { buffer: Buffer; mimeType: string; filename: string } {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(url);
  if (!match) {
    throw new CharacterAssetError('不支持的 data URL 格式', 400, 'invalid_data_url');
  }
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) {
    throw new CharacterAssetError('data URL 内容为空', 400, 'invalid_data_url');
  }
  return { buffer, mimeType, filename: `data-url-${Date.now()}.${guessExtension(mimeType)}` };
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) {
    return true;
  }
  if (/^169\.254\./.test(host)) return true;
  const m = /^172\.(\d{1,3})\./.exec(host);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function assertSafeExternalUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CharacterAssetError('外部图片 URL 格式不正确', 400, 'invalid_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CharacterAssetError('仅支持 http(s) 图片 URL', 400, 'invalid_url');
  }
  // 本地开发允许自建 mock 图片服务；生产环境禁止访问内网地址（SSRF 防护）
  if (process.env.NODE_ENV === 'production' && isPrivateHostname(parsed.hostname)) {
    throw new CharacterAssetError('不允许导入内网地址的图片', 400, 'invalid_url');
  }
  return parsed;
}

async function downloadExternalImage(
  rawUrl: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const parsed = assertSafeExternalUrl(rawUrl);
  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
      headers: { accept: 'image/*' },
    });
  } catch {
    throw new CharacterAssetError('外部图片下载失败或超时', 422, 'download_failed');
  }
  if (!response.ok) {
    throw new CharacterAssetError(
      `外部图片下载失败（HTTP ${response.status}）`,
      422,
      'download_failed',
    );
  }
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_CHARACTER_ASSET_SIZE) {
    throw new CharacterAssetError('外部图片超过 15MB 限制', 422, 'file_too_large');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_CHARACTER_ASSET_SIZE) {
    throw new CharacterAssetError('外部图片超过 15MB 限制', 422, 'file_too_large');
  }
  const pathname = parsed.pathname;
  const filename =
    decodeURIComponent(pathname.split('/').pop() ?? '') || `external-${Date.now()}`;
  return {
    buffer,
    mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg',
    filename,
  };
}

/**
 * 批量导入外部图片 URL（例如外部平台生成好的整套设定图）。
 * - importMode=mirror（默认）：下载后转存到自有存储；外链失效也不影响资产。
 * - importMode=link：仅记录外链，不占用存储。
 */
export async function importCharacterAssetsFromUrls(
  userId: string,
  characterId: string,
  items: CharacterAssetUrlInput[],
): Promise<BatchAssetOutcome> {
  await requireOwnedCharacter(userId, characterId);
  const assets: CharacterAssetView[] = [];
  const failed: { index: number; error: string }[] = [];
  let order = await nextSortOrder(characterId);

  for (const [index, item] of items.entries()) {
    try {
      const importMode = item.importMode ?? 'mirror';

      if (importMode === 'link') {
        assertSafeExternalUrl(item.url);
        const asset = await persistLinkedAsset({
          userId,
          characterId,
          url: item.url,
          input: item,
          defaultSortOrder: order,
        });
        order += 10;
        assets.push(asset);
        continue;
      }

      // mirror: data URL 直接解码，否则下载
      const downloaded = item.url.startsWith('data:')
        ? decodeDataUrl(item.url)
        : await downloadExternalImage(item.url);

      const validation = validateMediaFile({
        buffer: downloaded.buffer,
        mimeType: downloaded.mimeType,
        originalFilename: downloaded.filename,
        purpose: 'general',
      });
      if (!validation.valid) {
        failed.push({ index, error: validation.error });
        continue;
      }

      const metadata: CharacterAssetMetadata = {
        ...(item.metadata ?? {}),
        sourceUrl: item.url.startsWith('data:') ? null : item.url,
        importMode: 'mirror',
      };

      const asset = await persistUploadedAsset({
        userId,
        characterId,
        index,
        buffer: downloaded.buffer,
        verifiedMime: validation.verifiedMime,
        width: validation.width,
        height: validation.height,
        filename: downloaded.filename,
        input: { ...item, metadata, source: 'external_url' },
        defaultSortOrder: order,
      });
      order += 10;
      assets.push(asset);
    } catch (err) {
      failed.push({
        index,
        error: err instanceof Error ? err.message : '外部图片导入失败',
      });
    }
  }

  return { assets, failed };
}

async function persistLinkedAsset(args: {
  userId: string;
  characterId: string;
  url: string;
  input: CharacterAssetInputBase;
  defaultSortOrder: number;
}): Promise<CharacterAssetView> {
  const now = new Date();
  const id = crypto.randomUUID();
  const type = args.input.type ?? 'custom';
  const sortOrder = args.input.sortOrder ?? args.defaultSortOrder;
  const metadata: CharacterAssetMetadata = {
    ...(args.input.metadata ?? {}),
    sourceUrl: args.url,
    importMode: 'link',
  };
  const mimeType =
    /\.png(\?|$)/i.test(args.url)
      ? 'image/png'
      : /\.webp(\?|$)/i.test(args.url)
        ? 'image/webp'
        : /\.gif(\?|$)/i.test(args.url)
          ? 'image/gif'
          : 'image/jpeg';

  await db.insert(characterAssets).values({
    id,
    userId: args.userId,
    characterId: args.characterId,
    type,
    url: args.url,
    blobPathname: null,
    mimeType,
    fileSize: 0,
    width: null,
    height: null,
    isEnabled: args.input.isEnabled ?? true,
    sortOrder,
    metadata: serializeMetadata(metadata),
    source: 'external_url',
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    characterId: args.characterId,
    type,
    url: args.url,
    blobPathname: null,
    mimeType,
    fileSize: 0,
    width: null,
    height: null,
    isEnabled: args.input.isEnabled ?? true,
    sortOrder,
    metadata,
    source: 'external_url',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * 更新资产属性（启闭、类型标签、排序、metadata）。
 */
export async function updateCharacterAsset(
  userId: string,
  characterId: string,
  assetId: string,
  patch: CharacterAssetPatch,
): Promise<CharacterAssetView> {
  const existing = await getCharacterAsset(userId, characterId, assetId);
  if (!existing) {
    throw new CharacterAssetError('资产不存在或无权访问', 404, 'asset_not_found');
  }

  const updates: Partial<typeof characterAssets.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (patch.type !== undefined) updates.type = patch.type;
  if (patch.isEnabled !== undefined) updates.isEnabled = patch.isEnabled;
  if (patch.sortOrder !== undefined) updates.sortOrder = patch.sortOrder;

  if (patch.metadata !== undefined) {
    updates.metadata = serializeMetadata(patch.metadata);
  } else if (patch.metadataPatch !== undefined) {
    const merged = { ...(existing.metadata ?? {}), ...(patch.metadataPatch ?? {}) };
    updates.metadata = serializeMetadata(merged);
  }

  await db
    .update(characterAssets)
    .set(updates)
    .where(
      and(
        eq(characterAssets.id, assetId),
        eq(characterAssets.userId, userId),
        eq(characterAssets.characterId, characterId),
      ),
    );

  const updated = await getCharacterAsset(userId, characterId, assetId);
  if (!updated) {
    throw new CharacterAssetError('资产更新后读取失败', 500, 'update_failed');
  }
  return updated;
}

/**
 * 删除资产记录，并清理自有存储中的 blob（外链 / data URL 不删除）。
 */
export async function deleteCharacterAsset(
  userId: string,
  characterId: string,
  assetId: string,
): Promise<{ deleted: true; characterAssetId: string }> {
  const existing = await getCharacterAsset(userId, characterId, assetId);
  if (!existing) {
    throw new CharacterAssetError('资产不存在或无权访问', 404, 'asset_not_found');
  }

  await db
    .delete(characterAssets)
    .where(
      and(
        eq(characterAssets.id, assetId),
        eq(characterAssets.userId, userId),
        eq(characterAssets.characterId, characterId),
      ),
    );

  if (existing.blobPathname && !existing.url.startsWith('data:')) {
    await deleteFromBlobStorage(existing.url);
  }

  return { deleted: true, characterAssetId: assetId };
}
