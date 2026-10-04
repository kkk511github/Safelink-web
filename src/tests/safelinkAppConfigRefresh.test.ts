import {afterEach, describe, expect, it, vi} from 'vitest';
import {ApiManager} from '@appManagers/apiManager';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('SafeLink appConfig refresh', () => {
  it('updateConfig re-requests appConfig and discards a different server hash/name', async() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_MTPROTO_WS_URL', '/apiws');
    const manager = new ApiManager();
    const listeners: Record<string, (...args: any[]) => any> = {};
    let updates: Record<string, (...args: any[]) => any>;
    const cached = {hash: 123, safelink_app_name: 'Other Server', safelink_server_origin: 'https://other.example/'};
    const dispatchEvent = vi.fn();
    const pushToState = vi.fn();
    const invokeApi = vi.fn(async(method: string) => method === 'help.getAppConfig' ? {
      _: 'help.appConfig', hash: 456, config: {safelink_app_name: 'Online Server'}
    } : {_: 'config'});
    Object.assign(manager, {
      rootScope: {addEventListener: (event: string, callback: (...args: any[]) => any) => listeners[event] = callback, dispatchEvent},
      appStateManager: {getState: async() => ({appConfig: cached}), pushToState},
      apiUpdatesManager: {addMultipleEventsListeners: (events: typeof updates) => updates = events},
      invokeApi
    });
    await (manager as any).after();
    await listeners.managers_ready();
    updates.updateConfig();
    await vi.waitFor(() => expect(pushToState).toHaveBeenCalled());
    expect(invokeApi).toHaveBeenCalledWith('help.getConfig', {}, expect.anything());
    expect(invokeApi).toHaveBeenCalledWith('help.getAppConfig', {hash: 0}, expect.anything());
    expect(dispatchEvent).toHaveBeenCalledWith('app_config', expect.objectContaining({
      safelink_app_name: 'Online Server',
      safelink_server_origin: new URL('/.well-known/safelink-client.json', location.origin).href
    }));
  });
});
