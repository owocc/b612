/**
 * 人设工坊 · 固定提示词引擎（client-safe）
 *
 * 三阶段向导的提示词全部集中在这里，固定模板不允许用户在 UI 中随意改写，
 * 只把「角色描述」这种自由文本作为变量拼进去，从而保证：
 * 1. 第二阶段全身图的构图 / 背景 / 比例约束始终一致；
 * 2. 第三阶段四视角与特写共享同一套身份锁定与构图约束；
 * 3. 资产入库时可以把 prompt 与版本号写进 metadata，便于回溯。
 *
 * 本文件只放纯常量 / 纯函数，浏览器与服务端都可以引用。
 */

import type { CharacterAssetType } from '@/lib/character-assets';

export const WORKSHOP_PROMPT_VERSION = 'b612-workshop-v1';

/** 生成目标：三个阶段共享的目标枚举（视图与特写是第三阶段的两个子组） */
export type WorkshopTarget =
  | 'base'
  | 'full_body'
  | 'front'
  | 'side'
  | 'back'
  | 'three_quarter'
  | 'detail_face'
  | 'detail_outfit';

export type WorkshopStage = 'base' | 'full_body' | 'derive';

export type WorkshopTargetGroup = 'base' | 'full_body' | 'view' | 'detail';

export type WorkshopTargetMeta = {
  target: WorkshopTarget;
  stage: WorkshopStage;
  group: WorkshopTargetGroup;
  /** 入库时的资产类型 */
  assetType: CharacterAssetType;
  label: string;
  description: string;
  prompt: string;
};

/**
 * 身份锁定：所有跨阶段生成共用的第一段。
 * 参考图是唯一事实来源，禁止模型自由发挥五官、发型、体型与服装。
 */
const IDENTITY_LOCK = [
  'STRICT IDENTITY LOCK: the attached reference image is the single source of truth for this character.',
  'Keep exactly the same face shape, facial features, eye color and shape, eyebrows, hairstyle and hair color, skin tone, body type, height and outfit design.',
  'Do not change gender, age, ethnicity or art style. Do not add, remove or redesign any accessory.',
].join(' ');

/** 第二阶段固定构图约束（需求中规定的关键字必须原样保留） */
const FULL_BODY_FRAMING = [
  'full body standing pose, neutral white background, defined height proportions, head-to-toe shot,',
  'single character only, straight relaxed standing pose with arms slightly away from the body and feet together,',
  'the entire body from the top of the head to the soles of the shoes is fully visible and never cropped,',
  'camera at chest height, eye-level framing, flat 50mm lens, no perspective distortion,',
  'centered composition with even margins, soft even studio lighting, no cast shadow on the background,',
  'clean crisp detail, consistent character design sheet quality, full color.',
].join(' ');

/** 负向约束：所有阶段共用 */
const NEGATIVE_CONSTRAINTS = [
  'Avoid: cropped head or limbs, extra fingers, malformed hands, distorted anatomy, changed height proportions,',
  'background scenery, props that are not in the reference, text, watermark, logo overlay, frame, multiple characters.',
].join(' ');

/** 第三阶段四视角指令：构图与第二阶段的全身图完全对齐，只旋转机位 */
const VIEW_INSTRUCTIONS: Record<'front' | 'side' | 'back' | 'three_quarter', string> = {
  front:
    'front view, the character faces the camera directly, symmetrical left-right layout, both shoulders at the same distance from the camera',
  side:
    'side view, exact 90-degree profile, the left side of the body faces the camera, nose and toes point to the same side',
  back:
    'back view, seen from directly behind the character, back of the head, back of the outfit and both heels visible, face not visible',
  three_quarter:
    'three-quarter view, the body is turned 45 degrees away from the camera, both eyes and the side of the head still visible',
};

/** 第三阶段特写指令 */
const DETAIL_INSTRUCTIONS: Record<'detail_face' | 'detail_outfit', string> = {
  detail_face: [
    'extreme close-up headshot, head and shoulders only, the face fills most of the frame, neutral expression,',
    'looking straight at the camera, clearly showing face details, eye color, hairstyle, facial contours,',
    'skin texture and any makeup, on the same neutral background.',
  ].join(' '),
  detail_outfit: [
    'outfit and prop close-up, cropped from shoulders to knees and focused on the clothing,',
    'clearly showing fabric texture, material detail, stitching, patterns, accessories, badge and logo placement,',
    'on the same neutral background, no face close-up.',
  ].join(' '),
};

