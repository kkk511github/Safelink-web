// Run against the SafeLink login preview: node e2e/pending-message-bubble.cjs [url]
const {chromium} = require('@playwright/test');
const assert = require('node:assert/strict');

(async() => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  try {
    const page = await browser.newPage();
    await page.goto(process.argv[2] || 'http://127.0.0.1:9027/', {waitUntil: 'domcontentloaded'});
    await page.locator('#auth-flow-root').waitFor();
    const results = await page.evaluate(async() => {
      const {default: ChatBubbles} = await import('/src/components/chat/bubbles.ts');
      const results = [];
      for(const scenario of ['late-echo', 'no-pending', 'no-echo', 'shared-album']) {
        const chat = Object.create(ChatBubbles.prototype);
        const container = document.createElement('div');
        const destroyed = new Set();
        const createBubble = (mid) => {
          const bubble = document.createElement('div');
          bubble.dataset.peerId = '42';
          bubble.dataset.mid = '' + mid;
          bubble.classList.add('bubble');
          bubble.middlewareHelper = {destroy: () => destroyed.add(bubble)};
          container.append(bubble);
          return bubble;
        };
        const pending = createBubble(122.0001);
        pending.classList.add('is-outgoing');
        const confirmed = createBubble(123);
        Object.assign(chat, {
          bubbles: {'42_122.0001': pending, '42_123': confirmed},
          skippedMids: new Set(),
          bubbleGroups: {removeAndUnmountBubble: (bubble) => bubble.remove()}
        });
        if(scenario === 'no-pending') {
          delete chat.bubbles['42_122.0001'];
          pending.remove();
        } else if(scenario === 'no-echo') {
          delete chat.bubbles['42_123'];
          confirmed.remove();
        } else if(scenario === 'shared-album') {
          confirmed.remove();
          chat.bubbles['42_123'] = pending;
        }
        const result = chat.confirmPendingBubble('42_122.0001', '42_123', 123);
        const expectedBubble = scenario === 'no-pending' ? confirmed : pending;
        results.push({
          scenario,
          count: container.querySelectorAll('.bubble').length,
          correctMapping: chat.bubbles['42_123'] === expectedBubble && !chat.bubbles['42_122.0001'],
          correctResult: scenario === 'no-pending' ? result === undefined : result === pending,
          contextPreserved: !destroyed.has(expectedBubble),
          echoReleased: scenario !== 'late-echo' || destroyed.has(confirmed),
          correctMid: expectedBubble.dataset.mid === '123'
        });
      }
      return results;
    });
    for(const result of results) {
      assert.equal(result.count, 1, result.scenario);
      for(const key of ['correctMapping', 'correctResult', 'contextPreserved', 'echoReleased', 'correctMid']) {
        assert.equal(result[key], true, result.scenario + ': ' + key);
      }
      console.log('PASS: bubble reconciliation ' + result.scenario);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {console.error(error); process.exitCode = 1;});
