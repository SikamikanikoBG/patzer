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
