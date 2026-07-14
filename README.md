# Mistakery

Browser-based startup survival game about finding B2BuyerSpyer's first paying customer.

## Published version

- Game: <https://newsch8l.github.io/mistakery-current/>
- Interactive structure map and simulator: <https://newsch8l.github.io/mistakery-current/map/>

GitHub Pages is rebuilt automatically after every push to `main`. The build reads `cards.json`, regenerates the playable deck, and embeds the same current data into the interactive map. The previous `newsch8l/mistakery` repository and its Pages site are separate and remain unchanged.

Open `index.html` directly in a browser. No terminal or local server is required.

- `cards.json` is the canonical English deck and gameplay data.
- `cards.bundle.js` is the generated offline copy used by `index.html`.
- `scripts/build-pages.cjs` prepares the current game at `/` and the interactive map at `/map/`.

This public repository intentionally contains only the files required to run and verify the shared website. Internal design documents and authoring tools remain outside it.
