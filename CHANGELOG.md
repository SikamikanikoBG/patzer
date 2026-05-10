# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
