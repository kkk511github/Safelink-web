import {currentServerId, getServerStoragePrefix, MAX_SERVER_PROFILES, PRIMARY_SERVER_ID, readServerProfiles, SafeLinkServer, SERVER_PROFILES_KEY, validateServer} from '@config/safelinkServer';
import {SAFELINK_RSA_KEY} from '@config/safelink';
import selfHostedWebSocketUrl from '@lib/mtproto/selfHostedWebSocketUrl';
import {ActiveAccountNumber} from '@lib/accounts/types';
import bytesToHex from '@helpers/bytes/bytesToHex';
import type {User} from '@layer';
import {getCachedServerIdentity} from '@lib/mtproto/safelinkServerDiscovery';
import serverFingerprint from '@helpers/safelinkServerFingerprint';
export {default as serverFingerprint} from '@helpers/safelinkServerFingerprint';

export type ServerAccount = {accountNumber: ActiveAccountNumber, serverId: string, name?: string};
export const ACCOUNT_NUMBERS = [1, 2, 3, 4] as const;

export function isReadableAccountRecord(data: unknown): data is Record<string, unknown> {
  if(!data || typeof data !== 'object' || Array.isArray(data) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(data))) return false;
  return Object.keys(data).every((key) => ['userId', 'dcId', 'date', 'auth_key_fingerprint', 'push_key', 'push_key_fingerprint'].includes(key) ||
    /^dc[1-5]_(auth_key|server_salt)$/.test(key));
}

export function getAvailableAccountSlot(accounts: Pick<ServerAccount, 'accountNumber'>[]) {
  return ACCOUNT_NUMBERS.find((number) => !accounts.some((account) => account.accountNumber === number));
}

export async function getPrimaryServer(): Promise<SafeLinkServer> {
  const endpoint = selfHostedWebSocketUrl(import.meta.env.VITE_MTPROTO_WS_URL || '/apiws', location.origin);
  const identity = getCachedServerIdentity(endpoint, location.origin);
  return {id: PRIMARY_SERVER_ID, endpoint, name: identity?.name || 'SafeLink',
    fingerprint: identity?.fingerprint || await serverFingerprint(SAFELINK_RSA_KEY), publicKey: identity?.publicKey || SAFELINK_RSA_KEY};
}

export async function createServerProfile(endpoint: string, identity: Omit<SafeLinkServer, 'id' | 'endpoint'>): Promise<SafeLinkServer> {
  const id = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))));
  return validateServer({id, endpoint, ...identity});
}

export function saveServerProfile(server: SafeLinkServer, storage: Storage = localStorage) {
  const profiles = readServerProfiles(storage);
  const existing = profiles.find((profile) => profile.endpoint === server.endpoint || profile.id === server.id);
  if(existing && existing.fingerprint !== server.fingerprint) throw new Error('服务器指纹已改变，请联系管理员核验');
  if(!existing && profiles.length >= MAX_SERVER_PROFILES) throw new Error('服务器记录已达到上限');
  if(!existing) storage.setItem(SERVER_PROFILES_KEY, JSON.stringify([...profiles, validateServer(server)]));
  return existing || server;
}

function readStoredAccountRecords(server: Pick<SafeLinkServer, 'id'>, storage: Pick<Storage, 'getItem'>) {
  const prefix = getServerStoragePrefix(server.id === PRIMARY_SERVER_ID ? undefined : server);
  const accounts: ServerAccount[] = [];
  let opaque = false;
  for(const number of ACCOUNT_NUMBERS) {
    const raw = storage.getItem(`${prefix}account${number}`);
    if(raw === null) continue;
    try {
      const data = JSON.parse(raw);
      if(!isReadableAccountRecord(data)) {opaque = true; continue;}
      if(data.userId) accounts.push({serverId: server.id, accountNumber: number});
    } catch{opaque = true;}
  }
  return {accounts, opaque, prefix};
}

export function getStoredServerAccounts(server: Pick<SafeLinkServer, 'id'>, storage: Pick<Storage, 'getItem'> = localStorage): ServerAccount[] {
  return readStoredAccountRecords(server, storage).accounts;
}

export async function getStoredServerAccountState(server: Pick<SafeLinkServer, 'id'>, storage: Pick<Storage, 'getItem'> = localStorage) {
  const {accounts, opaque, prefix} = readStoredAccountRecords(server, storage);
  const rawCount = storage.getItem(prefix + 'number_of_accounts');
  let count: number | undefined;
  if(rawCount !== null) {
    try {
      const value = JSON.parse(rawCount);
      if(Number.isInteger(value) && value >= accounts.length && value >= 0 && value <= 4 && (!opaque || value > 0)) count = value;
    } catch{}
  } else if(!opaque) count = accounts.length;
  // Missing metadata in an initialized namespace is ambiguous; an authoritative plaintext zero is not.
  if(rawCount === null) {
    try {
      if(!indexedDB.databases || (await indexedDB.databases()).some((database) => database.name?.startsWith(prefix + 'tweb-'))) count = undefined;
    } catch{count = undefined;}
  }
  return {accounts, count, locked: opaque || count !== accounts.length};
}

export async function readCachedServerUser(server: SafeLinkServer, accountNumber: ActiveAccountNumber): Promise<User.user | undefined> {
  const prefix = getServerStoragePrefix(server.id === PRIMARY_SERVER_ID ? undefined : server);
  const account = JSON.parse(localStorage.getItem(`${prefix}account${accountNumber}`) || 'null');
  // Locked accounts keep identity and auth in encrypted stores. Do not try another server's key.
  if(!account?.userId || !indexedDB.databases) return;
  const name = `${prefix}tweb-account-${accountNumber}`;
  if(!(await indexedDB.databases()).some((database) => database.name === name)) return;
  return new Promise((resolve) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {request.transaction.abort(); resolve(undefined);};
    request.onerror = request.onblocked = () => resolve(undefined);
    request.onsuccess = () => {
      const db = request.result;
      if(!db.objectStoreNames.contains('users')) {db.close(); resolve(undefined); return;}
      const read = db.transaction('users', 'readonly').objectStore('users').get('' + account.userId);
      read.onsuccess = () => {db.close(); resolve(read.result?._ === 'user' ? read.result : undefined);};
      read.onerror = () => {db.close(); resolve(undefined);};
    };
  });
}

export function groupServerAccounts(servers: SafeLinkServer[], accounts: ServerAccount[]) {
  return servers.map((server) => ({server, accounts: accounts.filter((account) => account.serverId === server.id)}));
}

export function canRemoveServer(serverId: string, accounts: ServerAccount[], activeServerId = currentServerId) {
  return serverId !== PRIMARY_SERVER_ID && serverId !== activeServerId && !accounts.some((account) => account.serverId === serverId);
}

export async function removeServerProfile(server: SafeLinkServer, storage: Storage = localStorage) {
  const {accounts, count, locked} = await getStoredServerAccountState(server, storage);
  if(count !== 0 || locked || !canRemoveServer(server.id, accounts)) throw new Error('只能移除已确认未使用的非主服务器');
  const profiles = readServerProfiles(storage);
  storage.setItem(SERVER_PROFILES_KEY, JSON.stringify(profiles.filter((profile) => profile.id !== server.id)));
  // Keep the server's namespace intact; removing a bookmark must never log out or delete an account.
}
