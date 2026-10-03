const {chromium} = require('@playwright/test');
const {createAxeBuilder, expectNoA11yViolations, setIncreasedContrast, settleForMeasurement} = require('../e2e/accessibility.helpers.ts');
const assert = require('node:assert/strict');
const {mkdirSync} = require('node:fs');
const {resolve} = require('node:path');
const outputDir = resolve(__dirname, '../test-results/safelink-auth');
mkdirSync(outputDir, {recursive: true});

async function checkAccessibility(page) {
  const include = '#auth-flow-root';
  await settleForMeasurement(page, include);
  // Match the upstream contrast suite: preserve the ordinary palette, audit the opt-in correction.
  const ordinary = await (await createAxeBuilder(page, include)).disableRules(['color-contrast']).analyze();
  assert.deepEqual(ordinary.violations, [], 'Authentication semantic accessibility violations');
  await setIncreasedContrast(page, true);
  try {
    await expectNoA11yViolations(page, include);
  } finally {
    await setIncreasedContrast(page, false);
  }
}

(async() => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  try {
    for(const width of [390, 1280]) {
      const context = await browser.newContext({viewport: {width, height: 900}});
      const page = await context.newPage();
      page.on('pageerror', (error) => console.error('Auth preview:', error.message));
      const url = new URL(process.env.SAFELINK_PREVIEW_URL || 'http://127.0.0.1:9027/');
      url.searchParams.set('a11y', '1');
      await page.goto(url.href);
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
        await page.screenshot({path: resolve(outputDir, 'auth-preview-error.png')});
        throw error;
      });
      const inputs = page.locator('#auth-flow-root .input-field');
      const boxes = await inputs.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
      assert(boxes.length >= 3 && Math.max(...boxes) - Math.min(...boxes) <= 1, 'Invitation and name inputs must have equal width');
      await page.screenshot({path: resolve(outputDir, `invite-optional-${width}.png`)});
      await page.evaluate(async() => {
        const {default: rootScope} = await import('/src/lib/rootScope.ts');
        rootScope.managers.apiManager.registrationPolicy = async() => ({inviteRequired: true, passwordRequired: false});
        const {navigateAuth} = await import('/src/pages/authFlow.tsx');
        navigateAuth({name: 'signUp', payload: {phone_number: '+10000000000', phone_code_hash: 'mock-hash'}});
      });
      await page.getByText('邀请码（必填）', {exact: true}).waitFor();
      await page.locator('#auth-flow-root button.btn-color-primary').click();
      await page.getByText('请输入邀请码', {exact: true}).waitFor();
      await checkAccessibility(page);
      await page.getByLabel('邀请码').fill('12345');
      await inputs.first().locator('.input-field-input').fill('Test');
      await page.locator('#auth-flow-root button.btn-color-primary').click();
      await page.getByText('邀请码无效、已过期或名额已用完', {exact: true}).waitFor();
      assert.equal(await page.evaluate(() => window.safelinkTestInvite), '12345');
      await page.screenshot({path: resolve(outputDir, `invite-required-${width}.png`)});
      await page.evaluate(async() => {
        const {navigateAuth} = await import('/src/pages/authFlow.tsx');
        navigateAuth({name: 'setupPassword'});
      });
      await page.getByText('设置登录密码', {exact: true}).waitFor();
      const passwords = page.locator('#auth-flow-root input[type=password]:not(.stealthy)');
      await passwords.nth(0).fill('Test-Password-123');
      await passwords.nth(0).focus();
      await page.keyboard.press('Tab');
      assert.equal(await passwords.nth(1).evaluate((input) => input === document.activeElement), true, 'Tab must reach password confirmation');
      await passwords.nth(1).fill('different');
      await page.getByRole('button', {name: '完成', exact: true}).focus();
      await page.keyboard.press('Enter');
      await page.getByText('请输入密码，并确认两次输入一致', {exact: true}).waitFor();
      assert.equal(await page.evaluate(() => window.safelinkTestPassword), undefined, 'A mismatch must not call the password RPC');
      await passwords.nth(1).fill('Test-Password-123');
      await page.getByRole('button', {name: '完成', exact: true}).click();
      await page.getByText('TEST_PASSWORD_FAILURE', {exact: true}).waitFor().catch(async(error) => {
        console.error(await page.locator('body').innerText());
        console.error(await page.evaluate(() => window.safelinkTestPassword));
        await page.screenshot({path: resolve(outputDir, 'auth-password-error.png')});
        throw error;
      });
      assert.equal(await page.evaluate(() => window.safelinkTestPassword), 'Test-Password-123');
      await page.screenshot({path: resolve(outputDir, `password-${width}.png`)});
      await checkAccessibility(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, 'Authentication cards must not overflow');
      await context.close();
    }
    console.log('SafeLink auth UI, Axe (contrast in opt-in mode) and keyboard checks passed on desktop/mobile; all registration/password RPCs were mocked');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
