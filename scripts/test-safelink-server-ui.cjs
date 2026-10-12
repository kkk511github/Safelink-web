const {chromium} = require('@playwright/test');
const {createAxeBuilder, settleForMeasurement} = require('../e2e/accessibility.helpers.ts');
const assert = require('node:assert/strict');
const {createHash, createPublicKey} = require('node:crypto');
const {mkdirSync, readFileSync} = require('node:fs');
const {resolve} = require('node:path');

const output = resolve(__dirname, '../test-results/safelink-servers');
mkdirSync(output, {recursive: true});
const modulus = readFileSync(resolve(__dirname, '../src/config/safelink.ts'), 'utf8').match(/modulus: '([a-f0-9]+)'/)[1];
const key = createPublicKey({key: {kty: 'RSA', n: Buffer.from(modulus, 'hex').toString('base64url'), e: 'AQAB'}, format: 'jwk'});
const descriptor = {version: 1, name: 'SafeLink',
  server_id: createHash('sha256').update(key.export({type: 'pkcs1', format: 'der'})).digest('hex'),
  rsa_public_key: key.export({type: 'pkcs1', format: 'pem'}).toString()};
const primaryPrefix = 'safelink-5cc5b7bffe3c4275-';
const originalAuth = {userId: 100, dc2_auth_key: 'fixture-original-auth-do-not-change', auth_key_fingerprint: 'fixture', push_key: 'fixture'};
const previewURL = process.env.SAFELINK_PREVIEW_URL || 'http://127.0.0.1:9048/';

async function assertRecoverableStartup(browser, width) {
  const endpoint = 'wss://team.example/apiws';
  const server = {id: createHash('sha256').update(endpoint).digest('hex'), endpoint,
    name: '团队服务器', fingerprint: descriptor.server_id, publicKey: {modulus, exponent: '010001'}};
  for(const kind of ['missing', 'corrupt', 'pin mismatch']) {
    const registry = kind === 'corrupt' ? 'invalid JSON' : JSON.stringify([kind === 'pin mismatch' ? {...server, fingerprint: '0'.repeat(64)} : server]);
    const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block', colorScheme: kind === 'corrupt' ? 'dark' : 'light'});
    await context.addInitScript(({registry, primaryPrefix, originalAuth}) => {
      localStorage.setItem('safelink-server-profiles-v1', registry);
      localStorage.setItem(primaryPrefix + 'account1', JSON.stringify(originalAuth));
      window.safelinkWorkerURLs = [];
      for(const name of ['Worker', 'SharedWorker']) {
        window[name] = new Proxy(window[name], {construct(target, args) {
          window.safelinkWorkerURLs.push(String(args[0]));
          return Reflect.construct(target, args);
        }});
      }
    }, {registry, primaryPrefix, originalAuth});
    const page = await context.newPage();
    const errors = [];
    const sockets = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('websocket', (socket) => {if(socket.url().includes('/apiws')) sockets.push(socket.url());});
    let recoveryNavigation;
    await context.route('**/*', (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if(!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
      if(request.isNavigationRequest() && !url.searchParams.has('server')) {
        recoveryNavigation = url;
        return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Explicit recovery navigation fixture</title>'});
      }
      return route.continue();
    });
    const url = new URL(previewURL);
    url.searchParams.set('a11y', '1');
    url.searchParams.set('server', kind === 'missing' ? 'f'.repeat(64) : server.id);
    url.searchParams.set('safelinkAddAccount', '1');
    url.searchParams.set('returnServer', 'primary');
    url.searchParams.set('returnAccount', '2');
    await page.goto(url.href);
    await page.getByRole('heading', {name: '无法选择服务器', exact: true}).waitFor();
    await page.getByRole('button', {name: '服务器与账号', exact: true}).click();
    await page.getByRole('navigation', {name: '服务器列表', exact: true}).waitFor();
    assert(await page.getByRole('button', {name: '返回主服务器', exact: true}).evaluate((button) => {
      const style = getComputedStyle(button);
      return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.color !== style.backgroundColor;
    }), 'Recovery primary action must be visually distinct before theme storage is loaded');
    assert.deepEqual(await page.evaluate(() => window.safelinkWorkerURLs), [], `${kind}: no wrong-namespace worker startup`);
    assert.deepEqual(await page.evaluate(() => indexedDB.databases()), [], `${kind}: no account database startup`);
    assert.deepEqual(sockets, [], `${kind}: no MTProto transport startup`);
    assert.equal(await page.evaluate(() => localStorage.getItem('safelink-server-profiles-v1')), registry, 'Recovery does not erase the registry');
    assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), primaryPrefix + 'account1'), originalAuth);
    await page.screenshot({path: resolve(output, `startup-${kind.replace(' ', '-')}-${width}.png`)});
    const audit = await (await createAxeBuilder(page, '#safelink-server-recovery')).disableRules(['color-contrast']).analyze();
    assert.deepEqual(audit.violations, []);
    await page.getByRole('button', {name: '返回主服务器', exact: true}).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => !url.searchParams.has('server'));
    assert(recoveryNavigation && !recoveryNavigation.searchParams.has('server'), 'Only an explicit recovery action may select primary');
    assert.equal(recoveryNavigation.searchParams.get('account'), '2', 'Recovery keeps the existing primary return slot');
    assert(!recoveryNavigation.searchParams.has('safelinkAddAccount'), 'Recovery returns to an existing account, never resumes pending allocation');
    assert.deepEqual(errors, []);
    await context.close();
  }
}

