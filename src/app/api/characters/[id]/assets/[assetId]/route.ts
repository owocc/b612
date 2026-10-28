import { z } from 'zod';
import { getSession } from '@/lib/session';
import {
  CHARACTER_ASSET_TYPES,
  type CharacterAssetType,
} from '@/lib/character-assets';
import {
  CharacterAssetError,
  deleteCharacterAsset,
  getCharacterAsset,
  updateCharacterAsset,
  type CharacterAssetPatch,
} from '@/server/character-assets';

export const dynamic = 'force-dynamic';

const assetTypeSchema = z.enum(CHARACTER_ASSET_TYPES);

const patchSchema = z
  .object({
    type: assetTypeSchema.optional(),
    isEnabled: z.boolean().optional(),
    sortOrder: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    metadataPatch: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine(
    (value) =>
      value.type !== undefined ||
      value.isEnabled !== undefined ||
      value.sortOrder !== undefined ||
      value.metadata !== undefined ||
      value.metadataPatch !== undefined,
    { message: '至少需要提供一个待修改字段' },
  );

function jsonError(message: string, status: number, code = 'bad_request') {
  return Response.json({ ok: false, error: message, code }, { status });
}

function handleError(err: unknown, scope: string): Response {
  if (err instanceof CharacterAssetError) {
    return jsonError(err.message, err.status, err.code);
  }
  console.error(`[${scope}] error:`, err);
  return jsonError('服务器内部错误，请稍后重试', 500, 'internal_error');
}

type RouteParams = { params: Promise<{ id: string; assetId: string }> };

/** GET /api/characters/[id]/assets/[assetId] — 单条资产详情 */
export async function GET(_req: Request, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user?.id) return jsonError('请先登录', 401, 'unauthorized');
  const { id: characterId, assetId } = await params;

  try {
    const asset = await getCharacterAsset(session.user.id, characterId, assetId);
    if (!asset) return jsonError('资产不存在或无权访问', 404, 'asset_not_found');
    return Response.json({ ok: true, asset });
  } catch (err) {
    return handleError(err, `GET /api/characters/${characterId}/assets/${assetId}`);
  }
}

/**
 * PATCH /api/characters/[id]/assets/[assetId]
 *
 * body: { isEnabled?, type?, sortOrder?, metadata?, metadataPatch? }
 * - metadata 整体替换；metadataPatch 浅合并（只改提示词等个别字段时更安全）
 */
export async function PATCH(req: Request, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user?.id) return jsonError('请先登录', 401, 'unauthorized');
  const { id: characterId, assetId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('请求体必须是合法的 JSON', 400, 'invalid_body');
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? '请求体格式不正确',
      400,
      'invalid_body',
    );
  }

  try {
    const patch: CharacterAssetPatch = {
      type: parsed.data.type as CharacterAssetType | undefined,
      isEnabled: parsed.data.isEnabled,
      sortOrder: parsed.data.sortOrder,
      metadata: parsed.data.metadata,
      metadataPatch: parsed.data.metadataPatch,
    };
    const asset = await updateCharacterAsset(session.user.id, characterId, assetId, patch);
    return Response.json({ ok: true, asset });
  } catch (err) {
    return handleError(err, `PATCH /api/characters/${characterId}/assets/${assetId}`);
  }
}

/** DELETE /api/characters/[id]/assets/[assetId] — 删除记录并清理自有存储 */
export async function DELETE(_req: Request, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user?.id) return jsonError('请先登录', 401, 'unauthorized');
  const { id: characterId, assetId } = await params;

  try {
    const result = await deleteCharacterAsset(session.user.id, characterId, assetId);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err, `DELETE /api/characters/${characterId}/assets/${assetId}`);
  }
}
