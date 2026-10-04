import {createHash, createPublicKey, webcrypto} from 'node:crypto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SAFELINK_RSA_KEY} from '@config/safelink';
import {discoverServer, discoverServerPublicKey, getServerDiscoveryUrl, parseServerPublicKey} from '@lib/mtproto/safelinkServerDiscovery';

function descriptor() {
  const key = createPublicKey({key: {
    kty: 'RSA', n: Buffer.from(SAFELINK_RSA_KEY.modulus, 'hex').toString('base64url'), e: 'AQAB'
  }, format: 'jwk'});
  const der = key.export({type: 'pkcs1', format: 'der'});
  return {version: 1, server_id: createHash('sha256').update(der).digest('hex'),
    rsa_public_key: key.export({type: 'pkcs1', format: 'pem'}).toString()};
}

afterEach(() => vi.unstubAllGlobals());

describe('SafeLink RSA discovery', () => {
  it('uses only the configured WebSocket server origin', () => {
    expect(getServerDiscoveryUrl('/apiws', 'https://web.safelink.chat')).toBe('https://web.safelink.chat/.well-known/safelink-client.json');
    expect(getServerDiscoveryUrl('wss://other.example/apiws?token=secret', 'https://web.safelink.chat')).toBe('https://other.example/.well-known/safelink-client.json');
    expect(getServerDiscoveryUrl('/apiws', 'http://localhost:9047')).toBe('http://localhost:9047/.well-known/safelink-client.json');
    expect(() => getServerDiscoveryUrl('ws://other.example/apiws', 'https://web.safelink.chat')).toThrow();
  });

  it('parses the server PKCS#1 key through WebCrypto', async() => {
    vi.stubGlobal('crypto', webcrypto);
    expect(await parseServerPublicKey(descriptor())).toEqual(SAFELINK_RSA_KEY);
  });

  it('rejects mismatched identity and malformed key descriptors', async() => {
    vi.stubGlobal('crypto', webcrypto);
    await expect(parseServerPublicKey({...descriptor(), server_id: '0'.repeat(64)})).rejects.toThrow('identity');
    await expect(parseServerPublicKey({...descriptor(), rsa_public_key: 'bad key'})).rejects.toThrow();
    await expect(parseServerPublicKey({version: 2})).rejects.toThrow();
  });

  it('keeps the pinned key when discovery is unavailable', async() => {
    const fetchMock = vi.fn().mockResolvedValue({ok: false});
    vi.stubGlobal('fetch', fetchMock);
    expect(await discoverServerPublicKey('/apiws', 'https://web.safelink.chat')).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('https://web.safelink.chat/.well-known/safelink-client.json',
      expect.objectContaining({redirect: 'error', credentials: 'omit'}));
  });

  it('reads the name field without changing RSA discovery', async() => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, text: async() => JSON.stringify({...descriptor(), name: '  Server Name  '})}));
    expect(await discoverServer('/apiws', 'https://web.safelink.chat')).toEqual({publicKey: SAFELINK_RSA_KEY, name: 'Server Name'});
  });
});