/** 第二阶段：稳定全身图（固定模板，无自由变量） */
export const WORKSHOP_FULL_BODY_PROMPT = [
  IDENTITY_LOCK,
  'Redraw the same character as a reference-quality full body character sheet.',
  FULL_BODY_FRAMING,
  NEGATIVE_CONSTRAINTS,
].join(' ');

/** 第一阶段（基础形象）的画风与构图约束 */
const BASE_STYLE_CONSTRAINTS = [
  'single character, clean character design portrait used as the canonical reference for later full body renders,',
  'neutral light grey studio background, soft even lighting, full color, crisp detail,',
  'avoid: text, watermark, logo overlay, frame, multiple characters, heavy background scenery.',
].join(' ');

/**
 * 第一阶段：基础形象提示词。
 * - 用户填写了形象描述时以描述为主体；
 * - 参考图存在时要求「重绘 / 精修」而不是凭空生成，尽量保留原图特征；
 * - 描述为空时退回到角色人设字段，保证永远有可用提示词。
 */
export function buildBasePrompt(args: {
  description?: string;
  personaHints?: string[];
  hasReferences?: boolean;
}): string {
  const description = (args.description ?? '').trim();
  const hints = (args.personaHints ?? [])
    .map((hint) => hint.trim())
    .filter((hint) => hint.length > 0);

  const subject = description
    ? `Character concept: ${description}.`
    : `Character concept based on this persona: ${hints.join('; ') || 'an everyday person'}.`;

  const referenceLine = args.hasReferences
    ? 'Use the attached reference image(s) as the identity anchor and redraw the same person as a clean character design portrait, keeping face, hairstyle, body type and outfit.'
    : 'Design a brand new original character that matches the description above.';

  return [referenceLine, subject, BASE_STYLE_CONSTRAINTS].join(' ');
}

/** 第三阶段：多视角全身图提示词 */
export function buildViewPrompt(target: 'front' | 'side' | 'back' | 'three_quarter'): string {
  return [
    IDENTITY_LOCK,
    `Redraw the attached full body reference image from a different camera angle: ${VIEW_INSTRUCTIONS[target]}.`,
    'Keep the identical standing pose, outfit, accessories, body proportions and framing, only the camera angle changes.',
    FULL_BODY_FRAMING,
    NEGATIVE_CONSTRAINTS,
  ].join(' ');
}

/** 第三阶段：头部 / 服饰特写提示词 */
export function buildDetailPrompt(target: 'detail_face' | 'detail_outfit'): string {
  return [
    IDENTITY_LOCK,
    `Derive a detail shot from the attached full body reference image: ${DETAIL_INSTRUCTIONS[target]}`,
    'Keep the same art style, color palette, lighting direction and level of detail as the reference.',
    NEGATIVE_CONSTRAINTS,
  ].join(' ');
}

/** 各目标 → 入库资产类型的映射 */
export const WORKSHOP_TARGET_ASSET_TYPE: Record<WorkshopTarget, CharacterAssetType> = {
  base: 'base',
  full_body: 'full_body',
  front: 'three_view',
  side: 'three_view',
  back: 'three_view',
  three_quarter: 'three_view',
  detail_face: 'detail_face',
  detail_outfit: 'detail_outfit',
};

const TARGET_ORDER: WorkshopTarget[] = [
  'base',
  'full_body',
  'front',
  'side',
  'back',
  'three_quarter',
  'detail_face',
  'detail_outfit',
];

const TARGET_LABELS: Record<WorkshopTarget, { label: string; description: string }> = {
  base: { label: '基础形象', description: '第一阶段的锚点形象' },
  full_body: { label: '全身标准图', description: '锁定身高与身材比例' },
  front: { label: '正面', description: 'front view' },
  side: { label: '侧面', description: 'side view · 90°' },
  back: { label: '背面', description: 'back view' },
  three_quarter: { label: '3/4 侧面', description: 'three-quarter view · 45°' },
  detail_face: { label: '头部特写', description: '五官 / 发型 / 眼睛' },
  detail_outfit: { label: '服饰特写', description: '材质 / 配饰 / logo' },
};

