# Third-party notices

Patzer is MIT-licensed (see [LICENSE](LICENSE)), but bundles third-party code under several licenses. The list below covers the runtime dependencies whose licenses meaningfully affect redistributors.

## chessground (GPL-3.0)

> https://github.com/lichess-org/chessground

The web frontend imports [`chessground`](https://github.com/lichess-org/chessground), which is **licensed under GPL-3.0**. If you redistribute a built/compiled artifact that includes chessground, the combined work must comply with GPL-3.0 — that is more restrictive than MIT. In practice for Patzer:

- **Source distribution** (this git repo, `npm install` from sources): you're fine — chessground is a runtime dependency under its own license.
- **Binary distribution** (the built Docker image we publish, or any fork that ships compiled bundles): the combined image is effectively GPL-3.0, and you must be ready to provide source on request and not impose additional restrictions.

If GPL is a problem for you, you would need to swap chessground for an MIT-compatible board (e.g. roll your own SVG board renderer). Patzer doesn't have a non-GPL fallback yet.

## Stockfish (GPL-3.0)

The container image apt-installs the upstream Stockfish package, which is GPL-3.0. We invoke it as a separate process over UCI; we do not link against it. Same redistribution caveat applies.

## Board move sounds (CC0)

`web/src/assets/sounds/board-move.wav` and `board-capture.wav` are cut from
[“Chess Pieces Move (Close)”](https://freesound.org/people/JJTaynos/sounds/733927/) by **JJTaynos** on Freesound,
released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public-domain dedication). CC0 needs no
attribution; it is credited here so the origin stays traceable. Each file is one click from that recording (at 24.41 s
and 40.95 s), 0.32 s long, high-passed at 60 Hz, faded out and loudness-matched — 48 kHz, 16-bit mono.

## Lichess puzzle database (CC0)

The tactic, mate and endgame tasks of the Learn section (`web/src/learn/content/*.json`, steps with a `src` field) are puzzles from the [Lichess puzzle database](https://database.lichess.org/#puzzles), released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). No permission or attribution is required; we keep each puzzle's id anyway, and the lesson page links to it on lichess.org. The lesson texts and all other positions are written for Patzer. The general tactic puzzles of the Train page (`server/src/chess/tacticsSet.json`, about 4,000 puzzles with their ids, solutions, ratings and theme tags, chosen by `scripts/build-tactics-set.mjs`) come from the same database, under the same license (it covers the whole export, solutions and metadata included); the page credits the database in its footer, and each puzzle links to its page on lichess.org once solved.

## Pixel themes

The pieces (`web/src/themes/pixel/sprites.ts`) were drawn for the Nectar project by its author and are contributed here under this project's MIT license.

The font (`web/src/themes/pixel/m6x11-400.woff2`) is not under the MIT license. It is [m6x11](https://managore.itch.io/m6x11) by Daniel Linssen, with the Cyrillic extension [m6x11cyrillic](https://nattogames.itch.io/m6x11cyrillic) by Natto Games, both "free to use with attribution": see `web/src/themes/pixel/CREDITS.txt`.

## Other notable dependencies

| Package | License |
| --- | --- |
| `react`, `react-dom` | MIT |
| `chess.js` | BSD-2-Clause |
| `hono` | MIT |
| `better-sqlite3` | MIT |
| `framer-motion` | MIT |
| `tailwindcss` | MIT |
| `bcryptjs` | MIT |
| `zod` | MIT |
| `lucide-react` | ISC |
| `i18next`, `react-i18next` | MIT |

Run `npm ls --all --json` and a license auditor (e.g. `license-checker`) for the full transitive list of any release.
