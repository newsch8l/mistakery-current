const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, '.pages-dist');
const deck = JSON.parse(fs.readFileSync(path.join(root, 'cards.json'), 'utf8'));
const translations = JSON.parse(fs.readFileSync(path.join(root, 'translations.ru.json'), 'utf8'));

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
  if (card.arc === 'padel') return 'padel';
  if (card.kind === 'story' && !card.arc) return 'sadbot';
  return 'other';
}

function buildMap() {
  const wrapper = fs.readFileSync(path.join(root, 'visualization/mistakery-map.template.html'), 'utf8');
  const match = wrapper.match(/srcdoc="([\s\S]*?)"><\/iframe>/);
  if (!match) throw new Error('Could not extract the visualization document');

  let html = decodeAttribute(match[1]);
  html = html.replace(
    '</head>',
    '<style id="standalone-layout">html>body{padding:24px 16px 56px}#mistakery-structure-v1{width:100%;max-width:736px;margin-inline:auto}@media(max-width:560px){html>body{padding:12px 8px 32px}}</style>\n</head>',
  );
  const serialized = JSON.stringify(deck, null, 2);
  html = html.replace(/var deck=\{[\s\S]*?\};\n  var translations=/, `var deck=${serialized};\n  var translations=`);
  html = html.replace(/var translations=\{[\s\S]*?\};\n  var keys=/, `var translations=${JSON.stringify(translations)};\n  var keys=`);
  const engineSource = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  html = html.replace('/* build:inject-engine */', () => engineSource);
  if (!html.includes('MistakeryEngine')) throw new Error('The map simulator did not receive the game engine');

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
    `Вступление ${counts.opening || 0} · основные сюжетные ветки ${(counts.sadbot || 0) + (counts.padel || 0)} · мини-истории ${(counts.packageA || 0) + (counts.b3 || 0)} · случайные проблемы ${counts.pressure || 0}`,
  );
  const pressureCards = deck.cards.filter((card) => category(card) === 'pressure');
  const pressureCallbacks = pressureCards.filter((card) => card.callbackOnly).length;
  for (const [id, count] of Object.entries({
    opening: counts.opening || 0,
    sadbot: counts.sadbot || 0,
    padel: counts.padel || 0,
    packageA: counts.packageA || 0,
    b3: counts.b3 || 0,
    pressure: pressureCards.length - pressureCallbacks,
    crises,
    endings,
  })) {
    html = html.replace(new RegExp(`(\\{id:'${id}'[^\\n]*note:')\\d+`), `$1${count}`);
  }

  if (html.includes('<iframe')) throw new Error('Published map unexpectedly contains an iframe');
  return html;
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'map/v1'), { recursive: true });
fs.mkdirSync(path.join(dist, 'story'), { recursive: true });
for (const name of ['index.html', 'app.js', 'game.js', 'style.css']) {
  fs.copyFileSync(path.join(root, name), path.join(dist, name));
}
fs.writeFileSync(path.join(dist, 'cards.bundle.js'), bundleDeck(deck));
fs.writeFileSync(path.join(dist, 'map/index.html'), buildMap());
fs.copyFileSync(path.join(root, 'visualization/map-v1-frozen.html'), path.join(dist, 'map/v1/index.html'));
fs.copyFileSync(path.join(root, 'visualization/story.html'), path.join(dist, 'story/index.html'));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log(`Built Pages: ${deck.cards.length} cards, ${Object.keys(deck.crises || {}).length} crises, ${Object.keys(deck.endings || {}).length} endings.`);
