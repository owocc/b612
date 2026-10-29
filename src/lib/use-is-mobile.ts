'use client';

import { useSyncExternalStore } from 'react';
import { CHARACTER_MOBILE_MEDIA_QUERY } from '@/lib/character-routes';

function subscribe(callback: () => void) {
  const mq = window.matchMedia(CHARACTER_MOBILE_MEDIA_QUERY);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function getSnapshot() {
  return window.matchMedia(CHARACTER_MOBILE_MEDIA_QUERY).matches;
}

// SSR / 首帧按桌面处理，挂载后立即纠正，避免与服务端输出不一致
function getServerSnapshot() {
  return false;
}

/**
 * 手机端判定（< 768px），与服务端渲染无关，可在事件回调里安全读取。
 * 首帧可能短暂为 false，因此纯 CSS 的移动端兜底（如隐藏抽屉）仍需保留。
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
