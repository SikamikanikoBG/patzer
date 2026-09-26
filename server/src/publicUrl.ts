import type { Context } from 'hono';
import { getSetting } from './db.js';

// Public base URL used to build absolute links (emails, invite links). Prefer
// an explicit operator setting (handles reverse-proxy / public-hostname deploys
// where the request's Host header is the internal one), then env, then the
// incoming request. Trailing slash trimmed.
export function publicBaseUrl(c: Context): string {
  const fromSetting = getSetting('public_base_url');
  if (fromSetting) return fromSetting.replace(/\/+$/, '');
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const proto = c.req.header('x-forwarded-proto') || 'http';
  const host = c.req.header('x-forwarded-host') || c.req.header('host');
  if (host) return `${proto}://${host}`;
  return new URL(c.req.url).origin;
}
