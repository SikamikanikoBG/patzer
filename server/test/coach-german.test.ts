import { describe, expect, it } from "vitest";
import {
  materialBalanceNatural,
  sanToNatural,
  systemPrompt,
  verdictPhrase,
} from "../src/coach/prompts.js";

// German is the first coach language whose piece names need an article and a
// grammatical case ("der Springer zieht", but "schlägt den Bauern"), so these
// pin the declension rather than just "some German came out".

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("German coach phrasing", () => {
  it("puts the moving piece in the nominative with its article", () => {
    expect(sanToNatural("Nf3", START, "de", "beginner")).toBe("der Springer von g1 nach f3");
    expect(sanToNatural("e4", START, "de", "beginner")).toBe("der Bauer nach e4");
    expect(sanToNatural("Nf3", START, "de", "kid")).toBe("das Pferdchen von g1 nach f3");
  });

  it("puts the captured piece in the accusative", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2";
    expect(sanToNatural("Nxe5", fen, "de", "beginner")).toBe("der Springer schlägt den Bauern auf e5");
  });

  it("renders castling, promotion and check", () => {
    expect(sanToNatural("O-O", "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "de", "beginner")).toBe("kurze Rochade");
    expect(sanToNatural("a8=Q+", "4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "de", "beginner"))
      .toBe("der Bauer nach a8, Umwandlung in eine Dame (Schach)");
  });

  it("uses the indefinite accusative for material balance", () => {
    expect(materialBalanceNatural(0.3, "de", "beginner")).toBe("das Material ist ausgeglichen");
    expect(materialBalanceNatural(1, "de", "beginner")).toBe("du hast einen Bauern mehr");
    expect(materialBalanceNatural(2, "de", "beginner")).toBe("du hast 2 Bauern mehr");
    expect(materialBalanceNatural(-3, "de", "beginner")).toBe("du hast einen Springer weniger");
    expect(materialBalanceNatural(9, "de", "kid")).toBe("du hast eine Königin mehr");
  });

  it("has a German persona, rules and verdicts", () => {
    expect(systemPrompt("beginner", "de")).toContain("Ausgabesprache: Deutsch");
    expect(verdictPhrase("blunder", "de")).toMatch(/^ein Patzer/);
  });
});
