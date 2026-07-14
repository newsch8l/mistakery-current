const fs = require('node:fs');
const path = require('node:path');

function quoteBlock(section, marker) {
  const lines = section.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => marker.test(line.trim()));
  if (markerIndex < 0) return null;
  const markerText = lines[markerIndex].trim();
  const block = [];
  for (let index = markerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('>')) {
      block.push(line.replace(/^> ?/, '').replace(/<br\s*\/?>/gi, '').replace(/\s{2}$/, ''));
      continue;
    }
    if (block.length && line.trim() !== '') break;
  }
  return { markerText, text: block.join('\n') };
}

function parseCatalog(markdown, deck) {
  const headings = [...markdown.matchAll(/^## ([A-Z0-9_]+) — .*$/gm)];
  const sections = new Map();
  headings.forEach((match, index) => {
    sections.set(match[1], markdown.slice(match.index, headings[index + 1]?.index ?? markdown.length));
  });

  const cards = {};
  for (const card of deck.cards) {
    const section = sections.get(card.id);
    if (!section) throw new Error(`Translation catalog is missing ${card.id}`);
    const english = quoteBlock(section, /^\*\*EN\*\*$/);
    const russian = quoteBlock(section, /^\*\*RU(?: — .+)?\*\*$/);
    if (!english?.text || !russian?.text) throw new Error(`${card.id} is missing an EN or RU message block`);
    if (english.text !== card.text) throw new Error(`${card.id} English message does not match cards.json`);

    const choiceLines = [...section.matchAll(/^- \*\*(.+?)\*\*:/gm)].map((match) => match[1]);
    const choices = {};
    for (const side of ['left', 'right']) {
      const sourceLabel = card.choices[side].label;
      const prefix = `${sourceLabel} — `;
      const choiceLine = choiceLines.find((line) => line.startsWith(prefix));
      if (!choiceLine) throw new Error(`${card.id}:${side} English label does not match the translation catalog`);
      const label = choiceLine.slice(prefix.length).trim();
      if (!label) throw new Error(`${card.id}:${side} has an empty Russian label`);
      choices[side] = { sourceLabel, label };
    }

    cards[card.id] = {
      sourceText: english.text,
      text: russian.text,
      approved: !russian.markerText.includes('перевод не утверждён'),
      choices,
    };
  }

  const productionIds = new Set(deck.cards.map((card) => card.id));
  const extraIds = [...sections.keys()].filter((id) => !productionIds.has(id));
  if (extraIds.length) throw new Error(`Translation catalog has non-production cards: ${extraIds.join(', ')}`);
  return { meta: { language: 'ru', source: 'MISTAKERY_CARDS_EN_RU.md' }, cards };
}

function mergeNonCardTranslations(nextCards, existing) {
  return {
    ...nextCards,
    crises: existing.crises || {},
    endings: existing.endings || {},
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const source = process.argv[2];
  if (!source) throw new Error('Usage: node scripts/sync-translations.cjs /absolute/path/to/MISTAKERY_CARDS_EN_RU.md');
  const deck = JSON.parse(fs.readFileSync(path.join(root, 'cards.json'), 'utf8'));
  const catalog = fs.readFileSync(path.resolve(source), 'utf8');
  const translationsPath = path.join(root, 'translations.ru.json');
  const existing = fs.existsSync(translationsPath) ? JSON.parse(fs.readFileSync(translationsPath, 'utf8')) : {};
  const translations = mergeNonCardTranslations(parseCatalog(catalog, deck), existing);
  fs.writeFileSync(translationsPath, `${JSON.stringify(translations, null, 2)}\n`);
  console.log(`Synced Russian text for ${Object.keys(translations.cards).length} production cards.`);
}

if (require.main === module) main();

module.exports = { parseCatalog, mergeNonCardTranslations };
