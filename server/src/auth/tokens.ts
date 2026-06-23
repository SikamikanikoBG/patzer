import { randomBytes, createHash } from 'node:crypto';
import { db } from '../db.js';

// Single-use email tokens (verification + password reset). The raw token goes
// in the emailed URL; only its sha256 is stored, so a leaked DB yields no live
// links. Tokens are consumed atomically (UPDATE ... WHERE used_at IS NULL) to
// defeat double-submit / link-prefetch races.

export type TokenKind = 'verify' | 'reset';

const TTL_MS: Record<TokenKind, number> = {
  verify: 24 * 60 * 60_000, // 24h
  reset: 60 * 60_000, // 1h — short window limits a stolen reset link
};

function hash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function issueToken(userId: number, kind: TokenKind): string {
  const raw = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TTL_MS[kind]).toISOString();
  // Invalidate any outstanding token of the same kind for this user — a fresh
  // "forgot password" should supersede a prior one rather than leave two live.
  db.prepare(`DELETE FROM auth_tokens WHERE user_id = ? AND kind = ? AND used_at IS NULL`).run(userId, kind);
  db.prepare(`INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES (?, ?, ?, ?)`)
    .run(userId, kind, hash(raw), expires);
  return raw;
}

// Atomically spend a token. Returns the user_id on success, or null if the
// token is unknown, wrong-kind, already used, or expired.
export function consumeToken(raw: string, kind: TokenKind): number | null {
  const tokenHash = hash(raw);
  const tx = db.transaction(() => {
    const row = db.prepare(
      `SELECT id, user_id FROM auth_tokens
       WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > datetime('now')`,
    ).get(tokenHash, kind) as { id: number; user_id: number } | undefined;
    if (!row) return null;
    const upd = db.prepare(`UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`).run(row.id);
    if (upd.changes !== 1) return null; // lost the race to a concurrent consume
    return row.user_id;
  });
  return tx();
}
