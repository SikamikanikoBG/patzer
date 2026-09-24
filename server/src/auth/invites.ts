import { randomInt } from 'node:crypto';
import { db, getSetting, setSetting } from '../db.js';

// Invite-only signup (#26). An admin hands out a code (or a /signup?invite=…
// link); registration accepts it while it is neither revoked, expired nor used
// up, and records on the new account which invite it came from.

export type SignupMode = 'open' | 'invite' | 'closed';

export function signupMode(): SignupMode {
  const m = getSetting('signup_mode');
  if (m === 'open' || m === 'invite' || m === 'closed') return m;
  // Installs from before invites only have the on/off switch.
  return getSetting('allow_signup') === '0' ? 'closed' : 'open';
}

export function setSignupMode(mode: SignupMode): void {
  setSetting('signup_mode', mode);
  // Keep the old switch in step — and off for 'invite', so an older image that
  // only knows allow_signup fails closed after a downgrade instead of throwing
  // registration open to anyone.
  setSetting('allow_signup', mode === 'open' ? '1' : '0');
}

// Codes get read out over the phone and typed off a screenshot, so no 0/O and
// no 1/I. 32 symbols × 12 characters = 60 random bits: far too many to guess,
// which is why checking a code needs no rate limit of its own.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;

export function generateInviteCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Whatever was typed or pasted → the stored form: "abcd-efgh jklm" → "ABCDEFGHJKLM". */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Stored form → grouped for people: "ABCDEFGHJKLM" → "ABCD-EFGH-JKLM". */
export function formatInviteCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

export interface InviteRow {
  id: number;
  code: string;
  note: string | null;
  max_uses: number | null; // null = unlimited
  uses: number;
  expires_at: string | null; // ISO 8601; null = never
  language: string | null; // preset for the new profile; null = the visitor's own
  audience: string | null; // preset for the new profile; null = 'beginner'
  created_by: number | null;
  created_at: string;
  revoked_at: string | null;
}

export type InviteStatus = 'active' | 'revoked' | 'expired' | 'used_up';

type StatusFields = Pick<InviteRow, 'revoked_at' | 'expires_at' | 'max_uses' | 'uses'>;

// When several apply, the admin's own action wins: an invite that was revoked
// reads "revoked" even if it has since expired too.
export function inviteStatus(inv: StatusFields, now = new Date()): InviteStatus {
  if (inv.revoked_at) return 'revoked';
  if (inv.expires_at && Date.parse(inv.expires_at) <= now.getTime()) return 'expired';
  if (inv.max_uses !== null && inv.uses >= inv.max_uses) return 'used_up';
  return 'active';
}

export function findInvite(rawCode: string): InviteRow | undefined {
  const code = normalizeInviteCode(rawCode);
  if (!code) return undefined;
  return db.prepare('SELECT * FROM invites WHERE code = ?').get(code) as InviteRow | undefined;
}

export interface NewInvite {
  note?: string | null;
  max_uses?: number | null;
  expires_in_days?: number | null;
  language?: string | null;
  audience?: string | null;
}

export function createInvite(input: NewInvite, createdBy: number | null, now = new Date()): InviteRow {
  const expiresAt = input.expires_in_days
    ? new Date(now.getTime() + input.expires_in_days * 24 * 60 * 60_000).toISOString()
    : null;
  const r = db.prepare(
    `INSERT INTO invites (code, note, max_uses, expires_at, language, audience, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateInviteCode(),
    input.note || null,
    input.max_uses ?? null,
    expiresAt,
    input.language ?? null,
    input.audience ?? null,
    createdBy,
    now.toISOString(),
  );
  return db.prepare('SELECT * FROM invites WHERE id = ?').get(r.lastInsertRowid) as InviteRow;
}

// Spend one use. The WHERE clause repeats inviteStatus() so two signups racing
// for the last use can't both get it — the second UPDATE matches no row. Call
// it inside the transaction that creates the account, so a signup that fails
// afterwards (username taken) gives the use back.
export function consumeInvite(id: number, now = new Date()): boolean {
  const r = db.prepare(
    `UPDATE invites SET uses = uses + 1
     WHERE id = ? AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)
       AND (max_uses IS NULL OR uses < max_uses)`,
  ).run(id, now.toISOString());
  return r.changes === 1;
}

/** False if there is no such invite. Revoking twice keeps the first date. */
export function revokeInvite(id: number, now = new Date()): boolean {
  if (!db.prepare('SELECT id FROM invites WHERE id = ?').get(id)) return false;
  db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now.toISOString(), id);
  return true;
}

/** Accounts made with it stay; their invite_id goes NULL via the foreign key. */
export function deleteInvite(id: number): boolean {
  return db.prepare('DELETE FROM invites WHERE id = ?').run(id).changes === 1;
}

export function listInvites(): InviteRow[] {
  return db.prepare('SELECT * FROM invites ORDER BY id DESC').all() as InviteRow[];
}
