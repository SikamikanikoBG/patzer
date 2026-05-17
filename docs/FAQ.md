# Patzer FAQ

A list of questions that come up often enough to belong here, written tersely so
you can actually scan them. If your question isn't covered, open a
[discussion](https://github.com/SikamikanikoBG/patzer/discussions).

## What is Patzer, in one sentence?

A self-hosted **Chess.com Game Review** alternative: pull your own games, get
Lichess-style classifications + accuracy + an LLM-narrated review, plus
play-vs-Stockfish and play-vs-friend, all in one Docker container.

## Why "Patzer"?

A *patzer* is chess slang for a weak amateur. The maintainer is one. The name
sets expectations: this tool is built for people who want to get better, not
for grandmasters who already have a coaching team.

## Is using the Chess.com API legal? Will I get a takedown?

Patzer pulls games through the **public, documented Chess.com API**
(`api.chess.com/pub/...`), with a proper User-Agent, against URLs you've
explicitly given it (your own username, entered in *Settings*). No scraping, no
auth circumvention, no rate-limit dodging, no resale of data. This is the
intended use of that endpoint. See
[`server/src/chess/chesscom.ts`](../server/src/chess/chesscom.ts) for the full
client — every URL is whitelisted against `api.chess.com/pub/` before fetching.

If Chess.com ever changes its terms, the fetch is one file. We'll adapt.

## Is this a Chess.com clone?

No, and we try not to call it that. Patzer focuses on the **Game Review /
training / analysis** slice of what Chess.com offers. It does **not** ship:
matchmaking against strangers, ratings against the global pool, tournaments,
puzzle rush, video lessons, or a public social graph. If you want those, stay
on Chess.com.

## Do I need to pay Chess.com Premium?

No. Patzer reads the public game archives that every Chess.com account
publishes for free. Premium changes nothing about the API surface Patzer uses.

## Is Ollama required?

It's required **only** for the AI Coach narrator. Everything else — playing
vs Stockfish, playing vs a friend, importing games, classifying moves,
computing accuracy, drawing the eval graph, marking blunders — works without
any LLM. If you never set up Ollama, you'll still get a serviceable Game
Review; the Coach panel just won't talk back.

## Can it run on a Raspberry Pi?

Yes, with caveats. Stockfish + the web stack run comfortably on a Pi 4 / Pi 5.
The AI Coach has to call out to an Ollama host — which usually isn't a Pi,
because small LLMs are still pretty heavy. Point Patzer at an Ollama running
on a desktop or NAS on the same LAN; the Pi just hosts the web app.

## I'm behind a NAT / reverse proxy. What do I do?

Everything you'd expect for a small self-hosted app:

1. Put Caddy / nginx / Traefik in front of the container, terminate TLS there.
2. Set `COOKIE_SECURE=true` in the container's env so session cookies are
   flagged `Secure`.
3. Make sure the proxy passes WebSocket upgrades through — `/ws/play` and
   `/ws/lobby` are core. In nginx that's
   `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade;` etc.

Public exposure isn't recommended (see [SECURITY.md](../SECURITY.md) — the
threat model assumes a trusted LAN), but a Tailscale tunnel or a Cloudflare
Tunnel works well for "let my family use it from anywhere".

## How do I back up my games?

Everything lives in one SQLite file: the volume you mounted at `/app/data`
(default `chess.db`). Copy that file while the container is stopped, or use
`sqlite3 chess.db .dump` for a portable SQL dump while it's running. Restore
by putting the file back in the same volume.

## I forgot my admin password.

There's no in-app reset yet. Until one ships:

```bash
docker stop patzer
sqlite3 /var/lib/docker/volumes/patzer-data/_data/chess.db  # or wherever
```

Then replace the offending row's `password_hash` with a fresh `bcryptjs` hash
(cost ≥ 12). Restart. This is documented in the
[README troubleshooting section](../README.md#troubleshooting) too.

## How is this different from Lichess Studio?

Lichess Studio is a great public, browser-hosted analysis surface. Patzer is
**self-hosted** (your games never leave your network), is **family-aware**
(profiles, admin console, per-profile language and audience tiers, kid-mode),
and has a **BYO-LLM coach** voice. Lichess is also free and excellent — if you
don't need self-hosting or kid-mode, use Lichess.

## How is this different from Aimchess?

Aimchess is a paid SaaS focused on weakness reports and drills. Patzer doesn't
compete on drill design or stat-arbitrage marketing — it's a Game Review +
coach + family platform you own.

## Can I run it without exposing Stockfish path to admins?

Currently no — the admin console can override `STOCKFISH_PATH`. The threat
model in [SECURITY.md](../SECURITY.md) explicitly calls that out: a compromised
admin account can point Stockfish at any local-executable binary. The
mitigation is to keep admin to one user (yourself) and run the container as a
non-root user without elevated privileges.

## What if I want a feature?

Open a [discussion](https://github.com/SikamikanikoBG/patzer/discussions)
first. The [ROADMAP](../ROADMAP.md) lists what's queued. Big features (new
top-level pages, variants, cloud features) will probably get pushed back —
see [CONTRIBUTING.md](../CONTRIBUTING.md#what-well-probably-push-back-on).

## How do I add my language?

Two JSON files and a register call. Step-by-step in
[CONTRIBUTING.md → Adding a language](../CONTRIBUTING.md#adding-a-language).

## Why GPL components if the project is MIT?

Patzer bundles **chessground** (GPL-3.0) for the board UI and links **Stockfish**
(GPL-3.0) as the engine. The MIT license applies to Patzer's own code; the
Docker image as a whole is therefore GPL-3.0 because of those components. See
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). If you're packaging
Patzer downstream, mirror the GPL-3.0 obligations for the image.
