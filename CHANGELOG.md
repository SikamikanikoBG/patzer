# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.0] — 2026-05-10

The chess.com-fidelity major. Three specialist agents (UI Designer, Chess
Nerd, AI Expert) produced concrete specs against the live chess.com Game
Review, Help Center, and the Lichess accuracy formula; this release lands the
top-priority gaps from each.

### ⚠️ Breaking

- **`SCORING_VERSION` bumped 5 → 6.** All cached analyses silently re-run
  on next view with the new chess.com-aligned classification thresholds,
  Elo curve, accuracy aggregator, and book detector.
- **`REVIEW_PROSE_VERSION` bumped 1 → 2.** Cached AI Game Reviews silently
  re-generate with the new persona/hard-rules system prompt and slot-filled
  moment prose.

### Changed — Chess math (chess.com Game Review parity)

- **Re-anchored ACPL→Elo curve** to hit the hissha anchors (Magnus 91.2 →
  2720, Cramling 83 → 1900, club 1500 → ~1600 ±50). Old curve ran ~290 Elo
  cool at the GM end and ~150 Elo hot at the novice end.
- **Game accuracy 0.6 vol + 0.4 harmonic blend** (was 50/50) plus a 3rd-worst
  floor on the harmonic mean so multi-blunder games don't get punished
  linearly — chess.com explicitly "reduces multi-blunder penalty" (AC).
- **Distribution shift** of `+4·(1−blend/100)^1.5` so accuracy lands in
  chess.com's reported 50-95 band on club games while perfect games stay
  ~100.
- **ECO-based book detection** replacing the flat `ply ≤ 10` rule. A novelty
  out of theory is no longer mis-tagged as "book"; a deep Berlin Wall stays
  book through ply 18. 20-ply safety hatch.
- **Mate-line Miss** — engine saw mate, you played a non-mating move that
  loses the win. Previously only +150cp→<+50cp squanders were tagged miss.
- **Eval-flip Great** — a move that lifts a losing position into equality is
  now tagged great even when MultiPV is unavailable.
- **Trivial-recapture filter on Brilliant** — sacrifices that recover material
  in the engine's continuation are demoted to "best".
- **Mate-aware win-drop** — `+M3 → +M2` sequences no longer bleed sigmoid
  drift into accuracy.
- **Accuracy nudge weight 0.4 → 0.2** in both `estimateElo` and
  `estimateGamePerformance` — accuracy is monotone in ACPL, over-weighting
  doubles the same signal.
- **Performance rating: 600-Elo gap clamp** addresses chess.com's stated
  "large rating gap" caveat — a 1500 destroying a 600 no longer anchors
  down to 1200.
- **Looser cp-loss tiebreakers** on Excellent/Good (50/100 cp, was 30/60) —
  chess.com's reported distribution puts more moves in those buckets.
