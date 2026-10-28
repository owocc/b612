import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

const PROXIED_MEDIA_HOSTS = [
  'vercel-storage.com',
  'blob.vercel-storage.com',
  '.private.blob.vercel-storage.com',
  'public.blob.vercel-storage.com',
];

function needsAuthenticatedProxy(url: string): boolean {
  if (PROXIED_MEDIA_HOSTS.some((host) => url.includes(host))) return true;
  // Uploaded assets may also be served from a custom blob domain configured via env.
  const blobHost = process.env.NEXT_PUBLIC_BLOB_HOST;
  return Boolean(blobHost && url.includes(blobHost));
}

/**
 * Resolve any media reference into a browser-safe URL.
 *
 * - `data:` / `blob:` / same-origin `/...` URLs are returned untouched.
 * - An `assetId` always takes precedence and uses the ownership-checked proxy
 *   (`/api/media/file?id=...`).
 * - Private/public Vercel Blob URLs go through the authenticated proxy
 *   (`/api/media/file?url=...`) so the BLOB_READ_WRITE_TOKEN never reaches the browser.
 *
 * Business code should never build proxy URLs by hand — render `SafeImage` instead.
 */
export function resolveMediaUrl(
  url: string | null | undefined,
  assetId?: string | null,
): string | null {
  if (assetId) return `/api/media/file?id=${encodeURIComponent(assetId)}`;
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('/api/') ||
    trimmed.startsWith('/')
  ) {
    return trimmed;
  }
  if (needsAuthenticatedProxy(trimmed)) {
    return `/api/media/file?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}
