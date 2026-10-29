{
  description = "Patzer — your private Chess.com. Self-hosted, AI-coached, family-friendly.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forEachSupportedSystem = f: nixpkgs.lib.genAttrs supportedSystems (system: f {
        pkgs = import nixpkgs { inherit system; };
      });
    in
    {
      apps = forEachSupportedSystem ({ pkgs }:
        let
          node = pkgs.nodejs_22;
          stockfish = pkgs.stockfish;

          runDevScript = pkgs.writeShellScriptBin "patzer-dev" ''
            set -euo pipefail
            export STOCKFISH_PATH="${stockfish}/bin/stockfish"
            export STOCKFISH_THREADS="''${STOCKFISH_THREADS:-2}"
            export STOCKFISH_HASH="''${STOCKFISH_HASH:-512}"
            export PATH="${node}/bin:${stockfish}/bin:$PATH"

            mkdir -p bin
            if [ ! -e bin/stockfish ]; then
              ln -sf "${stockfish}/bin/stockfish" bin/stockfish
            fi

            if [ ! -d "node_modules" ]; then
              echo "Installing dependencies via npm install..."
              npm install
            fi

            echo "Starting Patzer dev server (HMR on http://localhost:5173, backend on http://localhost:8800)..."
            exec npm run dev
          '';

          runProdScript = pkgs.writeShellScriptBin "patzer-prod" ''
            set -euo pipefail
            export STOCKFISH_PATH="${stockfish}/bin/stockfish"
            export STOCKFISH_THREADS="''${STOCKFISH_THREADS:-2}"
            export STOCKFISH_HASH="''${STOCKFISH_HASH:-512}"
            export PATH="${node}/bin:${stockfish}/bin:$PATH"

            mkdir -p bin
            if [ ! -e bin/stockfish ]; then
              ln -sf "${stockfish}/bin/stockfish" bin/stockfish
            fi

            if [ ! -d "node_modules" ]; then
              echo "Installing dependencies..."
              npm install
            fi

            if [ ! -d "server/dist" ] || [ ! -d "web/dist" ]; then
              echo "Building Patzer assets..."
              npm run build
            fi

            echo "Starting Patzer production server on http://localhost:8800..."
            exec npm start
          '';
        in
        {
          default = {
            type = "app";
            program = "${runDevScript}/bin/patzer-dev";
          };
          dev = {
            type = "app";
            program = "${runDevScript}/bin/patzer-dev";
          };
          prod = {
            type = "app";
            program = "${runProdScript}/bin/patzer-prod";
          };
        }
      );

      devShells = forEachSupportedSystem ({ pkgs }:
        let
          node = pkgs.nodejs_22;
          stockfish = pkgs.stockfish;
        in
        {
          default = pkgs.mkShell {
            name = "patzer-dev-shell";

            buildInputs = [
              node
              stockfish
              pkgs.python3
              pkgs.pkg-config
            ];

            shellHook = ''
              export STOCKFISH_PATH="${stockfish}/bin/stockfish"
              export STOCKFISH_THREADS="''${STOCKFISH_THREADS:-2}"
              export STOCKFISH_HASH="''${STOCKFISH_HASH:-512}"
              export PATH="$PWD/bin:$PWD/node_modules/.bin:$PATH"

              mkdir -p "$PWD/bin"
              if [ ! -e "$PWD/bin/stockfish" ]; then
                ln -sf "${stockfish}/bin/stockfish" "$PWD/bin/stockfish"
              fi

              echo ""
              echo "♟️  Patzer Nix Development Environment"
              echo "-------------------------------------"
              echo "Node.js:   $(node -v)"
              echo "Stockfish: ${stockfish}/bin/stockfish"
              echo ""
              echo "Useful commands:"
              echo "  npm install    - Install project dependencies"
              echo "  npm run dev    - Start dev servers (Vite: http://localhost:5173, API: http://localhost:8800)"
              echo "  npm test       - Run test suite"
              echo "  npm run build  - Build production bundles"
              echo "  npm start      - Run production server"
              echo ""
            '';
          };
        }
      );
    };
}
