/**
 * 人设工坊 · 角色视觉资产（client-safe 类型与常量）
 *
 * 这里只放浏览器与服务端都能使用的纯类型 / 常量，不能引入 db 或 node 模块。
 */

export const CHARACTER_ASSET_TYPES = [
  'base',
  'full_body',
  'three_view',
  'detail_face',
  'detail_outfit',
  'custom',
] as const;

export type CharacterAssetType = (typeof CHARACTER_ASSET_TYPES)[number];

export const CHARACTER_ASSET_SOURCES = [
  'upload',
  'external_url',
  'generated',
  'seed',
] as const;

export type CharacterAssetSource = (typeof CHARACTER_ASSET_SOURCES)[number];

/** 展示顺序：基础形象 → 全身 → 三视图 → 细节 → 自定义 */
export const CHARACTER_ASSET_TYPE_ORDER: readonly CharacterAssetType[] = [
  'base',
  'full_body',
  'three_view',
  'detail_face',
  'detail_outfit',
  'custom',
];

export const CHARACTER_ASSET_TYPE_META: Record<
  CharacterAssetType,
  { label: string; shortLabel: string; description: string }
> = {
  base: {
    label: '基础形象',
    shortLabel: '基础',
    description: '角色的主参考形象，通常作为一切生图的锚点。',
  },
  full_body: {
    label: '全身标准图',
    shortLabel: '全身',
    description: '标准站姿全身图，用于统一身高、比例与穿搭。',
  },
  three_view: {
    label: '多视角 / 三视图',
    shortLabel: '三视图',
    description: '正面、侧面、背面的多视角设定图。',
  },
  detail_face: {
    label: '头部脸型特写',
    shortLabel: '脸部',
    description: '五官、发型、脸型的细节特写。',
  },
  detail_outfit: {
    label: '服饰道具特写',
    shortLabel: '服饰',
    description: '服装材质、配饰、随身道具的细节特写。',
  },
  custom: {
    label: '自定义 / 外部导入',
    shortLabel: '自定义',
    description: '外部平台生成或用户自行上传的补充素材。',
  },
};

export const MAX_CHARACTER_ASSETS_PER_REQUEST = 30;
export const MAX_CHARACTER_ASSET_SIZE = 15 * 1024 * 1024; // 15MB

/** metadata 允许任意可 JSON 序列化的附加信息（提示词、生成参数、来源平台等） */
export type CharacterAssetMetadata = Record<string, unknown>;

export type CharacterAssetView = {
  id: string;
  characterId: string;
  type: CharacterAssetType;
  url: string;
  blobPathname: string | null;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  /** 是否在后续生图中作为参考图 */
  isEnabled: boolean;
  sortOrder: number;
  metadata: CharacterAssetMetadata | null;
  source: CharacterAssetSource;
  /** ISO 8601 字符串，便于直接传给客户端组件 */
  createdAt: string;
  updatedAt: string;
};

export function isCharacterAssetType(value: unknown): value is CharacterAssetType {
  return typeof value === 'string' && (CHARACTER_ASSET_TYPES as readonly string[]).includes(value);
}

export function isCharacterAssetSource(value: unknown): value is CharacterAssetSource {
  return typeof value === 'string' && (CHARACTER_ASSET_SOURCES as readonly string[]).includes(value);
}

export function getCharacterAssetTypeLabel(type: CharacterAssetType): string {
  return CHARACTER_ASSET_TYPE_META[type].label;
}

/** 把持久化 JSON 字符串解析成 metadata 对象；脏数据不会让接口整体失败。 */
export function parseCharacterAssetMetadata(raw: string | null): CharacterAssetMetadata | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CharacterAssetMetadata;
    }
  } catch {
    // ignore malformed legacy value
  }
  return null;
}
