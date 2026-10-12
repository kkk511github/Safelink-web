import {webcrypto} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {getServerStoragePrefix, MAX_SERVER_PROFILES, normalizeServerAddress, PRIMARY_SERVER_ID, readServerProfiles, resolveServer, SERVER_PROFILES_KEY, validateServer} from '@config/safelinkServer';
import {SAFELINK_RSA_KEY} from '@config/safelink';
import {canRemoveServer, createServerProfile, getAvailableAccountSlot, getStoredServerAccounts, getStoredServerAccountState, groupServerAccounts, removeServerProfile, saveServerProfile, serverFingerprint} from '@lib/accounts/serverProfiles';

beforeEach(() => {localStorage.clear(); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('indexedDB', {databases: async(): Promise<IDBDatabaseInfo[]> => []}); vi.stubEnv('VITE_MTPROTO_WS_URL', '/apiws');});
afterEach(() => {localStorage.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs();});

async function profile(endpoint = 'wss://other.example/apiws') {
  return createServerProfile(endpoint, {name: '团队服务器', fingerprint: serverFingerprint(SAFELINK_RSA_KEY), publicKey: SAFELINK_RSA_KEY});
}

describe('SafeLink server/account isolation and navigation model', () => {
  it('normalizes address-first input without accepting insecure transport or embedded credentials', () => {
    expect(normalizeServerAddress('other.example')).toBe('wss://other.example/apiws');
    expect(normalizeServerAddress('https://other.example/custom')).toBe('wss://other.example/custom');
    for(const value of ['http://other.example', 'ws://other.example', 'https://u:p@other.example', 'https://other.example/?token=x']) {
      expect(() => normalizeServerAddress(value)).toThrow();
    }
  });

  it('keeps legacy primary storage and separates servers even when their public key is the same', async() => {
    const first = await profile();
    const second = await profile('wss://second.example/apiws');
    expect(getServerStoragePrefix()).toBe('safelink-5cc5b7bffe3c4275-');
    expect(getServerStoragePrefix(first)).not.toBe(getServerStoragePrefix(second));
    expect(getServerStoragePrefix(first)).not.toBe(getServerStoragePrefix());
  });

  it('resolves window selection only from confirmed local profiles and worker selection from its matching snapshot', async() => {
    const server = await profile();
    const url = new URL(`https://web.example/?server=${server.id}`);
    expect(() => resolveServer(url.href, localStorage)).toThrow();
    saveServerProfile(server);
    expect(resolveServer(url.href, localStorage)).toEqual(server);
    expect(() => resolveServer(url.href)).toThrow();
    url.searchParams.set('safelinkWorkerServer', JSON.stringify(server));
    expect(resolveServer(url.href)).toEqual(server);
    url.searchParams.set('server', 'b'.repeat(64));
    expect(() => resolveServer(url.href)).toThrow('不匹配');
  });

  it('cannot replace a saved pin by rediscovery at the same endpoint', async() => {
    const server = await profile();
    saveServerProfile(server);
    expect(() => saveServerProfile({...server, fingerprint: 'b'.repeat(64)})).toThrow('指纹');
    expect(readServerProfiles(localStorage)).toEqual([server]);
  });

  it('rejects duplicate, oversized and inconsistent registry records before selection', async() => {
    const server = await profile();
    expect(() => validateServer({...server, fingerprint: '0'.repeat(64)})).toThrow('指纹');
    expect(() => validateServer({...server, id: '0'.repeat(64)})).toThrow();
    localStorage.setItem(SERVER_PROFILES_KEY, JSON.stringify([server, server]));
    expect(() => readServerProfiles(localStorage)).toThrow('重复');
    localStorage.setItem(SERVER_PROFILES_KEY, JSON.stringify(Array(MAX_SERVER_PROFILES + 1).fill(server)));
    expect(() => readServerProfiles(localStorage)).toThrow('上限');
    localStorage.setItem(SERVER_PROFILES_KEY, ' '.repeat(65537));
    expect(() => readServerProfiles(localStorage)).toThrow('过大');
  });

  it('groups duplicate account numbers by their server and chooses only an unused slot', async() => {
    const first = await profile();
    const second = await profile('wss://second.example/apiws');
    const accounts = [{serverId: first.id, accountNumber: 1 as const}, {serverId: second.id, accountNumber: 1 as const}];
    expect(groupServerAccounts([first, second], accounts).map((group) => group.accounts)).toEqual([[accounts[0]], [accounts[1]]]);
    expect(getAvailableAccountSlot(accounts)).toBe(2);
    expect(getAvailableAccountSlot([1, 2, 3, 4].map((accountNumber) => ({accountNumber: accountNumber as 1 | 2 | 3 | 4})))).toBeUndefined();
  });

  it('protects primary/current/used servers, including encrypted account counts and noncontiguous slots', async() => {
    const server = await profile();
    saveServerProfile(server);
    expect(canRemoveServer(PRIMARY_SERVER_ID, [], server.id)).toBe(false);
    expect(canRemoveServer(server.id, [], server.id)).toBe(false);
    const prefix = getServerStoragePrefix(server);
    localStorage.setItem(prefix + 'number_of_accounts', '2');
    localStorage.setItem(prefix + 'account4', JSON.stringify({userId: 123, dc2_auth_key: 'keep-this-auth'}));
    const accounts = getStoredServerAccounts(server);
    expect(accounts).toHaveLength(1);
    expect(accounts.some((account) => account.accountNumber === 4)).toBe(true);
    expect(canRemoveServer(server.id, accounts)).toBe(false);
    expect(await getStoredServerAccountState(server)).toMatchObject({count: 2, locked: true});
    await expect(removeServerProfile(server)).rejects.toThrow();
    expect(JSON.parse(localStorage.getItem(prefix + 'account4')).dc2_auth_key).toBe('keep-this-auth');
  });

  it('removes only an unused bookmark, never the namespace or another server', async() => {
    const first = await profile();
    const second = await profile('wss://second.example/apiws');
    saveServerProfile(first); saveServerProfile(second);
    const key = getServerStoragePrefix(first) + 'account1';
    localStorage.setItem(key, JSON.stringify({dc2_auth_key: 'pending-login-auth'}));
    await removeServerProfile(first);
    expect(readServerProfiles(localStorage)).toEqual([second]);
    expect(localStorage.getItem(key)).toContain('pending-login-auth');
    localStorage.setItem(SERVER_PROFILES_KEY, 'invalid');
    expect(() => readServerProfiles(localStorage)).toThrow();
  });

  it.each([[2, 4], [3, 4]])('never reconstructs encrypted sparse slots %s from a count', async(first, second) => {
    const server = await profile();
    saveServerProfile(server);
    const prefix = getServerStoragePrefix(server);
    for(const number of [first, second]) localStorage.setItem(prefix + 'account' + number, JSON.stringify('opaque-encrypted-record'));
    localStorage.setItem(prefix + 'number_of_accounts', '2');
    expect(getStoredServerAccounts(server)).toEqual([]);
    expect(await getStoredServerAccountState(server)).toMatchObject({accounts: [], count: 2, locked: true});
    await expect(removeServerProfile(server)).rejects.toThrow();
    localStorage.removeItem(prefix + 'number_of_accounts');
    expect((await getStoredServerAccountState(server)).count).toBeUndefined();
    localStorage.setItem(prefix + 'number_of_accounts', '0');
    expect((await getStoredServerAccountState(server)).count).toBeUndefined();
  });

  it('does not count an initialized namespace with missing metadata as empty', async() => {
    const server = await profile();
    vi.stubGlobal('indexedDB', {databases: async() => [{name: getServerStoragePrefix(server) + 'tweb-common'}]});
    expect((await getStoredServerAccountState(server)).count).toBeUndefined();
    await expect(removeServerProfile(server)).rejects.toThrow();
  });

  it('retains an authoritative plaintext zero despite existing databases', async() => {
    const server = await profile();
    const prefix = getServerStoragePrefix(server);
    localStorage.setItem(prefix + 'number_of_accounts', '0');
    localStorage.setItem(prefix + 'account1', JSON.stringify({dc2_auth_key: 'pending-login-auth'}));
    vi.stubGlobal('indexedDB', {databases: async() => [{name: prefix + 'tweb-common'}]});
    expect(await getStoredServerAccountState(server)).toMatchObject({accounts: [], count: 0, locked: false});
    localStorage.setItem(prefix + 'account1', JSON.stringify({encrypted: 'opaque'}));
    expect(await getStoredServerAccountState(server)).toMatchObject({count: undefined, locked: true});
  });
});
