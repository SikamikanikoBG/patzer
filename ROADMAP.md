# Patzer roadmap

A loose, opinionated list of where Patzer is headed. Items aren't promises — they're the maintainer's current view, and they shift. Open an issue / discussion if you want to nudge priority.

## Now (3.x)

- **Opening explorer.** Live master-game stats from Lichess ("Master games here: 47% white, 14% draw") layered on top of the local ECO/name lookup that already exists. → [#11](https://github.com/SikamikanikoBG/patzer/issues/11)
- **PvP draw / takeback / rematch.** The PvP lobby and live connection both work now; the protocol is still missing offer-draw, takeback-request, and one-click rematch. → [#10](https://github.com/SikamikanikoBG/patzer/issues/10)
- **Mobile play layout.** Sticky bottom action bar, swipe-up sheet for the moves panel, safe-area padding. → [#13](https://github.com/SikamikanikoBG/patzer/issues/13)

## Soon

- **Threats display.** "What's the opponent threatening here?" toggle in Game Review. → [#12](https://github.com/SikamikanikoBG/patzer/issues/12)
- **Cross-platform setup.** `setup.sh` mirroring `setup.ps1`. → [#16](https://github.com/SikamikanikoBG/patzer/issues/16)
- **Test suite.** vitest with coverage on the classifier and Glicko rating math. → [#15](https://github.com/SikamikanikoBG/patzer/issues/15)
- **More languages.** A third locale alongside English/Bulgarian — Spanish is the likely first win, but any language a contributor actually speaks is welcome. → [#14](https://github.com/SikamikanikoBG/patzer/issues/14)

## Shipped since this was last updated

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
