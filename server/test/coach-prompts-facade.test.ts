import { describe, expect, it } from "vitest";
import { boardPiecesNatural as facadeBoardPiecesNatural } from "../src/coach/prompts.js";
import { boardPiecesNatural as directBoardPiecesNatural } from "../src/coach/facts-utils.js";

const POSITIONS = [
  {
    name: "starting position",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  },
  {
    name: "middlegame",
    fen: "r1bq1rk1/ppp2ppp/2np1n2/8/2B1P3/2N2N2/PPP2PPP/R1BQ1RK1 w - - 0 1",
  },
  {
    name: "endgame",
    fen: "8/5pk1/3p2p1/2pP3p/2P2P2/1P4P1/5PK1/8 w - - 0 1",
  },
];

describe("coach prompt facade exports", () => {
  it("re-exports boardPiecesNatural from the implementation module", () => {
    for (const language of ["en", "bg", "es"] as const) {
      for (const audience of ["kid", "beginner", "intermediate", "advanced"] as const) {
        for (const position of POSITIONS) {
          for (const playerColor of ["white", "black"] as const) {
            expect(
              facadeBoardPiecesNatural(
                position.fen,
                playerColor,
                language,
                audience,
              ),
            ).toEqual(
              directBoardPiecesNatural(
                position.fen,
                playerColor,
                language,
                audience,
              ),
            );
          }
        }
      }
    }
  });
});
