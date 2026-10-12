import {normalizeAppName} from '@helpers/safelinkAppName';
import serverFingerprint from '@helpers/safelinkServerFingerprint';
import sha256 from '@cryptography/sha256';

export const SERVER_PROFILES_KEY = 'safelink-server-profiles-v1';
export const SERVER_QUERY_PARAM = 'server';
export const WORKER_SERVER_QUERY_PARAM = 'safelinkWorkerServer';
export const ADD_SERVER_ACCOUNT_QUERY_PARAM = 'safelinkAddAccount';
export const PRIMARY_SERVER_ID = 'primary';
export const PRIMARY_STORAGE_PREFIX = 'safelink-5cc5b7bffe3c4275-';
export const MAX_SERVER_PROFILES = 32;

export type SafeLinkServer = {
  id: string,
  name: string,
  endpoint: string,
  fingerprint: string,
  publicKey: {modulus: string, exponent: string}
};

export function normalizeServerAddress(address: string) {
  const url = new URL(address.includes('://') ? address : `https://${address}`);
  if(!['https:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('请输入 HTTPS 服务器地址，不包含凭据、查询参数或片段');
  }
  url.protocol = 'wss:';
  if(url.pathname === '/') url.pathname = '/apiws';
  return url.href;
}

export function validateServer(value: unknown): SafeLinkServer {
  const server = value as SafeLinkServer;
  if(!server || !/^[a-f0-9]{64}$/.test(server.id) || !/^[a-f0-9]{64}$/.test(server.fingerprint) ||
    !/^[a-f0-9]{512}$/.test(server.publicKey?.modulus) || server.publicKey.exponent !== '010001' ||
    typeof server.endpoint !== 'string' || server.endpoint.length > 2048 ||
    normalizeServerAddress(server.endpoint) !== server.endpoint || sha256(server.endpoint, 'hex') !== server.id ||
    serverFingerprint(server.publicKey) !== server.fingerprint) throw new Error('服务器记录或指纹无效');
  return {id: server.id, endpoint: server.endpoint, name: normalizeAppName(server.name), fingerprint: server.fingerprint,
    publicKey: {modulus: server.publicKey.modulus, exponent: server.publicKey.exponent}};
}

export function readServerProfiles(storage: Pick<Storage, 'getItem'>): SafeLinkServer[] {
  const raw = storage.getItem(SERVER_PROFILES_KEY) || '[]';
  if(raw.length > 65536) throw new Error('服务器列表过大');
  const values = JSON.parse(raw);
  if(!Array.isArray(values) || values.length > MAX_SERVER_PROFILES) throw new Error('服务器列表无效或超出记录上限');
  const profiles = values.map(validateServer);
  if(new Set(profiles.map((server) => server.id)).size !== profiles.length ||
    new Set(profiles.map((server) => server.endpoint)).size !== profiles.length) throw new Error('服务器列表包含重复记录');
  return profiles;
}

// Selection is immutable for this realm. Changing servers always reloads into its own worker/store.
export function resolveServer(url: string, storage?: Pick<Storage, 'getItem'>): SafeLinkServer | undefined {
  const params = new URL(url).searchParams;
  const id = params.get(SERVER_QUERY_PARAM);
  if(!id || id === PRIMARY_SERVER_ID) return;
  if(storage) {
    const server = readServerProfiles(storage).find((server) => server.id === id);
    if(!server) throw new Error('服务器不存在，请返回服务器列表');
    return server;
  }
  const server = validateServer(JSON.parse(params.get(WORKER_SERVER_QUERY_PARAM) || 'null'));
  if(server.id !== id) throw new Error('服务器上下文不匹配');
  return server;
}

export function getServerStoragePrefix(server?: Pick<SafeLinkServer, 'id'>) {
  if(serverSelectionError && !server) throw serverSelectionError;
  return server ? `safelink-server-${server.id}-` : (import.meta.env.VITE_MTPROTO_WS_URL ? PRIMARY_STORAGE_PREFIX : '');
}

export const serverSelection = (() => {
  try {return {server: resolveServer(location.href, typeof document === 'undefined' ? undefined : localStorage), error: undefined as Error};}
  catch(error) {return {server: undefined as SafeLinkServer, error: error instanceof SyntaxError ? new Error('服务器记录损坏，请返回服务器列表') :
    error instanceof Error ? error : new Error('无法读取服务器记录')};}
})();
export const serverSelectionError = serverSelection.error;
export const selectedServer = serverSelection.server;
export const currentServerId = serverSelectionError ? 'invalid' : selectedServer?.id || PRIMARY_SERVER_ID;
// An installed primary SW may control every page on this origin, but cannot route server accounts.
export const CAN_USE_PRIMARY_SERVICE_WORKER = !serverSelectionError && !selectedServer;
export const getSafeLinkWebSocketUrl = () => {
  if(serverSelectionError) throw serverSelectionError;
  return selectedServer?.endpoint || import.meta.env.VITE_MTPROTO_WS_URL;
};
