import { useEffect, useState } from 'react';
import { api } from '../api';

export interface AuthConfig {
  signup_enabled: boolean;
  signup_mode: 'open' | 'invite' | 'closed';
  email_enabled: boolean;
  // Single sign-on: show the SSO button; hide the password form (oidc_only);
  // the button label set by the operator (null = translated default).
  oidc_enabled: boolean;
  oidc_only: boolean;
  oidc_button_text: string | null;
}

// Public capability probe (GET /api/auth/config). Drives whether the login page
// shows "Sign up" / "Forgot password?" and whether signup asks for an email.
// Fails closed (both false) so a probe error never advertises a route the
// server would reject anyway.
export function useAuthConfig(): { config: AuthConfig; loaded: boolean } {
  const [config, setConfig] = useState<AuthConfig>({
    signup_enabled: false,
    signup_mode: 'closed',
    email_enabled: false,
    oidc_enabled: false,
    oidc_only: false,
    oidc_button_text: null,
  });
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
