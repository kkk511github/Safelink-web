const {chromium} = require('playwright');
const assert = require('node:assert/strict');

(async() => {
  const browser = await chromium.launch({headless: true});
  try {
    for(const width of [390, 1280]) {
      const page = await browser.newPage({viewport: {width, height: 900}});
      page.on('pageerror', (error) => console.error('Auth preview:', error.message));
      await page.goto(process.env.SAFELINK_PREVIEW_URL || 'http://127.0.0.1:9027/');
      await page.locator('#auth-flow-root').waitFor();
      await page.evaluate(async() => {
        const {default: rootScope} = await import('/src/lib/rootScope.ts');
        const apiManager = Object.create(rootScope.managers.apiManager);
        apiManager.registrationPolicy = async() => ({inviteRequired: false, passwordRequired: false});
        apiManager.registerAccount = async(params, invite) => {
          window.safelinkTestInvite = invite;
          throw {type: 'INVITE_CODE_INVALID'};
        };
        rootScope.managers.apiManager = apiManager;
        rootScope.managers.appStateManager = {pushToState: async() => undefined};
        rootScope.managers.passwordManager = {updateSettings: async(settings) => {
          window.safelinkTestPassword = settings.newPassword;
          throw {type: 'TEST_PASSWORD_FAILURE'};
        }};
        const {navigateAuth} = await import('/src/pages/authFlow.tsx');
        navigateAuth({name: 'signUp', payload: {phone_number: '+10000000000', phone_code_hash: 'mock-hash'}});
      });
      await page.getByText('邀请码（选填）', {exact: true}).waitFor().catch(async(error) => {
        console.error(await page.locator('body').innerText());
        await page.screenshot({path: '/tmp/safelink-auth-preview-error.png'});
        throw error;
      });
      const inputs = page.locator('#auth-flow-root .input-field');
      const boxes = await inputs.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
      assert(boxes.length >= 3 && Math.max(...boxes) - Math.min(...boxes) <= 1, 'Invitation and name inputs must have equal width');
      await page.screenshot({path: `/tmp/safelink-web-invite-optional-${width}.png`});
      await page.evaluate(async() => {
        const {default: rootScope} = await import('/src/lib/rootScope.ts');
        rootScope.managers.apiManager.registrationPolicy = async() => ({inviteRequired: true, passwordRequired: false});
        const {navigateAuth} = await import('/src/pages/authFlow.tsx');
        navigateAuth({name: 'signUp', payload: {phone_number: '+10000000000', phone_code_hash: 'mock-hash'}});
      });
      await page.getByText('邀请码（必填）', {exact: true}).waitFor();
      await page.locator('#auth-flow-root button.btn-color-primary').click();
      await page.getByText('请输入邀请码', {exact: true}).waitFor();
      await page.getByLabel('邀请码').fill('Invite-123');
      await inputs.first().locator('.input-field-input').fill('Test');
      await page.locator('#auth-flow-root button.btn-color-primary').click();
      await page.getByText('邀请码无效、已过期或名额已用完', {exact: true}).waitFor();
      assert.equal(await page.evaluate(() => window.safelinkTestInvite), 'Invite-123');
      await page.screenshot({path: `/tmp/safelink-web-invite-required-${width}.png`});
      await page.evaluate(async() => {
        const {navigateAuth} = await import('/src/pages/authFlow.tsx');
        navigateAuth({name: 'setupPassword'});
      });
      await page.getByText('设置登录密码', {exact: true}).waitFor();
      const passwords = page.locator('#auth-flow-root input[type=password]:not(.stealthy)');
      await passwords.nth(0).fill('Test-Password-123');
      await passwords.nth(1).fill('different');
      await page.getByRole('button', {name: '完成', exact: true}).click();
      await page.getByText('请输入密码，并确认两次输入一致', {exact: true}).waitFor();
      assert.equal(await page.evaluate(() => window.safelinkTestPassword), undefined, 'A mismatch must not call the password RPC');
      await passwords.nth(1).fill('Test-Password-123');
      await page.getByRole('button', {name: '完成', exact: true}).click();
      await page.getByText('TEST_PASSWORD_FAILURE', {exact: true}).waitFor().catch(async(error) => {
        console.error(await page.locator('body').innerText());
        console.error(await page.evaluate(() => window.safelinkTestPassword));
        await page.screenshot({path: '/tmp/safelink-auth-password-error.png'});
        throw error;
      });
      assert.equal(await page.evaluate(() => window.safelinkTestPassword), 'Test-Password-123');
      await page.screenshot({path: `/tmp/safelink-web-password-${width}.png`});
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, 'Authentication cards must not overflow');
      await page.close();
    }
    console.log('SafeLink auth UI passed on desktop/mobile; all registration/password RPCs were mocked');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