async function assertIsolatedPendingLogin(browser, width) {
  const endpoint = `wss://${new URL(previewURL).host}/apiws`;
  const server = {id: createHash('sha256').update(endpoint).digest('hex'), endpoint,
    name: '团队服务器', fingerprint: descriptor.server_id, publicKey: {modulus, exponent: '010001'}};
  const prefix = `safelink-server-${server.id}-`;
  const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'allow'});
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if(!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if(url.pathname === '/__safelink-sw-install') return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Isolated primary SW fixture</title>'});
    if(url.pathname === '/__safelink-primary-sw.js') return route.fulfill({contentType: 'application/javascript', headers: {'Service-Worker-Allowed': '/'}, body: `
      self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
      self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
      self.addEventListener('fetch', (event) => {
        if(/\\.([jt]sx?|s?css)?($|\\?)/.test(event.request.url)) return;
        const scope = new URL(event.request.url).pathname.split('/').slice(-2)[0];
        if(scope === 'ping') event.respondWith(new Response('primary-fixture-pong'));
        if(['stream', 'd', 'download', 'rtmp', 'hls', 'hls_quality_file', 'hls_stream'].includes(scope)) {
          event.waitUntil(self.clients.matchAll().then((clients) => clients.forEach((client) => client.postMessage({unsafeMediaURL: event.request.url}))));
          event.respondWith(new Response('Primary account media must not be used', {status: 418}));
        }
      });
    `});
    return route.continue();
  });
  await context.addInitScript(({server, primaryPrefix, originalAuth}) => {
    localStorage.setItem('safelink-server-profiles-v1', JSON.stringify([server]));
    localStorage.setItem(primaryPrefix + 'account1', JSON.stringify(originalAuth));
    localStorage.setItem(primaryPrefix + 'number_of_accounts', '1');
    window.safelinkWorkerURLs = [];
    window.safelinkSWMediaRequests = [];
    navigator.serviceWorker.addEventListener('message', (event) => {
      if(event.data?.unsafeMediaURL) window.safelinkSWMediaRequests.push(event.data.unsafeMediaURL);
    });
    for(const name of ['Worker', 'SharedWorker']) {
      window[name] = new Proxy(window[name], {construct(target, args) {
        window.safelinkWorkerURLs.push(String(args[0]));
        return Reflect.construct(target, args);
      }});
    }
  }, {server, primaryPrefix, originalAuth});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket(/apiws/, (socket) => socket.close());
  await page.goto(new URL('/__safelink-sw-install', previewURL).href);
  await page.evaluate(async() => {
    await navigator.serviceWorker.register('/__safelink-primary-sw.js', {scope: '/'});
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once: true}));
  });
  const url = new URL(previewURL);
  for(const [name, value] of Object.entries({a11y: '1', server: server.id, returnServer: 'primary', returnAccount: '1', safelinkAddAccount: '1'})) url.searchParams.set(name, value);
  await page.goto(url.href);
  await page.locator('#auth-flow-root').waitFor();
  assert(!new URL(page.url()).searchParams.has('safelinkAddAccount'), 'Cross-server add defers slot allocation until its own account state is loaded');
  const isolation = await page.evaluate(async() => {
    const config = await import('/src/config/safelinkServer.ts');
    const {SAFELINK_STORAGE_PREFIX} = await import('/src/config/safelink.ts');
    const {default: proxy} = await import('/src/lib/apiManagerProxy.ts');
    const {getCurrentAccount} = await import('/src/lib/accounts/getCurrentAccount.ts');
    const {default: navigation} = await import('/src/components/appNavigationController.ts');
    const {default: App} = await import('/src/config/app.ts');
    const {unversionedMainBroadcastChannelName} = await import('/src/config/broadcastChannel.ts');
    const {default: liveStreaming} = await import('/src/environment/liveStreamSupport.ts');
    const {default: getDocumentURL} = await import('/src/lib/appManagers/utils/docs/getDocumentURL.ts');
    const {default: rootScope} = await import('/src/lib/rootScope.ts');
    const doc = await rootScope.managers.appDocsManager.saveDoc({_: 'document', id: '987654321', access_hash: '1', file_reference: [],
      dc_id: 2, mime_type: 'video/mp4', size: 100, date: 0, attributes: [{_: 'documentAttributeVideo', duration: 1, w: 10, h: 10, pFlags: {supports_streaming: true}}]});
    navigation.reload = (target) => {window.safelinkNavigation = target.href;};
    return {serverId: config.currentServerId, endpoint: config.getSafeLinkWebSocketUrl(), prefix: SAFELINK_STORAGE_PREFIX,
      account: getCurrentAccount(), serviceBridge: !!proxy.serviceMessagePort,
      controller: navigator.serviceWorker.controller?.scriptURL, swOnline: proxy.isServiceWorkerOnline(), liveStreaming,
      workerDocStreaming: doc.supportsStreaming, mediaURL: getDocumentURL(doc, {supportsHlsStreaming: true}),
      broadcast: App.interclientBroadcastChannel, reloadBroadcast: unversionedMainBroadcastChannelName,
      databases: (await indexedDB.databases()).map((database) => database.name), workers: window.safelinkWorkerURLs};
  });
  assert.equal(isolation.serverId, server.id);
  assert.equal(isolation.endpoint, endpoint);
  assert.equal(isolation.prefix, prefix);
  assert.equal(isolation.account, 1, 'An empty custom server starts in its own account 1');
  assert.equal(isolation.serviceBridge, false, 'Never attach this server to the primary single-port service worker');
  assert(isolation.controller?.endsWith('/__safelink-primary-sw.js'), 'An already installed primary SW really controls this custom-server page');
  assert.equal(isolation.swOnline, false);
  assert.equal(isolation.liveStreaming, false);
  assert.equal(isolation.workerDocStreaming, false, 'The actual custom worker cannot advertise primary SW streaming');
  assert(isolation.mediaURL.startsWith('document/'), 'HLS requests fall back to ordinary selected-worker media downloads');
  assert.equal(isolation.broadcast, `tgweb-${server.id}`);
  assert.equal(isolation.reloadBroadcast, `webk-main-broadcast-channel-${server.id}`);
  assert(isolation.databases.length && isolation.databases.every((name) => name.startsWith(prefix)), 'The actual worker opens only the selected server databases');
  assert(isolation.workers.some((value) => {
    const url = new URL(value);
    return url.searchParams.get('server') === server.id && JSON.parse(url.searchParams.get('safelinkWorkerServer') || 'null')?.id === server.id;
  }), 'The actual worker receives the confirmed immutable server snapshot');
  await page.evaluate(async() => {
    const {default: rootScope} = await import('/src/lib/rootScope.ts');
    rootScope.managers.appStateManager = {pushToState: async() => undefined, setByKey: async() => undefined};
    const {navigateAuth} = await import('/src/pages/authFlow.tsx');
    navigateAuth({name: 'authCode', payload: {_: 'auth.sentCode', type: {_: 'auth.sentCodeTypeSms', length: 5}, phone_number: '+10000000000', phone_code_hash: 'fixture'}});
  });
  await page.locator('[class*="pageAuthCode"]').waitFor();
  await settleForMeasurement(page, '#auth-flow-root');
  await page.waitForFunction(() => {
    const card = document.querySelector('[class*="pageAuthCode"]');
    if(!card?.querySelector('input')) return false;
    for(let element = card; element; element = element.parentElement) {
      if(+getComputedStyle(element).opacity < 0.99) return false;
    }
    return true;
  }, undefined, {timeout: 15000});
  const back = page.getByRole('button', {name: '返回已有账号', exact: true});
  assert(await back.isVisible());
  await page.screenshot({path: resolve(output, `pending-auth-return-${width}.png`)});
  await back.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!window.safelinkNavigation);
  const returned = new URL(await page.evaluate(() => window.safelinkNavigation));
  assert(!returned.searchParams.has('server') && !returned.searchParams.has('account') && !returned.searchParams.has('returnAccount'));
  assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), primaryPrefix + 'account1'), originalAuth,
    'Returning from pending auth on another server preserves the original server account byte-for-byte');
  assert.deepEqual(await page.evaluate(async(server) => {
    const {getStoredServerAccountState} = await import('/src/lib/accounts/serverProfiles.ts');
    const {count, locked} = await getStoredServerAccountState(server);
    return {count, locked};
  }, server), {count: 0, locked: false}, 'Cancelling an empty login leaves authoritative zero metadata despite created databases');
  assert.deepEqual(errors, [], 'Actual selected worker boot has no browser runtime errors');
  assert.deepEqual(await page.evaluate(() => window.safelinkSWMediaRequests), [], 'No custom media request reaches a primary SW account path');
  assert.equal(await page.evaluate(async() => (await fetch('/ping/isolation-fixture')).text()), 'primary-fixture-pong', 'The primary SW is retained and still works');
  assert(await page.evaluate(async() => !!(await navigator.serviceWorker.getRegistration('/'))?.active), 'Never unregister the primary SW');
  await context.close();
}

