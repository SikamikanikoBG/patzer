# Running Patzer with Nix

Patzer provides built-in support for [Nix](https://nixos.org/), enabling reproducible local execution and development without Docker or manual dependency management.

Whether you are running NixOS, Linux, or macOS, Nix takes care of supplying the exact version of **Node.js 22** and a natively compiled **Stockfish** binary optimized for your system architecture.

---

## Why Nix?

Running chess platforms locally often means hunting down compatible Stockfish binaries for your specific OS and CPU, configuring paths, and ensuring compatible runtime versions. Nix eliminates this completely:

- **Zero manual binary downloads**: Stockfish is automatically pulled and compiled/cached by Nix.
- **Hermetic Node.js runtime**: Runs on Node.js 22 LTS with required native compilation tools (`python3`, `pkg-config`).
- **No container overhead**: Run directly on bare metal with native performance and instant file updates during development.
- **Cross-platform**: First-class support for both Linux and macOS (Intel & Apple Silicon).

---

## Supported Architectures

The Nix configuration targets modern systems via `nixpkgs-unstable`:

- `x86_64-linux` (standard 64-bit Linux / NixOS)
- `aarch64-linux` (ARM64 Linux, e.g. Raspberry Pi 4/5, Ampere)
- `aarch64-darwin` (macOS Apple Silicon: M1 / M2 / M3 / M4)
- `x86_64-darwin` (macOS Intel)

---

## Quick Start: Running Patzer

### 1. One-Command Dev Mode

Start the full development stack (Vite frontend with HMR on port 5173 + backend on port 8800):

```bash
nix run
```

Or explicitly:

```bash
nix run .#dev
```

**What this does automatically:**
1. Exports `STOCKFISH_PATH` pointing to the Nix store binary.
2. Creates a symlink at `bin/stockfish` for convenience.
3. Installs `node_modules` via `npm install` if not present.
4. Spawns the frontend and backend in parallel via `npm run dev`.

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

### 2. Production Runner

To build and run Patzer in production mode:

```bash
nix run .#prod
```

**What this does automatically:**
1. Configures `STOCKFISH_PATH`.
2. Installs dependencies if missing.
3. Automatically triggers `npm run build` if `server/dist` or `web/dist` are missing.
4. Launches the production web server on [http://localhost:8800](http://localhost:8800).

---

### 3. Run Directly from GitHub (No Clone Needed)

You can run Patzer instantly on any machine with Nix installed without cloning the repository:

```bash
nix run github:SikamikanikoBG/patzer
```

---

## Development Environments

### Nix Flakes (`nix develop`)

For active development, enter the shell with all development dependencies exposed:

```bash
nix develop
```

Upon entering the shell:
- `node` (v22), `npm`, `stockfish`, `python3`, and `pkg-config` are placed on `$PATH`.
- `STOCKFISH_PATH` is exported pointing to the Stockfish executable.
- `./bin/stockfish` is linked to the active Nix Stockfish binary.

Inside the shell, work as normal:

```bash
npm install
npm run dev      # Start dev servers
npm test         # Run test suites
npm run build    # Build production bundles
npm start        # Start production server
```

### Classic Nix (`nix-shell`)

If you are using classic Nix without flakes enabled, `shell.nix` and `default.nix` provide an identical development environment:

```bash
nix-shell
```

---

## Direnv Integration

For seamless shell activation when entering the repository directory, Patzer includes `.envrc`.

1. Install [direnv](https://direnv.net/) and [nix-direnv](https://github.com/nix-community/nix-direnv).
2. Hook direnv into your shell (e.g. in `~/.bashrc` or `~/.zshrc`):
   ```bash
   eval "$(direnv hook zsh)"  # or bash / fish
   ```
3. Allow direnv in the project directory:
   ```bash
   direnv allow
   ```

Whenever you `cd` into the project, Node 22, Stockfish, and environment variables will load automatically in your shell without running `nix develop`.

---

## Environment Variables

The Nix apps and shells automatically set:
- `STOCKFISH_PATH`: Set to `${pkgs.stockfish}/bin/stockfish` in the Nix store.
- `STOCKFISH_THREADS`: Defaults to `2` in the Nix environment (overridable up to 16).
- `STOCKFISH_HASH`: Defaults to `512` (MB) in the Nix environment (overridable up to 4096).

All standard Patzer configuration variables can be passed inline or set in a `.env` file in the root directory:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8800` | Port for the backend API and production server. |
| `HOST` | `0.0.0.0` | Host interface to bind. |
| `DATA_DIR` | `./data` | Directory where SQLite database (`chess.db`) is stored. |
| `STOCKFISH_THREADS` | `2` | Number of CPU threads allocated to Stockfish analysis. |
| `STOCKFISH_HASH` | `512` (Nix) / `128` | Stockfish transposition table size in MB. |
| `OLLAMA_BASE_URL` | (none) | URL to Ollama instance for AI Coach (e.g. `http://localhost:11434`). |
| `VLLM_BASE_URL` | (none) | URL to vLLM instance for AI Coach. |
| `COOKIE_SECURE` | `false` | Set to `true` when behind an HTTPS reverse proxy. |
| `PUBLIC_BASE_URL` | (request origin) | Public canonical URL (e.g. `https://chess.example.com`). |

Example: run production mode on a custom port:

```bash
PORT=9000 HOST=127.0.0.1 nix run .#prod
```

---

## Troubleshooting

### Flakes are not enabled

If you encounter:
```
error: experimental Nix feature 'nix-command' is disabled
```

You can enable flakes temporarily for a single invocation:

```bash
nix run --extra-experimental-features "nix-command flakes"
```

Or enable them permanently by adding the following line to `~/.config/nix/nix.conf` (user) or `/etc/nix/nix.conf` (system-wide):

```conf
experimental-features = nix-command flakes
```

### Unstaged Git Files

Nix Flakes only copies tracked files from your Git working tree into the Nix evaluation sandbox. If you create new files or modify files that are not staged, Nix might not see them.

If a script or build complains about missing files:

```bash
git add -A
```

Then retry your `nix run` or `nix develop` command.
