import { describe, expect, it } from "vitest";
import {
  boardPiecesNatural,
  correctionNote,
  evaluationStateNatural,
  explainMovePrompt,
  hintPrompt,
  materialBalanceNatural,
  sanToNatural,
  systemPrompt,
  verdictPhrase,
} from "../src/coach/prompts.js";
import { LANGUAGES } from "../src/types.js";

// French piece names carry a gendered article ("le cavalier prend la tour",
// "vous avez une dame de plus"), so these pin the grammar rather than just
// "some French came out". Two house rules are pinned as well: the coach
// always says "vous", never "tu", and kid mode keeps the real piece names
// ("cavalier", "dame"), never "cheval" or "reine".

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const CASTLES = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
const PROMOTES = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1";

describe("French coach phrasing", () => {
  it("gives the moving piece its article", () => {
    expect(sanToNatural("Nf3", START, "fr", "beginner")).toBe("le cavalier de g1 en f3");
    expect(sanToNatural("e4", START, "fr", "beginner")).toBe("le pion en e4");
    expect(sanToNatural("Nf3", START, "fr", "kid")).toBe("le cavalier de g1 en f3");
  });

  it("matches the article to the gender of the captured piece", () => {
    const pawn = "rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2";
    expect(sanToNatural("Nxe5", pawn, "fr", "beginner")).toBe("le cavalier prend le pion en e5");
    expect(sanToNatural("Rxa8+", "r3k3/8/8/8/8/8/8/R3K3 w - - 0 1", "fr", "beginner"))
      .toBe("la tour prend la tour en a8 (échec)");
  });

  it("renders castling, promotion, check and mate", () => {
    expect(sanToNatural("O-O", CASTLES, "fr", "beginner")).toBe("petit roque");
    expect(sanToNatural("O-O-O", CASTLES, "fr", "beginner")).toBe("grand roque");
    expect(sanToNatural("a8=Q+", PROMOTES, "fr", "beginner")).toBe("le pion en a8, promotion en dame (échec)");
    expect(sanToNatural("a8=Q+", PROMOTES, "fr", "kid")).toBe("le pion en a8, promotion en dame (échec)");
    expect(sanToNatural("Qxf7#", "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", "fr", "beginner"))
      .toBe("la dame prend le pion en f7 (échec et mat)");
  });

  it("uses the indefinite article for material balance", () => {
    expect(materialBalanceNatural(0.3, "fr", "beginner")).toBe("le matériel est égal");
    expect(materialBalanceNatural(1, "fr", "beginner")).toBe("vous avez un pion de plus");
    expect(materialBalanceNatural(2, "fr", "beginner")).toBe("vous avez 2 pions de plus");
    expect(materialBalanceNatural(-3, "fr", "beginner")).toBe("vous avez un cavalier de moins");
    expect(materialBalanceNatural(-5, "fr", "beginner")).toBe("vous avez une tour de moins");
    expect(materialBalanceNatural(9, "fr", "kid")).toBe("vous avez une dame de plus");
  });

  it("lists the pieces and counts pawns", () => {
    const eight = boardPiecesNatural(START, "white", "fr", "beginner");
    expect(eight.player).toContain("8 pions");
    expect(eight.player).toContain("roi en e1");
    const one = boardPiecesNatural("4k3/8/8/8/8/8/P7/4K3 w - - 0 1", "white", "fr", "beginner");
    expect(one.player).toContain("1 pion");
  });

  it("has a French persona, rules, verdicts and evaluation words", () => {
    expect(systemPrompt("beginner", "fr")).toContain("Langue de sortie : français");
    expect(systemPrompt("beginner", "fr")).toContain("CONCEPTS AUTORISÉS");
    expect(verdictPhrase("blunder", "fr")).toMatch(/^une gaffe/);
    expect(evaluationStateNatural(95, "fr")).toBe("position gagnante");
    expect(evaluationStateNatural(50, "fr")).toBe("à peu près égal");
    expect(correctionNote("fr", "une gaffe")).toContain("ne félicitez pas");
  });

  it("asks for French in the explain and hint tasks", () => {
    const input = {
      fen: START, player: "White" as const, played_san: "e4", best_san: "e4",
      classification: "best" as const, cp_loss: 0, user_perspective: true,
    };
    expect(explainMovePrompt(input, "fr", "beginner")).toContain("en français");
    expect(explainMovePrompt({ ...input, user_perspective: false }, "fr", "beginner")).toContain('"les Blancs"');
    expect(hintPrompt(START, "beginner", "fr")).toContain("en français");
  });

  it("always says vous, never tu, for every audience", () => {
    // Case-sensitive: the audience block has a "TON :" (tone) label.
    const tu = /(?<!\p{L})([Tt]u|[Tt]oi|te|[Tt]on|[Tt]a|[Tt]es|[Tt]utoie\p{L}*)(?!\p{L})/u;
    const input = {
      fen: "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3", player: "Black" as const,
      played_san: "Nf6", best_san: "g6", classification: "blunder" as const, cp_loss: 900,
      history: ["e4", "e5", "Qh5", "Nc6", "Bc4"], user_perspective: true,
    };
    for (const audience of ["kid", "beginner", "intermediate", "advanced"] as const) {
      const texts = [
        systemPrompt(audience, "fr"),
        explainMovePrompt(input, "fr", audience, { tone: "correct" }),
        hintPrompt(START, audience, "fr"),
        correctionNote("fr", "une gaffe"),
        materialBalanceNatural(3, "fr", audience),
      ];
      for (const text of texts) expect(text, audience).not.toMatch(tu);
      expect(systemPrompt(audience, "fr"), audience).toContain("Vous vouvoyez toujours le joueur");
    }
    expect(explainMovePrompt(input, "fr", "kid")).toContain('"perspective": "vous"');
  });

  it("keeps the real piece names in kid mode", () => {
    const kid = boardPiecesNatural(START, "white", "fr", "kid").player.join(", ");
    expect(kid).toContain("cavalier en g1");
    expect(kid).toContain("dame en d1");
    for (const text of [kid, sanToNatural("Qh5", "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "fr", "kid")]) {
      expect(text).not.toMatch(/cheval|reine/);
    }
  });
});

// The typed tables fail the build when a language is missing, but the task
// prompts and the evaluation/material words are picked by `if`/`switch` and
// fall back to English silently. This is what catches a language that was
// added to LANGUAGES and nowhere else.
describe("every coach language has its own text", () => {
  const input = {
    fen: START, player: "White" as const, played_san: "e4", best_san: "e4",
    classification: "best" as const, cp_loss: 0, user_perspective: true,
  };
  const task = (prompt: string) => prompt.slice(prompt.indexOf("TASK:"));
  const pawnTakes = "rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2";

  it.each(LANGUAGES.filter((l) => l !== "en"))("%s", (lang) => {
    expect(systemPrompt("beginner", lang)).not.toBe(systemPrompt("beginner", "en"));
    expect(verdictPhrase("blunder", lang)).not.toBe(verdictPhrase("blunder", "en"));
    expect(sanToNatural("Nxe5", pawnTakes, lang, "beginner")).not.toBe(sanToNatural("Nxe5", pawnTakes, "en", "beginner"));
    expect(sanToNatural("O-O", CASTLES, lang, "beginner")).not.toBe(sanToNatural("O-O", CASTLES, "en", "beginner"));
    expect(evaluationStateNatural(95, lang)).not.toBe(evaluationStateNatural(95, "en"));
    expect(materialBalanceNatural(0, lang, "beginner")).not.toBe(materialBalanceNatural(0, "en", "beginner"));
    expect(materialBalanceNatural(2, lang, "beginner")).not.toBe(materialBalanceNatural(2, "en", "beginner"));
    expect(boardPiecesNatural(START, "white", lang, "beginner").player).not.toEqual(boardPiecesNatural(START, "white", "en", "beginner").player);
    expect(correctionNote(lang, "x")).not.toBe(correctionNote("en", "x"));
    expect(task(explainMovePrompt(input, lang, "beginner"))).not.toBe(task(explainMovePrompt(input, "en", "beginner")));
    expect(task(hintPrompt(START, "beginner", lang))).not.toBe(task(hintPrompt(START, "beginner", "en")));
  });
});
