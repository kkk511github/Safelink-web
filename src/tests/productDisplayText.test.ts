import productDisplayText from '@helpers/productDisplayText';
import {normalizeAppName} from '@helpers/safelinkAppName';

describe('product presentation', () => {
  it.each(['SafeLink', 'Safelink', 'safelink', 'VO', 'vo'])('maps retired default name %s without changing custom names', (name) => {
    expect(normalizeAppName(name)).toBe('Vochat');
    expect(normalizeAppName('SafeLink Enterprise')).toBe('SafeLink Enterprise');
  });

  it.each([
    ['Contact Telegram@SafeLink.chat or recover@telegram.org via Telegram', 'Contact Telegram@SafeLink.chat or recover@telegram.org via Vochat'],
    ['[Telegram](https://telegram.org/Telegram?name=SafeLink)', '[Vochat](https://telegram.org/Telegram?name=SafeLink)'],
    ['@Telegram @SafeLink Telegram_User safelink_app_name SafeLinkTips', '@Telegram @SafeLink Telegram_User safelink_app_name SafeLinkTips'],
    ['/Applications/Telegram.app ./SafeLink/data ../Telegram/data C:\\Users\\Telegram \\\\host\\SafeLink', '/Applications/Telegram.app ./SafeLink/data ../Telegram/data C:\\Users\\Telegram \\\\host\\SafeLink'],
    ['Copyright © Telegram FZ-LLC; Telegram', 'Copyright © Telegram FZ-LLC; Vochat'],
    ['تلگرام+VO@example.org test@hello.телеграм телеграм.орг/טלגרם', 'تلگرام+VO@example.org test@hello.телеграм телеграм.орг/טלגרם'],
    ['__Telegram Premium.__ __SafeLink Premium__', '__Vochat Premium.__ __Vochat Premium__'],
    ['SafeLink Safelink safelink Telegram テスト', 'Vochat Vochat Vochat Vochat テスト']
  ])('rewrites product copy while protecting destinations and attribution', (input, output) => {
    expect(productDisplayText(input)).toBe(output);
  });

  it('uses an instance name literally and remains stable across repeated formatting', () => {
    const name = 'SafeLink Enterprise';
    const copy = `${name}: Telegram %s`;
    expect(productDisplayText(copy, name)).toBe(`${name}: ${name} %s`);
    expect(productDisplayText(productDisplayText(copy, name), name)).toBe(`${name}: ${name} %s`);
  });
});
