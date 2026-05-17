# Contributing to Patzer

Thanks for considering a contribution. Patzer is a small, opinionated project — please read this before opening a big PR.

## What we want

- **Bug fixes** of any size — open a PR, no need to ask first.
- **Small, well-scoped features** that fit the "self-hosted Chess.com Game Review alternative for a household" pitch.
- **Translations.** EN + BG ship today; see [Adding a language](#adding-a-language) below.
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
# Windows: download Stockfish into ./bin/
npm run setup
# Linux/macOS: install Stockfish via package manager (apt / brew)
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
npm run build
```

Both must be green. CI runs them on Node 20 and 22 plus a Docker image build.

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

Two files plus one register call. Pick an ISO 639-1 code (`es` for Spanish, `ru` for Russian, etc.) — call it `<code>` below.

1. **UI strings.** Copy `web/src/locales/en.json` to `web/src/locales/<code>.json` and translate every string. Don't change the keys. Plurals use `i18next`'s `{{count}}` syntax — leave those tokens alone.
2. **Coach prompt fragments.** The coach speaks the player's language. The strings live in `server/src/coach/prompts.ts`:
   - `CLASS_PHRASE_<EN|BG>` — one phrase per move classification (`brilliant`, `best`, …, `miss`).
   - `severityFromCpLoss` — language-tagged blocks for "small / medium / huge" mistake magnitude.
   - The `headerEn` / `headerBg` template literals plus the matching `askEn` / `askBg` instruction trailers near the bottom of the file.
   - `sanToNatural` — translates piece names (knight → "horsey" for kids, etc.) per language.
   Add `<code>` variants alongside the EN/BG ones, then plumb them through the existing `language === 'bg' ? … : …` branches.
3. **Register the locale** in `web/src/i18n.ts` (the `resources` map) and add the option in `web/src/pages/Settings.tsx` (the language `<select>`) plus `web/src/pages/Setup.tsx` (the `LangBtn` row).
4. **Database default.** The `profiles.language` column is a free-form `TEXT NOT NULL DEFAULT 'en'` (see `server/src/db.ts`), so no migration is needed — existing users keep their language.

To test locally: `npm run dev`, switch to your language in *Settings*, play a couple of moves with the coach on, and confirm the coach output stays in your language across kid / beginner / intermediate / advanced audience tiers.

## Reporting security issues

Please don't file public GitHub issues for security problems. See [SECURITY.md](SECURITY.md).
