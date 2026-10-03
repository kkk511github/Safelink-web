export const WEB_AUTH_TOKEN_UNSUPPORTED = 'AUTH_WEB_TOKEN_UNSUPPORTED';

export function prependLoginToken(tokens: string[], token: Uint8Array): string[] {
  if(token?.length !== 32) return tokens;
  const encoded = Array.from(token, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [encoded, ...tokens.filter((value) => value !== encoded)].slice(0, 20);
}

export function decodeLoginTokens(tokens: string[]): Uint8Array[] {
  return (tokens || []).filter((value) => /^[0-9a-f]{64}$/i.test(value)).slice(0, 20)
  .map((value) => Uint8Array.from(value.match(/../g), (byte) => parseInt(byte, 16)));
}

export function registrationCodeHash(hash: string, invite: string): string {
  const value = invite.trim();
  return value ? hash + ':safelink-invite:' + value : hash;
}

export function waitForLogout(request: Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    request.catch((): void => undefined).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function loginRequestWithDeadline<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('SafeLink connection timed out'), {type: 'CONNECTION_TIMEOUT'})), timeoutMs);
    request.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
