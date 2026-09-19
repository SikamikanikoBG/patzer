// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from '../api';
import ExplorerPanel from './ExplorerPanel';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('ExplorerPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows only the muted unavailable message when explorer data is unavailable', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('upstream down'));

    render(<ExplorerPanel fen={FEN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show master stats' }));

    await vi.runAllTimersAsync();

    await waitFor(() => {
      expect(screen.getByText('Lichess master database unreachable right now.')).toBeInTheDocument();
    });

    expect(screen.queryByText(/master games/i)).not.toBeInTheDocument();
    expect(screen.queryByText('White 0%')).not.toBeInTheDocument();
  });

  it('renders game count, WDL bar, and top continuations', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      available: true,
      white: 600,
      draws: 300,
      black: 100,
      total: 1000,
      opening: { eco: 'B00', name: 'King Pawn Game' },
      moves: [
        { uci: 'e2e4', san: 'e4', white: 400, draws: 200, black: 100, averageRating: 2200 },
        { uci: 'd2d4', san: 'd4', white: 200, draws: 100, black: 0, averageRating: 2150 },
      ],
    });

    render(<ExplorerPanel fen={FEN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show master stats' }));

    await vi.runAllTimersAsync();

    await waitFor(() => {
      expect(screen.getByText('1000 master games')).toBeInTheDocument();
      expect(screen.getByText('B00 · King Pawn Game')).toBeInTheDocument();
      expect(screen.getByText('e4')).toBeInTheDocument();
      expect(screen.getByText('d4')).toBeInTheDocument();
    });

    expect(screen.getByText('White 60%')).toBeInTheDocument();
    expect(screen.getByText('Draw 30%')).toBeInTheDocument();
    expect(screen.getByText('Black 10%')).toBeInTheDocument();
    expect(screen.getByText(/400/)).toBeInTheDocument();
  });

  it('passes preview callbacks for continuation hover', async () => {
    const onPreview = vi.fn();
    vi.mocked(api.get).mockResolvedValueOnce({
      available: true,
      white: 1,
      draws: 0,
      black: 0,
      total: 1,
      moves: [{ uci: 'e2e4', san: 'e4', white: 1, draws: 0, black: 0, averageRating: null }],
    });

    render(<ExplorerPanel fen={FEN} onPreview={onPreview} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show master stats' }));
    await vi.runAllTimersAsync();

    const row = await screen.findByText('e4');
    fireEvent.mouseEnter(row.parentElement!);
    fireEvent.mouseLeave(row.parentElement!);

    expect(onPreview).toHaveBeenNthCalledWith(1, 'e2e4');
    expect(onPreview).toHaveBeenNthCalledWith(2, null);
  });
});
