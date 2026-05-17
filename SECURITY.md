# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 3.x     | ✅ |
| < 3.0   | ❌ |

## Reporting a vulnerability

Please **do not** file a public GitHub issue for security problems.

**Preferred:** use [GitHub's private vulnerability reporting](https://github.com/SikamikanikoBG/patzer/security/advisories/new) — you'll get a private, encrypted thread with the maintainer; nothing is public until a fix is published.

**Alternative:** email the address on the [maintainer's GitHub profile](https://github.com/SikamikanikoBG).

Whichever path you pick, please include:

- A description of the issue and what it lets an attacker do.
- A minimal reproducer (proof-of-concept) if you have one.
- Whether the issue is already public anywhere.

We aim to acknowledge reports within 7 days, ship a fix within 30 days for high-severity issues, and credit you in the release notes (unless you'd rather stay anonymous).

## Threat model

Patzer is intended to run on a trusted home network, behind a reverse proxy that handles TLS. Out of the box it assumes:

- Only invited family members reach the port.
- The Ollama instance the coach talks to is also on the local network and trusted (Patzer treats Ollama responses as untrusted text but trusts the Ollama URL itself).
- The host machine is single-tenant.

Things we **do** care about:

- Cross-user data access (one profile reading another's games).
- LLM output reaching `dangerouslySetInnerHTML` with unsafe URL schemes.
- Command/SQL injection through any user-provided input that crosses a boundary.
- CSRF on state-changing endpoints.
- Stockfish process leaks that exhaust host resources.

Things we **don't** currently defend against:

- A compromised admin account (admin can change `stockfish_path`, which is intentionally local-execute).
- Resource abuse by a logged-in user spamming `/api/analyze` (rate-limiting is on the roadmap).
- A malicious Ollama instance — if you point Patzer at someone else's LLM, you trust them with your prompts.
