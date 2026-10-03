// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import CapturedPieces from './CapturedPieces';

afterEach(cleanup);

// White took a knight and lost two pawns.
const KNIGHT_FOR_PAWN = 'r1bqkbnr/pppp1ppp/8/4p3/8/8/PPP2PPP/RNBQKBNR w KQkq - 0 4';

describe('CapturedPieces', () => {
  it('shows the material lead, like chess.com, not the total captured', () => {
    const { container } = render(<CapturedPieces fen={KNIGHT_FOR_PAWN} side="white" />);
    // White captured a knight (3) and lost two pawns: +1, not +3.
    expect(container.textContent).toContain('+1');
    expect(container.textContent).not.toContain('+3');
  });

  it('shows no number next to the side that is behind', () => {
    const { container } = render(<CapturedPieces fen={KNIGHT_FOR_PAWN} side="black" />);
    expect(container.textContent).not.toMatch(/\+\d/);
  });

  it('shows nothing when material is level', () => {
    const { container } = render(<CapturedPieces fen="rnbqkbnr/pppp1ppp/8/8/8/8/PPP1PPPP/RNBQKBNR w KQkq - 0 3" side="white" />);
    expect(container.textContent).not.toMatch(/\+\d/);
  });
});
