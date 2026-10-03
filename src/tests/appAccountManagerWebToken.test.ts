import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import AppAccountManager from '@appManagers/appAccountManager';
import {WEB_AUTH_TOKEN_UNSUPPORTED} from '@helpers/safelinkLogin';

const TOKEN = 'web-auth-token';
const DC_ID = 2;

/**
 * Both methods only reach for `apiManager` and the logger, so the manager needs
 * none of its state/listener bootstrap here.
 */
function makeManager(appConfig: Record<string, unknown> = {safelink_web_auth_tokens_enabled: true}) {
  const invokeApi = vi.fn();
  const getAppConfig = vi.fn().mockResolvedValue(appConfig);
  const setBaseDcId = vi.fn();
  const setUser = vi.fn().mockResolvedValue(undefined);
  const logError = vi.fn();

  const manager = new AppAccountManager();
  Object.assign(manager as any, {
    apiManager: {invokeApi, getAppConfig, setBaseDcId, setUser, completeAuthorization: vi.fn(async(auth) => setUser(auth.user))},
    log: {error: logError}
  });

  return {manager, invokeApi, getAppConfig, setBaseDcId, setUser, logError};
}

beforeEach(() => vi.stubEnv('VITE_MTPROTO_WS_URL', '/apiws'));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('web token authorization', () => {
  it('imports on the token own dc and stores the user it comes back with', async() => {
    const {manager, invokeApi, setBaseDcId, setUser} = makeManager();
    const user = {_: 'user', id: '777'};
    invokeApi.mockResolvedValue({_: 'auth.authorization', user});

    const authorization = await manager.importWebTokenAuthorization(TOKEN, DC_ID);

    expect(setBaseDcId).toHaveBeenCalledWith(DC_ID);
    expect(invokeApi).toHaveBeenCalledWith(
      'auth.importWebTokenAuthorization',
      expect.objectContaining({web_auth_token: TOKEN}),
      {dcId: DC_ID, ignoreErrors: true}
    );
    expect(setUser).toHaveBeenCalledWith(user);
    expect(authorization).toEqual({_: 'auth.authorization', user});
  });

  it('leaves the session alone when the import needs a sign up', async() => {
    const {manager, invokeApi, setUser} = makeManager();
    invokeApi.mockResolvedValue({_: 'auth.authorizationSignUpRequired'});

    await manager.importWebTokenAuthorization(TOKEN, DC_ID);

    expect(setUser).not.toHaveBeenCalled();
  });

  it('preserves password handoff errors without forwarding bearer-bearing details', async() => {
    const {manager, invokeApi} = makeManager();
    for(const type of ['SESSION_PASSWORD_NEEDED', 'AUTH_TOKEN_INVALID']) {
      invokeApi.mockRejectedValue({type, message: TOKEN, originalError: {token: TOKEN}});
      const error = await manager.importWebTokenAuthorization(TOKEN, DC_ID).catch((err) => err);
      expect(error).toMatchObject({type: type === 'SESSION_PASSWORD_NEEDED' ? type : 'UNKNOWN'});
      expect(error).not.toHaveProperty('message');
      expect(error).not.toHaveProperty('originalError');
      expect(JSON.stringify(error)).not.toContain(TOKEN);
    }
  });

  it('cancels an explicitly supported token without moving the base dc', async() => {
    const {manager, invokeApi, setBaseDcId} = makeManager();
    invokeApi.mockResolvedValue(true);

    await expect(manager.cancelWebTokenAuthorization(TOKEN, DC_ID)).resolves.toBe(true);

    expect(invokeApi).toHaveBeenCalledWith(
      'auth.cancelWebTokenAuthorization',
      {web_auth_token: TOKEN},
      {dcId: DC_ID, ignoreErrors: true}
    );
    expect(setBaseDcId).not.toHaveBeenCalled();
  });

  it('swallows a rejected cancellation — nobody is waiting on it', async() => {
    const {manager, invokeApi, logError} = makeManager();
    invokeApi.mockRejectedValue({type: 'AUTH_TOKEN_INVALID', message: TOKEN, originalError: {token: TOKEN}});

    await expect(manager.cancelWebTokenAuthorization(TOKEN, DC_ID)).resolves.toBe(false);

    expect(logError).toHaveBeenCalledWith('Web token cancellation failed');
    expect(JSON.stringify(logError.mock.calls)).not.toContain(TOKEN);
  });

  it.each([
    {name: 'false', config: {safelink_web_auth_tokens_enabled: false}},
    {name: 'absent', config: {}},
    {name: 'truthy string', config: {safelink_web_auth_tokens_enabled: 'true'}}
  ])('disables only bearer web-token RPCs when capability is $name', async({config}) => {
    const {manager, invokeApi, setBaseDcId, setUser, logError} = makeManager(config);

    await expect(manager.importWebTokenAuthorization(TOKEN, DC_ID)).rejects.toMatchObject({type: WEB_AUTH_TOKEN_UNSUPPORTED});
    await expect(manager.cancelWebTokenAuthorization(TOKEN, DC_ID)).resolves.toBe(false);
    expect(invokeApi).not.toHaveBeenCalled();
    expect(setBaseDcId).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();

    manager.initPasskeyLogin();
    manager.sendVerifyEmailCode({_: 'emailVerifyPurposeLoginSetup', phone_number: '+10000000000', phone_code_hash: 'hash'}, 'test@example.test');
    manager.verifyEmail({_: 'emailVerifyPurposeLoginChange'}, {_: 'emailVerificationCode', code: '12345'});
    expect(invokeApi.mock.calls.map(([method]) => method)).toEqual([
      'auth.initPasskeyLogin', 'account.sendVerifyEmailCode', 'account.verifyEmail'
    ]);
  });

  it('fails closed without leaking an app-config error', async() => {
    const {manager, getAppConfig, invokeApi, logError} = makeManager();
    getAppConfig.mockRejectedValue(new Error(TOKEN));
    await expect(manager.importWebTokenAuthorization(TOKEN, DC_ID)).rejects.toMatchObject({type: WEB_AUTH_TOKEN_UNSUPPORTED});
    await expect(manager.cancelWebTokenAuthorization(TOKEN, DC_ID)).resolves.toBe(false);
    expect(invokeApi).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('does not apply the SafeLink capability to the upstream transport', async() => {
    vi.stubEnv('VITE_MTPROTO_WS_URL', '');
    const {manager, getAppConfig, invokeApi} = makeManager({});
    invokeApi.mockResolvedValue({_: 'auth.authorizationSignUpRequired'});
    await manager.importWebTokenAuthorization(TOKEN, DC_ID);
    expect(getAppConfig).not.toHaveBeenCalled();
    expect(invokeApi).toHaveBeenCalledWith('auth.importWebTokenAuthorization', expect.anything(), expect.anything());
  });
});
