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

  const sourceDeck = JSON.parse(fs.readFileSync(path.join(root, 'cards.json'), 'utf8'));
  delete require.cache[require.resolve(path.join(dist, 'cards.bundle.js'))];
  const bundledDeck = require(path.join(dist, 'cards.bundle.js'));
  assert.deepEqual(bundledDeck, sourceDeck);

  const map = fs.readFileSync(path.join(dist, 'map/index.html'), 'utf8');
  const embedded = map.match(/var deck=(\{[\s\S]*?\});\n  var keys=/);
  assert.ok(embedded, 'map does not contain an embedded deck');
  assert.deepEqual(JSON.parse(embedded[1]), sourceDeck);
  assert.equal(map.includes('<iframe'), false, 'published map must not use a nested scrolling iframe');
  assert.match(map, /data-mode="sim"/);
  assert.match(map, /id="ms-undo"/);
  assert.match(map, /id="ms-detail"[\s\S]*id="ms-groups"/);

  const ids = new Set(sourceDeck.cards.map((card) => card.id));
  for (const card of sourceDeck.cards) {
    for (const side of ['left', 'right']) {
      const choice = card.choices[side];
      const next = choice.next == null ? [] : Array.isArray(choice.next) ? choice.next : [choice.next];
      for (const id of next) assert.equal(ids.has(id), true, `${card.id}:${side} points to missing ${id}`);
    }
  }
});
