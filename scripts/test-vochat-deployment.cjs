const assert = require('node:assert/strict');
const {createHash, createPublicKey} = require('node:crypto');
const {mkdirSync, readFileSync, writeFileSync} = require('node:fs');
const {resolve} = require('node:path');
const express = require('express');
const {chromium} = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const root = resolve(__dirname, '..');
const output = resolve(root, 'test-results/vochat-deployment');
mkdirSync(output, {recursive: true});
const modulus = readFileSync(resolve(root, 'src/config/safelink.ts'), 'utf8').match(/modulus: '([a-f0-9]+)'/)[1];
const key = createPublicKey({key: {kty: 'RSA', n: Buffer.from(modulus, 'hex').toString('base64url'), e: 'AQAB'}, format: 'jwk'});
const descriptor = {
  version: 1,
  name: 'Vochat',
  server_id: createHash('sha256').update(key.export({type: 'pkcs1', format: 'der'})).digest('hex'),
  rsa_public_key: key.export({type: 'pkcs1', format: 'pem'}).toString()
};

(async() => {
  const app = express();
  app.enable('strict routing');
  app.get('/web', (req, res) => res.redirect(308, '/web/' + req.url.slice('/web'.length)));
  app.get('/.well-known/safelink-client.json', (_req, res) => res.json(descriptor));
  app.use('/web', express.static(resolve(root, 'dist')));
  const server = await new Promise((accept) => {
    const server = app.listen(0, '127.0.0.1', () => accept(server));
  });
  let browser;
  const results = [];
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
    for(const width of [390, 1280]) {
      const context = await browser.newContext({viewport: {width, height: 900}});
      const page = await context.newPage();
      const failures = [], errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        if(response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
      });
      // No remote infrastructure, accounts or verification messages are used.
      await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.routeWebSocket('**/*', (socket) => socket.close());
      await page.goto(`${origin}/web?a11y=1`);
      await page.getByRole('heading', {name: 'Vochat', exact: true}).waitFor({timeout: 30000});
      assert.equal(new URL(page.url()).pathname, '/web/');
      assert.equal(await page.title(), 'Vochat');
      const phoneLogin = page.getByRole('button', {name: /log in by phone number/i});
      if(await phoneLogin.count()) await phoneLogin.click();
      const image = await page.locator('#auth-flow-root img[src*="vochat.png"]').evaluate((image) => ({
        src: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight
      }));
      assert(image.src.startsWith(`${origin}/web/assets/img/vochat.png`));
      assert.equal(image.width, 1254);
      assert.equal(image.height, 1254);
      const installation = await page.evaluate(async() => {
        const href = document.querySelector('link[rel=manifest]').href;
        const manifest = await (await fetch(href)).json();
        const registrations = await navigator.serviceWorker.getRegistrations();
        return {href, manifest, scopes: registrations.map((registration) => registration.scope)};
      });
      assert(installation.href.startsWith(`${origin}/web/site`));
      assert.equal(installation.manifest.name, 'Vochat Web');
      assert.equal(new URL(installation.manifest.scope, installation.href).pathname, '/web/');
      assert.equal(new URL(installation.manifest.start_url, installation.href).pathname, '/web/');
      assert(installation.scopes.every((scope) => scope === `${origin}/web/`));
      const audit = await new AxeBuilder({page}).include('#auth-flow-root').disableRules(['color-contrast']).analyze();
      assert.deepEqual(audit.violations, []);
      await page.getByRole('textbox').last().focus();
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => document.activeElement !== document.body));
      assert.deepEqual(failures, [], 'Production assets must load under /web/');
      assert.deepEqual(errors, [], 'Production login must not throw');
      await page.screenshot({path: resolve(output, `login-${width}.png`)});
      results.push({width, image, installation, assetFailures: failures, pageErrors: errors, axeViolations: audit.violations.length});
      await context.close();
    }
    writeFileSync(resolve(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log('Production /web/ desktop/mobile login, icon, manifest, worker scope, assets, Axe semantics and keyboard smoke passed. No real accounts or codes used.');
  } finally {
    await browser?.close();
    await new Promise((accept) => server.close(accept));
  }
})().catch((error) => {console.error(error); process.exitCode = 1;});
