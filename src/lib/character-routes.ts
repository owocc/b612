/**
 * 角色详情（居民资料）的多端入口与路由工具。
 *
 * 容器策略：
 * - 手机端（< 768px）：进入全屏独立路由页 `/characters/[id]`，不再使用侧边抽屉。
 * - 平板 / 桌面端（>= 768px）：沿用当前页内的侧边浮层（聊天窗口 `?profile=1`）或双栏详情。
 */

export const CHARACTER_MOBILE_MEDIA_QUERY = '(max-width: 767px)';

/** 角色详情全屏页地址；`backPath` 用于直接刷新/深链后仍能回到来源页 */
export function characterDetailHref(characterId: string, backPath?: string | null): string {
  const base = `/characters/${characterId}`;
  const safeBack = sanitizeBackHref(backPath);
  return safeBack ? `${base}?back=${encodeURIComponent(safeBack)}` : base;
}

/** 只接受站内相对路径，避免把返回参数变成开放重定向 */
export function sanitizeBackHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (trimmed.includes('://') || trimmed.includes('\\')) return null;
  return trimmed;
}
