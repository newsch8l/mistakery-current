const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, '.pages-dist');
const deck = require(path.join(root, 'cards.json'));

test('published game and map remain interactive from desktop to mobile', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  try {
    const game = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await game.goto(pathToFileURL(path.join(dist, 'index.html')).href);
    await game.waitForSelector('[data-card-id]');
    assert.equal(await game.locator('[data-card-id]').textContent(), 'OPEN_01');
    assert.equal(await game.locator('[data-choice]').count(), 2);
    await game.close();

    for (const width of [736, 320]) {
      const map = await browser.newPage({ viewport: { width, height: 900 } });
      await map.goto(pathToFileURL(path.join(dist, 'map/index.html')).href);
      await map.waitForSelector('[data-node="OPEN_01"]');

      const renderedIds = await map.locator('[data-node]').evaluateAll((nodes) => [...new Set(nodes.map((node) => node.dataset.node))].sort());
      const expectedIds = [
        ...deck.cards.map((card) => card.id),
        ...Object.keys(deck.crises).map((id) => `crisis:${id}`),
        ...Object.keys(deck.endings).map((id) => `ending:${id}`),
      ].sort();
      assert.deepEqual(renderedIds, expectedIds, 'the all-game map lost or invented nodes');

      if (process.env.PAGES_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.PAGES_SCREENSHOT_DIR, { recursive: true });
        await map.screenshot({ path: path.join(process.env.PAGES_SCREENSHOT_DIR, `map-${width}.png`) });
      }

      const overflow = await map.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${width}px map overflows horizontally by ${overflow}px`);

      await map.locator('[data-node="OPEN_02"]').click();
      assert.match(await map.locator('#ms-detail').textContent(), /OPEN_02/);

      await map.locator('[data-scope="agents"]').click();
      assert.equal(await map.locator('[data-node="AGENT_01"]').count(), 1);
      assert.equal(await map.locator('[data-node="OPEN_01"]').count(), 0);

      await map.locator('[data-mode="sim"]').click();
      assert.match(await map.locator('#ms-current').textContent(), /OPEN_01/);
      const resourcesBefore = await map.locator('#ms-resources').textContent();
      await map.locator('#ms-left').click();
      assert.match(await map.locator('#ms-current').textContent(), /OPEN_02/);
      assert.notEqual(await map.locator('#ms-resources').textContent(), resourcesBefore);
      await map.locator('#ms-undo').click();
      assert.match(await map.locator('#ms-current').textContent(), /OPEN_01/);
      assert.equal(await map.locator('#ms-resources').textContent(), resourcesBefore);

      await map.locator('#ms-restart').click();
      assert.match(await map.locator('#ms-current').textContent(), /OPEN_01/);
      await map.locator('#ms-back-map').click();
      assert.equal(await map.locator('#ms-map').isVisible(), true);
      await map.close();
    }
  } finally {
    await browser.close();
  }
});
