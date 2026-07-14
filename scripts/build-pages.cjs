const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, '.pages-dist');
const deck = JSON.parse(fs.readFileSync(path.join(root, 'cards.json'), 'utf8'));

function bundleDeck(value) {
  return `(function(root, factory) {\n  const deck = factory();\n  if (typeof module === 'object' && module.exports) module.exports = deck;\n  root.MISTAKERY_DECK = deck;\n})(typeof globalThis !== 'undefined' ? globalThis : window, function() {\n  return ${JSON.stringify(value)};\n});\n`;
}

function decodeAttribute(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function category(card) {
  if ((card.id || '').startsWith('B3_') || card.scheduler?.moduleId === 'b3') return 'b3';
  if (card.kind === 'sideStory') return 'packageA';
  if (card.kind === 'pressure') return 'pressure';
  if (card.kind === 'opening') return 'opening';
  if (card.arc === 'agents') return 'agents';
  if (card.arc === 'padel') return 'padel';
  return 'other';
}

function buildMap() {
  const wrapper = fs.readFileSync(path.join(root, 'visualization/mistakery-map.template.html'), 'utf8');
  const match = wrapper.match(/srcdoc="([\s\S]*?)"><\/iframe>/);
  if (!match) throw new Error('Could not extract the visualization document');

  let html = decodeAttribute(match[1]);
  const serialized = JSON.stringify(deck, null, 2);
  html = html.replace(/var deck=\{[\s\S]*?\};\n  var keys=/, `var deck=${serialized};\n  var keys=`);
  html = html.replace(
    "if(b3.indexOf(c.id)>=0)return 'b3';\n    if(c.kind==='pressure')",
    "if(b3.indexOf(c.id)>=0)return 'b3';\n    if((c.id||'').indexOf('B3_')===0||(c.scheduler&&c.scheduler.moduleId==='b3'))return 'b3';\n    if(c.kind==='sideStory')return 'packageA';\n    if(c.kind==='pressure')",
  );

  const counts = deck.cards.reduce((all, card) => {
    const key = category(card);
    all[key] = (all[key] || 0) + 1;
    return all;
  }, {});
  const decisions = deck.cards.length;
  const crises = Object.keys(deck.crises || {}).length;
  const endings = Object.keys(deck.endings || {}).length;
  html = html.replace(
    /<strong>\d+ карточки? с выбором · \d+ кризисов? · \d+ финалов?<\/strong>/,
    `<strong>${decisions} карточки с выбором · ${crises} кризисов · ${endings} финалов</strong>`,
  );
  html = html.replace(
    /Вступление \d+ · основные сюжетные ветки \d+ · мини-истории \d+ · случайные проблемы \d+/,
    `Вступление ${counts.opening || 0} · основные сюжетные ветки ${(counts.agents || 0) + (counts.padel || 0)} · мини-истории ${(counts.packageA || 0) + (counts.b3 || 0)} · случайные проблемы ${counts.pressure || 0}`,
  );
  for (const [id, count] of Object.entries({
    opening: counts.opening || 0,
    agents: counts.agents || 0,
    padel: counts.padel || 0,
    packageA: counts.packageA || 0,
    b3: counts.b3 || 0,
    crises,
    endings,
  })) {
    html = html.replace(new RegExp(`(\\{id:'${id}'[^\\n]*note:')\\d+`), `$1${count}`);
  }
  const pressureCards = deck.cards.filter((card) => category(card) === 'pressure');
  const pressureCallbacks = pressureCards.filter((card) => card.callbackOnly).length;
  html = html.replace(
    /(\{id:'pressure'[^\n]*note:')\d+ могут выпасть случайно · \d+ возвращается/,
    `$1${pressureCards.length - pressureCallbacks} могут выпасть случайно · ${pressureCallbacks} возвращается`,
  );

  if (html.includes('<iframe')) throw new Error('Published map unexpectedly contains an iframe');
  return html;
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'map'), { recursive: true });
for (const name of ['index.html', 'app.js', 'game.js', 'style.css']) {
  fs.copyFileSync(path.join(root, name), path.join(dist, name));
}
fs.writeFileSync(path.join(dist, 'cards.bundle.js'), bundleDeck(deck));
fs.writeFileSync(path.join(dist, 'map/index.html'), buildMap());
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log(`Built Pages: ${deck.cards.length} cards, ${Object.keys(deck.crises || {}).length} crises, ${Object.keys(deck.endings || {}).length} endings.`);
