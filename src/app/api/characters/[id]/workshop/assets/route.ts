import { z } from 'zod';
import { getSession } from '@/lib/session';
import { isWorkshopTarget, WORKSHOP_TARGETS } from '@/lib/character-workshop';
import { CharacterAssetError } from '@/server/character-assets';
import { WorkshopError, attachWorkshopAssets } from '@/server/character-workshop';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const workshopTargets = WORKSHOP_TARGETS.map((item) => item.target) as [string, ...string[]];

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        url: z.string().min(1),
        target: z.enum(workshopTargets).refine(isWorkshopTarget),
        prompt: z.string().max(8_000).optional(),
        characterName: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(12),
});

function jsonError(message: string, status: number, code = 'bad_request') {
  return Response.json({ ok: false, error: message, code }, { status });
}

function handleError(err: unknown, scope: string): Response {
  if (err instanceof WorkshopError || err instanceof CharacterAssetError) {
    return jsonError(err.message, err.status, err.code);
  }
  console.error(`[${scope}] error:`, err);
  return jsonError('服务器内部错误，请稍后重试', 500, 'internal_error');
}

/**
 * POST /api/characters/[id]/workshop/assets
 *
 * 把工坊里确认的预览图写入角色视觉资产表：
 * { items: [{ url, target, prompt? }] }
 *
 * 资产类型由 target 映射（base / full_body / three_view / detail_face / detail_outfit），
 * metadata 自动带上 workshop 标记、阶段、目标与提示词版本，供后续阶段与资产面板使用。
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
    return jsonError('请求参数不正确：items 需要 url 与 target', 400, 'invalid_body');
  }

  try {
    const outcome = await attachWorkshopAssets({
      userId: session.user.id,
      characterId,
      characterName: parsed.data.items[0]?.characterName,
      items: parsed.data.items.map((item) => ({
        url: item.url,
        target: item.target,
        prompt: item.prompt,
      })),
    });

    if (outcome.assets.length === 0) {
      return Response.json(
        {
          ok: false,
          error: outcome.failed[0]?.error ?? '素材保存失败',
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
      },
      { status: 201 },
    );
  } catch (err) {
    return handleError(err, `POST /api/characters/${characterId}/workshop/assets`);
  }
}
