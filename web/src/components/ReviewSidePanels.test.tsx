// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../api', () => ({ api: { get, post } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string; [key: string]: unknown }) => {
      let value = options?.defaultValue ?? _key;
      for (const [key, replacement] of Object.entries(options ?? {})) {
        if (key !== 'defaultValue') value = value.replace(`{{${key}}}`, String(replacement));
      }
      return value;
    },
  }),
}));

import ExplorerPanel from './ExplorerPanel';
import ThreatPanel from './ThreatPanel';

const THREAT_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p1NQ/2B1P3/8/PPPP1PPP/RNB1K2R b KQkq - 4 4';
const CHECK_FEN = 'rnbqkbnr/ppppp1pp/8/4pP1Q/4P3/8/PPPP2PP/RNB1KBNR b KQkq - 1 2';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ThreatPanel', () => {
  it('shows the threat description after requesting analysis', async () => {
    post.mockResolvedValue({
      lines: [{ uci: 'g5f7', san: 'Nxf7', pv_san: ['Nxf7', 'Kxf7'], cp: 300, mate: null, multipv: 1 }],
    });
    render(<ThreatPanel fen={THREAT_FEN} currentCpWhite={0} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show threat' }));

    expect(await screen.findByText('If black passed')).toBeTruthy();
    expect(await screen.findByText('Nxf7')).toBeTruthy();
    expect(screen.getByText('takes the pawn on f7, winning a piece')).toBeTruthy();
  });

  it('reports check without requesting an impossible null-move analysis', async () => {
    render(<ThreatPanel fen={CHECK_FEN} currentCpWhite={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show threat' }));

    expect(await screen.findByText('In check — the threat is the check itself.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('retries a busy analysis endpoint', async () => {
    vi.useFakeTimers();
    post.mockRejectedValueOnce({ status: 429 }).mockResolvedValueOnce({
      lines: [{ uci: 'g5f7', san: 'Nxf7', pv_san: ['Nxf7'], cp: 300, mate: null, multipv: 1 }],
    });
    render(<ThreatPanel fen={THREAT_FEN} currentCpWhite={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show threat' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(900);
    });
    vi.useRealTimers();
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe('ExplorerPanel', () => {
  it('collapses to the unavailable message when the explorer is down', async () => {
    get.mockResolvedValue({ available: false });
    render(<ExplorerPanel fen="startpos" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show master stats' }));

    expect(await screen.findByText('Lichess master database unreachable right now.')).toBeTruthy();
    expect(screen.queryByText(/master games/)).toBeNull();
  });

  it('renders the game totals and top continuations', async () => {
    get.mockResolvedValue({
      available: true,
      white: 60,
      draws: 25,
      black: 15,
      total: 100,
      moves: [{ uci: 'e2e4', san: 'e4', white: 40, draws: 10, black: 5, averageRating: 1800 }],
    });
    render(<ExplorerPanel fen="startpos" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show master stats' }));

    expect(await screen.findByText('100 master games')).toBeTruthy();
    expect(screen.getByText('e4')).toBeTruthy();
    expect(screen.getByText(/55% · 55/)).toBeTruthy();
  });
});
