// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// chessground needs a real layout engine; we only care about what ChessBoard
// asks it to do, so the api is a spy.
const api = {
  set: vi.fn(),
  setShapes: vi.fn(),
  redrawAll: vi.fn(),
  destroy: vi.fn(),
};
vi.mock('chessground', () => ({ Chessground: vi.fn(() => api) }));

import ChessBoard from './ChessBoard';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

// happy-dom has no layout, so every element reports a zero rect. Drive it by hand.
let rect = { x: 0, y: 0, width: 320, height: 320 };
const observers: Array<() => void> = [];
beforeEach(() => {
  vi.clearAllMocks();
  rect = { x: 0, y: 0, width: 320, height: 320 };
  Element.prototype.getBoundingClientRect = function () {
    return { ...rect, top: rect.y, left: rect.x, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON() { /* noop */ } } as DOMRect;
  };
  observers.length = 0;
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) { observers.push(cb); }
    observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ }
  } as unknown as typeof ResizeObserver;
});

describe('ChessBoard keeps chessground\'s cached bounds fresh', () => {
  it('calls redrawAll when the board moves on screen without resizing', () => {
    // Black's board mounts while the "opponent is offline" banner is up…
    const { rerender } = render(<ChessBoard fen={START} orientation="black" turnColor="white" movable={false} />);
    expect(api.redrawAll).not.toHaveBeenCalled();

    // …the opponent connects, the banner disappears and the board slides up.
    // Without a re-measure chessground maps every click one row off and the
    // player cannot move a piece for the rest of the game.
    rect = { ...rect, y: rect.y - 42 };
    rerender(<ChessBoard fen={AFTER_E4} orientation="black" turnColor="black" movable />);
    expect(api.redrawAll).toHaveBeenCalled();
  });

  it('calls redrawAll when the board is resized without a re-render', () => {
    // A collapsing sidebar or a rotating phone resizes the board with no prop
    // change at all, so the ResizeObserver is the only thing that can notice.
    render(<ChessBoard fen={START} orientation="white" turnColor="white" movable />);
    api.redrawAll.mockClear();
    rect = { ...rect, width: 240, height: 240 };
    expect(observers.length).toBeGreaterThan(0);
    observers.forEach((cb) => cb());
    expect(api.redrawAll).toHaveBeenCalled();
  });

  it('does not redraw when nothing moved', () => {
    const { rerender } = render(<ChessBoard fen={START} orientation="white" turnColor="white" movable />);
    api.redrawAll.mockClear();
    // A clock tick re-renders Play ~10x a second; that must stay cheap.
    for (let i = 0; i < 5; i++) rerender(<ChessBoard fen={START} orientation="white" turnColor="white" movable />);
    expect(api.redrawAll).not.toHaveBeenCalled();
  });
});
