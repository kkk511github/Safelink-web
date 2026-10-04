const {chromium} = require('@playwright/test');
const {createAxeBuilder, settleForMeasurement} = require('../e2e/accessibility.helpers.ts');
const assert = require('node:assert/strict');
const {createHash, createPublicKey} = require('node:crypto');
const {mkdirSync, readFileSync} = require('node:fs');
const {resolve} = require('node:path');

const output = resolve(__dirname, '../test-results/safelink-brand');
mkdirSync(output, {recursive: true});
const publicConfig = readFileSync(resolve(__dirname, '../src/config/safelink.ts'), 'utf8');
const modulus = publicConfig.match(/modulus: '([a-f0-9]+)'/)[1];
const key = createPublicKey({key: {kty: 'RSA', n: Buffer.from(modulus, 'hex').toString('base64url'), e: 'AQAB'}, format: 'jwk'});
const descriptor = {
  version: 1,
  server_id: createHash('sha256').update(key.export({type: 'pkcs1', format: 'der'})).digest('hex'),
  rsa_public_key: key.export({type: 'pkcs1', format: 'pem'}).toString(),
  name: 'Enterprise Messaging'
};

(async() => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  try {
    for(const width of [390, 1280]) {
      const context = await browser.newContext({viewport: {width, height: 900}});
      const page = await context.newPage();
      await page.route('**/.well-known/safelink-client.json', (route) => route.fulfill({json: descriptor}));
      await page.routeWebSocket('**/apiws', (ws) => ws.close());
      const url = new URL(process.env.SAFELINK_PREVIEW_URL || 'http://127.0.0.1:9001/');
      url.searchParams.set('a11y', '1');
      url.searchParams.set('noWorker', '1');
      await page.goto(url.href);
      await page.getByRole('heading', {name: descriptor.name, exact: true}).waitFor().catch(async(error) => {
        console.error(await page.locator('body').innerText());
        await page.screenshot({path: resolve(output, `error-${width}.png`)});
        throw error;
      });
      assert.equal(await page.title(), descriptor.name, 'Login page title must use discovery name');
      await page.evaluate(async() => {
        const {navigateAuth} = await import('/src/pages/authFlow.tsx');
        navigateAuth({name: 'signIn'});
      });
      await page.getByRole('heading', {name: descriptor.name, exact: true}).waitFor();

      async function rename(name) {
        await page.evaluate(async(name) => {
          const {default: rootScope} = await import('/src/lib/rootScope.ts');
          rootScope.dispatchEventSingle('app_config', {
            safelink_app_name: name,
            safelink_server_origin: new URL('/.well-known/safelink-client.json', location.origin).href
          });
        }, name);
      }

      const longName = 'x'.repeat(80);
      await rename(longName);
      await page.getByRole('heading', {name: longName, exact: true}).waitFor();
      assert.equal(await page.title(), longName);
      await settleForMeasurement(page, '#auth-flow-root');
      await page.waitForFunction(() => {
        let element = document.querySelector('#auth-flow-root h1');
        while(element) {
          if(+getComputedStyle(element).opacity < 0.99) return false;
          element = element.parentElement;
        }
        return true;
      });
      const fits = await page.locator('#auth-flow-root h1').evaluate((heading) => {
        const box = heading.getBoundingClientRect();
        return heading.scrollWidth <= heading.clientWidth + 1 && box.left >= 0 && box.right <= innerWidth;
      });
      assert(fits, 'An 80-character name must fit the native login layout');
      await page.screenshot({path: resolve(output, `login-${width}.png`)});

      const literalName = '<img src=x onerror=alert(1)>';
      await rename(literalName);
      await page.getByRole('heading', {name: literalName, exact: true}).waitFor();
      assert.equal(await page.locator('#auth-flow-root h1 img').count(), 0, 'Brand names must render as text, never HTML');
      assert.equal(await page.title(), literalName);
      for(const invalidName of ['x'.repeat(81), 'Invalid\u0000Name', '\ud800']) {
        await rename(invalidName);
        await page.getByRole('heading', {name: 'SafeLink', exact: true}).waitFor();
        assert.equal(await page.title(), 'SafeLink');
      }

      const titles = await page.evaluate(async() => {
        const {default: notifications} = await import('/src/lib/uiNotificationsManager.ts');
        const {default: rootScope} = await import('/src/lib/rootScope.ts');
        notifications.titleMiddlewareHelper = {get: () => () => true};
        notifications.getNotificationsCountForAllAccountsForTitle = async() => 3;
        notifications.setFavicon = () => {};
        await notifications.onTitleInterval();
        const unread = document.title;
        rootScope.dispatchEventSingle('app_config', {
          safelink_app_name: 'Online Rename',
          safelink_server_origin: new URL('/.well-known/safelink-client.json', location.origin).href
        });
        await Promise.resolve();
        const renamed = document.title;
        await notifications.onTitleInterval();
        return {unread, renamed, restored: document.title};
      });
      assert(titles.unread.includes('3'), 'Existing unread title must still show its count');
      assert.equal(titles.renamed, titles.unread, 'Brand changes must not erase the current unread phase');
      assert.equal(titles.restored, 'Online Rename', 'Unread title must restore the latest brand');
      await rename(' \n\t ');
      await page.getByRole('heading', {name: 'SafeLink', exact: true}).waitFor();
      assert.equal(await page.title(), 'SafeLink');

      const audit = await (await createAxeBuilder(page, '#auth-flow-root')).disableRules(['color-contrast']).analyze();
      assert.deepEqual(audit.violations, [], 'Native login accessibility semantics must remain valid');
      await page.getByRole('textbox').last().focus();
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => document.activeElement !== document.body), 'Keyboard focus must stay on a control');
      await context.close();
    }
    console.log('Desktop/mobile discovery, online rename, 80-scalar layout, literal HTML text, invalid-name fallback, unread restoration, Axe semantics and keyboard checks passed; no verification codes sent or real accounts created.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
