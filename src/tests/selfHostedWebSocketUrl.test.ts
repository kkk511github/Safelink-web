import {expect, test} from 'vitest';
import selfHostedWebSocketUrl from '../lib/mtproto/selfHostedWebSocketUrl';

test('self-hosted transport follows the deployed web origin', () => {
  expect(selfHostedWebSocketUrl('/apiws', 'https://web.new.example.test')).toBe('wss://web.new.example.test/apiws');
  expect(selfHostedWebSocketUrl('/apiws', 'http://localhost:3000')).toBe('ws://localhost:3000/apiws');
  expect(selfHostedWebSocketUrl('wss://dedicated.example.test/apiws', 'https://web.example.test')).toBe('wss://dedicated.example.test/apiws');
  expect(() => selfHostedWebSocketUrl('//evil.example.test/apiws', 'https://web.example.test')).toThrow();
});
