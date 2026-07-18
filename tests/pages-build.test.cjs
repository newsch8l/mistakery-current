const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, '.pages-dist');

test('builds the current game and interactive map from canonical cards.json', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/build-pages.cjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  for (const relative of ['index.html', 'app.js', 'game.js', 'style.css', 'cards.bundle.js', 'map/index.html', 'map/v1/index.html', 'story/index.html', 'story/full/index.html', '.nojekyll']) {
    assert.equal(fs.existsSync(path.join(dist, relative)), true, `missing ${relative}`);
  }

  const story = fs.readFileSync(path.join(dist, 'story/index.html'), 'utf8');
  assert.equal(story, fs.readFileSync(path.join(root, 'visualization/story.html'), 'utf8'), 'story page must be published verbatim');
  assert.match(story, /Как это играется/);
  assert.match(story, /href="\.\.\/"/, 'story page does not link to the game');
  assert.match(story, /href="\.\.\/map\/"/, 'story page does not link to the map');
  assert.match(story, /href="full\/"/, 'short story page does not link to the full version');
  assert.equal(/SADBOT_\d|AGENT_\d|OPEN_\d|PADEL_\d/.test(story), false, 'the partner-facing story page must not leak internal card ids');

  const storyFull = fs.readFileSync(path.join(dist, 'story/full/index.html'), 'utf8');
  assert.equal(storyFull, fs.readFileSync(path.join(root, 'visualization/story-full.html'), 'utf8'), 'full story page must be published verbatim');
  assert.match(storyFull, /Первый клиент/);
  assert.match(storyFull, /Фоновый хаос/);
  assert.equal(/<section id="padel">/.test(storyFull), false, 'the padel path is hidden for now and must not render as a section');
  assert.match(storyFull, /href="\.\.\/\.\.\/"/, 'full story page does not link to the game');
  assert.match(storyFull, /href="\.\.\/\.\.\/map\/"/, 'full story page does not link to the map');
  assert.match(storyFull, /href="\.\.\/"/, 'full story page does not link back to the short version');
  assert.equal(/SADBOT_\d|AGENT_\d|OPEN_\d|PADEL_\d/.test(storyFull), false, 'the full story page must not leak internal card ids');

  const frozen = fs.readFileSync(path.join(root, 'visualization/map-v1-frozen.html'), 'utf8');
  const publishedV1 = fs.readFileSync(path.join(dist, 'map/v1/index.html'), 'utf8');
  assert.equal(publishedV1, frozen, 'archived v1 map must be published byte-for-byte from the frozen artifact');
  assert.match(publishedV1, /43 карточки с выбором · 9 кризисов · 20 финалов/, 'frozen v1 map lost its 14.07 data');
  assert.match(publishedV1, /1\.0 — рельса \(архив 14\.07\)/, 'frozen v1 map has no version tabs');
  assert.match(publishedV1, /href="\.\.\/"/, 'frozen v1 map does not link back to the v2 map');
  assert.match(publishedV1, /data-mode="sim"/, 'frozen v1 map must keep its working simulator');

  const translationsPath = path.join(root, 'translations.ru.json');
  assert.equal(fs.existsSync(translationsPath), true, 'missing translations.ru.json');
  const translations = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));

  const sourceDeck = JSON.parse(fs.readFileSync(path.join(root, 'cards.json'), 'utf8'));
  delete require.cache[require.resolve(path.join(dist, 'cards.bundle.js'))];
  const bundledDeck = require(path.join(dist, 'cards.bundle.js'));
  assert.deepEqual(bundledDeck, sourceDeck);

  const map = fs.readFileSync(path.join(dist, 'map/index.html'), 'utf8');
  const embedded = map.match(/var deck=(\{[\s\S]*?\});\n  var translations=/);
  assert.ok(embedded, 'map does not contain an embedded deck');
  assert.deepEqual(JSON.parse(embedded[1]), sourceDeck);
  const embeddedTranslations = map.match(/var translations=(\{[\s\S]*?\});\n  var keys=/);
  assert.ok(embeddedTranslations, 'map does not contain embedded Russian translations');
  assert.deepEqual(JSON.parse(embeddedTranslations[1]), translations);
  assert.equal(map.includes('<iframe'), false, 'published map must not use a nested scrolling iframe');
  assert.match(map, /data-mode="sim"/);
  assert.match(map, /MistakeryEngine/, 'the v2 simulator must embed the real game engine');
  assert.match(map, /id="ms-undo"/);
  assert.match(map, /2\.0 — сторилеты/);
  assert.match(map, /href="v1\/"/, 'v2 map does not link to the frozen v1 archive');
  assert.match(map, /data-scope="sadbot"/);
  assert.match(map, /id="ms-detail"[\s\S]*id="ms-groups"/);
  assert.match(map, /57 карточки с выбором · 8 кризисов · 18 финалов/);
  assert.match(map, /Вступление 7 · основные сюжетные ветки 23 · мини-истории 15 · случайные проблемы 12/);
  assert.match(map, /\{id:'sadbot',name:'SADBOT — первый клиент',note:'14 /);
  assert.match(map, /\{id:'padel',name:'Падел',note:'9 /);
  assert.match(map, /\{id:'packageA'[^\n]*note:'13 /);
  assert.match(map, /\{id:'pressure'[^\n]*note:'12 /);
  assert.match(map, /\{id:'crises'[^\n]*note:'8 /);
  assert.match(map, /\{id:'endings'[^\n]*note:'18 /);
  assert.equal(map.includes("id:'agents'"), false, 'the v2 map must not keep the old agents rail group');
  assert.match(map, /sadbot_sidestory_window/);
  assert.match(map, /sadbot_investor_window/);

  const ids = new Set(sourceDeck.cards.map((card) => card.id));
  const approvedPackageA = new Set([
    'PAYROLL_RESTRICTED_AI_SEED', 'PAYROLL_RESTRICTED_AI_CALLBACK',
    'DEV_HOSTAGE_SEED', 'DEV_HOSTAGE_CALLBACK',
    'MOM_INVESTOR_SEED', 'MOM_INVESTOR_CALLBACK',
    'COMA_SEED', 'COMA_CALLBACK_AUTHORIZED', 'COMA_CALLBACK_BLOCKED', 'MOM_FLYERS',
  ]);
  const sadbotIds = sourceDeck.cards.filter((card) => card.id.startsWith('SADBOT')).map((card) => card.id);
  assert.equal(sadbotIds.length, 13, 'unexpected SADBOT translation scope');
  for (const id of sadbotIds) {
    const translated = translations.cards[id];
    assert.equal(translated.approved, true, `${id} Russian copy is not enabled`);
    assert.match(translated.text, /[А-Яа-яЁё]/, `${id} has no Russian message`);
    assert.notEqual(translated.text, translated.sourceText, `${id} still duplicates its English message`);
  }
  assert.deepEqual(Object.keys(translations.cards).sort(), [...ids].sort(), 'translations must cover every production card exactly once');
  for (const card of sourceDeck.cards) {
    const translated = translations.cards[card.id];
    assert.ok(translated, `missing translation for ${card.id}`);
    assert.equal(typeof translated.approved, 'boolean', `${card.id} has no translation approval state`);
    if (approvedPackageA.has(card.id)) assert.equal(translated.approved, true, `${card.id} must use its approved Russian copy`);
    assert.equal(translated.sourceText, card.text, `${card.id} English message drifted from the translation catalog`);
    assert.ok(translated.text.trim(), `${card.id} has an empty Russian message`);
    for (const side of ['left', 'right']) {
      const choice = card.choices[side];
      assert.equal(translated.choices[side].sourceLabel, choice.label, `${card.id}:${side} English label drifted from the translation catalog`);
      assert.ok(translated.choices[side].label.trim(), `${card.id}:${side} has an empty Russian label`);
      const next = choice.next == null ? [] : Array.isArray(choice.next) ? choice.next : [choice.next];
      for (const id of next) assert.equal(ids.has(id), true, `${card.id}:${side} points to missing ${id}`);
    }
  }

  assert.deepEqual(Object.keys(translations.crises).sort(), Object.keys(sourceDeck.crises).sort(), 'translations must cover every crisis exactly once');
  for (const [id, crisis] of Object.entries(sourceDeck.crises)) {
    const translated = translations.crises[id];
    assert.equal(translated.approved, true, `${id} crisis translation is not approved`);
    assert.equal(translated.sourceText, crisis.text, `${id} crisis English message drifted`);
    assert.equal(translated.rescue.sourceLabel, crisis.rescueLabel, `${id} rescue label drifted`);
    assert.equal(translated.giveup.sourceLabel, crisis.giveupLabel, `${id} give-up label drifted`);
    assert.ok(translated.text.trim() && translated.rescue.label.trim() && translated.giveup.label.trim(), `${id} crisis translation is incomplete`);
  }

  assert.deepEqual(Object.keys(translations.endings).sort(), Object.keys(sourceDeck.endings).sort(), 'translations must cover every ending exactly once');
  for (const [id, ending] of Object.entries(sourceDeck.endings)) {
    const translated = translations.endings[id];
    assert.equal(translated.approved, true, `${id} ending translation is not approved`);
    assert.equal(translated.sourceTitle, ending.title, `${id} ending English title drifted`);
    assert.equal(translated.sourceText, ending.text, `${id} ending English message drifted`);
    assert.ok(translated.title.trim() && translated.text.trim(), `${id} ending translation is incomplete`);
  }

  assert.equal(translations.endings.founder_high.title, 'РЕЖИМ МЕССИИ');
  assert.equal(translations.endings.founder_high.text, 'Ты удалил продукт и объявил, что задизраптил саму идею покупки.');
});