(async() => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  try {
    for(const width of [390, 1280]) {
      const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block'});
      await context.addInitScript(({primaryPrefix, originalAuth}) => {
        localStorage.setItem(primaryPrefix + 'account1', JSON.stringify(originalAuth));
        localStorage.setItem(primaryPrefix + 'number_of_accounts', '1');
      }, {primaryPrefix, originalAuth});
      await context.route('**/*', (route) => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      let failDiscovery = false;
      let delayDiscovery;
      let discoveryStarted;
      await context.route('**/.well-known/safelink-client.json', async(route) => {
        if(delayDiscovery) {discoveryStarted(); await delayDiscovery;}
        return failDiscovery ? route.fulfill({status: 503, body: ''}) : route.fulfill({json: descriptor});
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {if(message.type() === 'error' && message.text().startsWith('solid error')) errors.push(message.text());});
      await page.routeWebSocket(/apiws/, (socket) => socket.close());
      const url = new URL(previewURL);
      for(const [name, value] of Object.entries({a11y: '1', noWorker: '1', account: '2', returnServer: 'primary', returnAccount: '1'})) url.searchParams.set(name, value);
      await page.goto(url.href);
      await page.locator('#auth-flow-root').waitFor();
      await page.evaluate(async() => {
        const {default: AccountController} = await import('/src/lib/accounts/accountController.ts');
        const {default: proxy} = await import('/src/lib/apiManagerProxy.ts');
        const {default: rootScope} = await import('/src/lib/rootScope.ts');
        const {default: navigation} = await import('/src/components/appNavigationController.ts');
        const {SAFELINK_STORAGE_PREFIX, SAFELINK_RSA_KEY} = await import('/src/config/safelink.ts');
        const {createServerProfile, saveServerProfile, serverFingerprint} = await import('/src/lib/accounts/serverProfiles.ts');
        const {default: passcode} = await import('/src/lib/passcode/deferredIsUsingPasscode.ts');
        passcode.resolveDeferred(false);
        const existing = JSON.parse(localStorage.getItem(SAFELINK_STORAGE_PREFIX + 'account1'));
        localStorage.setItem(SAFELINK_STORAGE_PREFIX + 'account1', JSON.stringify(existing));
        localStorage.setItem(SAFELINK_STORAGE_PREFIX + 'number_of_accounts', '1');
        AccountController.get = async(number) => number === 1 ? {...existing} : {};
        const originalInvoke = proxy.invoke.bind(proxy);
        window.safelinkFixtureCalls = [];
        proxy.invoke = (type, payload, ...rest) => {
          if(type === 'manager' && payload.name === 'appUsersManager' && payload.method === 'getSelf') {
            window.safelinkFixtureCalls.push(payload);
            return Promise.resolve({_: 'user', id: 100, first_name: '张明', last_name: '', pFlags: {self: true}});
          }
          return originalInvoke(type, payload, ...rest);
        };
        proxy.hasSomeonePremium = async() => false;
        rootScope.managers.appStateManager = {pushToState: async() => undefined, setByKey: async() => undefined};
        const apiManager = Object.create(rootScope.managers.apiManager);
        apiManager.registrationPolicy = async() => ({inviteRequired: false, passwordRequired: false});
        rootScope.managers.apiManager = apiManager;
        const passwordManager = Object.create(rootScope.managers.passwordManager);
        passwordManager.getState = async() => ({_: 'account.password', pFlags: {has_password: true}, hint: 'fixture'});
        rootScope.managers.passwordManager = passwordManager;
        navigation.reload = (target) => {window.safelinkNavigation = target.href;};
        const server = await createServerProfile('wss://team.example/apiws', {name: '团队服务器', publicKey: SAFELINK_RSA_KEY, fingerprint: await serverFingerprint(SAFELINK_RSA_KEY)});
        saveServerProfile(server);
        window.safelinkFixtureServer = server;
        const {getCurrentAccount} = await import('/src/lib/accounts/getCurrentAccount.ts');
        if(getCurrentAccount() !== 2) throw new Error('Fixture pending login must use empty account 2');
      });
      const returnButton = page.getByRole('button', {name: '返回已有账号', exact: true});
      await returnButton.waitFor();
      const open = async() => {
        await page.getByRole('button', {name: '服务器与账号', exact: true}).click();
        await page.getByRole('button', {name: /张明/}).waitFor().catch(async(error) => {
          console.error(await page.locator('body').innerText(), errors);
          await page.screenshot({path: resolve(output, `error-${width}.png`)});
          throw error;
        });
      };
      await open();
      const popup = page.locator('.popup.active');
      assert.equal(await popup.getByText('团队服务器', {exact: true}).count(), 1);
      assert.equal(await popup.getByRole('button', {name: '添加账号', exact: true}).count(), 2);
      await settleForMeasurement(page, '.popup-container');
      const fit = await popup.locator('.popup-container').evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth + 1;
      });
      assert(fit, 'The server popup must fit narrow and desktop viewports');
      await page.screenshot({path: resolve(output, `servers-day-${width}.png`)});
      const audit = await (await createAxeBuilder(page, '.popup-container')).disableRules(['color-contrast']).analyze();
      assert.deepEqual(audit.violations, [], 'Server/account popup semantics');
      await page.keyboard.press('Escape');
      await page.locator('.popup.active').waitFor({state: 'hidden'});
      await open();
      await popup.getByRole('button', {name: '添加服务器', exact: true}).click();
      await popup.getByRole('textbox', {name: '服务器地址', exact: true}).fill('stale.example');
      const savedBeforeClose = await page.evaluate(() => localStorage.getItem('safelink-server-profiles-v1'));
      let resumeDiscovery;
      delayDiscovery = new Promise((resolve) => {resumeDiscovery = resolve;});
      const started = new Promise((resolve) => {discoveryStarted = resolve;});
      await popup.getByRole('button', {name: '检查服务器', exact: true}).click();
      await started;
      await page.keyboard.press('Escape');
      await page.locator('.popup.active').waitFor({state: 'hidden'});
      resumeDiscovery();
      delayDiscovery = undefined;
      await open();
      assert.equal(await page.evaluate(() => localStorage.getItem('safelink-server-profiles-v1')), savedBeforeClose, 'Closing during discovery cannot save a stale candidate');
      await page.keyboard.press('Escape');
      await page.locator('.popup.active').waitFor({state: 'hidden'});
      assert(await page.getByRole('button', {name: '服务器与账号', exact: true}).evaluate((button) => button === document.activeElement), 'Escape restores focus to the opener');
      await page.getByRole('button', {name: /Dark Mode/}).click();
      await open();
      await settleForMeasurement(page, '.popup-container');
      await page.screenshot({path: resolve(output, `servers-night-${width}.png`)});
      await popup.getByRole('button', {name: /团队服务器/}).click();
      await popup.getByText(descriptor.server_id, {exact: true}).waitFor();
      await popup.getByRole('button', {name: '检查服务器', exact: true}).click();
      await popup.getByRole('status').getByText('HTTPS 身份已核验', {exact: true}).waitFor();
      await page.screenshot({path: resolve(output, `details-${width}.png`)});
      await popup.getByRole('button', {name: '移除服务器', exact: true}).click();
      await popup.getByText('仅移除服务器记录，不退出账号或删除账号数据。', {exact: true}).waitFor();
      await popup.getByRole('button', {name: '取消', exact: true}).click();
      await popup.getByRole('button', {name: '返回服务器列表', exact: true}).click();
      await popup.getByRole('button', {name: '添加服务器', exact: true}).click();
      await popup.getByRole('textbox', {name: '服务器地址', exact: true}).fill('new.example');
      failDiscovery = true;
      await popup.getByRole('button', {name: '检查服务器', exact: true}).click();
      await popup.getByRole('alert').waitFor();
      failDiscovery = false;
      await popup.getByRole('button', {name: '检查服务器', exact: true}).click();
      await popup.getByRole('button', {name: '确认指纹并添加', exact: true}).waitFor();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('safelink-server-profiles-v1')).length), 1, 'Discovery alone must not save a pin');
      await page.screenshot({path: resolve(output, `fingerprint-${width}.png`)});
      await popup.getByRole('button', {name: '确认指纹并添加', exact: true}).click();
      await popup.getByText('wss://new.example/apiws', {exact: true}).waitFor();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('safelink-server-profiles-v1')).length), 2);
      await popup.getByRole('button', {name: '添加账号', exact: true}).first().click();
      await page.waitForFunction(() => !!window.safelinkNavigation);
      const pending = new URL(await page.evaluate(() => window.safelinkNavigation));
      assert.equal(pending.searchParams.get('account'), '2');
      assert.equal(pending.searchParams.get('returnAccount'), '1');
      await popup.getByRole('button', {name: /张明/}).click();
      await page.waitForFunction(() => !!window.safelinkNavigation);
      assert(!new URL(await page.evaluate(() => window.safelinkNavigation)).searchParams.has('account'), 'Account row directly switches to account 1');
      await page.keyboard.press('Escape');
      await page.locator('.popup.active').waitFor({state: 'hidden'});
      // Every fixture stage keeps the host-level return/server entry; no RPC creates an account.
      const stages = [
        {name: 'signIn'}, {name: 'authCode', payload: {_: 'auth.sentCode', type: {_: 'auth.sentCodeTypeSms', length: 5}, phone_number: '+10000000000', phone_code_hash: 'fixture'}},
        {name: 'emailSetup', payload: {phone_number: '+10000000000', phone_code_hash: 'fixture'}},
        {name: 'emailSetupCode', payload: {phone_number: '+10000000000', phone_code_hash: 'fixture', sentCode: {_: 'account.sentEmailCode', email_pattern: 'f***@example.com', length: 6}}},
        {name: 'password'}, {name: 'emailRecover', payload: {email_pattern: 'f***@example.com'}},
        {name: 'signUp', payload: {phone_number: '+10000000000', phone_code_hash: 'fixture'}}, {name: 'setupPassword'}, {name: 'registrationCheck'}
      ];
      const cardClass = await page.evaluate(async() => (await import('/src/pages/authFlow.module.scss')).default.card);
      for(const spec of stages) {
        const oldCard = await page.locator('.' + cardClass).elementHandle();
        await page.evaluate(async(spec) => {const {navigateAuth} = await import('/src/pages/authFlow.tsx'); navigateAuth(spec);}, spec);
        await page.waitForFunction((element) => !element.isConnected, oldCard, {timeout: 15000});
        await page.locator('.' + cardClass).waitFor();
        await settleForMeasurement(page, '#auth-flow-root');
        assert(await returnButton.isVisible(), `Return entry at ${spec.name}`);
        assert(await page.getByRole('button', {name: '服务器与账号', exact: true}).isVisible(), `Server entry at ${spec.name}`);
      }
      await returnButton.click();
      await page.waitForFunction(() => !new URL(window.safelinkNavigation).searchParams.has('returnAccount'));
      assert(await page.evaluate(async() => {
        const {SAFELINK_STORAGE_PREFIX} = await import('/src/config/safelink.ts');
        return JSON.parse(localStorage.getItem(SAFELINK_STORAGE_PREFIX + 'account1')).dc2_auth_key === 'fixture-original-auth-do-not-change';
      }), 'Cancellation must preserve the old auth state');
      assert.deepEqual(errors, [], 'No browser runtime errors');
      await context.close();
      await assertIsolatedPendingLogin(browser, width);
      await assertRecoverableStartup(browser, width);
    }
    console.log('Desktop/mobile day/night grouping, details, HTTPS retry, explicit fingerprint confirmation, direct/add account navigation, removal cancellation, disposed discovery, rendered auth-stage return entries, state preservation, Escape focus restoration and Axe semantics passed. Real isolated worker boot + pending-code return targets preserve the primary fixture account. An installed primary SW controls custom pages but no custom media uses its account paths; worker media/live-stream and both broadcast channels remain isolated, and the primary SW is retained. Missing/corrupt/mismatched startup selection shows recovery without any worker, account database or MTProto transport. Fixtures only, no authenticated session or production writes.');
  } finally {await browser.close();}
})().catch((error) => {console.error(error); process.exitCode = 1;});
