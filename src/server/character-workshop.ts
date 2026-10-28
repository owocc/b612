import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { aiCharacters } from '@/db/schema';
import {
  WORKSHOP_PROMPT_VERSION,
  buildBasePrompt,
  buildPromptForTarget,
  getWorkshopTargetMeta,
  type WorkshopStage,
  type WorkshopTarget,
} from '@/lib/character-workshop';
import { generateCharacterImage, isReferenceUnsupportedError, resolveImageModel } from '@/server/ai/image';
import {
  attachCharacterAssetsFromUrls,
  requireOwnedCharacter,
  type BatchAssetOutcome,
} from '@/server/character-assets';
import type { CharacterAssetMetadata } from '@/lib/character-assets';

export class WorkshopError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'workshop_error') {
    super(message);
    this.name = 'WorkshopError';
    this.status = status;
    this.code = code;
  }
}

const MAX_REFERENCE_IMAGES = 4;
const MAX_ATTACH_ITEMS = 12;

export type WorkshopPreview = {
  id: string;
  target: WorkshopTarget;
  stage: WorkshopStage;
  assetType: ReturnType<typeof getWorkshopTargetMeta>['assetType'];
  label: string;
  url: string;
  prompt: string;
  promptVersion: string;
  /** 参考图未生效等降级提示；为空表示完全按固定模板执行 */
  warning: string | null;
};

type CharacterWorkshopContext = {
  id: string;
  name: string;
  persona: string;
  personality: string;
  interests: string;
  relationshipToUser: string;
  bio: string | null;
};

/**
 * 读取向导需要的人设信息，并顺带校验角色归属。
 */
export async function getWorkshopCharacter(
  userId: string,
  characterId: string,
): Promise<CharacterWorkshopContext> {
  await requireOwnedCharacter(userId, characterId);
  const [row] = await db
    .select({
      id: aiCharacters.id,
      name: aiCharacters.name,
      persona: aiCharacters.persona,
      personality: aiCharacters.personality,
      interests: aiCharacters.interests,
      relationshipToUser: aiCharacters.relationshipToUser,
      bio: aiCharacters.bio,
    })
    .from(aiCharacters)
    .where(and(eq(aiCharacters.id, characterId), eq(aiCharacters.userId, userId)))
    .limit(1);
  if (!row) {
    throw new WorkshopError('角色不存在或无权访问', 404, 'character_not_found');
  }
  return row;
}

/** 角色人设字段 → 第一阶段描述兜底提示词 */
function personaHints(character: CharacterWorkshopContext): string[] {
  return [
    character.name ? `name: ${character.name}` : '',
    character.persona,
    character.personality ? `personality: ${character.personality}` : '',
    character.interests ? `interests: ${character.interests}` : '',
    character.relationshipToUser ? `relationship to the user: ${character.relationshipToUser}` : '',
  ].filter((hint) => hint.trim().length > 0);
}

function sanitizeReferenceUrls(urls: string[] | undefined): string[] {
  return (urls ?? [])
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .slice(0, MAX_REFERENCE_IMAGES);
}

/**
 * 生成一张工坊预览图（不直接写角色资产表，用户确认后再 attach）。
 *
 * - base：描述 + 可选参考图，产出基础形象；
 * - full_body：强制注入固定全身提示词，参考图 = 第一阶段形象；
 * - front/side/back/three_quarter/detail_*：强制注入对应的固定模板，
 *   参考图 = 第二阶段全身图。
 */
export async function generateWorkshopPreview(args: {
  userId: string;
  characterId: string;
  target: WorkshopTarget;
  description?: string;
  referenceUrls?: string[];
  characterName?: string;
}): Promise<WorkshopPreview> {
  const character = await getWorkshopCharacter(args.userId, args.characterId);
  const meta = getWorkshopTargetMeta(args.target);
  const references = sanitizeReferenceUrls(args.referenceUrls);

  const resolved = await resolveImageModel(args.userId);
  if (!resolved.enabled) {
    throw new WorkshopError(
      'AI 生图未启用或未配置可用的服务商，请先到「设置 → AI 生图」配置后再使用工坊生成',
      400,
      'image_gen_not_configured',
    );
  }

  const prompt =
    args.target === 'base'
      ? buildBasePrompt({
          description: args.description,
          personaHints: personaHints(character),
          hasReferences: references.length > 0,
        })
      : buildPromptForTarget(args.target);

  let warning: string | null = null;
  let image;
  try {
    image = await generateCharacterImage({
      userId: args.userId,
      characterId: args.characterId,
      prompt,
      referenceImages: references,
    });
  } catch (err) {
    // 参考图不被当前生图模型支持时，退回纯文本模板继续完成流程（不阻断向导）
    if (references.length > 0 && isReferenceUnsupportedError(err)) {
      warning = '当前生图模型不支持参考图，已按固定提示词纯文本生成，一致性可能下降；建议换用 gpt-image-1 等支持图生图的模型。';
      image = await generateCharacterImage({
        userId: args.userId,
        characterId: args.characterId,
        prompt,
      });
    } else {
      throw err;
    }
  }

  return {
    id: crypto.randomUUID(),
    target: args.target,
    stage: meta.stage,
    assetType: meta.assetType,
    label: meta.label,
    url: image.url,
    prompt,
    promptVersion: WORKSHOP_PROMPT_VERSION,
    warning,
  };
}

export type WorkshopAttachItem = {
  url: string;
  target: WorkshopTarget;
  /** 生成时的实际提示词；不传则使用固定模板原文 */
  prompt?: string;
};

export type WorkshopAttachResult = BatchAssetOutcome;

/**
 * 将用户确认的预览图落库为角色视觉资产。
 * 资产类型由目标服务端映射（不信客户端传的 type），并把提示词与版本写进 metadata。
 */
export async function attachWorkshopAssets(args: {
  userId: string;
  characterId: string;
  items: WorkshopAttachItem[];
  characterName?: string;
}): Promise<WorkshopAttachResult> {
  await requireOwnedCharacter(args.userId, args.characterId);

  if (args.items.length === 0) {
    throw new WorkshopError('没有需要保存的素材', 400, 'empty_items');
  }
  if (args.items.length > MAX_ATTACH_ITEMS) {
    throw new WorkshopError(`单次最多保存 ${MAX_ATTACH_ITEMS} 张素材`, 400, 'too_many_items');
  }

  const now = new Date().toISOString();
  const inputs = args.items.map((item) => {
    const meta = getWorkshopTargetMeta(item.target);
    const metadata: CharacterAssetMetadata = {
      workshop: true,
      workshopStage: meta.stage,
      workshopTarget: meta.target,
      promptVersion: WORKSHOP_PROMPT_VERSION,
      prompt: item.prompt?.trim() || meta.prompt,
      characterName: args.characterName ?? null,
      generatedAt: now,
    };
    return {
      url: item.url,
      type: meta.assetType,
      metadata,
      isEnabled: true,
      source: 'generated' as const,
    };
  });

  return attachCharacterAssetsFromUrls(args.userId, args.characterId, inputs, {
    source: 'generated',
  });
}
