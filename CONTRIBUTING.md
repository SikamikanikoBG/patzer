# Contributing to Patzer

Thanks for considering a contribution. Patzer is a small, opinionated project — please read this before opening a big PR.

## What we want

- **Bug fixes** of any size — open a PR, no need to ask first.
- **Small, well-scoped features** that fit the "self-hosted Chess.com Game Review alternative for a household" pitch.
- **Translations.** EN, BG, ES and DE ship today; see [Adding a language](#adding-a-language) below.
- **Coach prompt improvements** for reducing hallucinations or improving voice in a specific audience (kid / beginner / etc.).

## What we'll probably push back on

- New top-level pages or major UX changes without a prior issue / discussion.
- Pulling in heavy dependencies for tiny features.
- Variants (chess960 / king-of-the-hill / 3check). The classifier and coach assume standard chess and would need real work to extend.
- Cloud-hosted features. Patzer is local-first.

## Local dev

Requirements: Node ≥ 20.11.

```bash
git clone https://github.com/SikamikanikoBG/patzer.git
cd patzer
npm install
npm run setup   # downloads Stockfish 17 into ./bin/ (Windows, Linux, macOS)
npm run dev
```

The dev script runs the server (port 8800) and the Vite frontend (port 5173) concurrently. Open <http://localhost:5173>.

## Repo layout

```
server/           Node + Hono API, SQLite, Stockfish driver, Ollama client
  src/auth/       Sessions, password hashing, middleware
  src/chess/      Stockfish UCI driver, move classifier, chess.com import
  src/coach/      Ollama client, anti-hallucination prompt assembly
  src/routes/     HTTP routes
  src/ws/         WebSocket handlers (Play, Lobby)
web/              React + Vite + Tailwind
  src/components/ Reusable UI (board, eval bar/graph, captured pieces, …)
  src/pages/      Route-level pages
  src/locales/    i18next dictionaries
  src/lib/        Sounds, TTS, markdown, helpers
```

Two key invariants:

1. **Coach is render-only.** The LLM never analyzes — `server/src/coach/prompts.ts` pre-computes facts (piece inventory, threats, recent moves, captured pieces, in-check flag) and hands them to the model as plain English. If you find yourself asking the LLM to "figure out X", figure it out server-side first.
2. **No user-facing config in env vars.** Anything a user might want to change at runtime lives in the SQLite DB (Admin → System or Settings). Env vars are operational only (`PORT`, `DB_PATH`, `STOCKFISH_PATH`, `SESSION_SECRET`).

## Before opening a PR

```bash
npm run typecheck
npm test
npm run build
```

All three must be green. CI runs them on Node 20 and 22 plus a Docker image build.

## Tests

`npm test` runs [vitest](https://vitest.dev). Server tests live in `server/test/*.test.ts` (kept out of
`server/dist`); web tests can sit next to their component as `*.test.ts(x)`. `npm run test:watch` for a
watch loop. If you touch `server/src/chess/classifier.ts` or `glicko.ts`, extend the matching suite — the
rating and classification math is exactly the code where a silent regression hurts everyone for weeks.

`npm run test:e2e` boots a real server on a throwaway SQLite file and drives two WebSocket clients through a
full PvP game (moves, clocks, draw offers, takebacks, rematch). Run it whenever you touch `server/src/ws/play.ts`.

`npm run test:ui` does the same thing through the actual interface, with two real browsers clicking the board.
It needs playwright, which is deliberately *not* a project dependency (it would pull browser binaries into
every install): `npm i -D playwright && npx playwright install chromium` first. Run it whenever you touch
`web/src/components/ChessBoard.tsx` or `web/src/pages/Play.tsx` — a board that renders perfectly but silently
ignores clicks has shipped twice now, and only this test sees it.

## Writing lessons

The Learn section keeps what a lesson *teaches* apart from what it *says*:

- `web/src/learn/content/<level>.json` — positions, solutions, stars; no words. The step types are
  documented in `web/src/learn/types.ts`.
- `web/src/locales/learn/<lang>.json` — the words, keyed `<lessonId>.<stepId>`. A `…_kid` key is the
  same text in kid-mode words; a `…_done` key is shown once a task is solved. A translation can never
  change a solution.

A wrong move in a lesson teaches someone something false, so every lesson is checked twice:

1. `npm test` runs `web/src/learn/content.test.ts`: every position loads, every move is legal,
   every "checkmate" is one, every star task is solvable in exactly `par` moves, every text exists.
   What an explanation claims about its board ("only the king defends f7") goes in there as well.
2. `npm run verify:lessons` asks Stockfish (`npm run setup` installs it) whether each "find the move"
   answer is its clear first choice — or, for several accepted answers, that none is a mistake — and
   whether each "play it out" position is a forced win within the move limit. Run it before a PR that
   touches lesson content.

Tactics are best taken from the [Lichess puzzle database](https://database.lichess.org/#puzzles)
(CC0) — generated by Stockfish and solved by thousands of players — with the puzzle id in `src`.
Don't copy lessons from Chess.com (copyright) or Lichess *Learn* (AGPL).

## Commit style

No strict format, but please:

- Write commit messages in the imperative mood ("Fix Stockfish info parser", not "Fixed").
- Reference the issue if there is one.
- For changelog-worthy changes, drop a `## [Unreleased]` entry in `CHANGELOG.md` so we don't have to chase you at release time.

## Code style

- TypeScript strict mode is on. No `any` without a `// eslint-disable` comment justifying it.
- Server code is ESM — use `.js` extensions in relative imports.
- Tailwind for styling. Prefer composing utilities over writing custom CSS, except for chessground overrides in `index.css`.
- Comments should explain **why**, not what. The next contributor can read the code; they need the context.

## Adding a language

Every language-dependent string is in a lookup table keyed by language code, so a new language is one
entry per table — no `if (language === …)` branches to chase. Pick an ISO 639-1 code (`es`, `ru`, …) — call
it `<code>` below. Spanish (`es`, PR #17) is a complete worked example to diff against.

1. **UI strings.** Copy `web/src/locales/en.json` to `web/src/locales/<code>.json` and translate every string. Don't change the keys. Plurals use `i18next`'s `{{count}}` syntax — leave those tokens alone.
2. **Register it once** in `web/src/lib/languages.ts` (`LANGUAGES`: code, short badge, native name — the language's name in itself, which every language picker shows — and BCP-47 tag for text-to-speech) and import the JSON in `web/src/i18n.ts`. Every toggle, select, TTS voice filter and signup default reads that list.
3. **Server enums.** Add `<code>` to the `z.enum(['en', 'bg', 'es'])` language schemas (`grep -rn "'es'" server/src/routes`) and to the `Language` type in `server/src/types.ts`.
4. **Coach text.** The coach speaks the player's language:
   - `server/src/coach/prompts.ts` — add a `<code>` entry to each `Record<Language, …>` table (`PIECE_NAMES`, `AUDIENCE_DATA`, `PERSONA`, `HARD_RULES`, `CASTLE_*`, `MOVE_DESCRIPTIONS`, `CLASS_PHRASES`, and the evaluation/material phrase tables further down).
   - `server/src/coach/review.ts` — add a `<code>` entry to `REVIEW_TEXT` (Game Review task prompts and fallback sentences).
5. **Lesson texts.** Copy `web/src/locales/learn/en.json` to `web/src/locales/learn/<code>.json`, translate
   it (keep the keys and the `{{side}}` token) and add the file to `TEXTS` in `web/src/learn/content.ts`.
   Until then the Learn section reads English. `web/src/locales/locales.test.ts` shows how to pin a
   language's lesson texts to full parity with English.
6. **Database default.** The `profiles.language` column is a free-form `TEXT NOT NULL DEFAULT 'en'` (see `server/src/db.ts`), so no migration is needed — existing users keep their language.

To test locally: `npm run dev`, switch to your language in *Settings*, play a couple of moves with the coach on, and confirm the coach output stays in your language across kid / beginner / intermediate / advanced audience tiers.

## Reporting security issues

Please don't file public GitHub issues for security problems. See [SECURITY.md](SECURITY.md).
