import {webcrypto} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({reload: vi.fn(), get: vi.fn(), premium: vi.fn(), handoff: vi.fn(), passcode: vi.fn(), metadata: vi.fn()}));
vi.mock('@components/appNavigationController', () => ({default: {reload: mocks.reload}}));
vi.mock('@lib/apiManagerProxy', () => ({default: {hasSomeonePremium: mocks.premium}}));
vi.mock('@lib/accounts/accountController', () => ({default: {get: mocks.get}}));
vi.mock('@lib/accounts/getCurrentAccount', () => ({getCurrentAccount: () => 1}));
vi.mock('@lib/passcode/keyHandoff', () => ({saveEncryptionKeyForHandoff: mocks.handoff}));
vi.mock('@lib/passcode/deferredIsUsingPasscode', () => ({default: {isUsingPasscode: mocks.passcode}}));
vi.mock('@lib/sessionStorage', () => ({default: {set: mocks.metadata}}));

import {addServerAccount, getLoginReturnTarget, serverAccountURL, switchServerAccount} from '@lib/accounts/serverNavigation';
import {createServerProfile, removeServerProfile, saveServerProfile, serverFingerprint} from '@lib/accounts/serverProfiles';
import {SAFELINK_RSA_KEY} from '@config/safelink';
import {getServerStoragePrefix} from '@config/safelinkServer';

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); history.replaceState(null, '', '/');
  vi.stubGlobal('crypto', webcrypto); vi.stubEnv('VITE_MTPROTO_WS_URL', '/apiws');
  vi.stubGlobal('indexedDB', {databases: async(): Promise<IDBDatabaseInfo[]> => []});
  mocks.get.mockImplementation(async(number: number) => number === 1 ? {userId: 123, dc2_auth_key: 'original-auth'} : {});
  mocks.premium.mockResolvedValue(false); mocks.passcode.mockResolvedValue(false);
});
afterEach(() => {localStorage.clear(); history.replaceState(null, '', '/'); vi.unstubAllGlobals(); vi.unstubAllEnvs();});

