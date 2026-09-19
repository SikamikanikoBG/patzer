// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';

vi.mock('../api', () => ({
  api: {
    post: vi.fn(),
  },
}));

import { api } from '../api';
import ThreatPanel from './ThreatPanel';

const IN_CHECK_FEN = 'rnbqkbnr/pppp1kpp/8/4p3/4P3/5Q2/PPPP1PPP/RNB1KBNR b KQ - 0 3';
const THREAT_FEN = '4k3/8/8/8/8/5q2/6P1/4K3 w - - 0 1';

function resolved(lines: unknown[]) {
  return Promise.resolve({ lines });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ThreatPanel', () => {
  it('renders the threatened move and plain-language explanation', async () => {
    vi.mocked(api.post).mockReturnValueOnce(
      resolved([{
        uci: 'f3g2',
        san: 'Qxg2',
        pv_san: ['Qxg2'],
        cp: 300,
        mate: null,
        multipv: 1,
      }]).then((r) => r as never),
    );

    render(<ThreatPanel fen={THREAT_FEN} currentCpWhite={-100} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show threat' }));

    expect(await screen.findByText('Qxg2')).toBeTruthy();
    expect(screen.getByText('takes the pawn on g2, winning a piece')).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/api/analyze/position', expect.objectContaining({
      depth: 14,
      lines: 1,
    }));
  });

  it('renders the in-check message and never calls the API', async () => {
    render(<ThreatPanel fen={IN_CHECK_FEN} currentCpWhite={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show threat' }));

    expect(await screen.findByText('In check — the threat is the check itself.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('retries a 429 response before showing the result', async () => {
    vi.mocked(api.post)
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 429 }))
      .mockReturnValueOnce(
        resolved([{
          uci: 'f3g2',
          san: 'Qxg2',
          pv_san: ['Qxg2'],
          cp: 300,
          mate: null,
          multipv: 1,
        }]).then((r) => r as never),
      );

    render(<ThreatPanel fen={THREAT_FEN} currentCpWhite={-100} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show threat' }));

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(api.post).toHaveBeenCalledTimes(1);

    expect(await screen.findByText('Qxg2')).toBeTruthy();
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});
