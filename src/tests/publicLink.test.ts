import {describe, expect, test} from 'vitest';
import {
  buildPublicLink,
  DEFAULT_PUBLIC_LINK_PREFIX,
  normalizePublicLinkPrefix,
  publicLinkDisplayText
} from '@helpers/publicLink';

describe('public links', () => {
  test('uses SafeLink when the server prefix is missing', () => {
    expect(normalizePublicLinkPrefix()).toBe(DEFAULT_PUBLIC_LINK_PREFIX);
    expect(buildPublicLink('/alice')).toBe('https://safelink.chat/alice');
  });

  test('uses the server-provided prefix for copied links', () => {
    expect(buildPublicLink('/alice/12', 'https://links.example.test/root')).toBe(
      'https://links.example.test/root/alice/12'
    );
  });

  test('removes only the scheme from display text', () => {
    expect(publicLinkDisplayText('https://safelink.chat/alice')).toBe('safelink.chat/alice');
  });
});
