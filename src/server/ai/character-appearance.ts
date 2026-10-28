/**
 * 角色形象装配层（Stage 4）
 *
 * 职责：
 * 1. 从角色资产库里取出「已启用」的视觉素材（is_enabled=true），禁用的严格不出现；
 * 2. 按模型给出的 appearance_refs 挑选参考图（默认 base + full_body）；
 * 3. 把角色的外观设定整理成一段文字摘要，用于：
 *    - 系统提示里的「角色形象参考」块（让模型知道自己的固定长相）；
 *    - 出镜生图时前置到 prompt（即使服务商不支持参考图也不漂移）。
 *
 * 任何资产读取失败都降级为「只有文字设定」，绝不让生图链路整体失败。
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { aiCharacters } from '@/db/schema';
import type { CharacterAssetType, CharacterAssetView } from '@/lib/character-assets';
import { CHARACTER_ASSET_TYPE_META } from '@/lib/character-assets';
import { listEnabledCharacterAssets } from '@/server/character-assets';

/** 模型可选的参考图视角（与资产类型一一对应） */
export const APPEARANCE_REF_KINDS = [
  'base',
  'full_body',
  'three_view',
  'detail_face',
  'detail_outfit',
] as const;

export type AppearanceRefKind = (typeof APPEARANCE_REF_KINDS)[number];

/** 未指定时的默认组合：基础形象锚点 + 全身标准图（锁比例与穿搭） */
export const DEFAULT_APPEARANCE_REFS: readonly AppearanceRefKind[] = ['base', 'full_body'];

/** 与 image.ts 的 MAX_REFERENCE_IMAGES 对齐，避免装配出下游会丢弃的图 */
export const MAX_APPEARANCE_REFERENCES = 4;

export type CharacterAppearanceCharacter = {
  id: string;
  name: string;
  persona: string;
  personality: string;
  interests: string;
  bio: string | null;
  relationshipToUser: string;
};

export type CharacterAppearance = {
  characterName: string;
  /** 已启用的资产行（仅在服务端使用，不序列化给客户端） */
  assets: CharacterAssetView[];
  /** 是否存在任何已启用资产（决定要不要引导模型出镜） */
  hasEnabledAssets: boolean;
  /** 已启用资产的类型清单（去重、按展示顺序），用于提示里列举 */
  availableAssetTypes: CharacterAssetType[];
  /** 默认视角下装配好的参考图 URL（仅 is_enabled=true、仅 http(s)/data） */
  referenceImages: string[];
  /** 文字外观摘要；为空串表示连人设都没有可用描述 */
  description: string;
  /** 画风描述（来自资产 metadata，可选） */
  style: string | null;
};

function isUsableImageUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function firstString(
  metadata: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

const APPEARANCE_TEXT_KEYS = ['appearance', 'appearanceBase', 'description', 'look'] as const;
const APPEARANCE_STYLE_KEYS = ['appearanceStyle', 'style', 'artStyle'] as const;

/**
 * 从已启用资产里挑出参考图。
 * - 已启用过滤在下游（listEnabledCharacterAssets）完成，这里只做视角与去重；
 * - 无效 URL（asset 被删/失效）跳过并记一条不含 URL 的 warn，生图继续。
 */
export function selectReferenceImages(
  assets: CharacterAssetView[],
  refs: readonly AppearanceRefKind[] | undefined,
  limit: number = MAX_APPEARANCE_REFERENCES,
): string[] {
  const wanted = (refs && refs.length > 0 ? refs : DEFAULT_APPEARANCE_REFS).slice();
  const selected: string[] = [];
  const used = new Set<string>();

  for (const kind of wanted) {
    if (selected.length >= limit) break;
    const asset = assets.find((item) => item.type === kind && !used.has(item.id));
    if (!asset) continue;
    used.add(asset.id);
    if (!isUsableImageUrl(asset.url)) {
      console.warn('[character-appearance] 跳过不可用参考图资产', asset.id, asset.type);
      continue;
    }
    selected.push(asset.url);
  }

  return selected;
}

/** 已启用资产 → 提示词里的资产类型摘要（只列类型，不暴露 URL） */
function summarizeAssetTypes(assets: CharacterAssetView[]): CharacterAssetType[] {
  const seen: CharacterAssetType[] = [];
  for (const asset of assets) {
    if (!seen.includes(asset.type)) seen.push(asset.type);
  }
  return seen;
}

/**
 * 角色的外观文字摘要。
 * 优先使用工坊写入 base 资产 metadata 的形象描述（appearance / description），
 * 没有资产时退化为 persona / 性格 / 兴趣摘要，保证永远有可用描述。
 */
function describeCharacterAppearance(
  character: CharacterAppearanceCharacter,
  assets: CharacterAssetView[],
): { description: string; style: string | null } {
  const ordered = [
    ...assets.filter((asset) => asset.type === 'base'),
    ...assets.filter((asset) => asset.type === 'full_body'),
    ...assets.filter((asset) => asset.type === 'detail_outfit'),
    ...assets,
  ];

  let look: string | null = null;
  let style: string | null = null;
  for (const asset of ordered) {
    const metadata = asset.metadata ?? null;
    look ??= firstString(metadata, APPEARANCE_TEXT_KEYS);
    style ??= firstString(metadata, APPEARANCE_STYLE_KEYS);
  }

  if (!look) {
    const persona = character.persona.trim().slice(0, 260);
    const traits = [character.personality, character.interests]
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .join('，');
    look = persona || traits || '';
    if (persona && traits) look = `${persona}；${traits}`;
  }

  return { description: look, style };
}

/**
 * 装配角色形象：查询当前用户下该角色的「已启用」资产 + 文字设定。
 * 角色没有归属、读取资产报错等都返回可用的降级结果（不抛错）。
 */
export async function loadCharacterAppearance(args: {
  userId: string;
  character: CharacterAppearanceCharacter;
  /** 可选：只装配某些视角；缺省 base + full_body */
  refs?: readonly AppearanceRefKind[];
}): Promise<CharacterAppearance> {
  let assets: CharacterAssetView[] = [];
  try {
    assets = await listEnabledCharacterAssets(args.userId, args.character.id);
  } catch (err) {
    // 资产表读取失败不应影响对话/发帖主链路
    console.warn(
      '[character-appearance] 读取启用资产失败，降级为文字设定',
      err instanceof Error ? err.message : String(err),
    );
  }

  const { description, style } = describeCharacterAppearance(args.character, assets);

  return {
    characterName: args.character.name,
    assets,
    hasEnabledAssets: assets.length > 0,
    availableAssetTypes: summarizeAssetTypes(assets),
    referenceImages: selectReferenceImages(assets, args.refs),
    description,
    style,
  };
}

/** 仅供需要 characterId 但手上没有行对象的调用方使用 */
export async function loadCharacterAppearanceById(args: {
  userId: string;
  characterId: string;
  refs?: readonly AppearanceRefKind[];
}): Promise<CharacterAppearance | null> {
  const [row] = await db
    .select({
      id: aiCharacters.id,
      name: aiCharacters.name,
      persona: aiCharacters.persona,
      personality: aiCharacters.personality,
      interests: aiCharacters.interests,
      bio: aiCharacters.bio,
      relationshipToUser: aiCharacters.relationshipToUser,
    })
    .from(aiCharacters)
    .where(and(eq(aiCharacters.id, args.characterId), eq(aiCharacters.userId, args.userId)))
    .limit(1);
  if (!row) return null;
  return loadCharacterAppearance({ userId: args.userId, character: row, refs: args.refs });
}

/** 系统提示里的「角色形象参考」块（无生图配置调用方不会使用它） */
export function characterAppearanceBlock(appearance: CharacterAppearance): string {
  const typeLabels = appearance.availableAssetTypes
    .map((type) => CHARACTER_ASSET_TYPE_META[type]?.label ?? type)
    .join('、');

  const lookLine = appearance.description
    ? `你的固定外观设定：${appearance.description}${appearance.style ? `（画风：${appearance.style}）` : ''}`
    : '你目前还没有登记外观设定，请按你的人设自然想象自己的样子。';

  const assetLine = appearance.hasEnabledAssets
    ? `你的形象素材库已启用：${typeLabels}（共 ${appearance.referenceImages.length} 张会作为生成参考图）。`
    : '你的形象素材库里还没有启用中的设定图，生图时会退回纯文字描述（不报错，也不需要提醒用户）。';

  return `【角色形象参考】
${lookLine}
${assetLine}
出镜规则（你自己判断，不要反问用户）：
- 当画面里会出现你本人（自拍、生活照、你看到的自己、对方说“画你/拍你/你现在的样子”）时，调用 generate_image 时把 include_self 设为 true；可按需用 appearance_refs 选参考视角（base、full_body、three_view、detail_face、detail_outfit），不填默认 base + full_body。
- 当画面是纯景物、食物、他人或抽象内容时，include_self 设为 false，且不要在 prompt 里描述自己的长相与穿着。
- 判断依据是对话语境、情绪氛围、用户意图和你的性格，不要每次都硬把自己塞进画面，也不要因为“有参考图”就一律出镜。`;
}