describe('SafeLink account login cancellation', () => {
  it('adds into an empty slot and carries the existing active account through every auth stage without writing its state', async() => {
    const before = {...localStorage};
    await addServerAccount('primary');
    const url = mocks.reload.mock.calls[0][0] as URL;
    expect(url.searchParams.get('account')).toBe('2');
    expect(getLoginReturnTarget(url.href)).toEqual({serverId: 'primary', accountNumber: 1});
    expect({...localStorage}).toEqual(before);
    const returned = serverAccountURL(getLoginReturnTarget(url.href));
    expect(returned.searchParams.has('account')).toBe(false);
    expect(returned.searchParams.has('returnAccount')).toBe(false);
  });

  it('can return from another server account 1 and keeps the original return target when changing login servers', async() => {
    const server = await createServerProfile('wss://team.example/apiws', {name: 'Team', publicKey: SAFELINK_RSA_KEY, fingerprint: serverFingerprint(SAFELINK_RSA_KEY)});
    saveServerProfile(server);
    history.replaceState(null, '', '/?returnServer=primary&returnAccount=1');
    await addServerAccount(server.id);
    const url = mocks.reload.mock.calls[0][0] as URL;
    expect(url.searchParams.get('server')).toBe(server.id);
    expect(url.searchParams.get('safelinkAddAccount')).toBe('1');
    expect(url.searchParams.has('account')).toBe(false);
    expect(getLoginReturnTarget(url.href)).toEqual({serverId: 'primary', accountNumber: 1});
    expect(localStorage.getItem(getServerStoragePrefix(server) + 'account1')).toBeNull();
    localStorage.setItem(getServerStoragePrefix(server) + 'number_of_accounts', '1');
    const before = {...localStorage};
    await addServerAccount(server.id);
    expect((mocks.reload.mock.calls[1][0] as URL).searchParams.get('safelinkAddAccount')).toBe('1');
    expect({...localStorage}).toEqual(before);
  });

  it('does not navigate after a selector is closed during an async operation', async() => {
    await addServerAccount('primary', false, () => false);
    expect(mocks.reload).not.toHaveBeenCalled();
    await switchServerAccount({serverId: 'primary', accountNumber: 1}, false, undefined, () => false);
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it('preserves existing free and maximum account limits across servers', async() => {
    mocks.get.mockResolvedValue({userId: 123});
    await expect(addServerAccount('primary')).rejects.toThrow('上限');
    mocks.get.mockImplementation(async(number: number) => number <= 3 ? {userId: number} : {});
    await expect(addServerAccount('primary')).rejects.toThrow('上限');
    mocks.premium.mockResolvedValue(true);
    await addServerAccount('primary');
    expect((mocks.reload.mock.calls[0][0] as URL).searchParams.get('account')).toBe('4');
  });

  it('blocks local allocation when a foreign opaque namespace has an unknown quota', async() => {
    const server = await createServerProfile('wss://opaque.example/apiws', {name: 'Opaque', publicKey: SAFELINK_RSA_KEY, fingerprint: serverFingerprint(SAFELINK_RSA_KEY)});
    saveServerProfile(server);
    localStorage.setItem(getServerStoragePrefix(server) + 'account4', 'opaque record');
    await expect(addServerAccount('primary')).rejects.toThrow('数量');
    expect(mocks.reload).not.toHaveBeenCalled();
    await addServerAccount(server.id);
    expect((mocks.reload.mock.calls[0][0] as URL).searchParams.get('safelinkAddAccount')).toBe('1');
  });

  it('never reuses a slot when AccountController still returns an opaque record', async() => {
    mocks.get.mockImplementation(async(number: number) => number === 4 ? 'opaque record' : {});
    await expect(addServerAccount('primary')).rejects.toThrow('已解锁账号状态');
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it('can add on the original server and remove B after cancelling its known empty login', async() => {
    const server = await createServerProfile('wss://cancelled.example/apiws', {name: 'Cancelled', publicKey: SAFELINK_RSA_KEY, fingerprint: serverFingerprint(SAFELINK_RSA_KEY)});
    saveServerProfile(server);
    const prefix = getServerStoragePrefix(server);
    localStorage.setItem(prefix + 'account1', JSON.stringify({dc2_auth_key: 'pending-login-auth'}));
    localStorage.setItem(prefix + 'number_of_accounts', '0');
    vi.stubGlobal('indexedDB', {databases: async() => [{name: prefix + 'tweb-common'}, {name: prefix + 'tweb-account-1'}]});
    await addServerAccount('primary');
    expect((mocks.reload.mock.calls[0][0] as URL).searchParams.get('account')).toBe('2');
    await removeServerProfile(server);
    expect(localStorage.getItem(prefix + 'account1')).toContain('pending-login-auth');
  });

  it('refreshes only the existing non-sensitive zero count when returning from an empty unlocked login', async() => {
    mocks.get.mockResolvedValue({});
    await switchServerAccount({serverId: 'primary', accountNumber: 1});
    expect(mocks.metadata).toHaveBeenCalledWith({number_of_accounts: 0});
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it.each([[2, 4], [3, 4]])('allocates from real unlocked sparse slots %s only in the selected server', async(first, second) => {
    const server = await createServerProfile('wss://sparse.example/apiws', {name: 'Sparse', publicKey: SAFELINK_RSA_KEY, fingerprint: serverFingerprint(SAFELINK_RSA_KEY)});
    saveServerProfile(server);
    const prefix = getServerStoragePrefix(server);
    for(const number of [first, second]) localStorage.setItem(prefix + 'account' + number, JSON.stringify('opaque-encrypted-record'));
    localStorage.setItem(prefix + 'number_of_accounts', '2');
    history.replaceState(null, '', `/?server=${server.id}&returnServer=primary&returnAccount=1`);
    mocks.get.mockImplementation(async(number: number) => [first, second].includes(number) ? {userId: number} : {});
    const before = {...localStorage};
    vi.resetModules();
    const navigation = await import('@lib/accounts/serverNavigation');
    await navigation.addServerAccount(server.id);
    const url = mocks.reload.mock.calls[0][0] as URL;
    expect(url.searchParams.has('account')).toBe(false);
    expect(url.searchParams.has('safelinkAddAccount')).toBe(false);
    expect(url.searchParams.get('returnServer')).toBe('primary');
    expect({...localStorage}).toEqual(before);
  });

  it('rejects unregistered return servers and invalid slots, and uses passcode handoff only before same-tab navigation', async() => {
    expect(getLoginReturnTarget('https://web.example/?returnServer=unknown&returnAccount=1')).toBeUndefined();
    expect(getLoginReturnTarget('https://web.example/?returnServer=primary&returnAccount=5')).toBeUndefined();
    localStorage.setItem('safelink-server-profiles-v1', 'invalid JSON');
    expect(getLoginReturnTarget('https://web.example/?returnServer=unknown&returnAccount=1')).toBeUndefined();
    expect(getLoginReturnTarget('https://web.example/?returnServer=primary&returnAccount=1')).toEqual({serverId: 'primary', accountNumber: 1});
    mocks.passcode.mockResolvedValue(true);
    await switchServerAccount({serverId: 'primary', accountNumber: 2});
    expect(mocks.handoff).toHaveBeenCalledOnce();
  });
});
