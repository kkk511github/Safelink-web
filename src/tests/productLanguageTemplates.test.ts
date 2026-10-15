import {vi} from 'vitest';
import langSign from '@/langSign';
import lang from '@/lang';
import I18n from '@lib/langPack';

const state = vi.hoisted(() => ({name: 'Vochat'}));
vi.mock('@stores/appName', () => ({default: () => () => state.name}));

describe('production language formatting', () => {
  beforeEach(() => {
    for(const string of I18n.formatLocalStrings({...lang, ...langSign})) {
      I18n.strings.set(string.key as keyof typeof langSign | keyof typeof lang, string);
    }
  });

  afterEach(() => {state.name = 'Vochat';});

  it('projects actual login and fallback product text', () => {
    expect(langSign['Login.Title']).toContain('SafeLink');
    expect(I18n.format('Login.Title', true)).toBe('Sign in to Vochat');
    expect(lang['ClientPip.PlaceholderTitle']).toContain('Telegram');
    expect(I18n.format('ClientPip.PlaceholderTitle', true)).toBe('Vochat is in Picture-in-Picture');
  });

  it.each(['Acme %s', 'Acme [x]()', 'SafeLink **Enterprise**', 'Enterprise __%1$s__', 'Link', 'gram', 'T'])('renders configured name literally: %s', (name) => {
    state.name = name;
    expect(I18n.format('Login.Title', true)).toBe(`Sign in to ${name}`);
    I18n.strings.set('Login.Title', {_: 'langPackString', key: 'Login.Title', value: '**Telegram** %s'});
    expect(I18n.format('Login.Title', true, ['Telegram'])).toBe(`${name} Telegram`);
    I18n.strings.set('Login.Title', {_: 'langPackString', key: 'Login.Title', value: `${name} %s`});
    expect(I18n.format('Login.Title', true, ['SafeLink'])).toBe(`${name} SafeLink`);
  });

  it('preserves formatter arguments and custom instance names', () => {
    state.name = 'Custom Messaging';
    expect(I18n.format('Login.Title', true)).toBe('Sign in to Custom Messaging');
    I18n.strings.set('Login.Title', {_: 'langPackString', key: 'Login.Title', value: 'Telegram %s'});
    expect(I18n.format('Login.Title', true, ['SafeLink Telegram@SafeLink.chat'])).toBe('Custom Messaging SafeLink Telegram@SafeLink.chat');
  });
});
