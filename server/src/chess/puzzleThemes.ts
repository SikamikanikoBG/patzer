// Puzzle themes as Lichess tags them in its puzzle database, grouped the way
// lichess.org/training/themes shows them. The keys are the exact tag strings in
// the CSV / Hugging Face `Themes` column, so they go straight into a query.
//
// 'mix' is not a tag: it means "no theme filter". Lichess's "player games"
// origin is left out — it needs the viewer's own Lichess games, which the
// public database doesn't have.

export const PUZZLE_THEME_GROUPS = [
  { key: 'recommended', themes: ['mix', 'opening', 'middlegame', 'endgame', 'mateIn1', 'mateIn2', 'fork', 'pin'] },
  { key: 'phases', themes: ['opening', 'middlegame', 'endgame', 'rookEndgame', 'bishopEndgame', 'pawnEndgame', 'knightEndgame', 'queenEndgame', 'queenRookEndgame'] },
  { key: 'motifs', themes: ['advancedPawn', 'attackingF2F7', 'capturingDefender', 'discoveredAttack', 'doubleCheck', 'exposedKing', 'fork', 'hangingPiece', 'kingsideAttack', 'pin', 'queensideAttack', 'sacrifice', 'skewer', 'trappedPiece'] },
  { key: 'advanced', themes: ['attraction', 'clearance', 'defensiveMove', 'deflection', 'interference', 'intermezzo', 'quietMove', 'xRayAttack', 'zugzwang'] },
  { key: 'mates', themes: ['mate', 'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5', 'anastasiaMate', 'arabianMate', 'backRankMate', 'bodenMate', 'doubleBishopMate', 'dovetailMate', 'hookMate', 'killBoxMate', 'vukovicMate', 'smotheredMate'] },
  { key: 'specialMoves', themes: ['castling', 'enPassant', 'promotion', 'underPromotion'] },
  { key: 'goals', themes: ['equality', 'advantage', 'crushing'] },
  { key: 'lengths', themes: ['oneMove', 'short', 'long', 'veryLong'] },
  { key: 'origin', themes: ['master', 'masterVsMaster', 'superGM'] },
] as const;

export type PuzzleTheme = typeof PUZZLE_THEME_GROUPS[number]['themes'][number];

const ALL = new Set<string>(PUZZLE_THEME_GROUPS.flatMap((g) => g.themes));

export function isPuzzleTheme(v: string): v is PuzzleTheme {
  return ALL.has(v);
}

/** Rating offsets from the player's puzzle rating, as Lichess's difficulty picker. */
export const PUZZLE_DIFFICULTIES = { easiest: -600, easier: -300, normal: 0, harder: 300, hardest: 600 } as const;
export type PuzzleDifficulty = keyof typeof PUZZLE_DIFFICULTIES;

export function isPuzzleDifficulty(v: string): v is PuzzleDifficulty {
  return Object.prototype.hasOwnProperty.call(PUZZLE_DIFFICULTIES, v);
}
