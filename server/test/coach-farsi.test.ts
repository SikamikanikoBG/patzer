import { describe, expect, it } from "vitest";
import {
  boardPiecesNatural,
  materialBalanceNatural,
  sanToNatural,
  systemPrompt,
  verdictPhrase,
} from "../src/coach/prompts.js";
import { contradiction, fallbackText } from "../src/coach/coaching.js";

// Farsi is verb-final ("اسب سرباز را در e5 می‌گیرد" — the knight the pawn on
// e5 takes), nouns don't decline, and a count takes the singular ("۸ سرباز"
// is "8 pawn"). These pin that word order, not just "some Farsi came out".

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("Farsi coach phrasing", () => {
  it("describes plain moves", () => {
    expect(sanToNatural("Nf3", START, "fa", "beginner")).toBe("اسب از g1 به f3");
    expect(sanToNatural("e4", START, "fa", "beginner")).toBe("سرباز به e4");
    expect(sanToNatural("Nf3", START, "fa", "kid")).toBe("اسب کوچولو از g1 به f3");
  });

  it("puts the verb last in a capture, with the object marker", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2";
    expect(sanToNatural("Nxe5", fen, "fa", "beginner")).toBe("اسب سرباز را در e5 می‌گیرد");
    expect(sanToNatural("Bxc3", "rnbqk1nr/pppp1ppp/8/4p3/1b6/2N5/PPPPPPPP/R1BQKBNR b KQkq - 3 3", "fa", "kid"))
      .toBe("فیل اسب کوچولو را در c3 می‌گیرد");
  });

  it("renders castling, promotion and check", () => {
    const castle = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(sanToNatural("O-O", castle, "fa", "beginner")).toBe("قلعه‌روی کوتاه");
    expect(sanToNatural("O-O-O", castle, "fa", "beginner")).toBe("قلعه‌روی بلند");
    expect(sanToNatural("a8=Q+", "4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "fa", "beginner"))
      .toBe("سرباز به a8، ارتقا به وزیر (کیش)");
    expect(sanToNatural("a8=Q+", "4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "fa", "kid"))
      .toBe("سرباز به a8، ارتقا به ملکه (کیش)");
  });

  it("describes material balance", () => {
    expect(materialBalanceNatural(0.3, "fa", "beginner")).toBe("تعداد مهره‌ها برابر است");
    expect(materialBalanceNatural(1, "fa", "beginner")).toBe("یک سرباز بیشتر داری");
    expect(materialBalanceNatural(2, "fa", "beginner")).toBe("2 سرباز بیشتر داری");
    expect(materialBalanceNatural(-3, "fa", "beginner")).toBe("یک اسب کمتر داری");
    expect(materialBalanceNatural(-5, "fa", "beginner")).toBe("یک رخ کمتر داری");
    expect(materialBalanceNatural(9, "fa", "kid")).toBe("یک ملکه بیشتر داری");
  });

  it("counts pawns in the singular and places pieces with «در»", () => {
    const eight = boardPiecesNatural(START, "white", "fa", "beginner");
    expect(eight.player).toContain("8 سرباز");
    expect(eight.player).toContain("شاه در e1");
    const one = boardPiecesNatural("4k3/8/8/8/8/8/P7/4K3 w - - 0 1", "white", "fa", "beginner");
    expect(one.player).toContain("1 سرباز");
  });

  it("has a Farsi persona, rules and verdicts", () => {
    expect(systemPrompt("beginner", "fa")).toContain("زبان پاسخ: فارسی");
    expect(systemPrompt("kid", "fa")).toContain("اسب کوچولو");
    expect(verdictPhrase("blunder", "fa")).toMatch(/^یک اشتباه فاحش/);
  });

  it("catches praise for a mistake and blame for a good move, however the words are joined", () => {
    expect(contradiction("این یک اشتباه فاحش بود: اسب بی‌دفاع ماند.", "blunder", "fa")).toBeNull();
    expect(contradiction("حرکت خوبی بود! اسب را گسترش دادی.", "blunder", "fa")).toBe("praise_for_mistake");
    expect(contradiction("فوق‌العاده بود.", "mistake", "fa")).toBe("praise_for_mistake");
    expect(contradiction("فوق العاده بود.", "mistake", "fa")).toBe("praise_for_mistake");
    // The better move may be praised after the verdict.
    expect(contradiction("این یک اشتباه بود. حرکت بهتر عالی بود.", "mistake", "fa")).toBeNull();
    expect(contradiction("این یک بی دقتی بود.", "best", "fa")).toBe("blame_for_good_move");
    expect(contradiction("بهترین انتخاب موتور؛ شاه در امان است.", "best", "fa")).toBeNull();
  });

  it("builds a Farsi fallback answer", () => {
    const text = fallbackText({ verdict: verdictPhrase("mistake", "fa"), why: [], better_move: "اسب به f3" }, "fa");
    expect(text).toContain("بهتر: اسب به f3.");
  });
});
