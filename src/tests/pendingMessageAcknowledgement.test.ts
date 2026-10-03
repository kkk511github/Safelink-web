import {afterEach, describe, expect, it, vi} from 'vitest';
import {AppMessagesManager} from '@appManagers/appMessagesManager';
import {AppMessagesIdsManager} from '@appManagers/appMessagesIdsManager';
import MTProtoMessagePort from '@lib/mainWorker/mainMessagePort';
import '@helpers/peerIdPolyfill';

function createPending(options: {peerId?: number, scheduled?: boolean, threadId?: number} = {}) {
  const manager = new AppMessagesManager();
  manager.clear(true);
  const internal = manager as any;
  const peerId = (options.peerId ?? 42) as PeerId;
  const ids = new AppMessagesIdsManager();
  const channelId = peerId < 0 ? peerId.toChatId() : undefined;
  const mid = ids.generateMessageId(123, channelId);
  const tempId = ids.generateTempMessageId(122, channelId);
  const randomId = '987654321';
  const storage = options.scheduled ? manager.getScheduledMessagesStorage(peerId) : manager.getHistoryMessagesStorage(peerId);
  const tempMessage = {
    _: 'message', id: 122, mid: tempId, peerId,
    pFlags: {out: true, is_outgoing: true}, message: 'same text',
    random_id: randomId, pending: true, date: 1
  } as any;
  const message = {
    _: 'message', id: 123, mid, peerId,
    pFlags: {out: true}, message: 'same text', date: 2
  } as any;
  const history = new Set([tempId]);
  const threadHistory = new Set([tempId]);
  const dispatchEvent = vi.fn();
  vi.spyOn(MTProtoMessagePort, 'getInstance').mockReturnValue({invokeVoid: vi.fn()} as any);
  Object.assign(internal, {
    appPeersManager: {isChannel: () => !!channelId},
    appMessagesIdsManager: ids,
    rootScope: {dispatchEvent},
    getAccountNumber: () => 1,
    getHistoryStorage: (_peerId: PeerId, threadId?: number) => ({history: threadId ? threadHistory : history}),
    updateMessageContextForDeletion: vi.fn(),
    handleReleasingMessage: vi.fn(),
    onMessageModification: vi.fn()
  });
  manager.setMessageToStorage(storage, tempMessage);
  internal.pendingByRandomId[randomId] = {peerId, tempId, storage, threadId: options.threadId};
  internal.pendingTopMsgs[peerId] = tempId;
  const acknowledge = (token = randomId) => internal.onUpdateMessageId({_: 'updateMessageID', id: 123, random_id: token});
  const cacheConfirmed = () => manager.setMessageToStorage(storage, message);
  return {manager, internal, storage, tempMessage, message, history, threadHistory, dispatchEvent, acknowledge, cacheConfirmed, randomId, tempId, mid};
}

afterEach(() => vi.restoreAllMocks());

describe('pending message acknowledgements', () => {
  it.each([
    {peerId: 42},
    {peerId: -42},
    {peerId: 42, scheduled: true},
    {peerId: -42, threadId: 10}
  ])('finalizes an already cached message when its acknowledgement arrives late: %j', (options) => {
    const state = createPending(options);
    state.cacheConfirmed();
    state.acknowledge();
    expect(state.storage.has(state.tempId)).toBe(false);
    expect(state.storage.get(state.mid)).toBe(state.message);
    expect(state.history.has(state.tempId)).toBe(false);
    if(options.threadId) expect(state.threadHistory.has(state.tempId)).toBe(false);
    expect(state.internal.pendingByRandomId[state.randomId]).toBeUndefined();
    expect(state.internal.pendingByMessageId[state.mid]).toBeUndefined();
    expect(state.dispatchEvent).toHaveBeenCalledWith('message_sent', expect.objectContaining({tempId: state.tempId, mid: state.mid}));
    expect(state.dispatchEvent).toHaveBeenCalledWith('history_update', expect.objectContaining({tempId: state.tempId, message: state.message}));
  });

  it('still finalizes normally when the acknowledgement arrives before the message', () => {
    const state = createPending();
    state.acknowledge();
    expect(state.storage.has(state.tempId)).toBe(true);
    state.cacheConfirmed();
    state.internal.checkPendingMessage(state.message);
    expect(state.storage.has(state.tempId)).toBe(false);
    expect(state.internal.pendingByRandomId[state.randomId]).toBeUndefined();
  });

  it('ignores duplicate acknowledgements after finalization', () => {
    const state = createPending();
    state.cacheConfirmed();
    state.acknowledge();
    state.acknowledge();
    expect(state.dispatchEvent.mock.calls.filter(([name]) => name === 'message_sent')).toHaveLength(1);
    expect(state.internal.pendingByMessageId[state.mid]).toBeUndefined();
  });

  it('does not merge identical text without the matching random ID', () => {
    const state = createPending();
    state.cacheConfirmed();
    state.acknowledge('another-send');
    expect(state.storage.has(state.tempId)).toBe(true);
    expect(state.dispatchEvent).not.toHaveBeenCalled();
  });

  it('does not finalize against a cached message belonging to another peer', () => {
    const state = createPending();
    state.message.peerId = 99;
    state.cacheConfirmed();
    state.acknowledge();
    expect(state.storage.has(state.tempId)).toBe(true);
    expect(state.dispatchEvent).not.toHaveBeenCalled();
  });

  it('does not treat an outgoing placeholder as a server confirmation', () => {
    const state = createPending();
    state.message.pFlags.is_outgoing = true;
    state.cacheConfirmed();
    state.acknowledge();
    expect(state.storage.has(state.tempId)).toBe(true);
    expect(state.dispatchEvent).not.toHaveBeenCalled();
  });
});