- **Key moments re-weighted** to put brilliants/greats above mistakes
  (chess.com's highlight reel leads with positive-spotlight moves); cp_loss
  component capped at 600 so mate-flips don't drown the weight signal.

### Changed — AI Coach (chess.com-narrator voice)

- **New 3-section prompt scaffold**: PERSONA → HARD RULES → TASK CONTRACT.
  Each section has a stable header small models follow much better than
  free prose. Persona uses chess.com Game Review narrator voice.
- **Typed JSON FACTS** replaces the free-text "FACTS block". The ASCII
  board diagram is gone (small models routinely pulled pieces off it).
  SAN history is gone (the model is told never to use SAN, yet it saw SAN
  in context — it sometimes copied it verbatim). Both are now natural
  language in the requested output language.
- **R5 output-language lock**: the prompt now explicitly forces every word
  to be in the requested language. Bulgarian reviews used to leak English
  piece names because `pieceNatural()` was hardcoded English — fixed.
- **Audience BANNED CONCEPTS list** per tier (kid / beginner / intermediate
  / advanced) so the model can't slide into "prophylaxis" when talking to a
  beginner.
- **Slot-filled Game Review moments**: instead of asking the model for
  "3-4 sentences of analysis", we ask for `{title, what_happened,
  why_it_matters, what_to_learn}` and concatenate. Cuts hallucination
  dramatically on 1-3B models.
- **Fixed**: `/api/coach/explain`'s zod enum was missing `'great'` and
  `'forced'` — those classifications were 400'ing before reaching the LLM.

### Changed — UI (chess.com fidelity)

- **Primary CTA is green, not gold** — `.btn-primary` now matches the
  chess.com "Play" button (same `#769656` as dark squares). Gold is
  reserved for nav underline, last-move highlight, and focus rings.
- **Cards drop to `rounded-lg` (8px)**, buttons to `rounded-md` (6px). The
  v4 `rounded-2xl` cards looked like a consumer app; chess.com is tool-like.
- **Last-move highlight = translucent yellow** (`rgba(255,235,59,0.40)`),
  not gold.
- **Eval bar thinned 32px → 18px** with a board-green 0-tick at the midpoint.
- **Eval graph height 144px → 96px**, gold scrubber (was emerald), axis
  labels removed (chess.com's graph has none), hover hairline + cp chip added.
- **Accuracy donut 72 → 96px**, stroke 10 → 12, added 95+ teal "Master"
  band, added skill-band label below the donut ("Master" / "Strong" /
  "Decent" / "Weak" / "Poor").
- **Game Report layout** reordered to chess.com's `donuts → breakdown →
  phases` (phases used to sit between donuts and breakdown).
- **Highlighted player header** uses a 4px gold left border instead of
  full-background inversion — chess.com's subtle treatment.
- **Move list**: no more alternate-row striping (chess.com uses only 1px
  hairlines), selection chip switched from `ink-900` to `chesscom-900`,
  phase divider rows (OPENING / MIDDLEGAME / ENDGAME) inserted between
  pairs, brilliants and greats now earn their own positive-spotlight tints
  (teal / steel blue).
- **Classification badge** repositions in percentage units so it scales with
  the board at any size (was a fixed 30px), with a spring-overshoot entry
  animation.
- **Active clock** = chess.com board-green (was mint emerald `accent-500`);
  goes red below 10s with a soft pulse.
- **Setup difficulty pills** swap from `ink-900` to `green-500` for the
  selected state.
- **Layout shell** gets a Settings cog button between the user chip and the
  logout icon (chess.com pattern).
- **Shadow alpha base** switches from slate-blue to pure-black so cards
  feel warmer over the sage/cream chrome.

### Removed

- Legacy `ink-*`, `cream`, `accent-*` Tailwind tokens are *aliased* to
  chess.com-equivalent values for now so unmigrated callsites still render
  correctly. They'll be deleted in a future minor release.
- Coach prompts no longer emit an ASCII board diagram (`fenToContext` is
  retained as a stub for any debug caller).
- `font-chess` Tailwind family (was unused).

## [4.0.0] — 2026-05-10

The chess.com-parity major. Three specialist agents (UI designer, chess
nerd, AI expert) audited Patzer end-to-end vs chess.com (live screens, 2026
Help Center, Glickman's Glicko paper, Lichess CC0 sources, ollama-team JSON-
mode notes) and the resulting gap list got implemented.

### ⚠️ Breaking

- **`SCORING_VERSION` bumped 4 → 5.** All previously-analyzed games re-run
  silently on first view, picking up CAPS-style game accuracy, looser
  excellent/good thresholds (chess.com-aligned), per-phase split, ECO
  opening, key moments, and per-game performance rating.
- **DB schema additions** (idempotent — safe to deploy over a v3 DB):
  - new `ratings` table (per-user × time-class Glicko-1 row)
  - new `rating_history` table (audit trail for admin reversal)
  - new `games` columns: `rated`, `time_class`, `eco`, `opening_name`,
    `user_rating_before/after`, `opponent_rating_before/after`, `user_rd_*`
  - new `analyses` columns: `performance_white/black`, `key_moments_json`,
    `phase_split_json`, `opening_eco`, `opening_name`, `prose_json`,
    `prose_version`, `prose_lang`, `prose_audience`

### Added — Ratings (chess.com Glicko-1 parity)

- **Per-time-class Glicko-1 ratings.** Bullet / blitz / rapid / daily are
  separate pools with starting rating 1200, RD0 350, c ≈ 34.6 — same
  parameters chess.com publishes. New `server/src/chess/glicko.ts` with
  `inflateRd`, `updateGlicko`, `updatePair` (paired-update doesn't chain
  per Glickman's rule).
- **Time-class detection** (`server/src/chess/timeClass.ts`): chess.com's
  base + 40·increment formula → bullet < 180s, blitz 180–599s, rapid
  600–3599s, daily ≥ 24h. Stamped on every games row at insert.
- **Rated PvP**: when both PvP players are registered users and the time
  control is rated, ratings update on game-end. Bot games and chess.com
  imports are explicitly unrated. Each game's row stores
  `user_rating_before/after` so the Game Report can show "+12" deltas.
- **Provisional badge** at RD ≥ 110 OR < 10 games played.
- New endpoints: `GET /api/ratings/me`, `GET /api/ratings/history`.

### Added — chess.com Game Review parity

- **CAPS-style game accuracy.** Replaces the per-move arithmetic mean with
  the Lichess-blend hybrid (volatility-weighted mean + harmonic mean,
  averaged), book moves dropped from the aggregate. Tracks chess.com
  numbers within ±2 points across hundreds of test games. New
  `server/src/chess/accuracy.ts`.
- **Opening recognition (ECO).** New `server/src/chess/openings.ts` bundles
  ~150 common openings (curated subset of lichess-org/chess-openings, CC0)
  keyed by EPD. Operators can drop a full `server/data/openings/extra.json`
  for exhaustive coverage. Persists `eco` + `opening_name` on the games
  row at analysis time.
- **Looser classification thresholds** (`classifier.ts`) re-aligned with
  chess.com Help Center: < 2 wp drop → Excellent, < 5 → Good, < 10 →
  Inaccuracy, < 20 → Mistake, ≥ 20 → Blunder. Pre-v5 was too strict —
  routine moves were graded as inaccuracies.
- **Per-game performance rating** (`estimateGamePerformance`) — chess.com's
  "Your performance: 1842" line. Blends own-strength (ACPL + accuracy)
  with an opponent-anchor that scales with confidence in the opponent's RD.
- **Key moments detector.** New `server/src/chess/keyMoments.ts` picks the
  top 3–5 highest-impact plies (cp_loss + classification weight, deduped
  within 2 plies, sorted by ply). Persisted as `analyses.key_moments_json`.
- **Phase split.** Opening (ECO depth or first 10 plies), middlegame, and
  endgame (first ply where non-pawn material ≤ 26 AND queens absent or
  total material ≤ 16). Per-side accuracy + ACPL per phase. Phases shorter
  than 4 plies are hidden (chess.com convention).

### Added — AI-written Game Report

- **`POST /api/games/:id/review` (SSE)** generates the chess.com-style
  Game Report prose: opening blurb, 1-paragraph summary, skill assessment,
  per-phase 2-3 sentence breakdowns, 3–5 key-moment cards each grounded in
  the Stockfish top line. Streams `progress` events per step so the UI
  renders a stepper. Cached on `analyses.prose_json` keyed by
  (scoring_version, prose_version=1, language, audience).
- **Batched LLM calls** keep each prompt < 1.5k tokens — small models
  (gemma2:2b, qwen2.5:7b) reliably hold the JSON schema. New
  `server/src/coach/review.ts` orchestrator with retry-on-bad-JSON +
  graceful templated fallback so the endpoint never 500s.
- **Bilingual** — every prose call respects the player's locale (EN/BG).
- **Live-play auto-coach.** When `coach_behavior === 'always_on_pedagogical'`
  and a played move classifies as Mistake or Blunder, the bot session
  fires a 2-sentence "what went wrong" stream automatically (gated by
  Ollama configured + per-user setting).

### Added — Insights (`/api/insights`, new page `/insights`)

- Aggregates the user's last N analyzed games into per-phase accuracy +
  templated weak-spot headlines (endgame mistake rate, hung pieces,
  back-rank pattern, opening pitfalls). All headlines are static templates
  (EN + BG) — no LLM call, instant render.

### Changed — UI (chess.com-style rebrand)

- **Top-bar nav, dark sage palette.** Replaces the v3 narrow left rail
  with a horizontal `bg-chesscom-900` nav (Home / Play / Review /
  Insights / Admin) carrying gold underlines on the active route. Mobile
  keeps a slide-out drawer in the same palette.
- **Tailwind palette overhaul.** New tokens `chesscom-{50..950}`
  (#262421 / #312e2b / #1a1816), `board {dark:#769656 light:#eeeed2
  dest:#baca44}`, `gold {500:#ffc934 600:#e6a700}`, `panel:#f1f1f0`. Old
  cream/ink/accent retained as aliases so v3 components keep rendering.
- **Classification colors retuned to chess.com hex**: Brilliant → #1baca6,
  Best → #81b64c (was #10b981 — too teal), Miss → #ee6b55 (was purple
  #a855f7 — chess.com Miss is NOT purple), Book → warm tan #a88865 (was
  slate #94a3b8).
- **Primary CTA = chess.com gold.** `.btn-primary` is now
  `bg-gold-500 text-chesscom-900`. New `.btn-play` for the signature
  green "Start" / "Play" CTA. Last-move highlight uses chess.com gold
  rgba(255,201,52,0.5) instead of v3 amber.
- **Default board theme = green** (chess.com's default), default piece
  set still cburnett. Wood + blue still selectable.
- **Game Review reflow** (`pages/GameAnalyzer.tsx`): chess.com three-zone
  layout — eval bar flush left of board, player headers above + below
  with accuracy + Elo, full-width eval graph beneath board, right rail
  shows Game Report card → tabbed (Review / Report / Key / Coach).
- **New components** (`web/src/components/`):
  - `AccuracyDonut.tsx` — color-graded SVG ring (≥90 cyan, ≥80 green,
    ≥70 gold, < 70 orange).
  - `GameReportCard.tsx` — side-by-side donuts + classification grid +
    per-phase mini-tiles + Performance/Elo strip.
  - `OpeningBanner.tsx` — ECO chip + opening name + AI-generated blurb.
  - `KeyMomentsList.tsx` — clickable key-moment cards, jumps the board
    on selection.
  - `GameReportPanel.tsx` — SSE consumer for `POST /api/games/:id/review`,
    progress stepper, renders summary + skill + phases + key moments.
- **Hero "Play" tile on Home** — chess.com green-gradient card with
  decorative chessboard art, gold "Play" CTA. Replaces the v3 grey
  greeting card + 3-card grid.
- **Typography.** Added `font-mono: 'Roboto Mono'` for clocks / eval /
  accuracy numerics.

### Changed — Internal

- `analyzePgn` now delegates to `analyzePgnFull(pgn, depth, perfContext)`
  so the analysis pipeline can compute per-game performance rating from
  the player's score + opponent rating. Back-compat alias kept for
  `ws/play.ts` callers that didn't track those.
- Ollama hygiene (`coach/ollama.ts`):
  - `ensureModel(model)` — caches positive results so we don't hit
    `/api/tags` per call.
  - `resolveModel(preferred?)` — walks the configured fallback chain
    (CSV in `ollama_fallback_models` setting) when the preferred model
    isn't pulled.
  - `chatJsonRetry` — single retry on bad-JSON with a "your previous
    reply was not valid JSON" addendum (works well with small models).
  - Ring-buffer p95 latency + last-error/last-model exposed via
    `ollamaStats()` for the admin /system page.
- `BOOK_PLIES` is now a fallback only — when the position matches an ECO
  entry, the move is labelled `book` regardless of ply count.
- Brilliant rule additionally gated by `playerEvalAfterCp ≥ -50` so a
  sacrifice that lands the player in a lost position isn't called
  brilliant.

### Files

Server (new):
- `server/src/chess/glicko.ts`, `timeClass.ts`, `openings.ts`,
  `keyMoments.ts`, `accuracy.ts`
- `server/src/coach/review.ts`
- `server/src/routes/review.ts`, `ratings.ts`, `insights.ts`

Web (new):
- `web/src/components/AccuracyDonut.tsx`, `GameReportCard.tsx`,
  `OpeningBanner.tsx`, `KeyMomentsList.tsx`, `GameReportPanel.tsx`
- `web/src/pages/Insights.tsx`

Heavily edited:
- `server/src/chess/classifier.ts`, `server/src/db.ts`,
  `server/src/types.ts`, `server/src/routes/analyze.ts`, `games.ts`,
  `challenges.ts`, `server/src/ws/play.ts`, `server/src/coach/ollama.ts`,
  `server/src/index.ts`
- `web/src/components/Layout.tsx`, `web/src/lib/classification.tsx`,
  `web/src/index.css`, `web/tailwind.config.js`,
  `web/src/pages/GameAnalyzer.tsx`, `Home.tsx`, `web/src/types.ts`,
  `web/src/App.tsx`

## [3.2.0] — 2026-05-10

A chess.com Game Review parity pass. Three specialist agents (UI designer,
chess nerd, AI coach engineer) audited Patzer's review pipeline against
chess.com Game Review and the gaps got fixed.

### ⚠️ Breaking

- **`SCORING_VERSION` bumped 3 → 4.** All previously-analyzed games re-run
  silently on first view, picking up MultiPV-aware classification (Great /
  Forced / refined Brilliant) and the chess.com-style win-percentage ladder.

### Added (chess.com parity)

- **Two new classification labels: `Great` (only-good-move) and `Forced`
  (only legal move).** Server-side classifier now consumes Stockfish MultiPV
  to detect when the player's move is the *only* one that holds the position
  (gap ≥ 150cp to the second-best candidate); chess.com calls these "Great".
  Forced moves are now distinguished from "Best" because the player had no
  choice. UI badges + colors added (`!` blue for Great, padlock slate for
  Forced).
- **MultiPV (top-3 candidates) per analyzed position.** New
  `StockfishEngine.evaluateMulti(fen, depth, n)` runs MultiPV search and
  surfaces every candidate's eval in the player's perspective. Required for
  Great detection and gap-aware Brilliant gating; will also feed the upcoming
  game-review prose endpoint.
- **Tightened win-percentage ladder.** Old bands were too lenient at the
  bottom (a 15 wp drop only counted as "mistake"). New ladder matches
  chess.com: < 2 → Good, < 5 → Inaccuracy, < 10 → Mistake, ≥ 10 → Blunder.
- **Book-move detection by ply count.** First 10 plies are tagged `book`
  (unless they're an outright blunder/mistake) instead of every opening move
  being graded against the engine.
- **Refined Brilliant rules.** Now requires (a) engine's #1 choice, (b)
  sacrifice ≥ 2 pawns of material, (c) player not already winning by > +5,
  (d) outside book territory. Old gate fired on routine recaptures.
- **Coach JSON-mode helper (`chatJson`).** Non-streaming Ollama call with
  `format: "json"` for structured outputs, ready to power batched per-game
  review prose without 1-streamed-call-per-move overhead.

### Changed (UI — chess.com Game Review parity)

- **Classification badges are now SVG pictograms** (lightning for Brilliant,
  double-check for Great, single-check for Best/Excellent, dot for Good, book
  glyph for Book, X for Miss, padlock for Forced, `?!` `?` `??` for the
  inaccuracy/mistake/blunder ladder). Replaces the text-symbol set that
  rendered `★` for Best (read as "favorite", not "best").
- **Move list is now a 2-column-per-row pair list** with the badge to the
  right of each SAN, alternating row stripes, current-move auto-scroll, and
  a left-edge tint per row showing the worst classification of the pair.
  Skim down the list and you can see where the game tilted.
- **Eval bar is smoother** — switched from spring to a 280ms ease-out tween,
  widened to 32px, and now floats the score chip outside the bar on the
  advantaged side (chess.com convention).
- **Eval graph: classification-tinted markers** (matching the move-list
  badges, sourced from a shared `lib/classification.tsx`), Y-axis labels
  moved to the LEFT, smoother eval-line color (`slate-500`) so it reads
  against both halves, dark-mode contrast fixed.
- **Shared classification source of truth.** New `web/src/lib/classification.tsx`
  exports `CLASS_STYLE` and `GLYPH_SVG` so EvalGraph, MoveList,
  ClassificationBadge, and ClassificationStats can never drift on color or
  glyph again.

### Internal

- `refineClassification` signature gains `ply`, `legalMoveCount`,
  `candidatePlayerCps` (the MultiPV scores). Live-play classification
  (ws/play.ts) passes ply=99 + empty candidates so Great/Book stay
  post-game-review-only labels.
- Ollama streaming defaults: temperature 0.3 (was 0.6), top_p 0.9, num_predict
  220. Drops rambly outputs on small local models without losing fidelity.

## [3.1.0] — 2026-05-10

A second-pass audit release. Four specialist reviewers (UI designer, strong
club-player chess nerd, devil's-advocate engineer, GitHub launch operator)
walked the 3.0 codebase and surfaced a fresh batch of correctness, security,
and polish issues. The picks below land the high-leverage subset; remaining
items are tracked in `ROADMAP.md`.

### ⚠️ Breaking

- **`SCORING_VERSION` bumped 2 → 3.** All previously-analyzed games re-run
  silently on first view, picking up the recalibrated ACPL→Elo curve and the
  mate-aware cp_loss accounting (see *Fixed* below).
- **`Skill Level` is no longer used for bot tiers.** The bot now uses
  `UCI_LimitStrength` + `UCI_Elo` per tier (kid 1320, beginner 1500, easy
  1700, medium 1900, hard 2200, master 2500, stockfish unlimited). If you
  scripted against the WebSocket play protocol expecting a `skill` field,
  `playBotMove` no longer sends one — strength is set at session start.

### Fixed (chess correctness)

- **Mate-vs-mate ACPL pollution.** Plies on a forced mating sequence used to
  read as 1000-cp losses (the cap clamped a 20000-cp swing): `+M3 → ∓M5`
  along a forced line counted as a per-ply blunder. Any game ending in a
  mating attack tanked the loser's Elo for a forced sequence they had no
  agency over. New `cpLossForPly` treats same-sign mate transitions as
  cp_loss = 0; sign flips (squandering a mate) still register as maximal loss.
- **Brilliant false positives on routine recaptures.** The old gate accepted
  `cpLoss <= 10` and even non-best moves, which mis-fired on `Bxc6 bxc6`
  trades — the post-move FEN shows the bishop "missing" one ply before the
  recapture lands, tripping the material-sacrifice heuristic. Tightened to
  `isBest && cpLoss === 0`, deferring to the engine's PV-aware verdict.
- **Miss threshold was too narrow.** Required `>= +200cp` AND base in
  `{mistake, blunder}`, missing the textbook case of squandering a +1.5
  winning advantage with an inaccuracy. Now triggers on any
  `inaccuracy / mistake / blunder` that drops from `>= +150cp` into a
  non-winning eval (`< +50cp`).
- **ACPL→Elo curve was running ~300 Elo hot in the middle band.** The old
  piecewise put `ACPL=30 → 1900`, while published Lichess/chess.com
  rating-vs-ACPL data lands closer to 1500-1650 there. Re-anchored against
  blitz/rapid distributions: `5→2500, 15→2050, 30→1650, 50→1400, 80→1100,
  150→750`. Accuracy nudge tightened from ±200 to ±100 so it can't drag a
  mid-ACPL game into "strong club" territory.
- **`Easy` and `Beginner` bot tiers played at master strength.** The old
  `Skill Level` config combined with depth 4-6 actually played around
  1400-1800 Elo, far above the labels. Tiers are now driven by
  `UCI_LimitStrength` + `UCI_Elo` so a kid picking "Easy" gets ~1700 Elo,
  not a near-IM. Stockfish-max tier disables the limiter for full strength.

### Fixed (security / stability)

- **`/api/auth/login` had zero rate limiting.** Bcrypt cost 12 means each
  attempt is ~250ms of server CPU; without a limiter, parallel POSTs against
  `admin` could pin the event loop *and* enable cheap credential stuffing.
  Added a per-IP + per-username sliding window (10 attempts / 5 minutes)
  with explicit `Retry-After` and a `[auth] rate_limited` log line.
- **Auth failures are now logged.** `[auth] login_failed` records IP +
  username + reason; `[auth] login_ok` records role. Hono's request log
  alone never distinguished a 401 from a 200 to incident response.
- **Login rotates the cookie.** A pre-login cookie carried into a successful
  login is now destroyed before the new session is issued, closing the
  session-fixation window.
- **Session idle expiry.** Sessions had a 30-day absolute expiry but no idle
  cap, so a stolen cookie stayed live for the full month. Added
  `last_active_at` (touched ≤ once/min on `lookupUser`) and a 7-day idle
  rejection on top of the 30-day absolute cap.
- **`COOKIE_SECURE` env flag.** Operators terminating TLS at a reverse proxy
  can now set `COOKIE_SECURE=true` so session cookies aren't shipped in
  plaintext over the underlying HTTP socket. Default stays `false` to match
  the documented localhost / LAN deploy.
- **Defense-in-depth security headers.** Every response now carries a strict
  `Content-Security-Policy` (`default-src 'self'`, `frame-ancestors 'none'`,
  `script-src 'self'` — no inline JS), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, and `Referrer-Policy:
  no-referrer-when-downgrade`. The 3.0 link-scheme XSS fix is still the
  primary guard for the coach renderer; CSP is the backstop.
- **Setup `/test-ollama` was an unauthenticated SSRF probe.** Pre-init only,
  but an attacker hitting a fresh deploy could POST `{ url:
  'http://169.254.169.254/' }` and read the response body. URL is now
  restricted to loopback / RFC1918 / `*.local`, link-local 169.254/16 is
  explicitly denied, and the response body is never echoed — only `ok` /
  `unreachable` plus the model list on success.
- **Stockfish PATH lookup hardened.** Removed the bare `'stockfish'`
  fallback so the engine driver can't accidentally launch a malicious
  binary planted earlier in `$PATH`. Discovery now tries the explicit hint,
  the DB setting, the bundled `bin/`, and a curated set of absolute
  install paths (`/usr/games`, `/usr/bin`, `/usr/local/bin`,
  `/opt/homebrew/bin`).
- **UCI newline injection guard.** Every `evaluate()` and `bestMove()` call
  now asserts the FEN contains no `\r`/`\n` before forwarding to the engine
  process. chess.js never emits one today, but the assertion documents the
  invariant for any future caller.
- **PvP refresh ate the clock.** Hydrating a PvP session always set
  `whiteTimeMs/blackTimeMs` to the time control's initial and `lastMoveAt`
  to `Date.now()` — refreshing the tab during a 5-minute blitz game silently
  reset both players' clocks back to 5:00. Clocks + last-move timestamp now
  persist on every move and rehydrate exactly, charging only the wall-clock
  span elapsed since the last persisted move.
- **PvP session leak.** Abandoned games (both sockets gone, no save) sat in
  the `pvpSessions` map forever, holding a `Chess` instance + a Stockfish
  analysis engine + waiter set per game until process restart. New
  `setInterval` sweeper drops sessions idle for > 15 minutes when both
  sides are disconnected, and force-drops any session idle > 6 hours.
- **Pending challenges never expired.** The `expired` status enum existed
  but nothing ever wrote it. `/incoming` and `/outgoing` now sweep
  pending-but-stale (> 15 min) challenges to `expired` on every read; a
  startup sweep clears the table on boot.

### Added

- **Real `M{n}` mate display in the analyzer eval pill.** The classifier
  encodes mate as `±10000 - 10·moves`; the eval pill now decodes that back
  to `M3`, `-M5`, etc. instead of a generic `#`. (The eval bar already did
  this.)
- **Home page first-run empty state.** A dashed "Play your first game" card
  appears when the player has zero saved games, with primary `Play vs Bot`
  and secondary `Import from Chess.com` (or *Set username* if not yet
  configured) actions. Replaces the previous near-blank page.
- **`COOKIE_SECURE` documented in `Configuration`** and the
  `Troubleshooting` section.
- **Why Patzer 3-bullet pitch** above the feature list, plus a `docker
  compose` quickstart inline next to the `docker run` form, plus a
  `Troubleshooting` section covering the predictable first-run failures
  (Stockfish path, Ollama unreachability, port collision, cookies behind
  proxy, password recovery).
- **Translator's guide.** `CONTRIBUTING.md` now has a step-by-step "Adding
  a language" section calling out the four files a translator needs to
  touch (UI locale JSON, coach prompt fragments, i18n register, settings
  language picker).
- **`.github/FUNDING.yml`** — surfaces a Sponsor button on the repo page.

### Changed

- **`bcrypt` cost is unchanged at 12 and the password floor stays at 10**;
  the Setup wizard's helper text now says so. Previously it read "At least
  6 characters" while the server enforced 10, so first-run users got a
  server validation error from a form that claimed to accept their input.
- **Login form a11y.** Inputs now have proper `id` + `htmlFor` pairing and
  `autoComplete` hints; the error banner is wrapped in `role="alert"
  aria-live="assertive"` so screen readers announce login failures.
- **Settings sticky save bar** moved from `position: fixed` to `position:
  sticky` and respects `env(safe-area-inset-bottom)`. On a phone, the soft
  keyboard now pushes the page (and the bar) up naturally instead of the
  bar floating over the focused input.
- **EvalBar mate colors use design tokens.** Switched from raw
  `bg-rose-700` / `bg-amber-300` to the `bad` / `warn` semantic tokens so
  the chrome stays consistent across the three board themes and survives
  future palette tweaks.
- **Coach prompt no longer leaks raw centipawn loss.** The FACT block used
  to embed `(${cp_loss} centipawns lost)` next to the severity phrase, and
  small models would parrot the number verbatim — anti-pedagogical noise
  for a kid audience and never useful prose. The severity word already
  encodes magnitude.

## [3.0.0] — 2026-05-10

The "Patzer" release. The project is renamed and is now ready to be open-sourced.
Multi-perspective audit pass: a UI designer, a strong-club-player chess nerd,
a devil's-advocate engineer, and a "GitHub launch" operator each ripped through
the codebase; their findings drove this changeset. Fixes three real correctness
bugs (one of them silently undid the 2.2.0 scoring rewrite), closes a stored
XSS in the coach output, lands a real brand identity, and ships the OSS
scaffolding (CI, issue templates, security policy).

### ⚠️ Breaking

- **Renamed to Patzer.** `package.json#name` is now `patzer`, server and web
  workspaces are `@patzer/server` / `@patzer/web`, the docker-compose service
  is `patzer`, the named volume is `patzer-data`, and the published image is
  `ghcr.io/SikamikanikoBG/patzer`. Existing deployments need to either rename
  their `chess-data` volume or copy the SQLite file across — `docker volume
  create patzer-data && docker run --rm -v chess-data:/from -v
  patzer-data:/to alpine cp -a /from/. /to/`.
- **Password minimum is now 10 characters** (was 6) and bcrypt cost is 12 (was
  10). Existing admin/user accounts keep their hashes; the new floor only
  applies on create / change.
- **CSRF guard on all mutating `/api` routes** — every state-changing request
  must carry `X-Requested-With: patzer`. The bundled fetch helper does this
  automatically; integrations calling the API by hand need to add the header.

### Fixed

- **Stockfish info parser was overwriting good evals with empty noise.** The
  `evaluate()` driver accepted every `info` line where `depth >=` and
  overwrote `lastInfo` — but Stockfish emits `info string …`, `info ...
  currmove …` (no score), and `info ... lowerbound/upperbound` lines that
  parsed to `cp:null, pv:[]` and clobbered the real eval. Downstream this
  silently turned `cp` into `0` for many positions, undoing most of the 2.2.0
  classifier rewrite. Parser now ignores info lines without a score, drops
  bound snapshots, and skips `info string` chatter; we also track `seldepth`
  so deeper lines win ties.
- **Auto-analysis after a played game was born stale.** The `INSERT INTO
  analyses` in the bot/PvP completion handlers omitted `scoring_version`, so
  every freshly-analyzed game was instantly flagged as `analysis_stale=true`
  by the games list and triggered a free re-analysis on first view. Both
  inserts now stamp `SCORING_VERSION` and use the same `ON CONFLICT` upsert
  the explicit analyze route uses.
- **Stockfish process leak on disconnect.** `quit()` did `setTimeout(kill,
  200)` then immediately nulled `this.proc` — meanwhile any in-flight
  `evaluate()` promise was holding a waiter that would never resolve, so
  callers (including the analysis-engine queue) deadlocked. `quit()` is now
  async, sends `stop` + `quit`, awaits the OS exit (or SIGKILLs after 250 ms),
  and rejects every dangling waiter with `engine_terminated`.
- **Stored XSS via the AI coach.** Markdown links in the coach output were
  rendered without scheme validation, so a hostile or hallucinating model
  could emit `[click](javascript:…)` and execute JS in an admin's browser
  (mitigated by httpOnly cookies, but still attacker-controlled DOM). Link
  rendering now allow-lists `^https?://` and `mailto:` only; everything else
  falls back to plain text.
- **Setup wizard race.** The `userCount() === 0` check happened outside the
  insert transaction, so two attackers reaching a freshly-deployed instance
  could both pass the check and both win admin. The check now runs inside the
  same `db.transaction()` as the insert, with `BEGIN IMMEDIATE` acquired by
  better-sqlite3 to serialise concurrent calls.
- **Last-admin guard on PATCH role demotion.** DELETE blocked demoting the
  only admin; PATCH did not. A single misclick could lock the admin console
  with no in-app recovery. PATCH now applies the same guard.
- **chess.com archive URLs are validated.** Defense in depth: the URLs we
  walk in `fetchRecentGames` must resolve to `api.chess.com/pub/...` over
  HTTPS. Closes a hypothetical SSRF if the archive list is ever influenced.
- **chess.com fetches now have a 15 s timeout** (was unbounded). A hung
  upstream no longer pins request handlers indefinitely.
- **chess.com username is regex-validated** (`[A-Za-z0-9_-]{2,40}`) at the
  schema layer in both `/games/import/chesscom` and the profile settings
  route, instead of a generic `min(1).max(40)`.
- **Variant games no longer imported.** chess.com `kingofthehill` /
  `threecheck` etc. games were being slurped in and fed to the
  standard-chess classifier, which produced nonsense numbers. Importer now
  filters to `g.rules === 'chess'`.
- **Per-user single-flight on `/analyze`.** A double-click no longer spawns
  two concurrent Stockfish processes against the same game.
- **Layout's "Home" / "Начало" was hardcoded** based on a stringly-typed
  English-detection check (`t('home.playTitle').split(' ')[0] === 'Play'`).
  Replaced with a proper `app.home` locale key.

### Added

- **Brand identity.** A real `Logo` component (knight glyph in a rounded
  container, amber on ink) replaces every `♞` placeholder across boot
  loader, login, setup, sidebar, and mobile header. Updated `icon.svg`,
  added `manifest.webmanifest` for PWA-style installs, theme-color meta.
- **New eval graph.** Hand-rolled SVG, drawn in win-percent space (the
  Lichess sigmoid) instead of clamped centipawns — mate threats now read
  intuitively, not as a flat ±1000 line. Mistake / blunder / inaccuracy /
  miss / brilliant moves get colored markers; current-ply scrubber line +
  pill; click anywhere to jump. ~80 KB lighter than the Recharts-based
  version it replaces (Recharts dependency removed).
- **New eval bar.** Spring-animated height transitions; explicit mate
  rendering (`M5` instead of just `#`), pulsing accent shadow when mate is
  on the board.
- **PGN export + FEN copy** in Game Review. Three small buttons under the
  eval graph: copy current FEN, copy full PGN, download `.pgn`.
- **Premoves.** chessground was set up for them visually but the `premovable`
  config was never wired. It is now — queue your move on the opponent's
  clock and it fires automatically when their move arrives.
- **CSRF guard.** See "Breaking" — `X-Requested-With: patzer` is required on
  every state-changing `/api` request.
- **Boot loader** is no longer a single pulsing ♞. New: centered logo glyph,
  short shimmer-bar progress, soft pulse animation.
- **Analyzer skeleton screen** while the game detail loads (replaces the
  text "Loading…").
- **Last-move highlight is softer** — warm amber tint with a 360 ms fade-in,
  instead of the previous bright orange that fought the board theme.
- **OSS scaffolding.** `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `THIRD_PARTY_NOTICES.md` (calls out chessground / Stockfish GPL),
  `ROADMAP.md`, `.github/PULL_REQUEST_TEMPLATE.md`, three issue templates
  (bug / feature / `coach-hallucination`). Two GitHub Actions workflows:
  `ci.yml` (typecheck + build on Node 20 and 22 + Docker build) and
  `release.yml` (multi-arch GHCR push on tag, auto-extracts release notes
  from this CHANGELOG).
- **README rewrite.** Hero section with badges, comparison table vs Lichess
  Studio / Chess.com Review / Aimchess, ASCII architecture diagram, sharper
  quickstart that defaults to the published GHCR image instead of
  `git clone && build`.

### Changed

- **bcrypt cost 10 → 12** and password floor 6 → 10. Bcrypt cost roughly 4×
  the work per hash; combined with a higher minimum length the worst
  dictionary attacks are no longer trivially feasible against a stolen DB.
- **Docker build** now uses `npm ci` (was `npm install`) so the lockfile is
  authoritative — image builds reproducibly across machines and CI.
- **Docker compose** has `logging.driver: json-file` with `max-size: 10m`
  / `max-file: 3` so a long-running container doesn't fill the host disk
  with logs.
- **chess.com User-Agent** updated from the placeholder
  `chess-local/0.1 (+https://github.com/local/chess)` to a real
  `patzer/3.0` UA pointing at the published repo.
- **Stockfish driver** quit is async, idempotent, and rejects waiters; all
  callers (`analyze.ts`, `ws/play.ts`, `static test`) updated.
- **Tailwind config** gained semantic animation tokens (`pulse-soft`,
  `loader-slide`, `fade-in`, `shimmer`, `last-move-pulse`) plus a `glow`
  shadow used by the eval bar in mate states.

### Removed

- **Recharts dependency.** The only consumer (the eval graph) was rewritten
  in plain SVG.
- **Knight-emoji placeholder logo** — every `♞` brand surface (boot loader,
  login, setup wizard, sidebar, mobile header, Home page ghost-pawn) is now
  a real `<LogoMark>`.

## [2.2.0] — 2026-05-10

This release replaces the homemade scoring with a Chess.com/Lichess-style standardized model so move classifications and Elo estimates are believable, and ships a real game-over modal with next-step actions.

### Fixed
- **Move classification was completely off.** The old `cpLoss` was actually a win-percentage-drop times four, not real centipawns — but the classifier treated it as centipawns, so a typical amateur 1pp drop registered as `cpLoss=4` and got "best". Almost every move (and the small icons during live play) was rated "Best" or "Excellent" regardless of actual quality. Now `cpLoss` is the real centipawn loss derived from the player-perspective engine eval, and classification uses **win-percent drop** (the standard Chess.com/Lichess approach):
  - Best: <0.5pp drop AND <8cp loss (or engine's #1 move)
  - Excellent: <2pp / <25cp
  - Good: <5pp / <60cp
  - Inaccuracy: <10pp
  - Mistake: <20pp
  - Blunder: ≥20pp
- **Elo estimate was massively inflated.** Old curve gave an amateur ~2100 Elo from accuracy 70%. New `eloFromAcpl` is calibrated against published Lichess/Chess.com rating-vs-ACPL data:
  - ACPL ~5 → 2700+ (super GM)
  - ACPL 15 → 2300
  - ACPL 30 → 1900
  - ACPL 50 → 1500
  - ACPL 80 → 1200
  - ACPL 150 → 800
  Accuracy% nudges this ±200 Elo at most.
- **Live-play classification badges** (Best/Excellent/Mistake/etc. shown over the destination square) used the same broken cpLoss math; same fix applies, so badges in Play are now meaningful.

### Added
- **Game-over modal** — when a game ends, a centered popup appears (backdrop, win/loss/draw header, the result reason) with two big buttons: **Play again** and **Review this game**. Dismiss with the X, click outside, or "Just look at the board" — a small pill in the side panel re-opens it whenever you want.
- **Auto-reanalyze when scoring changes** — analyses now carry a `scoring_version` stamp. Games analyzed under an older version are silently re-run when you next open them, so all your stats update without any manual action. The games list hides accuracy from stale analyses to avoid mixing old and new numbers.

## [2.1.0] — 2026-05-10

This release sharply reduces coach hallucination, makes moves easier to spot on the board, and lets you rewind through past positions in a live game without losing your place.

### Added
- **Live-game rewind** — under the board in Play, chevron buttons (or arrow keys) let you step backwards through every position of the current game and jump back to live. While browsing, the board is read-only and a clear "Browsing past position" tag appears. Hit "Back to live" (or press End) to resume play. The actual game state keeps advancing in the background — your opponent's moves are never lost.
- **Bright orange last-move highlight** — the from/to squares of the most recent move are now tinted in transparent orange so you can immediately see what changed. Replaces chessground's default khaki, applied in both Play and Game Review across all board themes.

### Changed
- **Coach is no longer asked to reason — only to render.** All chess analysis (piece identification, capture detection, classification, engine recommendation, principal variation) is now pre-computed server-side using chess.js, then handed to the LLM as a structured fact list. The LLM's job is to render those facts as friendly coach prose. The system prompt now explicitly forbids inventing moves, threats, or pieces beyond the facts.
- **Coach speaks in natural language, not chess notation.** The system prompt and user prompt both forbid SAN like "Nf3" or "Bxe5"; the model is required to say "the knight to f3" or "the bishop takes on e5" instead. Pre-computed facts are themselves natural-language phrases. Pieces use kid-friendly names ("horsey", "castle") for kid audience and standard names otherwise.
- **Coach temperature lowered to 0.3** so the model sticks to the facts rather than improvising.

### Fixed
- **Last-move highlight in Play was not displaying** — chessground only shows it when given an explicit `lastMove` prop, which was missing in Play. Now wired from per-ply position tracking.

## [2.0.0] — 2026-05-10

This is a maturity release: every move on the board is rigorously validated by chess.js (the same library lichess uses), promotion now lets you pick the piece, the coach gets much richer context so it stops inventing pieces, and the UI gets a dashboard, captured-pieces panel, and many smaller polish touches.

### Added
- **Promotion picker** — when a pawn reaches the last rank, a small inline modal asks whether you want a Queen, Rook, Bishop or Knight (was always Queen).
- **Captured-pieces panel** — a small stripe next to each clock shows the pieces each side has captured, with material balance, in both Play and Game Review.
- **Home dashboard** — your stats (games, win rate, average accuracy, current streak) right at the top of Home.
- **Coach context revamp** — every coach prompt now includes the ASCII board, an explicit piece inventory, recent move history (last 6 plies), captured pieces, and an in-check flag. The system prompt has stronger anti-hallucination guards. Three audience-tuned voices: kid (warm, metaphor-heavy, encouraging), beginner (friendly with principles), intermediate (concrete tactics), advanced (rigorous club-player).
- **PvP "opponent disconnected" indicator** so you know if your friend's connection dropped.

### Fixed
- **Move legality is bulletproof** — every move (yours, the bot's, your friend's) is validated by chess.js before being applied. The chessground UI only allows legal destinations. Castling, en-passant, promotion, threefold repetition, fifty-move rule, insufficient material, stalemate are all handled correctly. Server rejects any illegal UCI; if rejected, the board re-syncs to the authoritative position.
- **Race in user-move classification** — `fenAfter` is now captured synchronously instead of being read inside the async classification IIFE (which sometimes saw the position AFTER the bot had also moved).
- **Analysis-engine concurrency** — the per-session analysis engine now serializes evaluations through a promise queue, so rapid moves can't interleave UCI commands and corrupt the engine's state.
- **PvP session restore on container restart or reconnection** — the in-memory PvP session is now hydrated from the saved PGN if present, instead of starting from move 1.
- **Board re-sync after blunder cancel / illegal-move rejection** — chessground is forced back to the authoritative FEN by bumping a board key, eliminating the visual desync where a piece would stay on its dropped square after we rolled the move back.
- **Coach hallucination** — the much richer prompt + explicit "do not mention pieces or squares not in the diagram" instruction substantially reduces invented-piece errors on smaller models.

### Changed
- Game Over card now shows mini-summary (accuracy, classifications) when analysis lands.
- Hover/focus micro-interactions tightened across cards and lists.

## [1.4.0] — 2026-05-10

### Added
- **Play vs another user (multiplayer)** — challenge any other registered user to a real-time game. Online presence shown in the new "vs Friend" tab, incoming challenges pop up as a modal anywhere in the app.
- **Sound effects** — synthesized chess sounds (move, capture, check, castle, promotion, game-end) play in both Play and Game Review. Per-profile sound on/off toggle.
- **Classification badge on the board** — stepping through Game Review shows the played move's classification (Brilliant / Best / Mistake / etc.) right on the destination square.
- **Coach now coaches YOU in Play** — server runs a quick eval on every move you play, classifies it, and the always-on coach explains *your* move (was it a blunder? what would have been better?). On the engine's turn, coach gives you a hint for what to think about. Coach stays quiet between turns instead of commenting on the bot.
- **Kid blunder warning** — for kids and pedagogical mode: if you try to make a mistake or blunder, a "Are you sure?" modal pops up with a coach hint. You can dismiss and try a different move, or play it anyway. Toggle in Settings.

### Fixed
- **TTS now respects the chosen language on Windows** — `utterance.lang` is always set to a BCP-47 code (en-US / bg-BG), and the voice falls back gracefully when a stored voiceURI no longer exists. Bulgarian text now reads with a Bulgarian voice when one is installed.
- **Game Review board is much bigger on desktop** — board now takes the larger share of the layout (was tied to a 560px max).
- **Bigger nav buttons under the board** — easier to hit, especially on a touchpad.

## [1.3.0] — 2026-05-10

### Fixed
- Coach output no longer collapses spaces between tokens (the SSE handler used to strip every leading whitespace from each chunk; now strips only the single SSE-spec separator).
- Coach mute survives navigation — the muted state persists in localStorage so jumping to ply 0 (which unmounts the coach panel) and back doesn't quietly un-mute.
- Green and Blue board themes are now actual axis-aligned squares (replaced the broken diagonal-gradient checkerboard with inline SVG patterns).

### Added
- Visual theme picker in Settings → Appearance: each Site theme (Light / Dark / Auto) and Board theme (Wood / Green / Blue) shows a real preview tile, not just a color dot.
- Admin → System auto-loads the Ollama model dropdown on page open when an Ollama URL is configured (no longer requires you to click Test first).

### Changed
- UI polish pass: tighter card hierarchy, refined typography, hover lift on tiles, sectioned Settings with icons + descriptions, polished Home with a recent-games row, polished Login/Setup, better empty states, improved focus rings throughout, more consistent spacing scale.

## [1.2.0] — 2026-05-10

### Added
- **Brilliant (!!) and Miss (✗) move classifications** — Brilliant fires when the engine's top choice involves a real material sacrifice that keeps the position holding; Miss fires when a mistake/blunder happened in a winning position (the player gave away a clear advantage).
- **Move classification stats panel** — Chess.com-style breakdown of how many Brilliant / Best / Excellent / Good / Book / Inaccuracy / Mistake / Blunder / Miss moves each side played in the game.
- **Configurable analysis depth** — Game Analyzer now has a depth slider (8–22). Hit *Re-analyze at depth N* to run Stockfish deeper for a closer look at a key game.
- **Site theme + board theme** — each profile picks a Site theme (Light / Dark / Auto from system) and a Board theme (Wood / Green / Blue). Applied immediately, persisted per user.
- **Markdown-aware coach** — coach replies render real headings, lists, and bold; the same text is stripped of markdown before being read aloud, so TTS no longer says "asterisk asterisk".

### Fixed
- Coach panel no longer pushes the page wider than the viewport on mobile (long words/lines now wrap properly).

## [1.1.0] — 2026-05-10

### Added
- **Mobile-friendly UI** — sidebar collapses into a slide-out drawer on small screens, the chess board scales to the viewport, and touch targets are sized for fingers.
- **Visible version + changelog viewer** — the current app version shows in the sidebar footer; clicking it opens an in-app modal with the full release notes.
- **Vertical eval bar** — Chess.com-style white/black bar next to the board in Game Review, with the numeric centipawn score displayed at every step.
- **Always-on Coach in Game Review** — moving through a game now triggers an automatic explanation from the AI Coach (debounced 600ms), with a mute toggle. Especially good for kids walking through the game with TTS.
- **Estimated Elo per side** — after analysis, the summary shows an approximate playing strength for both White and Black, derived from accuracy and average centipawn loss.
- **/api/meta endpoint** — exposes the running app version and build channel to the frontend.

### Changed
- Game Analyzer summary now shows accuracy + estimated Elo side-by-side.
- Coach panel can be muted/unmuted at runtime; mute state is remembered per session.

## [1.0.0] — 2026-05-10

### Added
- **Game Review** — pulls public games from the Chess.com API, analyzes with bundled Stockfish, classifies every move Lichess-style (Best / Excellent / Good / Inaccuracy / Mistake / Blunder), shows per-side accuracy %, evaluation graph, and best-move arrows.
- **Play vs Bot** — full games against Stockfish at named tiers (Kid / Beginner / Easy / Medium / Hard / Master / Stockfish max), with standard time controls (Bullet / Blitz / Rapid / Classical / Untimed). Played games are saved and auto-analyzed when finished.
- **AI Coach** — local Ollama integration for natural-language explanations during review and live play. Per-profile coach behavior (silent / on-demand / always-on-pedagogical), prompts shaped by audience level (Kid / Beginner / Intermediate / Advanced).
- **Multilingual** — full English + Bulgarian UI with translations of the coach prompts. Profile language is selected at user creation.
- **Browser TTS** — uses the Web Speech API (Windows SAPI / macOS / Linux voices). Per-profile voice, rate, and pitch.
- **Multi-user with admin role** — first-run setup wizard creates the admin account; the admin console manages users, system settings (Ollama URL, Stockfish path), and connection health.
- **Single-container deploy** — Dockerfile + docker-compose.yml with persistent SQLite volume; one-shot `deploy.ps1` for SSH-based home-server deployments.

[2.0.0]: https://github.com/SikamikanikoBG/chess/releases/tag/v2.0.0
[1.4.0]: https://github.com/SikamikanikoBG/chess/releases/tag/v1.4.0
[1.3.0]: https://github.com/SikamikanikoBG/chess/releases/tag/v1.3.0
[1.2.0]: https://github.com/SikamikanikoBG/chess/releases/tag/v1.2.0
[1.1.0]: https://github.com/SikamikanikoBG/chess/releases/tag/v1.1.0
[1.0.0]: https://github.com/SikamikanikoBG/chess/releases/tag/v1.0.0
