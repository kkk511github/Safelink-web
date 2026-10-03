import {readFileSync} from 'fs';
import {resolve} from 'path';

type WebManifest = {
  id: string,
  start_url: string,
  scope: string,
  scope_extensions: Array<{
    type: string,
    origin: string
  }>
};

const EXPECTED_MANIFEST_ID = 'https://web.safelink.chat/';

const manifests = [
  'site.webmanifest',
  'site_apple.webmanifest'
].map((fileName) => ({
  fileName,
  manifest: JSON.parse(readFileSync(resolve(__dirname, '../../public', fileName), 'utf8')) as WebManifest
}));

describe('PWA web manifests', () => {
  test.each(manifests)('$fileName has a stable SafeLink identity without Telegram link scopes', ({manifest}) => {
    expect(manifest.id).toBe('./');
    expect(new URL(manifest.id, 'https://web.safelink.chat/').href).toBe(EXPECTED_MANIFEST_ID);
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.scope_extensions).toBeUndefined();
  });

  test('desktop variants keep the same scope extensions', () => {
    expect(manifests[0].manifest.scope_extensions).toEqual(manifests[1].manifest.scope_extensions);
  });
});