function stageForTarget(target: WorkshopTarget): WorkshopStage {
  if (target === 'base') return 'base';
  if (target === 'full_body') return 'full_body';
  return 'derive';
}

function groupForTarget(target: WorkshopTarget): WorkshopTargetGroup {
  if (target === 'base' || target === 'full_body') return target;
  if (target === 'detail_face' || target === 'detail_outfit') return 'detail';
  return 'view';
}

/** 目标是否属于四视角组（需要全身构图约束） */
export function isViewTarget(target: WorkshopTarget): target is
  | 'front'
  | 'side'
  | 'back'
  | 'three_quarter' {
  return groupForTarget(target) === 'view';
}

/** 目标是否属于特写组 */
export function isDetailTarget(target: WorkshopTarget): target is
  | 'detail_face'
  | 'detail_outfit' {
  return groupForTarget(target) === 'detail';
}

/** 按目标取固定提示词（第一阶段需要外部传入描述，因此单独走 buildBasePrompt） */
export function buildPromptForTarget(
  target: WorkshopTarget,
  args?: { description?: string; personaHints?: string[]; hasReferences?: boolean },
): string {
  if (target === 'base') return buildBasePrompt(args ?? {});
  if (target === 'full_body') return WORKSHOP_FULL_BODY_PROMPT;
  if (isViewTarget(target)) return buildViewPrompt(target);
  return buildDetailPrompt(target);
}

export const WORKSHOP_TARGETS: readonly WorkshopTargetMeta[] = TARGET_ORDER.map((target) => ({
  target,
  stage: stageForTarget(target),
  group: groupForTarget(target),
  assetType: WORKSHOP_TARGET_ASSET_TYPE[target],
  label: TARGET_LABELS[target].label,
  description: TARGET_LABELS[target].description,
  prompt: buildPromptForTarget(target),
}));

export const WORKSHOP_VIEW_TARGETS = WORKSHOP_TARGETS.filter((item) => item.group === 'view');
export const WORKSHOP_DETAIL_TARGETS = WORKSHOP_TARGETS.filter((item) => item.group === 'detail');

const TARGET_BY_ID = new Map<WorkshopTarget, WorkshopTargetMeta>(
  WORKSHOP_TARGETS.map((item) => [item.target, item]),
);

export function getWorkshopTargetMeta(target: WorkshopTarget): WorkshopTargetMeta {
  const meta = TARGET_BY_ID.get(target);
  if (!meta) throw new Error(`未知的工坊生成目标：${target}`);
  return meta;
}

export function isWorkshopTarget(value: unknown): value is WorkshopTarget {
  return typeof value === 'string' && TARGET_BY_ID.has(value as WorkshopTarget);
}

/** 第三阶段资产入库时的自定义 metadata 结构（与 CharacterAssetMetadata 兼容） */
export type WorkshopAssetMetadata = {
  workshop: true;
  workshopStage: WorkshopStage;
  workshopTarget: WorkshopTarget;
  promptVersion: string;
  prompt: string;
  characterName?: string;
  generatedAt: string;
};

/** 阶段元信息：向导步骤标题与「跳过」的含义 */
export const WORKSHOP_STAGE_META: Record<
  WorkshopStage,
  { title: string; subtitle: string; skipHint: string }
> = {
  base: {
    title: '基础形象确立',
    subtitle: '上传已有参考图，或用一段描述生成初版形象',
    skipHint: '跳过：沿用已有基础形象 / 稍后手动补充',
  },
  full_body: {
    title: '稳定全身图',
    subtitle: '以基础形象为参考，注入固定全身提示词锁定比例',
    skipHint: '跳过：直接沿用基础形象作为后续参考',
  },
  derive: {
    title: '多视角与细节拆解',
    subtitle: '从全身图派生四视角全身图与关键特写',
    skipHint: '跳过：仅保留已选中的素材',
  },
};
