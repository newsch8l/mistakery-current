const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, '.pages-dist');
const deck = require(path.join(root, 'cards.json'));

test('published game and v2 map remain interactive from desktop to mobile', async () => {
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

      // Version tabs: v2 is active, v1 archive, the game and the story page are links.
      assert.match(await map.locator('[aria-label="Версии карты"]').textContent(), /2\.0 — сторилеты/);
      assert.equal(await map.locator('[aria-label="Версии карты"] a[href="v1/"]').count(), 1, 'v2 map has no link to the frozen archive');
      assert.equal(await map.locator('[aria-label="Версии карты"] a[href="../"]').count(), 1, 'v2 map has no link back to the game');
      assert.equal(await map.locator('[aria-label="Версии карты"] a[href="../story/"]').count(), 1, 'v2 map has no link to the story page');

      // Phase 2: the v2 simulator runs on the embedded real game engine.
      assert.equal(await map.locator('[data-mode="sim"]').count(), 1, 'the v2 simulator toggle is missing');
      assert.equal(await map.locator('[data-mode="sim"]').isDisabled(), false, 'the engine failed to load: simulator toggle is disabled');

      const translationToggle = map.locator('#ms-translation');
      assert.equal(await translationToggle.isChecked(), false, 'Russian translation must be off by default');
      assert.equal(await map.locator('#ms-detail [data-translation="message"]').count(), 0);
      await translationToggle.check();
      assert.match(await map.locator('#ms-detail [data-translation="message"]').textContent(), /Привет, визионер/);
      assert.match(await map.locator('#ms-detail [data-translation="left"]').textContent(), /Проверить рынок/);
      assert.match(await map.locator('#ms-detail [data-translation="right"]').textContent(), /Довериться названию/);
      const translatedOverflow = await map.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(translatedOverflow <= 1, `${width}px translated map overflows horizontally by ${translatedOverflow}px`);

      if (width === 736) {
        assert.equal(await map.locator('[data-window]').count(), 4, 'opening and SADBOT insertion windows are missing');
        assert.match(await map.locator('.ms-legend').textContent(), /↩ отдельная карточка-последствие/);
        assert.match(await map.locator('.ms-legend').textContent(), /🧠 учитывает прошлое решение/);
        assert.equal(await map.locator('[data-node="OPEN_01"]').getAttribute('aria-pressed'), 'true');
        await map.locator('[data-window="opening_shared_seed"]').press('Enter');
        assert.equal(await map.locator('[data-window="opening_shared_seed"]').getAttribute('aria-pressed'), 'true');
        assert.equal(await map.locator('[data-node="OPEN_01"]').getAttribute('aria-pressed'), 'false');
        assert.match(await map.locator('#ms-detail').textContent(), /Окно вариативной вставки/);
        assert.match(await map.locator('#ms-detail').textContent(), /MOM_INVESTOR_SEED/);
        assert.equal(await map.locator('[data-node="MOM_INVESTOR_SEED"]').getAttribute('data-window-match'), 'true');
        assert.equal(await map.locator('[data-node="COMA_SEED"]').getAttribute('data-window-match'), 'true');
        assert.equal(await map.locator('[data-node="MOM_FLYERS"]').getAttribute('data-window-match'), 'false');

        // SADBOT side-story window highlights the pre-viral seeds.
        await map.locator('[data-window="sadbot_sidestory_window"]').press('Enter');
        assert.match(await map.locator('#ms-detail').textContent(), /До вируса/);
        assert.equal(await map.locator('[data-node="PAYROLL_RESTRICTED_AI_SEED"]').getAttribute('data-window-match'), 'true');
        assert.equal(await map.locator('[data-node="DEV_HOSTAGE_SEED"]').getAttribute('data-window-match'), 'true');
        assert.equal(await map.locator('[data-node="B3_SALES_PRESSURE_SEED"]').getAttribute('data-window-match'), 'true');
        assert.equal(await map.locator('[data-node="MOM_FLYERS"]').getAttribute('data-window-match'), 'false');

        // Investor window leans on the viral scandal and the old AGENT_01 order.
        await map.locator('[data-window="sadbot_investor_window"]').press('Enter');
        assert.equal(await map.locator('[data-node="SADBOT_INVESTOR_CLAIM"]').getAttribute('data-window-match'), 'true');
        assert.equal(await map.locator('[data-node="AGENT_01"]').getAttribute('data-window-match'), 'true');
        if (process.env.PAGES_SCREENSHOT_DIR) {
          await map.screenshot({ path: path.join(process.env.PAGES_SCREENSHOT_DIR, 'window-selection.png') });
        }
        await map.locator('[data-node="OPEN_02"]').press('Enter');
        assert.equal(await map.locator('[data-window="sadbot_investor_window"]').getAttribute('aria-pressed'), 'false');
        assert.equal(await map.locator('[data-node="OPEN_02"]').getAttribute('aria-pressed'), 'true');

        for (const id of ['OPEN_06', 'AGENT_01', 'SADBOT_03_VIRAL', 'SADBOT_04_LEAD', 'SADBOT_07_INVOICE']) {
          assert.match(await map.locator(`[data-node="${id}"]`).textContent(), /🧠/, `${id} has no memory-reader icon`);
        }
        assert.doesNotMatch(await map.locator('[data-node="OPEN_06"]').textContent(), /↩/);
        assert.match(await map.locator('[data-node="MOM_INVESTOR_CALLBACK"]').textContent(), /↩/);
        assert.doesNotMatch(await map.locator('[data-node="MOM_INVESTOR_CALLBACK"]').textContent(), /🧠/);

        // Storylet entries advertise that they arrive from the shared pool.
        assert.match(await map.locator('[data-node="SADBOT_01_SEED"]').textContent(), /🎲/);
        assert.match(await map.locator('[data-node="SADBOT_04_LEAD"]').textContent(), /⊘/);
        for (const id of ['SADBOT_04_LEAD', 'SADBOT_05_ORDER_CALL', 'SADBOT_FRIDAY', 'SADBOT_05B_THEATER', 'SADBOT_06_LEGAL']) {
          assert.match(await map.locator(`[data-node="${id}"]`).textContent(), /⛓/, `${id} lost its protected-pair icon`);
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

        await map.locator('[data-node="SADBOT_04_LEAD"]').click();
        const leadDetail = await map.locator('#ms-detail').textContent();
        assert.match(leadDetail, /Зарплата и облачные кредиты/);
        assert.match(leadDetail, /Конфликт с разработчиком/);
        assert.match(leadDetail, /Навязчивые продажи/);
        assert.doesNotMatch(leadDetail, /payroll_offer_compute_only/);
        await map.locator('#ms-detail details summary').first().click();
        assert.equal(await map.locator('#ms-detail .ms-memory-result').first().isVisible(), true);

        await map.locator('[data-node="SADBOT_03_VIRAL"]').click();
        assert.match(await map.locator('#ms-detail').textContent(), /Шантаж оставлен как фича/);

        // Storylet buttons explain the pool return; the legal card names both invoice doubles.
        await map.locator('[data-node="SADBOT_01_SEED"]').click();
        assert.match(await map.locator('#ms-detail').textContent(), /возврат в общий пул — следующая карта ветки придёт оттуда позже/);
        await map.locator('[data-node="SADBOT_06_LEGAL"]').click();
        assert.match(await map.locator('#ms-detail').textContent(), /двойники: в прогоне придёт одна из них, по флагу/);

        await map.locator('[data-node="AGENT_01"]').click();
        const agent01Detail = await map.locator('#ms-detail').textContent();
        assert.match(agent01Detail, /Приняли облачные кредиты/);
        assert.doesNotMatch(agent01Detail, /payroll_offer_compute_only/);

        await map.locator('[data-node="PAYROLL_RESTRICTED_AI_CALLBACK"]').click();
        const payrollCallbackDetail = await map.locator('#ms-detail').textContent();
        assert.match(payrollCallbackDetail, /pay us or i shut everything down right now/);
        assert.match(payrollCallbackDetail, /давай деньги, или я прямо сейчас всё вырублю/);
        assert.match(payrollCallbackDetail, /Promise payroll/);
        assert.match(payrollCallbackDetail, /Pay out of pocket/);

        // SADBOT copy is available in Russian on the map.
        await map.locator('[data-node="SADBOT_06_LEGAL"]').click();
        const sadbotLegalDetail = await map.locator('#ms-detail').textContent();
        assert.match(sadbotLegalDetail, /Юристы говорят: покупать 500 страдающих ИИ-сотрудников — это работорговля/);
        assert.doesNotMatch(sadbotLegalDetail, /Перевод пока не утверждён/);

        await map.locator('[data-node="crisis:cash_low"]').click();
        const crisisDetail = await map.locator('#ms-detail').textContent();
        assert.match(crisisDetail, /Бухгалтерия спрашивает, принимает ли ваше видение банковские переводы/);
        assert.match(crisisDetail, /Продать стулья/);
        assert.match(crisisDetail, /Объявить изобилие/);

        await map.locator('[data-node="ending:validation"]').click();
        const endingDetail = await map.locator('#ms-detail').textContent();
        assert.match(endingDetail, /ВАЛИДИРОВАНО/);
        assert.match(endingDetail, /Никто не понимает зачем, но счёт настоящий/);
      }

      await map.locator('[data-node="OPEN_02"]').click();
      assert.match(await map.locator('#ms-detail').textContent(), /OPEN_02/);

      await map.locator('[data-scope="sadbot"]').click();
      assert.equal(await map.locator('[data-node="SADBOT_01_SEED"]').count(), 1);
      assert.equal(await map.locator('[data-node="AGENT_01"]').count(), 1);
      assert.equal(await map.locator('[data-node="OPEN_01"]').count(), 0);
      assert.equal(await map.locator('[data-node="PADEL_01"]').count(), 0);

      // The simulator drives the real engine: layout, one move, undo.
      await map.locator('[data-mode="sim"]').click();
      assert.match(await map.locator('#ms-current').textContent(), /OPEN_01/);
      assert.match(await map.locator('#ms-current [data-translation="message"]').textContent(), /Привет, визионер/);
      assert.match(await map.locator('#ms-status').textContent(), /Сторилетов доступно из пула/);
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
      const resourcesBefore = await map.locator('#ms-resources').textContent();
      await map.locator('#ms-left').click();
      assert.match(await map.locator('#ms-current').textContent(), /OPEN_02/);
      assert.notEqual(await map.locator('#ms-resources').textContent(), resourcesBefore);
      await map.locator('#ms-undo').click();
      assert.match(await map.locator('#ms-current').textContent(), /OPEN_01/);
      assert.equal(await map.locator('#ms-resources').textContent(), resourcesBefore);
      await map.locator('#ms-restart').click();
      assert.match(await map.locator('#ms-current').textContent(), /OPEN_01/);

      if (width === 736) {
        // Play the seeded run to its end: the engine must never strand the
        // simulator — every run finishes with an ending card (storylet pool,
        // fillers and invoice doubles all come from the embedded engine).
        let sawCrisis = false;
        for (let step = 0; step < 60 && !(await map.locator('#ms-again').count()); step += 1) {
          if (await map.locator('#ms-giveup').count()) {
            sawCrisis = true;
            assert.equal(await map.locator('#ms-current [data-translation="message"]').count(), 1, 'simulator crisis has no Russian message');
            await map.locator('#ms-giveup').click();
            break;
          }
          await map.locator(step % 3 === 1 ? '#ms-right' : '#ms-left').click();
        }
        assert.equal(await map.locator('#ms-again').count(), 1, `simulator did not reach an ending${sawCrisis ? ' after crisis' : ''}`);
        assert.equal(await map.locator('#ms-current [data-translation="title"]').count(), 1, 'simulator ending has no Russian title');
        assert.equal(await map.locator('#ms-current [data-translation="message"]').count(), 1, 'simulator ending has no Russian message');
      }
      await map.locator('#ms-back-map').click();
      assert.equal(await map.locator('#ms-map').isVisible(), true);
      await map.close();
    }

    // The frozen v1 archive keeps its own working simulator and links back.
    const archive = await browser.newPage({ viewport: { width: 736, height: 900 } });
    await archive.goto(pathToFileURL(path.join(dist, 'map/v1/index.html')).href);
    await archive.waitForSelector('[data-node="OPEN_01"]');
    assert.match(await archive.locator('[aria-label="Версии карты"]').textContent(), /1\.0 — рельса \(архив 14\.07\)/);
    assert.equal(await archive.locator('[aria-label="Версии карты"] a[href="../"]').count(), 1, 'v1 archive has no link to the v2 map');
    assert.equal(await archive.locator('[aria-label="Версии карты"] a[href="../../"]').count(), 1, 'v1 archive has no link back to the game');
    assert.equal(await archive.locator('[data-node="AGENT_04_LEAD"]').count(), 1, 'v1 archive lost the old agents rail');
    await archive.locator('[data-mode="sim"]').click();
    assert.match(await archive.locator('#ms-current').textContent(), /OPEN_01/);
    await archive.locator('#ms-left').click();
    assert.match(await archive.locator('#ms-current').textContent(), /OPEN_02/);
    await archive.locator('#ms-undo').click();
    assert.match(await archive.locator('#ms-current').textContent(), /OPEN_01/);
    await archive.close();

    // The partner-facing story page reads cleanly on phone and desktop widths.
    for (const width of [1280, 360]) {
      const story = await browser.newPage({ viewport: { width, height: 900 } });
      await story.goto(pathToFileURL(path.join(dist, 'story/index.html')).href);
      await story.waitForSelector('h1');
      assert.match(await story.locator('h1').textContent(), /Стартап/);
      const storyOverflow = await story.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(storyOverflow <= 1, `${width}px story page overflows horizontally by ${storyOverflow}px`);
      await story.close();
    }
  } finally {
    await browser.close();
  }
});
