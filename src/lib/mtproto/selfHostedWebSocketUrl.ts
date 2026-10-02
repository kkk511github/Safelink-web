export default function selfHostedWebSocketUrl(configured: string, origin: string): string {
  if(!configured.startsWith('/')) return configured;
  if(configured.startsWith('//')) throw new Error('WebSocket path must be same-origin');
  const url = new URL(configured, origin);
  if(url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Invalid WebSocket origin');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
