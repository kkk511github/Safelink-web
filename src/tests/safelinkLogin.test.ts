import {describe, expect, it, vi} from 'vitest';
import {decodeLoginTokens, prependLoginToken, registrationCodeHash, waitForLogout, loginRequestWithDeadline} from '@helpers/safelinkLogin';

describe('SafeLink remembered-device login tokens', () => {
  const token = new Uint8Array(32).fill(7);
  const encoded = '07'.repeat(32);
  it('round-trips a token without serializing byte-array objects', () => {
    expect(decodeLoginTokens(prependLoginToken([], token))).toEqual([token]);
  });
  it('moves a repeated token to the front without duplicates', () => {
    expect(prependLoginToken(['01'.repeat(32), encoded], token)).toEqual([encoded, '01'.repeat(32)]);
  });
  it('limits the saved and sent tokens to twenty', () => {
    const tokens = Array.from({length: 30}, (_, i) => i.toString(16).padStart(2, '0').repeat(32));
    expect(prependLoginToken(tokens, token)).toHaveLength(20);
    expect(decodeLoginTokens(tokens)).toHaveLength(20);
  });
  it('rejects malformed token values', () => {
    expect(decodeLoginTokens(['xyz', '00', 'g0'.repeat(32), encoded])).toEqual([token]);
    expect(prependLoginToken([], new Uint8Array(31))).toEqual([]);
    expect(decodeLoginTokens(undefined)).toEqual([]);
  });
});

describe('logout token persistence ordering', () => {
  it('waits for the request and token write before finishing logout', async() => {
    let finish: () => void;
    let completed = false;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const logout = waitForLogout(pending, 10000).then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    finish();
    await logout;
    expect(completed).toBe(true);
  });
  it('does not leave offline users stuck in logout', async() => {
    vi.useFakeTimers();
    try {
      const logout = waitForLogout(new Promise(() => undefined), 10000);
      await vi.advanceTimersByTimeAsync(10000);
      await expect(logout).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
  it('still completes local logout if the request fails', async() => {
    await expect(waitForLogout(Promise.reject(new Error('offline')), 10000)).resolves.toBeUndefined();
  });
});

describe('registration policy connection errors', () => {
  it('keeps real errors instead of treating them as a disabled policy', async() => {
    await expect(loginRequestWithDeadline(Promise.reject(new Error('offline')), 10000)).rejects.toThrow('offline');
  });
  it('returns a retryable timeout for an unreachable server', async() => {
    vi.useFakeTimers();
    try {
      const result = expect(loginRequestWithDeadline(new Promise(() => undefined), 10000)).rejects.toMatchObject({type: 'CONNECTION_TIMEOUT'});
      await vi.advanceTimersByTimeAsync(10000);
      await result;
    } finally { vi.useRealTimers(); }
  });
});

describe('SafeLink registration invitation', () => {
  it('preserves the original hash when an optional invite is omitted', () => {
    expect(registrationCodeHash('code:hash', '  ')).toBe('code:hash');
  });
  it('attaches a trimmed invite without modifying the original hash', () => {
    expect(registrationCodeHash('code:hash', '  Invite-123  ')).toBe('code:hash:safelink-invite:Invite-123');
  });
});
