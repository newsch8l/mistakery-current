# Mistakery

Browser-based startup survival game about finding B2BuyerSpyer's first paying customer.

## Published version

- Game: <https://newsch8l.github.io/mistakery-current/>
- Interactive structure map and simulator: <https://newsch8l.github.io/mistakery-current/map/>

GitHub Pages is rebuilt automatically after every push to `main`. The build reads `cards.json`, regenerates the playable deck, and embeds the same current data into the interactive map. The previous `newsch8l/mistakery` repository and its Pages site are separate and remain unchanged.

Russian text is compiled from the private `MISTAKERY_CARDS_EN_RU.md` catalog before publication:

```sh
npm run translations:sync -- /absolute/path/to/MISTAKERY_CARDS_EN_RU.md
```

The publication checks that every production card has catalog entries for its message and both buttons, and that the catalog's English source still matches `cards.json`. Entries explicitly marked as not yet approved stay visibly marked that way. A new or edited card therefore cannot be published with silently outdated translation data.

Open `index.html` directly in a browser. No terminal or local server is required.

- `cards.json` is the canonical English deck and gameplay data.
- `cards.bundle.js` is the generated offline copy used by `index.html`.
- `translations.ru.json` is the generated Russian layer used by the map and simulator.
- `scripts/build-pages.cjs` prepares the current game at `/` and the interactive map at `/map/`.

This public repository intentionally contains only the files required to run and verify the shared website. Internal design documents and authoring tools remain outside it.
