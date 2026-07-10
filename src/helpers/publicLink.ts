import rootScope from '@lib/rootScope';

export const DEFAULT_PUBLIC_LINK_PREFIX = 'https://safelink.chat/';

export function normalizePublicLinkPrefix(prefix?: string) {
  const normalized = prefix?.trim() || DEFAULT_PUBLIC_LINK_PREFIX;
  return normalized.endsWith('/') ? normalized : normalized + '/';
}

export function buildPublicLink(path: string, prefix?: string) {
  return normalizePublicLinkPrefix(prefix) + path.replace(/^\/+/, '');
}

export function publicLinkDisplayText(url: string) {
  return url.replace(/^https?:\/\//i, '');
}

export async function getPublicLinkPrefix() {
  try {
    const config = await Promise.resolve(rootScope.managers.apiManager.getConfig());
    return normalizePublicLinkPrefix(config.me_url_prefix);
  } catch{
    return DEFAULT_PUBLIC_LINK_PREFIX;
  }
}
