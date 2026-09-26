# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Opening trainer is marked beta.** It works, but it is still being
  refined, so the *Trainer* tab carries a small "Beta" badge.
- **Opening trainer: easier first steps, fairer misses.** A new line starts
  with "Do you know this line already?": watch it first (arrows on every
  move, nothing counted) or practise right away. One wrong try no longer
  lands in the review — the second one (or "Show me the move") does. "Practice
  this line" from your repertoire stops before one of your own moves that the
  analysis calls a mistake in most of your games. The review queue turns over
  at your own midnight instead of UTC's, and a move you no longer play can be
  removed from it. Built-in line names are translated. In the review, a
  first wrong try gets a hint and one more go; after the answer it moves on
  by itself.

## [7.15.0] — 2026-09-26

### German, Lichess, invites, an opening trainer — and two new contributors

The biggest community release so far: seven pull requests from two first-time
contributors. **Thank you, [@eric-gpu](https://github.com/eric-gpu)** (German,
Lichess import, invite-only sign-up, both sound sets and the opening trainer —
#39, #40, #41, #42, #43, #45) **and [@aminghuf](https://github.com/aminghuf)**
(DeepSeek, the opt-in hosted engine and automatic Chess.com sync — #44).

Nothing changes unless you ask for it: the new sounds default to *Classic*,
sign-up keeps whatever mode you had, and Game Review stays on the bundled
Stockfish. The one thing that runs on its own is the Chess.com sync below — it
only touches profiles that already have a Chess.com username.

### Added
- **German (`de`).** The whole app — UI, setup wizard, coach persona and hard
  rules, move narration, Game Review prose — in German. The coach prompt is
  tuned for small local models: it asks for the informal "du" without using
  it as a form of address (mistral:7b otherwise ended most answers' first
  sentence with "…, du!"), and it has no example sentences, which such
  models copied word for word — "Solide Entwicklung" even for a blunder.
  German is also the first
  coach language whose piece names need an article and a grammatical case
  ("der Springer zieht", but "schlägt den Bauern", "du hast einen Turm
  mehr"), so move and material phrasing decline properly instead of gluing
  bare nouns together. (#18)
- **Soft check and game-end sounds.** A new *Check & game-end sounds* choice
  under **Settings → Sound & assistance**: *Classic* keeps the original bells
  (and stays the default), *Soft* swaps those two for marimba-style wooden
  bars that sit closer to the wood-knock move sounds — two short rising notes
  for check, and the same G → E → C cadence as before on marimba with a faint
  bell underneath for game end. Still fully synthesized, no audio files, with
  a preview button next to each option. (#36)
- **Real-board move sounds.** A second choice under **Settings → Sound &
  assistance**, *Move sounds*: *Classic* keeps the synthesized wood knocks
  (default), *Real board* plays recordings of real pieces set down on a
  wooden board for moves, captures and castling (the move click twice, king
  then rook). Check, promotion and game end keep their sounds and still follow
  the check & game-end choice. The two clicks (~30 KB each) are cut from a CC0
  recording on Freesound and only load once *Real board* is picked; until
  they have loaded — or if they can't — moves fall back to the synthesized
  knocks. (#36)
- **Import games from Lichess.** Next to the Chess.com importer: set a
  Lichess username in **Settings** and *Import from Lichess* appears in Game
  Review. Uses Lichess's public export API (no token), sends a real
  User-Agent, makes one request at a time from the server and tells you to
  wait a minute instead of retrying when Lichess answers 429. Standard chess
  only — variants, aborted and unfinished games are skipped — and importing
  twice doesn't duplicate anything. Correspondence games land in the same
  *daily* pool as chess.com's. Import errors (unknown player, Lichess down)
  are shown now instead of failing silently, for Chess.com too. (#28)
- **Invite-only sign-up.** Admin → System now has three answers to "who can
  create an account": anyone, invite only, nobody. Admin → Users gets an
  Invites list: each invite is a code and a `/signup?invite=…` link, limited
  to a number of accounts and a lifetime (one account, one week unless you
  pick otherwise), and can preset the language and coach level of the
  accounts made with it — so a coach can hand a class a "Spanish, beginner"
  link. Copy the link again later, withdraw it, and see who signed up with
  it. The sign-up page checks an invite as soon as it's entered, so a dead
  link is reported before anyone fills in the form. Existing installs keep
  what they had: on becomes "anyone", off becomes "nobody". (#26)
- **Opening trainer.** The Openings page has a second tab, *Trainer*. Pick a
  line — one of 16 built-in main lines for White or Black, or any position in
  your own repertoire tree ("Practice this line", continued the way most of
  your games went on) — and Patzer plays the other side while you find your
  moves. A wrong move is taken back so you can try again; "Show me the move"
  draws the arrow. Every move you miss is stored on your profile and comes
  back in a daily review queue until you've got it right on three different
  days. (Roadmap #6)

- **DeepSeek as a coach provider.** A third tab next to Ollama and vLLM in
  **Admin → System**, for machines too small to run a model. The API key comes
  from `DEEPSEEK_API_KEY` (wins, Docker-secret friendly) or the Admin field,
  and is never sent back to the browser — only whether one is set. Ollama and
  vLLM stay the local-first default. (#44)
- **Optional hosted analysis engine.** `ENGINE_BACKEND=chessapi` sends Game
  Review positions to chess-api.com (Stockfish 18 NNUE) instead of the bundled
  binary — meant for a Pi/NAS or a public try-it instance. **Off by default**:
  `local` stays the default and nothing leaves your machine unless you set it.
  On an API failure it retries once, then finishes that game locally, so one
  review never mixes two engines. (#44)
- **Automatic Chess.com sync and review.** Profiles with a Chess.com username
  get their new games pulled in the background (every 15 minutes by default,
  `CHESSCOM_SYNC_MINUTES`, `0` turns the timer off), the newest ones analyzed
  (at most three per tick), and — when an LLM is configured — the AI Game
  Review written without a click. Finished bot and friend games get their
  review the same way. A failed review never blocks the import; it is retried
  on the next sweep. (#44)
### Changed
- **`games.source` accepts `lichess`.** SQLite can't alter a CHECK
  constraint, so existing installs rebuild the `games` table once on startup:
  in one transaction, with foreign keys off for the swap so no analysis,
  puzzle or rating history is cascade-deleted, and with the row count and
  `foreign_key_check` verified before it commits. If anything goes wrong it
  rolls back, logs, and the server starts as before without the Lichess
  import.

### Fixed
- **Admin → System's Save button didn't save the sign-up settings.** It only
  saved the coach and engine fields; the sign-up switches were saved by
  "Save email settings" further down, so changing them and pressing Save
  quietly did nothing. Save now saves the whole page.
- **English text on translated screens.** Around 140 strings were hard-coded
  in components (Settings descriptions, the greeting, phase names, the game
  list, key moments, admin pages…) or used a translation key that existed in
  no locale file, so they showed English in every language. They are locale
  keys now. Achievement titles and weekly plan goals come from the server in
  English; they are now translated in the browser from their id/kind, with
  the server text as fallback. Bulgarian and Spanish fall back to English for
  the new keys, exactly as before, until someone translates them.
- **Language pickers showed every language in the current one.** After
  switching to Bulgarian, the Settings select read "Немски" for German — no
  way back for someone who can't read Cyrillic. Settings, the setup wizard
  and Admin → Users now list each language in itself (English, Български,
  Español, Deutsch), like the command palette already did.

## [7.14.0] — 2026-09-23

### Your game is still there when you come back

Switching to another app mid-game and coming back used to lose the game. Not
"lose the connection" — lose the game. This release fixes that for bot games and
for games against a friend, which failed the same way for two different reasons.

- **Fixed: a game against the bot was never written down until it ended.** It
  lived entirely inside the WebSocket that created it, so closing the tab — or a
  phone freezing the browser while you answered a message — destroyed it with no
  trace. Every move is now snapshotted server-side, and reconnecting picks the
  game up mid-position. It survives the tab closing, a reload, and a server
  restart. **Your clock is not charged for the time you were away**: PvP charges
  it because a human is waiting, but the bot is a process that wasn't even
  running, and flagging you for closing a tab would punish the exact thing this
  release is about. Bot games are unrated, so there's nothing to protect.
- **Fixed: the page never reconnected.** `onclose` was literally
  `/* ignore */` — so after a phone sleep the board still looked alive, the clock
  kept counting down, and nothing you did reached the server. The socket now
  retries with a backoff, and retries *immediately* on the events that actually
  fire when a phone wakes up. This is what was killing longer games with a
  friend: the server kept those games correctly all along, but the browser had
  quietly stopped talking to it.
- **New: "Continue where you left off."** Until now there was no route back into
  an unfinished game at all — a friend game could only be reached if you still
  had its URL. The Play screen now lists the bot game you left and every
  unfinished game with a friend, with how far in you are and which colour you're
  playing. One button to resume, one to discard.
- **New: the clock measures real time.** It used to count interval ticks rather
  than elapsed time, and browsers throttle timers in background tabs. It now
  measures real time, and freezes while the socket is down instead of counting
  down a game you aren't connected to.
- **Fixed: the GitHub star count from 7.13.0 never appeared.** The page's own
  Content-Security-Policy blocked the request and logged a violation on every
  page load. Found by the new browser test.

Two new test suites, because "it reconnects" is not something to take on trust:
`npm run test:resume` drives the protocol against a real server (kill the socket,
reconnect, keep playing), and `npm run test:resume-ui` does it in a real browser,
including pulling the network out from under a live game.

## [7.13.0] — 2026-09-20

### Star on GitHub link

Patzer is free and self-hosted, so there is exactly one thing it can ask for in
return. This release adds a **Star on GitHub** link — in three places that stay
out of the way, and nowhere near the board.

- **In the footer, beside the version chip.** On every page, at the same size
  as the version, with the repo's live star count next to it. Deliberately not
  in the top bar: that bar already measures itself and collapses nine nav pills
  to icons when the labels don't fit a laptop, so a star button up there would
  have cost somebody a destination.
- **At the bottom of the changelog.** Having just read what the last few
  releases handed you for free is the one moment to ask.
- **Under the login card.** That is where someone sizing Patzer up for their
  own box lands — and until now nothing in the product said where the source
  lives. The word `github` appeared exactly once in the whole web app, in a
  help string on the admin page.

The count comes from GitHub's public API once a day per browser and is cached in
`localStorage`. If the box has no internet, the call fails or you are
rate-limited, the link still works and simply shows no number. Click it once and
it goes muted — *Starred* — and stops nudging on that device for good. The
browser cannot actually check whether you starred without your GitHub
credentials, which Patzer will never ask for, so it takes the click at its word.

Bulgarian and Spanish strings included. Five new tests cover the cache, the
offline path and the once-only nudge; `npm test` is at 100.

## [7.12.0] — 2026-09-19

### Premove queues, an instant board, and a clock you can read at a glance

Three changes aimed squarely at playing fast.

- **New: queue up to six premoves.** chessground holds exactly one premove, so
  the queue is Patzer's own. While the opponent is thinking you can keep
  playing: the board shows the position *as if* every queued move had been
  made — your pieces are already sitting where you put them, with an arrow per
  move and the move list under the board — which is the trace you actually want
  rather than a single ghost arrow. Each move is re-checked against reality the
  instant the opponent moves: if it's still legal it's sent immediately, if it
  isn't, the whole queue is dropped rather than half-played. Escape cancels, so
  does clicking the chip.

  The edge cases it handles, because a premove queue is mostly edge cases: a
  queued move that gives check ends the queue (the position after it isn't one
  you can plan from); the queue clears on takeback, on game over, and whenever
  the server rejects anything; premoves are ignored while you're browsing back
  through the game; promotion works (the picker runs against the queued
  position, not the live one); and a premove skips the blunder warning, because
  the point of premoving is speed.

- **Removed: the piece slide animation.** It was 200ms of dead time on every
  move — the board knew the position before you could see it, which reads as
  lag on a fast time control. Pieces now appear where they are.

- **The clock grows under 30 seconds.** The side actually on the clock doubles
  in size below 30s (18px → 36px) so it's readable without looking away from
  the board, and keeps the red pulse it already had below 10s. The idle side
  stays small — a big number on a clock that isn't running is just noise.

## [7.11.0] — 2026-09-19

### It tells you when it's out of date, and the header stops falling off the screen

Four community pull requests landed today — thanks to **@Vaibhavs25**, who
picked up four of the open issues in one sitting.

- **New: Patzer notices when a newer release is out.** A self-hosted app can't
  update itself and shouldn't try, but it can stop you discovering six months
  later that the thing you wanted was fixed in July. Patzer now asks GitHub at
  most once every six hours whether there's a newer tag, and shows one quiet
  line at the top of the page when there is, with a link to the release notes
  and a reminder to pull the image. Dismiss it and that version never nags you
  again. It sends nothing about you or your games — it's an anonymous read of a
  public page — a failed check is silent, and you can switch the whole thing
  off in **Admin → System** or with `UPDATE_CHECK=0`.
- **Fixed: the header overflowed the window.** With nine nav items, an admin
  account and the language toggle, the top bar wrapped onto two lines and
  pushed the `ES` button and the user chip off the right-hand edge — on a
  1440px laptop, which is most laptops. Two things were wrong: the bar was
  capped at 1280px wide no matter how big your monitor was, so the nav never
  had room even at 1920; and the pills overflowed their container instead of
  giving way, so they painted over the user menu. The bar now uses the width
  it has, and the nav *measures itself* — when the labels don't fit, the pills
  become icons with tooltips, so every destination stays one click away instead
  of some being hidden. Measuring rather than picking a breakpoint matters
  because an admin carries two more items than a regular profile and Bulgarian
  labels are wider than English ones: any fixed width would be wrong for
  somebody. `Users` and `System` also moved into an Admin dropdown. (#22, PR by
  @Vaibhavs25, finished off afterwards)
- **Fixed: the coach's mute button didn't always mute.** Two separate bugs,
  both in the gap between "you press mute" and "sound comes out". The panel
  read a stale copy of the mute flag when a reply finished streaming, so muting
  mid-answer still read the answer aloud. And the speech helper has two
  deferred paths — a one-tick delay to dodge a Chrome bug, and a wait for the
  OS voice list, which on Windows is usually empty on first use — neither of
  which was cancellable, so a mute landing in either window was simply ignored
  and the coach carried on talking. Both now check a generation counter that
  `cancel()` bumps. Covered by tests that fail against the old behaviour.
- **New: the phone moves sheet is draggable.** Swipe up on the *Moves* button
  to open it, drag the handle down to dismiss, with the sheet following your
  finger. Tapping still works, the move list inside still scrolls, and
  `prefers-reduced-motion` disables the gesture rather than just shortening the
  animation. (#23, PR by @Vaibhavs25)

Also: the Spanish/Bulgarian strings for the new UI, and `npm test` is now at 89
tests.

## [7.10.1] — 2026-09-19

### Black could not move in a PvP game

Playing a full game against another person through two browsers — the one
test nobody had run — found this immediately. As Black, you could see the
opponent's moves arrive, the clock ran, "Your turn" showed, and clicking your
pieces did **nothing**. A page refresh fixed it, which is exactly why it read
like a flaky connection.

chessground caches where the board sits on screen and only re-measures on a
window resize or scroll. Black's board mounts while the opponent is still
connecting, so the "waiting for them to come back" banner is on screen; the
moment they arrive the banner disappears and the board slides up by its
height. chessground keeps the old position, so every click is mapped to the
square *below* the one you clicked — usually an empty square, so nothing gets
selected and the board looks dead. White never saw it, because White's board
mounts after the opponent is already online.

The board now re-measures itself whenever it moves or changes size (and a
ResizeObserver covers a resize that comes with no re-render, like a rotating
phone). Two new tests: a component test that pins the re-measure, and
`npm run test:ui` — two real browsers playing each other through the actual
interface, which is the only thing that would have caught this. Nothing else
changed.

## [7.10.0] — 2026-09-18

### Spanish, tests, PvP negotiation, and two bugs nobody could have seen

This release closes every open issue on the tracker (#10–#16) and merges the
first external feature PR. Thanks to **@fiedri** for the Spanish translation
and — more than that — for restructuring the coach prompts so the *next*
language is a table entry instead of a branch in every function.

- **New: Spanish.** The whole app — UI, setup wizard, coach persona and
  hard rules, move narration, Game Review prose — in `es`. Every language
  toggle now iterates one registry (`web/src/lib/languages.ts`), so adding a
  fourth language touches one list, one JSON file and the server enums; the
  contributor guide has the recipe. Text-to-speech picks a Spanish voice
  and previews in Spanish. (#14, #17 by @fiedri)
- **New: PvP draw offers, takebacks and one-click rematch.** Offer a draw
  (crossing offers count as agreement), ask for a takeback (rolls back to
  before your last move, one or two plies as needed), and from the game-over
  card start a rematch with colours swapped and the same clock — no trip
  back through the lobby. Offers are relayed live, survive a refresh, and are
  cancelled by any move. (#10)
- **New: "What's the threat?" in Game Review and Lab.** If you passed, what
  would the opponent play? A null-move engine probe rendered in plain words
  from the move's own facts — "Nxf7, takes the pawn on f7, winning a piece",
  "Qxf7#, checkmate" — never an invented line, no LLM involved. (#12)
- **New: master-game stats.** A "Master games" card under the engine lines
  with win/draw/loss, game count, ECO name and the top continuations from the
  Lichess Opening Explorer, proxied and cached server-side, shown next to —
  never instead of — the engine. `LICHESS_EXPLORER_URL` points it at a
  self-hosted explorer. Heads-up: Lichess is currently refusing third-party
  API clients (lila#19610), so the card shows an "unreachable" line until
  they reopen it or you run your own. (#11)
- **New: phone layout for Play.** Full-width board, a sticky bottom bar
  (back/forward, moves, flip, hint, resign, PvP actions in a menu) and a
  tap-to-expand moves sheet. Desktop also gains a board flip. (#13)
- **New: `setup.sh`.** `npm run setup` now works on Linux and macOS too —
  detects OS/CPU, fetches the matching official Stockfish 17 build into
  `./bin/`, and is safe to re-run. (#16)
- **New: a real test suite.** `npm test` (vitest) runs in CI on every PR:
  the classification ladder and Elo calibration, the Glicko-1 math, the PGN
  save/restore cycle PvP reconnects depend on, the explorer client against a
  mocked upstream, and the threat/takeback/time-control helpers.
  `npm run test:e2e` boots a real server and plays a PvP game over two
  WebSockets. (#15)
- **Fixed: two-player games never relayed a single move.** Each player has
  their own `games` row, but PvP sessions were keyed by that row id — so the
  two humans sat in two separate sessions, each seeing "opponent
  disconnected". Sessions are now keyed by the shared game id. Found by the
  new end-to-end test; nobody had reported it because the live instance has
  never had two people online at once.
- **Fixed: timed PvP games ran without clocks.** The stored time control is
  `600+0` but the socket looked it up as the keyword `rapid`; it also made
  "classical" a 10-minute game. Both formats are understood now and
  classical is 30 minutes again.
- **Fixed: Brilliant moves could not exist.** The sacrifice test compared
  your material before and after *your own* move, which never changes —
  4,482 classified moves in the reference database and not one Brilliant.
  Sacrifices are now measured with a static exchange evaluation on the
  position after the move, net of what it captured, with the engine-line
  recapture filter comparing material *balance*. Roughly 1 in 100 engine-top
  moves now qualifies before the filter, which is about what chess.com shows.
  Scoring version 8 → 9: cached analyses re-run on next view.
- **Changed: Game Review prose is table-driven.** `review.ts` joins
  `prompts.ts` in keeping every language string in one lookup — English and
  Bulgarian output is byte-identical (verified across 26,776 prompt
  renderings).

## [7.9.0] — 2026-09-06

### vLLM support, three bug fixes, and a security pass

A community-driven release — every change here started from a GitHub issue
or pull request. Thanks to **@qrakhen**, **@souorosco**, **@ryanchristle**
and **@bashir-abdelwahed** for the reports and the diagnosis work.

- **New: vLLM as an AI-coach backend.** The coach can now talk to an
  OpenAI-compatible vLLM server as an alternative to Ollama, picked with a
  provider toggle in **Admin → System**. Ollama and vLLM keep independent
  URL + model settings, so switching the toggle never clobbers the other's
  config — point one at a small local model and the other at a bigger box,
  and flip between them freely. Reasoning models served via vLLM (Qwen3 and
  friends) have their chain-of-thought suppressed the same way Ollama's do,
  so a tight response budget doesn't get eaten by thinking tokens before the
  model ever answers. Existing deployments need no migration — the provider
  defaults to Ollama. (#1)
- **Fixed: board frozen when playing Black.** Starting a bot game (or
  joining a PvP game) as Black could leave the board permanently unplayable
  — pieces would visually move but no move ever reached the server, with no
  error shown. Root cause: the board's drop handler was only wired up when
  it mounted on your turn; mounting on the opponent's turn (always the case
  for Black at game start) left it disconnected for the rest of the game.
  Premoves had the same gap. (#3, reported and diagnosed by @souorosco)
- **Fixed: PvP games failing to connect for one side.** Accepting a
  challenge could leave one player stuck on "Connecting to game…" forever
  while the other saw a permanent "opponent disconnected" — every game
  needed two database rows (one per player), but only one of them was ever
  handed out as the game to join, so whichever player got the other row
  could never connect. (#2, reported by @ryanchristle)
- **Fixed: bot difficulty tiers playing at nearly the same strength.** Every
  difficulty from "kid" to "stockfish" shared Stockfish's effective rating
  floor, so a weak setting still played like a strong club player — just
  with less thinking time. Rebalanced the depth/time/rating curve per tier
  and added slight per-move timing variance so the bot feels less
  metronomic. (#4, reported and fixed by @qrakhen in #6)
- **Security:** updated dependencies flagged by `npm audit` (several
  severe/critical advisories, mostly in the optional SMTP mailer path) and
  resolved the one remaining non-breaking finding (`postcss-selector-parser`
  DoS). Three moderate/high findings remain that require major-version
  bumps (nodemailer, react-router, vite/esbuild) and real regression
  testing — tracked for a future release rather than forced through here.
  (#6, contributed by @qrakhen)

## [7.8.0] — 2026-06-24

### Players — browse the people you play

Patzer gains a social surface. Until now you could challenge other accounts
from the Play tab, but you couldn't *see* anyone — no record, no ratings, no
sense of who's who. This release adds a proper players directory and public
profiles, so a family/club instance feels like the small social network it is.

- **New "Players" page (`/players`).** A directory of everyone on the instance:
  avatar, online dot, lifetime games, win-rate and best rating at a glance.
  Search by name/username, sort by Rating / Win % / Games / Name, online
  players always float to the top, and the top three on the rating board get a
  crown. You appear in the list too, badged "You".
- **Public player profiles (`/players/:id`).** Full record for any player —
  W/L/D, win-rate, average accuracy, current streak, per-time-class ratings
  (bullet/blitz/rapid/daily, provisional-aware), and their last ten games.
- **Your head-to-head.** Each profile shows your personal score against that
  player (wins / draws / losses), computed from your own game rows.
- **Challenge from the profile.** Pick a colour and time control and send a
  live invitation without leaving the page; a pending challenge shows a
  "waiting…" state you can cancel.
- **Missed invitations.** The Players page surfaces challenges that expired
  before you answered them, with a one-tap "Challenge back".
- **Wired into the chrome.** New nav pill (desktop + mobile), command-palette
  entry, and a `g u` keyboard jump. Full EN/BG localization.
- **New API:** `GET /api/players` (directory) and `GET /api/players/:id`
  (profile), plus `GET /api/challenges/history` for invitation activity. All
  read-only and auth-scoped; no schema changes — built on existing tables.
- **Delivery:** images now also publish to **Docker Hub**
  (`sikamikaniko123/patzer`) on every push to `main`, and the reference home-server deployment
  tracks that image via Watchtower for hands-off redeploys.

## [7.7.0] — 2026-06-23

### Self-service signup + email (SMTP) + a user-creation fix

The admin "New user" form could bounce with a bare `invalid_input` and no
explanation; visitors had no way to make their own account; and there was no
email capability at all. This release fixes the first and adds the other two.

- **Fixed: admin "New user" failing with `invalid_input`.** The modal let you
  submit a 6–9 character password while the server requires **≥ 10** — the
  mismatch surfaced only as an opaque code. The client now mirrors the server
  rules (username ≥ 2, password ≥ 10, display name required), shows an inline
  password hint, and renders the server's field-level validation details
  instead of a raw error string (`web/src/pages/admin/Users.tsx`,
  `web/src/lib/errors.ts`).
- **Self-service signup.** A public `POST /api/auth/register` plus a `/signup`
  page and a "Create account" link on the login screen. Gated by a new
  **Allow self-registration** admin toggle (on by default). Self-signups are
  always created as `user` (never `admin`), rate-limited like login, and
  default to the friendly `beginner` profile.
- **SMTP email.** A nodemailer-based mailer configurable from **Admin → System
  → Email (SMTP)** or via `SMTP_*` environment variables (env wins). The stored
  password is never returned to the browser. Includes a **Send test email**
  button that verifies the connection first.
- **Email verification.** Optional **Require email verification** toggle. When
  on *and* SMTP is configured, new signups must confirm their address before
  signing in; `/verify-email` confirms the token and doubles as a resend form.
  Fails open when SMTP isn't configured so it can never lock anyone out.
- **Password reset.** "Forgot password?" → emailed, single-use, 1-hour link →
  `/reset-password`. Completing a reset clears every existing session for that
  account (evicts an attacker) and marks the email verified. Account-enumeration
  safe: the forgot/resend endpoints always return the same generic response.
- **Admin notifications.** Admins with an email get a heads-up when someone
  self-registers (toggle: **Notify admins of new sign-ups**).
- **Data model.** Idempotent migrations add `users.email` (case-insensitively
  unique when present) + `users.email_verified` (defaults to `1`, so existing
  accounts are never stranded) and a hashed, single-use `auth_tokens` table.
- **Docs.** `.env.example` documents `SMTP_*`, `PUBLIC_BASE_URL`, and the
  signup/verification settings.

## [7.6.3] — 2026-05-17

### Docs — popularization-prep pass

A full pre-promotion audit of the public surface. No app-code changes; this
release is the audit findings turned into shipped files.

- **README hero GIF placeholder removed** (was a `<em>(hero GIF — see... after
  recording)</em>` TODO masquerading as content; first impression killer).
- **README clarifies the BYO-Ollama vs out-of-the-box split.** "Play vs
  Stockfish, play vs friend, classify, accuracy %, eval graph" all work
  without Ollama and without a Chess.com account — only the AI Coach narrator
  and game-import need them. Previously implied as "required".
- **README "clone of Chess.com" → "take on the Chess.com / Lichess
  workflow"** (`README.md`, `CONTRIBUTING.md`). "Clone" overpromises features
  (matchmaking, ratings ecosystem) Patzer doesn't ship, and "Chess.com" is a
  trademark we don't want to use as our product-category label. The README
  hero "Your private Chess.com" stays — that's metaphor, not categorization.
- **GitHub Private Vulnerability Reporting enabled** and `SECURITY.md` /
  `CODE_OF_CONDUCT.md` updated to route through PVR instead of a public
  personal email.
- **`docs/FAQ.md` added** to pre-answer the questions every HN/Reddit thread
  about a self-hosted chess tool gets: is the Chess.com API legal, is Ollama
  required, NAT/proxy notes, backup/restore, lost admin password, "why
  Patzer", and how this differs from Lichess Studio / Aimchess.
- **`deploy.sh` added** as the Linux/macOS twin of `deploy.ps1` (same
  `.env.deploy` contract, same `--no-build` / `--logs` flags). README's
  deploy section now documents both.
- **GitHub releases backfilled.** Tags + releases for every version commit
  from v3.2.0 through v7.6.1 (11 versions) — the Releases page previously
  showed v6.0.0 as latest, making the project look abandoned despite weekly
  work. Now matches reality.
- **Repo renamed** `SikamikanikoBG/chess` → `SikamikanikoBG/patzer` to match
  the package name and the link in every doc. GitHub auto-redirects the old
  URL; CHANGELOG reference-links updated.

No code under `server/src/` or `web/src/` changed in this release. The Docker
container on a self-hosted deploy does not need to redeploy for 7.6.3.

## [7.6.2] — 2026-05-17

### Docs

- Backfill the 7.6.1 changelog with three UI-polish bullets that shipped
  in `bbea1e6` but were never written down (review-table glyph match,
  larger on-board badges, visible laptop logout button).

## [7.6.1] — 2026-05-12

### Changed — review tables, on-board badges, logout button

- `GameReportCard.tsx`: the move-breakdown row was a 10px solid color dot
  with no glyph (different code path from `ClassificationStats.tsx`, which
  already had the right icon). Now uses the same `h-6 w-6` circle with the
  classification's SVG glyph — what users see in the breakdown matches
  what they see in the per-move list and the legend.
- `ClassificationBadge.tsx`: on-board badges 2.4 / 3.0 % of board → 3.2 /
  4.4 %. ~1.4× larger so the glyph reads at a glance on a laptop board.
- `Layout.tsx`: laptop logout button was an icon-only ghost button in
  near-bg color, easy to miss. Now a bordered pill with "Logout" label on
  `lg+`, red on hover.

### Fixed — coach hallucinating + reasoning models returned empty

Investigation triggered by the user reporting frequent hallucinations from
the live coach despite the admin UI showing a larger model selected.

Findings on the live host:
- The admin UI **was** saving correctly; SQLite `settings.ollama_model` held
  the chosen model and `chatStream` reads it fresh per request.
- The configured model (`ministral-3:14b`) was the one actually being
  called — confirmed via Ollama logs + VRAM resident snapshot — but at 14B
  parameters it still produces confidently-wrong chess prose ("e4 and e5
  lock in the queenside while leaving the kingside exposed") despite the
  FACTS scaffolding.
- A separate latent bug: reasoning models on this host (gemma4:26b,
  gpt-oss:20b-patched) emit their chain-of-thought into `message.thinking`
  and only put the final answer into `message.content`. The chess
  `chatStream` parser only reads `content`, so the user saw an empty
  stream. With `num_predict` capped at 220 the CoT also ate the entire
  budget before the answer ever arrived.

Changes:

- `coach/ollama.ts`: pass `think: false` on every `/api/chat` call.
  Non-reasoning models silently ignore it; reasoning models behave like
  normal chat. The coach is a faithful FACTS renderer — reasoning is
  counterproductive and burns budget.
- `routes/admin.ts` GET `/api/admin/system`: now also returns
  `last_model_used`, `last_error`, `p95_ms`, `call_count` from the
  module-level latency / model-name tracker, so admins can verify what the
  coach actually called rather than just what's saved.
- `pages/admin/System.tsx`: new "Runtime" panel below the model picker
  showing the last-used model, call count, p95 latency, and last error
  with a refresh button.
- DB setting `ollama_model` switched from `ministral-3:14b` to
  `gemma3:27b` on the live host (Gemma 3 27B was the best of the three
  large models tested — clean, faithful output, no chain-of-thought).
  Default fallback in code stays the same; admins can repick freely.

## [7.6.0] — 2026-05-12

### Fixed — pawn promotion was silently rejected

`ChessBoard`'s chessground `events.after` callback was bound inside a
mount-only effect, so it kept reading the start-position FEN forever. Every
time a pawn reached the last rank, `needsPromotion(staleFen, …)` returned
false, the move was sent as a bare 4-char UCI without a promotion piece,
and the server rejected it as illegal — the picker never appeared. The
callback now reads live `fen` / `onMove` / `turnColor` from refs, and the
promotion picker's position formula is corrected (it used to render at the
opposite end of the board).

### Changed — more legible UI

- Small text bumped +1px across the app: `text-[9px]→[10px]`,
  `text-[10px]→[11px]`, `text-[11px]→text-xs`. The `.label` utility class
  follows the same bump.
- Classification icons in the move list and the review summary now use the
  same circle size (`h-6 w-6`, 14px glyph) so the legend and the moves it
  describes match visually.
- Kid-mode mood bubbles roughly 1.5× larger (18→28px container, 13/14→20/22
  font) — readable at glance even on a small board.

### Changed — modern sound design

`web/src/lib/sounds.ts` was rewritten from bare oscillator beeps to a
proper synthesized chain: master compressor + parallel convolution reverb
(decaying-noise impulse), wood-knock voicing for moves/captures/castles
(transient noise click + low body sine with quick pitch droop), and
inharmonic-bell additive synthesis for check / promotion / game end
(partials 1.0, 2.01, 2.99, 4.07, 5.42 ≈ a small handbell). Sequences are
scheduled sample-accurately via `osc.start(at)` instead of `setTimeout`.
Still 100% synthesis — no external audio assets.

## [7.5.0] — 2026-05-12

### Added — Living Pieces (kid mode)

A new opt-in feature for the **kid** audience that turns the board into an
emotional reading exercise. The goal is to teach 7-10 year olds to read the
*whole* board at a glance — instead of looking at each square individually,
they see who's a hero, who's scared, who's defending, and who's still
asleep, all updated in real time as the position changes.

**User stories**

- _"As a kid playing, I want to instantly see which of my pieces are in
  danger, so I can react before losing material."_ → pieces under attack and
  either undefended or losing the exchange wobble with a red **😱** bubble.
- _"As a kid, I want to know when I have a heroic move, so I learn to spot
  tactics."_ → any piece that can capture a more valuable enemy piece, give
  check, or deliver mate bobs gently with a gold **🦸** bubble.
- _"As a kid, I want to understand defense, so I learn what 'guarding' is."_
  → any piece that is currently defending a friendly piece *that is itself
  under attack* pulses with a blue **🛡️** bubble. (Plain "defends a piece
  that isn't in danger" doesn't qualify — would otherwise flag every
  back-rank rook in the opening as a guardian.)
- _"As a kid, I want to be encouraged to develop my pieces, so I stop
  shuffling the same knight."_ → minor pieces and rooks still on their home
  squares from move 3 onwards drift with a purple **💤** bubble.
- _"As a parent, I want to enable/disable this for my kid specifically, so
  it doesn't show up on the adult accounts on the same server."_ → toggle in
  Settings, visible only when audience is set to "kid".

**Emotional states (priority high → low)**

| Mood | Trigger | Animation | Why kids care |
|------|---------|-----------|---------------|
| 🦸 Hero | Can capture a higher-value piece, give check, or deliver mate. | Gold ring, gentle bob up/down. | Spot tactics. |
| 😱 Stressed | Attacked AND (undefended OR cheaper attacker = losing trade). King: in check. | Red ring, wobble side-to-side. | Stop hanging pieces. |
| 🛡️ Guarding | Defends ≥1 friendly piece that's currently under attack. | Blue ring, soft pulse. | Learn defense. |
| 💤 Sleeping | Minor/rook on its starting square, fullmove ≥ 3, no enemy attacks. | Purple ring, slow drift. | Develop your pieces. |
| (calm) | None of the above. | No overlay (avoid clutter). | — |

**UI**

- Mood bubbles sit at the **top-left** corner of each affected square, so
  they never collide with the existing top-right ClassificationBadge.
- All animations are CSS-only, capped at one per piece per frame; on a 32-
  piece position the cost is negligible.
- `prefers-reduced-motion` kills the animations but keeps the colored rings,
  so the *information* is still available to motion-sensitive kids.
- Only the **viewer's own pieces** get moods — kid focus is "how are MY
  pieces doing", not the opponent's.
- Disabled during browse-past-position mode in Play, to avoid confusion
  between "moods of the live position" and "moods of an earlier position".

**Settings**

A new section appears in Settings → only for accounts whose audience is
`kid`. It contains:
- A single toggle: "Show piece feelings" (off by default).
- A 2×4 preview grid showing each of the four moods animating live, with a
  one-line description.

**Storage**

- New profile column `kid_piece_emotions INTEGER NOT NULL DEFAULT 0`.
- Idempotent via `ensureColumn` — existing installs upgrade silently.
- The flag is part of the same PATCH `/api/settings/profile` payload as the
  other toggles, so the save path didn't grow a new endpoint.

**Files**

- `web/src/lib/pieceMoods.ts` — chess.js-based mood detector.
- `web/src/components/PieceEmotionsOverlay.tsx` — absolute-positioned bubble
  layer above the chessground board.
- `web/src/index.css` — keyframes + `.mood-*` classes.
- `web/src/pages/Settings.tsx` — new section + `MoodPreview` helper.
- `web/src/pages/Play.tsx` — overlay wired in, gated on profile + audience.
- `server/src/db.ts`, `server/src/routes/settings.ts` — schema + zod.

## [7.4.2] — 2026-05-11

### Fixed

- **EvalBar invisible in Game Analyzer.** The v7.3.0 board layout switched
  the board element to `w-full` inside a flex row, putting shrink pressure
  on the eval-bar sibling. EvalBar's flex item had no explicit width and no
  `flex-shrink: 0`, so it collapsed to ~0 pixels. `alignSelf: 'stretch'`
  was also on the wrong element (the inner styled div, not the flex item),
  so even when wide enough it had zero height. Fixed by moving the size +
  `flex-shrink: 0` + `align-self: stretch` to the outer flex item and
  letting the inner fill it with `h-full w-full`.

## [7.4.1] — 2026-05-11

### Changed — accuracy calibration

Re-ran the Hikaru April 2026 benchmark across three volatility-weight cap
values to find the sweet spot:

| cap | MAE vs chess.com | bias | max Δ | ±3 hit |
|-----|------------------|------|-------|--------|
| ∞ (v7) | 5.32 | −0.29 | 21.47 | 45% |
| 2.0 | 5.60 | +4.80 | 19.27 | 45% |
| 3.0 (7.4.0 shipped) | 4.90 | +3.52 | 17.27 | 50% |
| **4.0 (7.4.1)** | **4.97** | **+2.58** | 17.57 | **55%** |

4.0 picked over 3.0: nearly identical MAE, lower systematic bias (+2.58 vs
+3.52 = users see numbers closer to chess.com), and the better ±3-pt
hit-rate is what most users will actually feel ("am I within 3 points of
what chess.com told me"). The 7.4.0 CHANGELOG incorrectly described the
clamp as reverted — it actually shipped at 3.0; this corrects the record.

## [7.4.0] — 2026-05-11

This is the code drop matching the 7.1.x / 7.2.0 entries above (board sizing
rearrangement, MoveRow scroll containment, Home redesign, mobile-friendliness
pass across Layout/Insights/Settings/admin/Users/Play, GameReportPanel
double-header removal, AnalyzedMove `mate_before`/`mate_after`, opponent-RD
fix, env-tunable Stockfish, `ucinewgame` between games, key-moment dedupe
widened, accuracy floor only when n ≥ 5, forced moves excluded from accuracy
aggregate, ACPL cap, Brilliant 4-ply recapture replay). Plus the following
genuinely new work below.

### Changed — analytical engine (SCORING_VERSION 7 → 8)

Calibrated against the Hikaru April 2026 archive (10 blitz games, 20 data
points). Current state vs chess.com: MAE 5.32 points, mean signed bias
−0.29, 70% within ±5 pts.

- **Great tightened.** Threshold raised 150 → 200 cp on the only-good-move
  pattern, AND the v7 "near-best (cpLoss ≤ 30) + only-good-move" alternate
  pattern is removed entirely. chess.com only tags Great when the player
  picked engine #1, and the v7 alternate was over-firing (5 Greats per blitz
  game in benchmark game 2). Pure #1-or-eval-flip Great now.
- **Accuracy volatility-clamp experiment reverted.** Clamping volatility
  weight to ≤ 2.0 fixed the worst single-blunder outlier (game 10 W: Δ −21
  → −3) but pushed bias from ~0 to +5 across the sample because `volMean`
  drifted toward arithmetic on multi-error games where chess.com punishes
  harder. Net MAE 5.32 → 5.60. Reverted; documented in the `accuracy.ts`
  header so future passes don't repeat it.

### Added — chess.com accuracy benchmark harness

New `server/scripts/` directory:

- `benchmark-chesscom.ts` — runs `analyzePgnFull` over a JSON file of real
  chess.com games and writes a side-by-side report (per-side accuracy, our
  vs chess.com's reported, MAE / bias / coverage bands, plus classification
  counts and our estimated Elo per game).
- `benchmark-games.json` — the Hikaru April 2026 sample (10 games, 37–59
  plies, ratings 2994–3431, results spread, with chess.com's reported
  accuracies as the ground truth).
- `benchmark-report.md` — the report from the most recent run (regenerated
  by re-running the script).

Run with `npx tsx server/scripts/benchmark-chesscom.ts [depth]`. This is the
tool that drove the SCORING_VERSION 8 calibration and will continue to gate
future scoring changes.

### Fixed — Settings: sound + blunder-warning toggles now persist

`Settings.tsx`'s save payload was building `sound_enabled` and
`blunder_warning` from form state but never including them in the PATCH
body, so toggling either checkbox had no effect across reloads. Added both
fields to the payload sent to `/api/profile`.

## [7.3.0] — 2026-05-11

### Fixed — mobile board coordinate alignment

Chessground's default coord CSS uses fixed pixel offsets (`top: -20px` on
ranks, `left: 24px` on files) calibrated for a desktop board. On a small
mobile board those become a much larger fraction of the width, and the a/b/c
file labels visibly drift off their squares. Replaced with pure percentage
positioning anchored inside the board edges (lichess/chess.com style), with
a responsive `clamp(8px, 1.6vmin, 11px)` font size. Labels now stay aligned
at any board size.

### Changed — nav label "Play vs Bot" → "Play"

The Play page lets you set up a game against either a bot OR another player,
but the nav pill (and home CTA) said "Play vs Bot". Renamed the
`home.playTitle` i18n key in both EN and BG, plus the matching `playDesc`
and `firstRunReady` strings.

### Changed — AI coach hardening (anti-hallucination FACTS pass)

Diagnosis: small local models (default `gemma3:1b`) routinely hallucinated
piece locations and motifs in Game Review because the FACTS payload sent to
them only described *the move* — no piece inventory, no win-probability, no
natural-language eval state. With abstract terms only, the model fell back
to chess-trained prose ("your bishop pins the knight on f6") about pieces
that aren't on the board.

Fixes in `server/src/coach/`:

- **Piece inventory in FACTS.** New `boardPiecesNatural(fen, color)` helper
  walks the FEN and emits `your_pieces` / `opponent_pieces` lists like
  `["queen on d1", "rook on a1", "8 pawns"]`. Injected into both
  `/api/coach/explain` and per–key-moment FACTS in the pre-generated review.
  This is the critical grounding — the model now has the exact piece list
  to reference.
- **Win-probability and natural-language eval state.** `factsForExplain`
  now ships `win_pct_before/after/delta`, an `evaluation_state` label
  ("winning", "slightly worse", "roughly equal"…), and a
  `material_balance` phrase ("you are down a knight"). Strong concrete
  anchors to repeat instead of inventing.
- **Tighter system prompt.** R1 explicitly forbids naming any piece or
  square outside `your_pieces`/`opponent_pieces`. New R11: "if FACTS
  doesn't have a detail, STAY GENERAL — don't invent details to fill
  space." Added one worked GOOD vs BAD example showing what a faithful
  rendering looks like versus a hallucination.
- **Per-call TASK nudge.** The TASK line tells the model to use
  `FACTS.evaluation_state` OR `FACTS.material_balance` as its anchor.
- **Lower temperature.** Explain endpoint 0.3 → 0.15 — we want faithful
  rendering of FACTS, not creative chess prose.
- **`REVIEW_PROSE_VERSION` 2 → 3** so cached game reviews regenerate with
  the new grounded payload.

UX in `web/src/components/CoachPanel.tsx`:

- **"Show context" toggle.** A small info-icon button next to the coach
  controls now reveals a collapsible block with the exact JSON FACTS
  payload that was sent for the current ask. Directly answers "what is
  actually being injected into the prompt?" — every call is inspectable.

Wired `eval_before_cp` / `eval_after_cp` from `GameAnalyzer.tsx` through
the explain endpoint schema so the new win-probability fields are populated
in Game Review.

## [7.2.0] — 2026-05-11

### Changed — Home redesign

Home was doing too much: 7 stacked sections, repeating icon-on-tinted-square
patterns on every tile, tiny uppercase tracking-wide labels stacked three at
a time, a "what's new" toast, a kitschy inline SVG checkerboard ornament in
the hero. It read like a wireframe. New layout is 3 sections:

- **Hero** — greeting (time-aware), avatar, the player's name as the H1, and
  stats inlined as one bold-number-plus-tiny-label row (`142 GAMES · 67% WIN
  RATE · 78% ACCURACY · 3 WIN STREAK`). Background uses a single soft
  radial-fade chessboard pattern instead of the rectangular SVG ornament.
  Primary action (Play) sits next to the greeting with a subtle right-pull
  arrow on hover. Secondary "Review" is a glass pill.
- **Continue your journey** — one row of three compact tiles (puzzle / plan /
  achievements). Each tile has the same scaffold so the row reads as a unit.
  Plan progress bar animates from 0 → pct on mount (one element only).
- **Recent games** — a single rounded list with hairline dividers instead of
  five separate card-hover boxes. W/L/D pill on the left, names, date +
  opening, accuracy on the right. The active side's accuracy is emphasized
  in semibold; the opponent's is muted.

Removed: standalone Stats strip, First-run state card, "What's new" toast.
Stats live in the hero now; the version chip in the footer already surfaces
"what's new".

Motion is restrained: one entrance fade-up on each section, 60ms stagger on
the three continue tiles, a one-time width animation on the plan progress
bar. No constant looping, no scale wobble.

## [7.1.3] — 2026-05-11

### Changed — board sizing and scroll behaviour (rearranged, not just wrapped)

- **Board column is wide again on laptops.** The previous fix capped the
  column's `max-width` by viewport height, which produced a narrow column on
  short screens. Reverted to `lg:max-w-[760px]`. The **board element itself**
  is now `aspect-square` with `lg:max-w-[calc(100vh-Xrem)]` — the height cap
  shrinks both dimensions while the column stays wide.
- **Eval graph moved out of the board column into the right rail.** Sits
  between the opening banner and the report card. Removes ~8rem of vertical
  chrome from the board column, which lets the board itself be larger.
- **MoveRow no longer cascades `scrollIntoView` to the page.** Stepping
  through moves used to scroll the page down to the move list on every
  click. The new effect finds the FIRST scrollable ancestor (the move-list
  wrapper) and scrolls only that. Right rail stays still. Page stays still.
  The board stays where the user is looking.
- **Play page** uses the same aspect-square + viewport-height-aware board
  cap. Wider column on lg+ than the previous fix.

## [7.1.2] — 2026-05-11

### Fixed

- **Game Analyzer (`/review/:id`) fits the fold.** Same treatment as Play:
  the workspace's flex row is capped at `calc(100vh − 11rem)` on lg+ with
  `overflow-hidden`, the board column caps at `min(760px, calc(100vh − 31rem))`,
  and the right rail (which legitimately has more cards than fit — opening
  banner, report card, tabs, lines, toolbar, export) scrolls *inside itself*
  via `overflow-y-auto` + `min-h-0`. No more page-level scroll on desktop.

## [7.1.1] — 2026-05-11

### Fixed

- **React error #310 in Game Analyzer.** Five `useState` and a `useEffect`
  for the engine-lines panel sat after the `if (isLoading || !data) return`
  early-return in `GameAnalyzer.tsx`. The hook count differed between the
  loading and loaded renders — a latent bug surfaced by 7.1.0's
  SCORING_VERSION bump, which makes the loading→loaded transition happen
  more often (cached analyses re-run on view). Hooks hoisted above the
  early return.
- **Play page fits in the viewport.** The board column on lg+ now caps at
  `min(760px, calc(100vh - 22rem))` so the board + clocks + step controls
  + turn row cluster never overflows the fold. Previously the square board
  could be ~760px tall and forced page-level scrolling.

## [7.1.0] — 2026-05-11

The "feels like chess.com 2" polish — tightens the analytical engine and
unsticks the "analysis within analysis" feel of the Game Review screen, plus
a broad mobile-friendliness pass.

### Changed — analytical engine (SCORING_VERSION 6 → 7; old caches re-run)

- **Brilliant is a real sacrifice now.** The trivial-recapture filter
  (`classifier.ts:isTrivialRecapture`) replays the engine PV 4 plies through
  chess.js and re-checks material. Previously it only inspected the immediate
  material delta — equal-trade exchange sacs were classifying as Brilliant.
- **Great is no longer pinned to engine #1.** A non-#1 played move can also
  classify as Great when it's within 30cp of best AND the top engine
  candidate dominates the second-best by ≥150cp.
- **ACPL aggregation capped at 300 per ply** (`cpLossForAcpl`). One mate-flip
  ply previously added 1000/N to the average, dragging estimated Elo by
  ~300-400 points on otherwise-clean games.
- **`ucinewgame` between analyses.** The shared engine instance no longer
  carries TT state across games.
- **Stockfish threads + hash are env-tunable.** `STOCKFISH_THREADS` (default
  2) and `STOCKFISH_HASH` (MB, default 128). Match your host.
- **Forced moves excluded from accuracy aggregate** — they weren't your
  choice, like book moves.
- **Game-accuracy floor only when n ≥ 5.** Short games no longer collapse
  onto the worst move.
- **`mate_before` / `mate_after` on each AnalyzedMove.** Eval bar / graph
  consumers can render "M3" instead of decoding ±10000-cp spikes.
- **Per-game performance no longer leaks user RD as opponent RD** in
  `analyze.ts`. Without per-opponent RD storage, opponent confidence defaults
  to 350 (low) — cleaner than silently mis-blending.
- **Wider key-moment dedupe** (±4 plies) so adjacent inaccuracies in one
  tactical sequence don't both make the highlights cut.

### Changed — Game Analyzer UI

- **Tab strip renamed** for clarity: `Moves / AI report / Key moments / Coach`
  (was `Review / Report / Key / Coach`, with truncated labels that overlapped
  the page title "Game Review"). The internal `Tab` type's `'review'` value
  is now `'moves'`.
- **Removed nested "Game Report" header** inside the AI report panel — it sat
  inside a tab already labeled "AI report", stacking two identical titles.
  This is the root cause of the "analysis within analysis" feel.
- **Page-level CTA renamed** "Analyze" → "Run engine analysis" to distinguish
  it from the in-tab "Write AI report" button (different pipelines).
- **Tab labels icon-only below 640px** so the strip fits comfortably on a
  phone.

### Changed — mobile pass

- **`html, body { overflow-x: clip; }`** in `index.css` — safety net against
  any wide element triggering horizontal scroll on phones.
- **Game Report donuts stack on phones** (`grid-cols-1 sm:grid-cols-2`).
- **Openings repertoire table** wrapped in `overflow-x-auto` with
  `min-w-[28rem]` + per-cell `whitespace-nowrap` — previously clipped
  rightmost columns at <400px.
- **Settings theme pickers stack on phones** (3-up → 1-up below 640px).
- **Analyzer step controls** drop from `h-12` to `h-10` below 640px so they
  fit on iPhone SE.
- **Play.tsx turn/hint/resign row** now `flex-wrap`; rewind buttons drop a
  size on phones too.
- **Mobile drawer shows the user chip** at the top — previously the only
  identity cue was hidden under `sm:`.
- **Admin → New user grid** stacks on phones.
- **Move list height caps at 320px below 768px** so the right rail doesn't
  expand into a second screen of scroll.

## [7.0.0] — 2026-05-10

The "Beyond Chess.com 2.0" major — Personal Power Suite. Where v6 added the
features chess.com refuses to ship, v7 turns Patzer into a personal coach: a
weekly improvement plan that knows your weaknesses, a clickable opening tree
of your own repertoire, an achievement system tied to *your* games, an engine
sandbox to think out loud, and on-demand multi-PV in the analyzer.

### Added — Improvement Plan (`/plan`)

- **Weekly goals tailored to your data.** Five goal kinds (`puzzles_solve`,
  `opening_play`, `review_games`, `accuracy`, `win_streak`) seeded from
  insights — e.g. "play 3 games as White in your weakest opening" picks the
  actual ECO from your repertoire row with the worst score.
- **Live progress.** Each goal's bar advances as you play, train, or review.
  Goals expire after 7 days; completed ones get a gold sparkle.
- **`POST /api/plan/regenerate`** swaps in a fresh week.
- **Home tile** surfaces the most-imminent goal so the plan never goes cold.

### Added — Opening Tree Explorer (`/openings`)

- **`GET /api/openings/tree`** builds an EPD-keyed trie from your analyzed
  games (depth-capped at ply 20, top 8 children per node), attaches ECO and
  opening name where the position matches the curated book.
- **Clickable tree UI** with score chips (green ≥55%, red ≤40%), per-node
  W/D/L counts, and a mini-board that updates on selection.
- **"Train these →"** deep-links each node into Review filtered by opening.

### Added — Achievements

- **11 achievements across 4 categories** (milestone / mastery / tactics /
  streaks): from `first_game` and `first_win` through `centurion`,
  `puzzle_master`, `tactician`, `accurate_player`, three `streaker_*` tiers,
  and `opening_explorer`.
- **`GET /api/achievements`** returns the full catalog with live progress and
  first-unlock latching (`achievements_unlocked` table is write-once).
- **Insights page achievements section** (anchor-linkable via `#achievements`)
  shows all badges grouped by category — unlocked get a gold ring.
- **Home achievements tile** counts unlocked / total and previews the three
  most-recently-unlocked badges.

### Added — Engine Lab (`/lab`)

- **Position sandbox** with both colors movable, FEN paste/load/reset, board
  flip, and a side-to-move indicator.
- **`POST /api/analyze/position`** runs Stockfish multi-PV (lines 1-5, depth
  8-22) on demand. Each candidate returns UCI, SAN, full PV in SAN (8 plies),
  and cp/mate score.
- **Top-N lines panel** with click-to-play SAN, hint arrow for the engine's
  best move, and a move history list with click-to-revert.

### Added — Top-3 lines in Game Analyzer

- **Lines panel** in the right rail shows the engine's top 3 alternatives at
  the current ply. Toggle on/off; auto-fetches with 400ms debounce as you
  navigate. Hover a line to preview that move on the board.

### Added — Navigation & UX polish

- **Three new top-bar entries** (Openings, Plan, Lab) and matching mobile
  drawer items.
- **`g X` shortcuts** extended: `g o` (Openings), `g n` (plaN), `g l` (Lab).
- **Command palette** entries for the new pages.
- **"What's new" v7.0.0 badge** on Home (dismissible, persisted in
  localStorage).
- **Staggered framer-motion entrance** on Home tiles.

### Database

- **`goals`** — per-user weekly goals (kind, target, progress is computed),
  with auto-expire sweep at startup.
- **`achievements_unlocked`** — write-once table, one row per first-unlock.

## [6.0.0] — 2026-05-10

The "Beyond Chess.com" major. Where v4/v5 were *parity passes*, v6 lands the
features chess.com itself doesn't ship: a global command palette, a personal
tactic trainer drawn from your own blunders, year-of-games analytics, and a
keyboard-first power UX.

### Added — Tactic Trainer

- **`/train` page (and `/api/train/*` endpoints).** Solves puzzles extracted
  from your own analyzed blunders / mistakes / misses. The puzzle is the
  exact FEN before the move you got wrong; the solution is the engine's best
  move. Every solve is retraining a real pattern *you* lost rating to —
  unlike chess.com's generic puzzle dump.
- **Hint arrow** (engine's best-move hint, on demand).
- **Solved/Failed/Accuracy** counters; recent attempt stream stored in a new
  `puzzle_attempts` table (idempotent per `(user, game, ply)`, accepts
  multiple PV moves so equally-best alternatives both count as solved).
- **Home tile** surfaces "Today's puzzle" pulled from the next unseen
  blunder.
- **Open in Review** link from any puzzle deep-links to that exact ply in
  the full game analyzer.

### Added — Insights v2 (chess.com analytics, but more of it)

- **`/api/insights/v2`** returns six aggregates in one round-trip:
  activity heatmap, rating trajectory, opening repertoire, mistake taxonomy,
  per-time-class W/D/L + accuracy, and an accuracy trend series.
- **GitHub-style activity heatmap** — 53-week × 7-day calendar with
  intensity buckets.
- **Rating trajectory chart** — multi-series line chart for bullet/blitz/
  rapid/daily, drawn from `rating_history`.
- **Mistake taxonomy** with seven personalized buckets: hung pieces,
  one-move blunders, back-rank weakness, missed wins/mates, opening
  pitfalls, endgame drift, squandered advantages. Each tile links to the
  Tactic Trainer with one click.
- **Top openings table** — top 10 played by side, with W/D/L score % and
  average accuracy. Color-coded score column (green ≥55%, red ≤40%).
- **Time-class breakdown** with horizontal stacked bars (W/D/L proportions)
  and per-class accuracy.
- **Accuracy-trend chart** with avg-line marker and per-game result dots
  (green=win / red=loss / grey=draw).

### Added — Power UX

- **Command palette (⌘K / Ctrl K).** Global search-and-act for navigation,
  recent games, theme, language, logout. The first first-class keyboard
  surface in the app.
- **Keyboard shortcuts overlay (`?`)** documenting every binding.
- **`g X` prefix navigation** (g h, g p, g r, g i, g t, g s) for one-key
  jumps to Home / Play / Review / Insights / Train / Settings.
- **Game Review keys** — `F` flips the board, `S` copies a deep-link to
  the current position. Existing arrow / Home / End navigation kept.
- **Deep-link review** — the URL now carries `?ply=N` so refresh and
  share both jump to the exact move you were viewing.

### Added — Per-game bookmarks + notes

- **Star a game** to mark it for later. Star toggles inline on the Review
  list (with optimistic update) and from the game analyzer toolbar.
- **Private notes** per game (4000-char textarea, autosave on blur).
  Searchable via the new Review search input.
- **Filter "Starred only"** + free-text search across players, opening
  names, and notes.

### Changed — Layout

- **Top nav** gains a `Train` pill plus a chess.com-style "Search" chip
  (⌘K shortcut hint included), and a keyboard-help button.
- **Home dashboard** gets:
  - Inline accuracy sparkline on the avg-accuracy stat tile.
  - "Today's puzzle" tile pulled from `/api/train/next`.
  - "Top opening" tile sourced from `/api/insights/v2`.

### Schema additions (idempotent)

- `games.bookmarked INTEGER NOT NULL DEFAULT 0`
- `games.notes TEXT`
- New table `puzzle_attempts(user_id, game_id, ply, fen, solution_uci,
  attempted_uci, solved, created_at)` with unique `(user, game, ply)`.
- Existing `analyses` schema is **untouched** — v5 analyses remain valid;
  no SCORING_VERSION bump needed for any of the v6 features.

### i18n

- Full BG translations added for palette, shortcuts, train, insights v2,
  home tiles, review search/notes/star strings.

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

[2.0.0]: https://github.com/SikamikanikoBG/patzer/releases/tag/v2.0.0
[1.4.0]: https://github.com/SikamikanikoBG/patzer/releases/tag/v1.4.0
[1.3.0]: https://github.com/SikamikanikoBG/patzer/releases/tag/v1.3.0
[1.2.0]: https://github.com/SikamikanikoBG/patzer/releases/tag/v1.2.0
[1.1.0]: https://github.com/SikamikanikoBG/patzer/releases/tag/v1.1.0
[1.0.0]: https://github.com/SikamikanikoBG/patzer/releases/tag/v1.0.0
