// Maps the server's machine error codes (and zod validation `details`) into a
// human, localized message. Without this the UI showed bare codes like
// "invalid_input" — which is exactly what made the user-creation failure
// undiagnosable.

type TFn = (key: string, opts?: Record<string, unknown>) => string;

interface ApiError extends Error {
  status?: number;
  data?: {
    error?: string;
    details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
  };
}

const CODE_KEYS: Record<string, string> = {
  invalid_input: 'auth.errInvalidInput',
  invalid_credentials: 'login.invalid',
  username_taken: 'auth.errUsernameTaken',
  email_taken: 'auth.errEmailTaken',
  signup_disabled: 'auth.errSignupDisabled',
  rate_limited: 'auth.errRateLimited',
  email_unverified: 'auth.errEmailUnverified',
  invalid_or_expired: 'auth.errInvalidOrExpired',
  setup_required: 'auth.errSetupRequired',
  smtp_not_configured: 'auth.errSmtpNotConfigured',
  csrf_required: 'auth.errGeneric',
  last_admin: 'auth.errLastAdmin',
  cannot_delete_self: 'auth.errCannotDeleteSelf',
};

export function humanizeError(e: unknown, t: TFn): string {
  const err = e as ApiError;
  const code = err?.data?.error ?? err?.message ?? '';
  const key = CODE_KEYS[code];
  let msg = key ? t(key) : code || t('auth.errGeneric');

  // Surface the first zod field error so a validation bounce names the field
  // (e.g. "password: too small") instead of just "Check your input".
  const fieldErrors = err?.data?.details?.fieldErrors;
  if (code === 'invalid_input' && fieldErrors) {
    const first = Object.entries(fieldErrors).find(([, v]) => v && v.length);
    if (first) msg = `${msg} (${first[0]}: ${first[1]![0]})`;
  }
  return msg;
}
