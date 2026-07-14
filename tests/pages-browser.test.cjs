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

    for (const width of [1440, 736, 320]) {
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
      const frame = await map.locator('#mistakery-structure-v1').evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      });
      assert.ok(frame.width <= 736, `${width}px viewport stretches the map to ${frame.width}px`);
      assert.ok(Math.abs(frame.left - (width - frame.width) / 2) <= 1, `${width}px map is not centered: ${JSON.stringify(frame)}`);
      const spacing = await map.evaluate(() => {
        const root = document.querySelector('#mistakery-structure-v1').getBoundingClientRect();
        const bodyStyle = getComputedStyle(document.body);
        const groupStyle = getComputedStyle(document.querySelector('.ms-group'));
        return {
          rootTop: root.top,
          bottomSpace: document.documentElement.scrollHeight - root.bottom,
          bodyPaddingTop: parseFloat(bodyStyle.paddingTop),
          bodyPaddingBottom: parseFloat(bodyStyle.paddingBottom),
          groupPaddingTop: parseFloat(groupStyle.paddingTop),
          groupBorderTop: parseFloat(groupStyle.borderTopWidth),
        };
      });
      assert.ok(spacing.bodyPaddingTop >= 12 && spacing.rootTop >= 12, `${width}px page has no top breathing room: ${JSON.stringify(spacing)}`);
      assert.ok(spacing.bodyPaddingBottom >= 32 && spacing.bottomSpace >= 31, `${width}px page has no bottom breathing room: ${JSON.stringify(spacing)}`);
      assert.ok(spacing.groupPaddingTop >= 16 && spacing.groupBorderTop >= 1, `map groups visually run together: ${JSON.stringify(spacing)}`);

      if (width === 736) {
        assert.equal(await map.locator('[data-window]').count(), 4, 'opening and Agents insertion windows are missing');
        await map.locator('[data-window="opening_shared_seed"]').click();
        assert.equal(await map.locator('[data-node="MOM_INVESTOR_SEED"]').getAttribute('data-window-match'), 'true');
        assert.equal(await map.locator('[data-node="COMA_SEED"]').getAttribute('data-window-match'), 'true');
        assert.equal(await map.locator('[data-node="MOM_FLYERS"]').getAttribute('data-window-match'), 'false');

        for (const id of ['OPEN_06', 'AGENT_01', 'AGENT_04_LEAD']) {
          assert.match(await map.locator(`[data-node="${id}"]`).textContent(), /↩/, `${id} has no memory-reader icon`);
        }

        await map.locator('[data-node="OPEN_06"]').click();
        const open06Detail = await map.locator('#ms-detail').textContent();
        assert.match(open06Detail, /Мама против инвестора/);
        assert.match(open06Detail, /История о коме/);
        assert.match(open06Detail, /Мамины листовки/);
        assert.doesNotMatch(open06Detail, /control_seed_mom/);
        await map.locator('#ms-detail details summary').first().click();
        assert.equal(await map.locator('#ms-detail .ms-memory-result').first().isVisible(), true);
        assert.match(await map.locator('#ms-detail .ms-memory-result').first().textContent(), /Команда \+3.*Фаундер -4/);
        if (process.env.PAGES_SCREENSHOT_DIR) {
          await map.screenshot({ path: path.join(process.env.PAGES_SCREENSHOT_DIR, 'detail-open06.png') });
        }

        await map.locator('[data-node="AGENT_04_LEAD"]').click();
        const leadDetail = await map.locator('#ms-detail').textContent();
        assert.match(leadDetail, /Зарплата и облачные кредиты/);
        assert.match(leadDetail, /Конфликт с разработчиком/);
        assert.match(leadDetail, /Навязчивые продажи/);
        assert.doesNotMatch(leadDetail, /payroll_offer_compute_only/);
        await map.locator('#ms-detail details summary').first().click();
        assert.equal(await map.locator('#ms-detail .ms-memory-result').first().isVisible(), true);
        if (process.env.PAGES_SCREENSHOT_DIR) {
          await map.screenshot({ path: path.join(process.env.PAGES_SCREENSHOT_DIR, 'detail-agent04.png') });
        }

        await map.locator('[data-node="AGENT_01"]').click();
        const agent01Detail = await map.locator('#ms-detail').textContent();
        assert.match(agent01Detail, /Приняли облачные кредиты/);
        assert.doesNotMatch(agent01Detail, /payroll_offer_compute_only/);
      }

      await map.locator('[data-node="OPEN_02"]').click();
      assert.match(await map.locator('#ms-detail').textContent(), /OPEN_02/);

      await map.locator('[data-scope="agents"]').click();
      assert.equal(await map.locator('[data-node="AGENT_01"]').count(), 1);
      assert.equal(await map.locator('[data-node="OPEN_01"]').count(), 0);

      await map.locator('[data-mode="sim"]').click();
      assert.match(await map.locator('#ms-current').textContent(), /OPEN_01/);
      const simulatorCard = await map.evaluate(() => {
        const root = document.querySelector('#mistakery-structure-v1').getBoundingClientRect();
        const cardNode = document.querySelector('#ms-current');
        const card = cardNode.getBoundingClientRect();
        return {
          rootLeft: root.left,
          cardLeft: card.left,
          cardWidth: card.width,
          cardPadding: parseFloat(getComputedStyle(cardNode).paddingLeft),
        };
      });
      assert.ok(simulatorCard.cardWidth <= 560, `${width}px simulator card is too wide: ${JSON.stringify(simulatorCard)}`);
      assert.ok(Math.abs(simulatorCard.rootLeft - simulatorCard.cardLeft) <= 1, `${width}px simulator card is not left-aligned: ${JSON.stringify(simulatorCard)}`);
      assert.ok(simulatorCard.cardPadding >= 16, `${width}px simulator card needs more inner spacing: ${JSON.stringify(simulatorCard)}`);
      if (process.env.PAGES_SCREENSHOT_DIR) {
        await map.screenshot({ path: path.join(process.env.PAGES_SCREENSHOT_DIR, `sim-${width}.png`) });
      }
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
