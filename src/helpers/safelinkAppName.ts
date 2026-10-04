export const DEFAULT_APP_NAME = 'SafeLink';

export function normalizeAppName(value: unknown): string {
  if(typeof value !== 'string') return DEFAULT_APP_NAME;
  const name = value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
  if(!name || Array.from(name).length > 80 || /[\p{Cc}\p{Cs}]/u.test(name)) return DEFAULT_APP_NAME;
  return name;
}
