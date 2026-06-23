import { useEffect, useState } from 'react';
import { api } from '../api';

export interface AuthConfig {
  signup_enabled: boolean;
  email_enabled: boolean;
}

// Public capability probe (GET /api/auth/config). Drives whether the login page
// shows "Sign up" / "Forgot password?" and whether signup asks for an email.
// Fails closed (both false) so a probe error never advertises a route the
// server would reject anyway.
export function useAuthConfig(): { config: AuthConfig; loaded: boolean } {
  const [config, setConfig] = useState<AuthConfig>({ signup_enabled: false, email_enabled: false });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get<AuthConfig>('/api/auth/config')
      .then((c) => { if (alive) setConfig(c); })
      .catch(() => { /* keep fail-closed defaults */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);
  return { config, loaded };
}
