import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {normalizeAppName} from '@helpers/safelinkAppName';
import type {AppManagers} from '@lib/managers';

const mocks = vi.hoisted(() => ({
  listeners: {} as Record<string, (...args: any[]) => void>,
  account: 1,
  discoverServer: vi.fn()
}));

vi.mock('@lib/rootScope', () => ({default: {
  addEventListener: (event: string, listener: (...args: any[]) => void) => mocks.listeners[event] = listener
}}));
vi.mock('@lib/accounts/getCurrentAccount', () => ({getCurrentAccount: () => mocks.account}));
vi.mock('@lib/mtproto/safelinkServerDiscovery', () => ({
  discoverServer: mocks.discoverServer,
  getServerDiscoveryUrl: (ws: string, origin: string) => new URL('/.well-known/safelink-client.json', new URL(ws, origin)).href
}));

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((r) => resolve = r);
  return {promise, resolve};
}

const server = 'https://one.example/.well-known/safelink-client.json';
const config = (name: unknown, origin = server) => ({safelink_app_name: name, safelink_server_origin: origin}) as MTAppConfig;
const managers = (getAppConfig: ReturnType<typeof vi.fn>) => ({apiManager: {getAppConfig}}) as unknown as AppManagers;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MTPROTO_WS_URL', 'https://one.example/apiws');
  mocks.account = 1;
  mocks.discoverServer.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe('SafeLink app name', () => {
  it.each([undefined, null, '', ' \n\t ', 5, {}])('defaults missing, blank and non-string values: %s', (value) => {
    expect(normalizeAppName(value)).toBe('SafeLink');
  });

  it('counts Unicode scalars after trimming, rather than UTF-16 units or graphemes', () => {
    expect(normalizeAppName('  \u4f01\u4e1a\u901a\u8baf  ')).toBe('\u4f01\u4e1a\u901a\u8baf');
    expect(normalizeAppName('x'.repeat(80))).toBe('x'.repeat(80));
    expect(normalizeAppName('x'.repeat(81))).toBe('SafeLink');
    expect(normalizeAppName(' ' + '\u{1f600}'.repeat(80) + ' ')).toBe('\u{1f600}'.repeat(80));
    expect(normalizeAppName('\u{1f600}'.repeat(81))).toBe('SafeLink');
    expect(normalizeAppName('e\u0301'.repeat(40))).toBe('e\u0301'.repeat(40));
    expect(normalizeAppName('e\u0301'.repeat(40) + 'e')).toBe('SafeLink');
  });

  it.each(['A\u0000B', 'A\nB', 'A\tB', 'A\u007fB', 'A\u0085B', 'A\u009fB', '\ud800', '\udfff', 'A\ud800B'])('rejects controls and invalid surrogates: %s', (value) => {
    expect(normalizeAppName(value)).toBe('SafeLink');
  });

  it('rejects every Unicode control scalar inside a name', () => {
    for(let scalar = 0; scalar <= 0x9f; ++scalar) {
      if(scalar > 0x1f && scalar < 0x7f) continue;
      expect(normalizeAppName('A' + String.fromCodePoint(scalar) + 'B')).toBe('SafeLink');
    }
  });

  it('matches server Unicode whitespace trimming and retains safe literal text', () => {
    expect(normalizeAppName('\u0085\u3000 Enterprise \u00a0\u0085')).toBe('Enterprise');
    expect(normalizeAppName('\ufeffEnterprise\ufeff')).toBe('\ufeffEnterprise\ufeff');
    expect(normalizeAppName('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });

  it('uses discovery before config, then gives appConfig authority including blank fallback', async() => {
    mocks.discoverServer.mockResolvedValue({name: 'Login Server'});
    const request = deferred<MTAppConfig>();
    const getAppConfig = vi.fn().mockReturnValue(request.promise);
    const {default: useAppName, initializeAppName} = await import('@stores/appName');
    initializeAppName(undefined, managers(getAppConfig));
    await Promise.resolve();
    expect(useAppName()()).toBe('Login Server');
    expect(getAppConfig).toHaveBeenCalledWith(true);
    request.resolve(config('  Current Server  '));
    await Promise.resolve();
    expect(useAppName()()).toBe('Current Server');
    mocks.listeners.app_config(config('Online Rename'));
    expect(useAppName()()).toBe('Online Rename');
    mocks.listeners.app_config(config(' '));
    expect(useAppName()()).toBe('SafeLink');
    mocks.listeners.app_config(config('x'.repeat(81)));
    expect(useAppName()()).toBe('SafeLink');
    mocks.listeners.app_config(config('Invalid\u0000Name'));
    expect(useAppName()()).toBe('SafeLink');
  });

  it('validates cached account names before rendering', async() => {
    const {default: useAppName, initializeAppName} = await import('@stores/appName');
    initializeAppName(config('\ud800'), managers(vi.fn().mockReturnValue(new Promise(() => {}))));
    expect(useAppName()()).toBe('SafeLink');
  });

  it('does not let a late discovery response override current config', async() => {
    const discovery = deferred<{name: string}>();
    mocks.discoverServer.mockReturnValue(discovery.promise);
    const {default: useAppName, initializeAppName} = await import('@stores/appName');
    initializeAppName(config('Cached Current Server'), managers(vi.fn().mockResolvedValue(config('Fresh Server'))));
    await Promise.resolve();
    discovery.resolve({name: 'Stale Discovery'});
    await Promise.resolve();
    expect(useAppName()()).toBe('Fresh Server');
  });

  it('ignores another server cache and events', async() => {
    const request = deferred<MTAppConfig>();
    const {default: useAppName, initializeAppName} = await import('@stores/appName');
    initializeAppName(config('Wrong Server', 'https://two.example/'), managers(vi.fn().mockReturnValue(request.promise)));
    expect(useAppName()()).toBe('SafeLink');
    mocks.listeners.app_config(config('Another Server', 'https://two.example/'));
    expect(useAppName()()).toBe('SafeLink');
    request.resolve(config('This Server'));
    await Promise.resolve();
    expect(useAppName()()).toBe('This Server');
  });

  it('resets on account switch and rejects late responses from the previous account', async() => {
    const oldRequest = deferred<MTAppConfig>();
    const newRequest = deferred<MTAppConfig>();
    const {default: useAppName, initializeAppName} = await import('@stores/appName');
    initializeAppName(config('Account One'), managers(vi.fn().mockReturnValue(oldRequest.promise)));
    expect(useAppName()()).toBe('Account One');
    mocks.account = 2;
    initializeAppName(undefined, managers(vi.fn().mockReturnValue(newRequest.promise)));
    expect(useAppName()()).toBe('SafeLink');
    newRequest.resolve(config('Account Two'));
    await Promise.resolve();
    oldRequest.resolve(config('Late Account One'));
    await Promise.resolve();
    expect(useAppName()()).toBe('Account Two');
  });
});
