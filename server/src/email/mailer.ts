import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { getSetting } from '../db.js';

// SMTP configuration is resolved env-first, then from the `settings` table
// (Admin → System). Operators who prefer secrets out of the DB set SMTP_* env
// vars; everyone else fills the admin form. Either path produces the same
// shape. The transport is rebuilt whenever the resolved config fingerprint
// changes, so saving new settings in the UI takes effect without a restart.

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

function envOrSetting(envKey: string, settingKey: string): string {
  const e = process.env[envKey];
  if (e !== undefined && e !== '') return e;
  return getSetting(settingKey) ?? '';
}

export function resolveSmtpConfig(): SmtpConfig | null {
  const host = envOrSetting('SMTP_HOST', 'smtp_host').trim();
  if (!host) return null; // host is the single required field; no host = email disabled
  const portRaw = envOrSetting('SMTP_PORT', 'smtp_port').trim();
  const port = portRaw ? Number(portRaw) : 587;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  const secureRaw = envOrSetting('SMTP_SECURE', 'smtp_secure').trim().toLowerCase();
  // Default: implicit TLS only on the canonical SMTPS port 465. 587/25 use
  // STARTTLS, which nodemailer negotiates automatically with secure=false.
  const secure = secureRaw ? /^(1|true|yes|on)$/.test(secureRaw) : port === 465;
  const user = envOrSetting('SMTP_USER', 'smtp_user').trim();
  const pass = process.env.SMTP_PASS ?? getSetting('smtp_pass') ?? '';
  const from = (envOrSetting('SMTP_FROM', 'smtp_from').trim()) || user || `patzer@${host}`;
  return { host, port, secure, user, pass, from };
}

export function isMailerConfigured(): boolean {
  return resolveSmtpConfig() !== null;
}

let cached: { fingerprint: string; transport: Transporter } | null = null;

function getTransport(cfg: SmtpConfig): Transporter {
  const fingerprint = JSON.stringify(cfg);
  if (cached && cached.fingerprint === fingerprint) return cached.transport;
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    // Omit auth entirely for relays that accept unauthenticated local mail
    // (a common self-hosted setup) — passing empty creds makes some servers
    // reject the session outright.
    auth: cfg.user || cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  cached = { fingerprint, transport };
  return transport;
}

export interface SendResult {
  ok: boolean;
  error?: string;
  skipped?: boolean; // mailer not configured — caller decides if that's fatal
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendResult> {
  const cfg = resolveSmtpConfig();
  if (!cfg) return { ok: false, skipped: true, error: 'smtp_not_configured' };
  try {
    const transport = getTransport(cfg);
    await transport.sendMail({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { ok: true };
  } catch (err) {
    // Never let a mail failure throw into a request handler — signup/reset must
    // still complete (or fail gracefully) regardless of the relay's mood.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mail] send_failed to=${opts.to} subject="${opts.subject}" err=${msg}`);
    return { ok: false, error: msg };
  }
}

// Verifies the SMTP connection + credentials without sending a message. Used by
// the admin "Send test email" / connection-check button.
export async function verifyConnection(): Promise<SendResult> {
  const cfg = resolveSmtpConfig();
  if (!cfg) return { ok: false, skipped: true, error: 'smtp_not_configured' };
  try {
    await getTransport(cfg).verify();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ---- Templates -----------------------------------------------------------

const BRAND = 'Patzer';

function shell(title: string, bodyHtml: string): string {
  // Inline styles only — email clients strip <style>/<link>. Kept deliberately
  // plain so it renders in text-mostly clients and never trips spam heuristics.
  return `<!doctype html><html><body style="margin:0;background:#f7f6f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-size:20px;font-weight:700;letter-spacing:-.01em;margin-bottom:8px">♟ ${BRAND}</div>
    <div style="background:#fff;border:1px solid #e7e5e0;border-radius:14px;padding:24px">
      <h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
      ${bodyHtml}
    </div>
    <div style="color:#9ca3af;font-size:12px;margin-top:16px">You're receiving this because someone used your email on a ${BRAND} chess server. If that wasn't you, you can ignore this message.</div>
  </div></body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">${label}</a>`;
}

export function verifyEmailTemplate(displayName: string, link: string) {
  return {
    subject: `Confirm your ${BRAND} email`,
    text: `Hi ${displayName},\n\nConfirm your email to finish setting up your ${BRAND} account:\n${link}\n\nThis link expires in 24 hours.`,
    html: shell(
      `Confirm your email`,
      `<p style="margin:0 0 16px;line-height:1.5">Hi ${displayName}, confirm your email to finish setting up your ${BRAND} account.</p>
       <p style="margin:0 0 16px">${button(link, 'Confirm email')}</p>
       <p style="margin:0;color:#6b7280;font-size:13px">Or paste this link: <br><span style="word-break:break-all">${link}</span><br><br>This link expires in 24 hours.</p>`,
    ),
  };
}

export function resetPasswordTemplate(displayName: string, link: string) {
  return {
    subject: `Reset your ${BRAND} password`,
    text: `Hi ${displayName},\n\nReset your ${BRAND} password using this link:\n${link}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email — your password is unchanged.`,
    html: shell(
      `Reset your password`,
      `<p style="margin:0 0 16px;line-height:1.5">Hi ${displayName}, we got a request to reset your ${BRAND} password.</p>
       <p style="margin:0 0 16px">${button(link, 'Reset password')}</p>
       <p style="margin:0;color:#6b7280;font-size:13px">Or paste this link: <br><span style="word-break:break-all">${link}</span><br><br>This link expires in 1 hour. If you didn't request this, ignore this email — your password won't change.</p>`,
    ),
  };
}

export function welcomeTemplate(displayName: string, link: string) {
  return {
    subject: `Welcome to ${BRAND}`,
    text: `Hi ${displayName},\n\nYour ${BRAND} account is ready. Jump in:\n${link}`,
    html: shell(
      `Welcome, ${displayName} 👋`,
      `<p style="margin:0 0 16px;line-height:1.5">Your ${BRAND} account is ready. Play vs Stockfish, review your games, and let the AI coach explain your moves.</p>
       <p style="margin:0">${button(link, 'Open Patzer')}</p>`,
    ),
  };
}

export function adminNewUserTemplate(adminName: string, newUsername: string, newEmail: string | null) {
  return {
    subject: `New ${BRAND} signup: ${newUsername}`,
    text: `Hi ${adminName},\n\nA new user just self-registered on your ${BRAND} server:\n  username: ${newUsername}\n  email: ${newEmail ?? '(none)'}\n\nManage users in Admin → Users.`,
    html: shell(
      `New signup`,
      `<p style="margin:0 0 8px;line-height:1.5">A new user just self-registered on your ${BRAND} server.</p>
       <ul style="margin:0 0 16px;padding-left:18px;color:#374151">
         <li><b>Username:</b> ${newUsername}</li>
         <li><b>Email:</b> ${newEmail ?? '(none)'}</li>
       </ul>
       <p style="margin:0;color:#6b7280;font-size:13px">Manage everyone from Admin → Users.</p>`,
    ),
  };
}
