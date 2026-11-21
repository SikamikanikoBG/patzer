{ pkgs ? import <nixpkgs> {} }:

let
  node = pkgs.nodejs_22;
  stockfish = pkgs.stockfish;
in
pkgs.mkShell {
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
    echo "♟️  Patzer Nix Development Environment (via shell.nix)"
    echo "-----------------------------------------------------"
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
}
