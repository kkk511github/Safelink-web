import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import serverFingerprint from '@helpers/safelinkServerFingerprint';

const mocks = vi.hoisted(() => ({discovery: vi.fn(), sha1: vi.fn(), deleteLegacy: vi.fn()}));
vi.mock('@lib/mtproto/safelinkServerDiscovery', () => ({discoverServerPublicKey: mocks.discovery}));
vi.mock('@lib/crypto/cryptoMessagePort', () => ({default: {invokeCrypto: mocks.sha1}}));
vi.mock('@lib/sessionStorage', () => ({default: {delete: mocks.deleteLegacy}}));
vi.mock('@lib/mainWorker/mainMessagePort', () => ({default: {}}));
vi.mock('@lib/passcode/keyStore', () => ({default: {}}));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); window.sessionStorage.clear();
  history.replaceState(null, '', '/');
  vi.stubEnv('VITE_MTPROTO_WS_URL', '/apiws');
  mocks.sha1.mockResolvedValue(new Uint8Array(20));
  mocks.deleteLegacy.mockResolvedValue(undefined);
});
afterEach(() => {localStorage.clear(); window.sessionStorage.clear(); history.replaceState(null, '', '/'); vi.unstubAllEnvs();});

async function selectServer() {
  const {SAFELINK_RSA_KEY} = await import('@config/safelink');
  const endpoint = 'wss://team.example/apiws';
  const server = {id: createHash('sha256').update(endpoint).digest('hex'), name: 'Team', endpoint, fingerprint: serverFingerprint(SAFELINK_RSA_KEY), publicKey: SAFELINK_RSA_KEY};
  localStorage.setItem('safelink-server-profiles-v1', JSON.stringify([server]));
  history.replaceState(null, '', `/?server=${server.id}&account=2&returnServer=primary&returnAccount=1&safelinkWorkerServer=untrusted`);
  vi.resetModules();
  return server;
}

describe('SafeLink selected worker and tab isolation', () => {
  it('retains primary workers while excluding account and login-return parameters', async() => {
    history.replaceState(null, '', '/?debug=1&account=2&returnServer=primary&returnAccount=1&safelinkWorkerServer=untrusted&safelinkAddAccount=1');
    const {makeWorkerURL} = await import('@helpers/setWorkerProxy');
    const url = makeWorkerURL('/worker.js');
    expect(url.searchParams.get('debug')).toBe('1');
    for(const name of ['account', 'returnServer', 'returnAccount', 'safelinkWorkerServer', 'safelinkAddAccount']) expect(url.searchParams.has(name)).toBe(false);
  });

  it('gives each selected server a fixed worker URL and confirmed snapshot, ignoring URL-supplied key data', async() => {
    const server = await selectServer();
    const {makeWorkerURL} = await import('@helpers/setWorkerProxy');
    const url = makeWorkerURL('/worker.js');
    expect(url.searchParams.get('server')).toBe(server.id);
    expect(JSON.parse(url.searchParams.get('safelinkWorkerServer'))).toEqual(server);
    expect(url.searchParams.has('returnAccount')).toBe(false);
    expect(makeWorkerURL('blob:http://localhost/fixture').href).toBe('blob:http://localhost/fixture');
    const {default: App} = await import('@config/app');
    const {unversionedMainBroadcastChannelName} = await import('@config/broadcastChannel');
    expect(App.interclientBroadcastChannel).toBe(`tgweb-${server.id}`);
    expect(unversionedMainBroadcastChannelName).toBe(`webk-main-broadcast-channel-${server.id}`);
  });

  it('uses only a custom server confirmed RSA key and never replaces it by automatic discovery', async() => {
    const server = await selectServer();
    mocks.discovery.mockResolvedValue({modulus: 'f'.repeat(512), exponent: '010001'});
    const {RSAKeysManager} = await import('@lib/mtproto/rsaKeysManager');
    const manager = new RSAKeysManager();
    await manager.prepare();
    expect(mocks.discovery).not.toHaveBeenCalled();
    expect(await manager.select(['0'])).toMatchObject(server.publicKey);
  });

  it('cannot consume a different server passcode handoff during navigation', async() => {
    await selectServer();
    const {writeEncryptionKeyHandoff, takeEncryptionKeyHandoff} = await import('@lib/passcode/keyHandoff');
    window.sessionStorage.setItem('safelink-5cc5b7bffe3c4275-encryption_key_handoff', 'primary-key');
    expect(takeEncryptionKeyHandoff()).toBeNull();
    writeEncryptionKeyHandoff('custom-key');
    expect(takeEncryptionKeyHandoff()).toBe('custom-key');
    expect(takeEncryptionKeyHandoff()).toBeNull();
    expect(window.sessionStorage.getItem('safelink-5cc5b7bffe3c4275-encryption_key_handoff')).toBe('primary-key');
  });

  it.each(['missing', 'corrupt', 'pin mismatch'])('exposes a recoverable %s selection error without any primary namespace fallback', async(kind) => {
    const server = await selectServer();
    if(kind === 'missing') localStorage.removeItem('safelink-server-profiles-v1');
    if(kind === 'corrupt') localStorage.setItem('safelink-server-profiles-v1', 'invalid JSON');
    if(kind === 'pin mismatch') localStorage.setItem('safelink-server-profiles-v1', JSON.stringify([{...server, fingerprint: '0'.repeat(64)}]));
    vi.resetModules();
    const config = await import('@config/safelinkServer');
    expect(config.serverSelectionError).toBeInstanceOf(Error);
    expect(config.selectedServer).toBeUndefined();
    expect(config.currentServerId).toBe('invalid');
    expect(() => config.getSafeLinkWebSocketUrl()).toThrow();
    expect(() => config.getServerStoragePrefix()).toThrow();
  });
});
