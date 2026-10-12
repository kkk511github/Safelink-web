import {createHash} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import serverFingerprint from '@helpers/safelinkServerFingerprint';

const mocks = vi.hoisted(() => ({ping: vi.fn(), invoke: vi.fn()}));
vi.mock('@lib/apiManagerProxy', () => ({default: {
  serviceMessagePort: {invokeVoid: mocks.invoke, addEventListener: vi.fn()},
  pingServiceWorkerWithIframe: mocks.ping
}}));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); history.replaceState(null, '', '/');
  vi.stubEnv('VITE_MTPROTO_WS_URL', '/apiws');
  vi.stubGlobal('navigator', new Proxy(navigator, {
    has: (target, property) => property === 'serviceWorker' || Reflect.has(target, property),
    get: (target, property) => property === 'serviceWorker' ? {controller: {scriptURL: '/primary-sw.js'}} : Reflect.get(target, property, target)
  }));
});
afterEach(() => {localStorage.clear(); history.replaceState(null, '', '/'); vi.unstubAllGlobals(); vi.unstubAllEnvs();});

async function selectCustomServer() {
  const {SAFELINK_RSA_KEY} = await import('@config/safelink');
  const endpoint = 'wss://media.example/apiws';
  const server = {id: createHash('sha256').update(endpoint).digest('hex'), endpoint, name: 'Media',
    fingerprint: serverFingerprint(SAFELINK_RSA_KEY), publicKey: SAFELINK_RSA_KEY};
  localStorage.setItem('safelink-server-profiles-v1', JSON.stringify([server]));
  history.replaceState(null, '', `/?server=${server.id}`);
  vi.resetModules();
}

const documentFixture = {_: 'document', id: '123', dc_id: 2, mime_type: 'video/mp4', size: 100,
  access_hash: '1', attributes: [], supportsStreaming: true} as any;

describe('SafeLink media under an already controlling primary service worker', () => {
  it('keeps the primary streaming URLs and live-stream support unchanged', async() => {
    const {CAN_USE_PRIMARY_SERVICE_WORKER} = await import('@config/safelinkServer');
    const {default: live} = await import('@environment/liveStreamSupport');
    const {default: getDocumentURL} = await import('@appManagers/utils/docs/getDocumentURL');
    expect(CAN_USE_PRIMARY_SERVICE_WORKER).toBe(true);
    expect(live).toBe(true);
    expect(getDocumentURL(documentFixture)).toMatch(/^stream\//);
    expect(getDocumentURL(documentFixture, {download: true})).toMatch(/^download\//);
  });

  it('does not advertise or generate SW media URLs for a custom server, even with a controller', async() => {
    await selectCustomServer();
    const {CAN_USE_PRIMARY_SERVICE_WORKER} = await import('@config/safelinkServer');
    const {default: live} = await import('@environment/liveStreamSupport');
    const {default: getDocumentURL} = await import('@appManagers/utils/docs/getDocumentURL');
    const {getFileURL} = await import('@helpers/fileName');
    expect(navigator.serviceWorker.controller).toBeTruthy();
    expect(CAN_USE_PRIMARY_SERVICE_WORKER).toBe(false);
    expect(live).toBe(false);
    for(const options of [{}, {download: true}, {supportsHlsStreaming: true}]) expect(getDocumentURL(documentFixture, options)).toMatch(/^document\//);
    for(const type of ['stream', 'download', 'hls'] as const) expect(() => getFileURL(type, {} as any)).toThrow('Service Worker');
  });

  it('uses blob downloads without a SW download id or ping, even if a port is supplied', async() => {
    await selectCustomServer();
    const {AppDownloadManager} = await import('@lib/appDownloadManager');
    const manager = new AppDownloadManager();
    const download = vi.spyOn(manager as any, 'downloadMedia').mockResolvedValue(new Blob(['fixture']));
    const options = {media: documentFixture};
    await manager.downloadToDisc(options, true);
    expect(options).not.toHaveProperty('downloadId');
    expect(download).toHaveBeenCalledWith(options, 'disc', undefined);
    expect(mocks.ping).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('rejects RTMP URL generation, join and recovery before any manager or SW operation', async() => {
    await selectCustomServer();
    const {getRtmpStreamUrl} = await import('@lib/rtmp/url');
    const {RtmpCallsController} = await import('@lib/calls/rtmpCallsController');
    const controller = new RtmpCallsController();
    expect(() => getRtmpStreamUrl({_: 'inputGroupCall', id: '1', access_hash: '1'})).toThrow('Service Worker');
    await expect(controller.joinCall(1 as ChatId)).rejects.toThrow('Service Worker');
    await expect(controller.rejoinCall()).rejects.toThrow('Service Worker');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
