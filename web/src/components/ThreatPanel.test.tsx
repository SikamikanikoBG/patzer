// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({
  api: {
    post: vi.fn(),
  },
}));

import { api } from '../api';
import ThreatPanel from './ThreatPanel';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const IN_CHECK_FEN = 'rnbqkbnr/pppp1kpp/8/4p3/4P3/5Q2/PPPP1PPP/RNB1KBNR b KQ - 0 3';

function resolved(lines: unknown[]) {
  return Promise.resolve({ lines });
}

describe('ThreatPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the threatened move and plain-language explanation', async () => {
    vi.mocked(api.post).mockReturnValueOnce(
      resolved([{
        uci: 'd8h4',
        san: 'Qxh4',
        pv_san: ['Qxh4', 'Qxh4'],
        cp: 300,
        mate: null,
        multipv: 1,
      }]).then((r) => r as never),
    );

    render(<ThreatPanel fen={START_FEN} currentCpWhite={-100} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show threat' }));

    await vi.runAllTimersAsync();

    expect(api.post).toHaveBeenCalledWith('/api/analyze/position', expect.objectContaining({
      depth: 14,
      lines: 1,
    }));
    expect(screen.getByText('Qxh4')).toBeInTheDocument();
  });

  it('renders the in-check message and never calls the API', async () => {
    render(<ThreatPanel fen={IN_CHECK_FEN} currentCpWhite={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show threat' }));

    await waitFor(() => {
      expect(screen.getByText('In check — the threat is the check itself.')).toBeInTheDocument();
    });

    expect(api.post).not.toHaveBeenCalled();
  });

  it('retries a 429 response before showing an error', async () => {
    vi.mocked(api.post)
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 429 }))
      .mockReturnValueOnce(
        resolved([{
          uci: 'd8h4',
          san: 'Qxh4',
          pv_san: ['Qxh4'],
          cp: 300,
          mate: null,
          multipv: 1,
        }]).then((r) => r as never),
      );

    render(<ThreatPanel fen={START_FEN} currentCpWhite={-100} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show threat' }));

    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    await vi.runAllTimersAsync();

    await waitFor(() => expect(screen.getByText('Qxh4')).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});
