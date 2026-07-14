const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeNonCardTranslations } = require('../scripts/sync-translations.cjs');

test('card catalog sync preserves approved crisis and ending translations', () => {
  const nextCards = { meta: { language: 'ru' }, cards: { OPEN_01: { text: 'новый перевод' } } };
  const existing = {
    crises: { cash_low: { text: 'кризис' } },
    endings: { validation: { text: 'финал' } },
  };

  assert.deepEqual(mergeNonCardTranslations(nextCards, existing), {
    ...nextCards,
    crises: existing.crises,
    endings: existing.endings,
  });
});
