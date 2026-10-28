import { z } from 'zod';
import { getSession } from '@/lib/session';
import { isWorkshopTarget, WORKSHOP_TARGETS } from '@/lib/character-workshop';
import {
  WorkshopError,
  generateWorkshopPreview,
} from '@/server/character-workshop';
import { CharacterAssetError } from '@/server/character-assets';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const workshopTargets = WORKSHOP_TARGETS.map((item) => item.target) as [string, ...string[]];

const bodySchema = z.object({
  target: z.enum(workshopTargets).refine(isWorkshopTarget),
  description: z.string().max(1200).optional(),
  referenceUrls: z.array(z.string().max(8_000_000)).max(4).optional(),
});

function jsonError(message: string, status: number, code = 'bad_request') {
  return Response.json({ ok: false, error: message, code }, { status });
}

function handleError(err: unknown, scope: string): Response {
  if (err instanceof WorkshopError) {
    return jsonError(err.message, err.status, err.code);
  }
  if (err instanceof CharacterAssetError) {
    return jsonError(err.message, err.status, err.code);
  }
  console.error(`[${scope}] error:`, err);
  const message = err instanceof Error ? err.message : '服务器内部错误，请稍后重试';
  return jsonError(message, 500, 'internal_error');
}

/**
 * POST /api/characters/[id]/workshop/generate
 *
 * 生成一张向导预览图（不落角色资产表）：
 * { target: 'base' | 'full_body' | 'front' | … , description?, referenceUrls? }
 *
 * 阶段与资产类型的映射、固定提示词注入全部在服务端完成，
 * 客户端只能传目标与参考图，无法改写固定模板。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) return jsonError('请先登录', 401, 'unauthorized');
  const { id: characterId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('请求体必须是 JSON', 400, 'invalid_body');
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('请求参数不正确：请提供合法的 target', 400, 'invalid_body');
  }

  try {
    const preview = await generateWorkshopPreview({
      userId: session.user.id,
      characterId,
      target: parsed.data.target,
      description: parsed.data.description,
      referenceUrls: parsed.data.referenceUrls,
    });
    return Response.json({ ok: true, preview });
  } catch (err) {
    return handleError(err, `POST /api/characters/${characterId}/workshop/generate`);
  }
}
