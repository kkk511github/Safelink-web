import {afterEach, describe, expect, test, vi} from 'vitest';
import wrapUrl from '../lib/richTextProcessor/wrapUrl';

describe('SafeLink invite URLs', () => {
  afterEach(() => {
    delete (window as any).tg_join;
  });

  test('dispatches SafeLink invites to the in-app join handler without rewriting the URL', () => {
    (window as any).tg_join = vi.fn();
    const url = 'safelink://join?invite=CNxZg8gdDwV1_yFWuCibDRLz';
    expect(wrapUrl(url)).toEqual({url, onclick: 'tg_join'});
    expect(new URL(url).searchParams.get('invite')).toBe('CNxZg8gdDwV1_yFWuCibDRLz');
  });

  test('does not treat an external URL containing a SafeLink link as an app link', () => {
    (window as any).tg_join = vi.fn();
    expect(wrapUrl('https://example.com/?url=safelink://join?invite=test').onclick).toBeUndefined();
  });

  test.each(['www.vochat.im', 'vochat.im', 'safelink.chat', 'www.safelink.chat'])('opens owned public username links in app: %s', (host) => {
    (window as any).im = vi.fn();
    expect(wrapUrl(`https://${host}/alice`).onclick).toBe('im');
    delete (window as any).im;
  });

  test.each(['www.vochat.im.evil.test', 'www.vochat.im@evil.test', 'alice.vochat.im'])('keeps lookalike hosts external: %s', (host) => {
    (window as any).im = vi.fn();
    expect(wrapUrl(`https://${host}/alice`).onclick).toBeUndefined();
    delete (window as any).im;
  });

  test('retains internal Telegram protocol compatibility', () => {
    (window as any).tg_join = vi.fn();
    expect(wrapUrl('tg://join?invite=test').onclick).toBe('tg_join');
  });
});
