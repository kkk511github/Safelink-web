import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AppUsersManager} from '@appManagers/appUsersManager';

const peerId = 100 as PeerId;
const otherPeerId = 200 as PeerId;

function makeManager(config: Record<string, unknown> = {}) {
  const manager = new AppUsersManager();
  const state = {topPeersCache: {
    correspondents: {cachedTime: 123, peers: [{id: peerId, rating: 9}, {id: otherPeerId, rating: 4}]},
    bots_inline: {cachedTime: 456, peers: [{id: peerId, rating: 2}]}
  }};
  const getTopPeersPromises = {
    correspondents: Promise.resolve(state.topPeersCache.correspondents.peers),
    bots_inline: Promise.resolve(state.topPeersCache.bots_inline.peers)
  };
  const invokeApi = vi.fn().mockResolvedValue(true);
  const getAppConfig = vi.fn().mockResolvedValue(config);
  const pushToState = vi.fn();
  const getInputPeerById = vi.fn(() => ({_: 'inputPeerUser', user_id: peerId, access_hash: '0'}));
  Object.assign(manager as any, {
    getTopPeersPromises,
    apiManager: {getAppConfig, invokeApi},
    appStateManager: {getState: vi.fn().mockResolvedValue(state), pushToState},
    appPeersManager: {getInputPeerById}
  });
  return {manager, state, getTopPeersPromises, invokeApi, getAppConfig, pushToState, getInputPeerById};
}

beforeEach(() => vi.stubEnv('VITE_MTPROTO_WS_URL', '/apiws'));
afterEach(() => vi.unstubAllEnvs());

describe('SafeLink top-peer reset capability', () => {
  it.each([
    {name: 'false', config: {safelink_top_peers_enabled: false}},
    {name: 'absent', config: {}},
    {name: 'truthy string', config: {safelink_top_peers_enabled: 'true'}},
    {name: 'unrelated token flag', config: {safelink_web_auth_tokens_enabled: true}}
  ])('only removes local stale hints when capability is $name', async({config}) => {
    const {manager, state, getTopPeersPromises, invokeApi, pushToState, getInputPeerById} = makeManager(config);
    await manager.resetTopPeerRating(peerId);
    expect(invokeApi).not.toHaveBeenCalled();
    expect(getInputPeerById).not.toHaveBeenCalled();
    expect(state.topPeersCache.correspondents).toEqual({cachedTime: 123, peers: [{id: otherPeerId, rating: 4}]});
    expect(getTopPeersPromises).not.toHaveProperty('correspondents');
    expect(getTopPeersPromises.bots_inline).toBeDefined();
    expect(state.topPeersCache.bots_inline.peers).toEqual([{id: peerId, rating: 2}]);
    expect(pushToState).toHaveBeenCalledWith('topPeersCache', state.topPeersCache);
  });

  it('fails closed on config errors but still clears local hints', async() => {
    const {manager, getAppConfig, invokeApi, state} = makeManager();
    getAppConfig.mockRejectedValue(new Error('CONFIG_UNAVAILABLE'));
    await manager.resetTopPeerRating(peerId);
    expect(invokeApi).not.toHaveBeenCalled();
    expect(state.topPeersCache.correspondents.peers).toEqual([{id: otherPeerId, rating: 4}]);
  });

  it('uses the existing RPC only for explicit true, then clears the local hint', async() => {
    const {manager, invokeApi, getInputPeerById, state} = makeManager({safelink_top_peers_enabled: true});
    await manager.resetTopPeerRating(peerId);
    expect(invokeApi).toHaveBeenCalledExactlyOnceWith('contacts.resetTopPeerRating', {
      category: {_: 'topPeerCategoryCorrespondents'}, peer: getInputPeerById.mock.results[0].value
    });
    expect(state.topPeersCache.correspondents.peers).toEqual([{id: otherPeerId, rating: 4}]);
  });

  it('does not disguise an enabled server RPC failure as successful cleanup', async() => {
    const {manager, invokeApi, pushToState, getTopPeersPromises, state} = makeManager({safelink_top_peers_enabled: true});
    invokeApi.mockRejectedValue(new Error('RPC_UNSUPPORTED'));
    await expect(manager.resetTopPeerRating(peerId)).rejects.toThrow('RPC_UNSUPPORTED');
    expect(pushToState).not.toHaveBeenCalled();
    expect(getTopPeersPromises.correspondents).toBeDefined();
    expect(state.topPeersCache.correspondents.peers).toHaveLength(2);
  });

  it('can clear a stale promise even when no local correspondents remain', async() => {
    const {manager, state, getTopPeersPromises, pushToState, invokeApi} = makeManager();
    delete state.topPeersCache.correspondents;
    await manager.resetTopPeerRating(peerId);
    expect(getTopPeersPromises).not.toHaveProperty('correspondents');
    expect(pushToState).not.toHaveBeenCalled();
    expect(invokeApi).not.toHaveBeenCalled();
  });

  it('preserves the upstream transport behavior', async() => {
    vi.stubEnv('VITE_MTPROTO_WS_URL', '');
    const {manager, invokeApi, getAppConfig} = makeManager();
    await manager.resetTopPeerRating(peerId);
    expect(getAppConfig).not.toHaveBeenCalled();
    expect(invokeApi).toHaveBeenCalledTimes(1);
  });
});
