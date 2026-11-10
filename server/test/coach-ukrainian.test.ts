import { describe, expect, it } from "vitest";
import {
  boardPiecesNatural,
  materialBalanceNatural,
  sanToNatural,
  systemPrompt,
  verdictPhrase,
} from "../src/coach/prompts.js";

// Ukrainian piece names decline: the mover stays in the nominative ("кінь б’є")
// while the captured piece, a promotion target and a material edge take the
// accusative ("б’є пішака", "на ферзя", "на туру більше"), and pawn counts
// pick one of three plural forms.

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("Ukrainian coach phrasing", () => {
  it("keeps the moving piece in the nominative", () => {
    expect(sanToNatural("Nf3", START, "uk", "beginner")).toBe("кінь з g1 на f3");
    expect(sanToNatural("e4", START, "uk", "beginner")).toBe("пішак на e4");
    expect(sanToNatural("Nf3", START, "uk", "kid")).toBe("коник з g1 на f3");
  });

  it("puts the captured piece in the accusative", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2";
    expect(sanToNatural("Nxe5", fen, "uk", "beginner")).toBe("кінь б’є пішака на e5");
    expect(sanToNatural("Nxe5", fen, "uk", "kid")).toBe("коник б’є пішака на e5");
    const bishopTakes = "rnbqkbnr/pppp1ppp/8/4p3/8/2N5/PPPPPPPP/R1BQKBNR b KQkq - 1 2";
    expect(sanToNatural("Bb4", bishopTakes, "uk", "kid")).toBe("слоник з f8 на b4");
    expect(sanToNatural("Bxc3", "rnbqk1nr/pppp1ppp/8/4p3/1b6/2N5/PPPPPPPP/R1BQKBNR b KQkq - 3 3", "uk", "kid")).toBe("слоник б’є коника на c3");
  });

  it("renders castling, promotion and check", () => {
    expect(sanToNatural("O-O", "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "uk", "beginner")).toBe("коротка рокіровка");
    expect(sanToNatural("O-O-O", "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "uk", "beginner")).toBe("довга рокіровка");
    expect(sanToNatural("a8=Q+", "4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "uk", "beginner"))
      .toBe("пішак на a8, перетворення на ферзя (шах)");
    expect(sanToNatural("a8=Q+", "4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "uk", "kid"))
      .toBe("пішак на a8, перетворення на королеву (шах)");
  });

  it("uses the accusative for material balance", () => {
    expect(materialBalanceNatural(0.3, "uk", "beginner")).toBe("матеріал рівний");
    expect(materialBalanceNatural(1, "uk", "beginner")).toBe("у тебе на пішака більше");
    expect(materialBalanceNatural(2, "uk", "beginner")).toBe("у тебе на 2 пішаки більше");
    expect(materialBalanceNatural(-3, "uk", "beginner")).toBe("у тебе на коня менше");
    expect(materialBalanceNatural(-5, "uk", "beginner")).toBe("у тебе на туру менше");
    expect(materialBalanceNatural(9, "uk", "kid")).toBe("у тебе на королеву більше");
  });

  it("counts pawns with the right plural form", () => {
    const eight = boardPiecesNatural(START, "white", "uk", "beginner");
    expect(eight.player).toContain("8 пішаків");
    expect(eight.player).toContain("король на e1");
    const three = boardPiecesNatural("4k3/8/8/8/8/8/PPP5/4K3 w - - 0 1", "white", "uk", "beginner");
    expect(three.player).toContain("3 пішаки");
    const one = boardPiecesNatural("4k3/8/8/8/8/8/P7/4K3 w - - 0 1", "white", "uk", "beginner");
    expect(one.player).toContain("1 пішак");
  });

  it("has a Ukrainian persona, rules and verdicts", () => {
    expect(systemPrompt("beginner", "uk")).toContain("Мова відповіді: українська");
    expect(systemPrompt("kid", "uk")).toContain("коник");
    expect(systemPrompt("kid", "uk")).toContain("слоник");
    expect(verdictPhrase("blunder", "uk")).toMatch(/^грубий прорахунок/);
  });
});
