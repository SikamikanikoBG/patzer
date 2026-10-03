// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api', () => ({ api: { post } }));

import { endSession } from './logout';

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('endSession', () => {
  it('a password session just ends: the caller navigates', async () => {
    post.mockResolvedValue({ ok: true });
    expect(await endSession()).toBe(false);
    expect(post).toHaveBeenCalledWith('/api/auth/logout');
    expect(assign).not.toHaveBeenCalled();
  });

  it('an SSO session goes on to the provider to end its session too', async () => {
    const url = 'https://auth.example.com/application/o/patzer/end-session/?id_token_hint=x';
    post.mockResolvedValue({ ok: true, logout_url: url });
    expect(await endSession()).toBe(true);
    expect(assign).toHaveBeenCalledWith(url);
  });
});
