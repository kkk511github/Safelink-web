import bytesToHex from '@helpers/bytes/bytesToHex';
import base64ToBytes from '@helpers/string/base64ToBytes';
import selfHostedWebSocketUrl from '@lib/mtproto/selfHostedWebSocketUrl';
import type {RSAPublicKeyHex} from '@lib/mtproto/rsaKeysManager';

export function getServerDiscoveryUrl(wsUrl: string, origin: string) {
  const url = new URL(selfHostedWebSocketUrl(wsUrl, origin));
  if(url.username || url.password || (url.protocol !== 'wss:' &&
    !(url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('SafeLink discovery requires a secure server origin');
  }
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/.well-known/safelink-client.json';
  url.search = url.hash = '';
  return url.href;
}

export async function parseServerPublicKey(value: unknown): Promise<RSAPublicKeyHex> {
  const descriptor = value as {version?: number, server_id?: string, rsa_public_key?: string};
  if(descriptor?.version !== 1 || !/^[a-f0-9]{64}$/.test(descriptor.server_id ?? '') ||
    typeof descriptor.rsa_public_key !== 'string' || descriptor.rsa_public_key.length > 1024) {
    throw new Error('Invalid SafeLink discovery descriptor');
  }
  const pem = descriptor.rsa_public_key.trim().match(/^-----BEGIN RSA PUBLIC KEY-----\s+([A-Za-z0-9+/=\s]+)\s+-----END RSA PUBLIC KEY-----$/);
  if(!pem) throw new Error('Invalid SafeLink RSA public key');
  const der = base64ToBytes(pem[1].replace(/\s/g, ''));
  if(der.length !== 270) throw new Error('SafeLink discovery requires RSA-2048');
  const id = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', der)));
  if(id !== descriptor.server_id) throw new Error('SafeLink server identity does not match its key');

  // Wrap the server's fixed RSA-2048 PKCS#1 DER in SPKI, then let WebCrypto parse it.
  const prefix = new Uint8Array([48, 130, 1, 34, 48, 13, 6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 1, 5, 0, 3, 130, 1, 15, 0]);
  const spki = new Uint8Array(prefix.length + der.length);
  spki.set(prefix);
  spki.set(der, prefix.length);
  const key = await crypto.subtle.importKey('spki', spki, {name: 'RSA-OAEP', hash: 'SHA-256'}, true, ['encrypt']);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  const modulus = base64ToBytes(jwk.n);
  const exponent = bytesToHex(base64ToBytes(jwk.e));
  if(modulus.length !== 256 || exponent !== '010001') throw new Error('Invalid SafeLink RSA parameters');
  return {modulus: bytesToHex(modulus), exponent};
}

export async function discoverServerPublicKey(wsUrl: string, origin: string): Promise<RSAPublicKeyHex | undefined> {
  try {
    const response = await fetch(getServerDiscoveryUrl(wsUrl, origin), {
      signal: AbortSignal.timeout(5000), redirect: 'error', credentials: 'omit', cache: 'no-store'
    });
    if(!response.ok) return;
    const body = await response.text();
    if(body.length > 4096) throw new Error('SafeLink discovery descriptor is too large');
    return await parseServerPublicKey(JSON.parse(body));
  } catch{
    // Older servers may not publish discovery; only the pinned SafeLink key remains.
    return;
  }
}
