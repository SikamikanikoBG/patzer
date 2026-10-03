import { api } from '../api';

// Ends the Patzer session. For a session that came from single sign-on the
// server also returns the identity provider's logout URL; going there ends
// the provider session too, and the provider sends the browser back to
// /login. Returns true when the browser is leaving for the provider, so the
// caller should not navigate itself.
export async function endSession(): Promise<boolean> {
  const res = await api.post<{ ok: boolean; logout_url?: string }>('/api/auth/logout');
  if (res.logout_url) {
    window.location.assign(res.logout_url);
    return true;
  }
  return false;
}
