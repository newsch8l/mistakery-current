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

  for (const relative of ['index.html', 'app.js', 'game.js', 'style.css', 'cards.bundle.js', 'map/index.html', '.nojekyll']) {
    assert.equal(fs.existsSync(path.join(dist, relative)), true, `missing ${relative}`);
  }

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
  assert.deepEqual(JSON.parse(embeddedTranslations[1]), translations.cards);
  assert.equal(map.includes('<iframe'), false, 'published map must not use a nested scrolling iframe');
  assert.match(map, /data-mode="sim"/);
  assert.match(map, /id="ms-undo"/);
  assert.match(map, /id="ms-detail"[\s\S]*id="ms-groups"/);

  const ids = new Set(sourceDeck.cards.map((card) => card.id));
  const approvedPackageA = new Set([
    'PAYROLL_RESTRICTED_AI_SEED', 'PAYROLL_RESTRICTED_AI_CALLBACK',
    'DEV_HOSTAGE_SEED', 'DEV_HOSTAGE_CALLBACK',
    'MOM_INVESTOR_SEED', 'MOM_INVESTOR_CALLBACK',
    'COMA_SEED', 'COMA_CALLBACK_AUTHORIZED', 'COMA_CALLBACK_BLOCKED', 'MOM_FLYERS',
  ]);
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
});
