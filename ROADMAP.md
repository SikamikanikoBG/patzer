# Patzer roadmap

A loose, opinionated list of where Patzer is headed. Items aren't promises — they're the maintainer's current view, and they shift. Open an issue / discussion if you want to nudge priority.

## Now

- **Drag gesture for the phone moves sheet** — the tap-to-expand sheet shipped in 7.10; a real swipe is the follow-up.
- **Master games when Lichess reopens its API** — the panel is wired (7.10) and waits on [lila#19610](https://github.com/lichess-org/lila/issues/19610); a self-hosted explorer works today via `LICHESS_EXPLORER_URL`.
- **More languages.** Spanish landed in 7.10 thanks to @fiedri; the recipe in CONTRIBUTING is now one table entry per file. Any language a contributor actually speaks is welcome.

## Soon

- **Split `prompts.ts`** into `locales/*.ts`, `moves.ts`, `facts.ts` (same public API) — proposed by @fiedri in #17.
- **Web component tests** — the vitest harness (7.10) covers the server; the React side has one pure-helper suite so far.

## Shipped since this was last updated

- **7.10.0** — Spanish (#14/#17), PvP draw / takeback / rematch (#10), "What's the threat?" (#12), master-game stats (#11), phone Play layout (#13), `setup.sh` (#16), vitest suite + e2e (#15); PvP sessions and clocks fixed; Brilliant classification fixed.
- **Tactic puzzles from your blunders** — `/train`, personalized from your own analyzed games.
- **MultiPV in the analyzer** — multiple candidate lines in Lab/Game Review, plus the full `brilliant`→`miss` classification tier.
- **Stockfish strength tuning** — `UCI_LimitStrength` + `UCI_Elo` per difficulty tier.
- **Mate-in-N display** — `#N` shown wherever an eval is mate.
- **Repertoire view** — per-user opening tree at the Players/profile level, scored by win-rate per line.

## Maybe / later

- **Live demo at demo.patzer.app** (read-only, daily DB reset, rate-limited).
- **Annotation engine.** Auto-generate PGN comments like `{Threatening Nf6+ winning the queen}` from pre-computed facts.
- **Internal Glicko rating** between family-member profiles.
- **Position search.** "All my games where I had a backward pawn on d6."
- **Lichess study import / export.**

## Out of scope

- Variants (chess960, KOTH, 3-check). Classifier and coach assume standard chess.
- Cloud-hosted multi-tenant SaaS.
- Real-time spectator mode.
- ML-trained move classification (Stockfish + Lichess formula is the floor).
