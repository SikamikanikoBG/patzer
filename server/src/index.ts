import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { config } from './config.js';
import './db.js';

import setupRoutes from './routes/setup.js';
import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import adminRoutes from './routes/admin.js';
import gamesRoutes from './routes/games.js';
import analyzeRoutes from './routes/analyze.js';
import coachRoutes from './routes/coach.js';
import metaRoutes from './routes/meta.js';
import lobbyRoutes from './routes/lobby.js';
import challengesRoutes from './routes/challenges.js';
import playersRoutes from './routes/players.js';
import statsRoutes from './routes/stats.js';
import reviewRoutes from './routes/review.js';
import ratingsRoutes from './routes/ratings.js';
import insightsRoutes from './routes/insights.js';
import insightsV2Routes from './routes/insightsV2.js';
import trainRoutes from './routes/train.js';
import openingsRoutes from './routes/openings.js';
import planRoutes from './routes/plan.js';
import achievementsRoutes from './routes/achievements.js';
import { attachPlayWebSocket } from './ws/play.js';
import { attachLobbyWebSocket } from './ws/lobby.js';

const app = new Hono();
app.use('*', logger());

// Defense-in-depth headers. The 3.0.0 release fixed the link-scheme XSS in the
// coach renderer; if a future regression brings dangerouslySetInnerHTML back
// in scope, the CSP is the next line of defense. `'unsafe-inline'` for styles
// is required because chessground and Tailwind both inject inline style. We
// keep scripts strict — Vite ships hashed bundles only.
app.use('*', async (c, next) => {
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer-when-downgrade');
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; '),
  );
  await next();
});

// In development, the Vite dev server runs on a different port and proxies /api;
// CORS is allowed for localhost so the browser can hit the server directly too.
app.use('/api/*', cors({
  origin: (origin) => origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : undefined,
  credentials: true,
}));

// CSRF guard: every state-changing /api request must carry `X-Requested-With:
// patzer`. Browsers will not attach this header on cross-origin form/img/link
// requests, so simple-request CSRF (which the cookie's SameSite=Lax does not
// fully block on top-level POSTs) becomes infeasible. The fetch helper in
// web/src/api.ts adds the header automatically on every mutating call.
app.use('/api/*', async (c, next) => {
  const m = c.req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  if (c.req.header('X-Requested-With') === 'patzer') return next();
  return c.json({ error: 'csrf_required' }, 403);
});

app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.route('/api/meta', metaRoutes);
app.route('/api/setup', setupRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/games', gamesRoutes);
// Game Review (AI prose) lives under /api/games/:id/review — mount the review
// router on the same prefix so it shares URL space.
app.route('/api/games', reviewRoutes);
app.route('/api/analyze', analyzeRoutes);
app.route('/api/coach', coachRoutes);
app.route('/api/lobby', lobbyRoutes);
app.route('/api/challenges', challengesRoutes);
app.route('/api/players', playersRoutes);
app.route('/api/stats', statsRoutes);
app.route('/api/ratings', ratingsRoutes);
app.route('/api/insights', insightsRoutes);
app.route('/api/insights/v2', insightsV2Routes);
app.route('/api/train', trainRoutes);
app.route('/api/openings', openingsRoutes);
app.route('/api/plan', planRoutes);
app.route('/api/achievements', achievementsRoutes);

// In production, serve the built web app
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
const WEB_DIST = resolve(config.projectRoot, 'web', 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

if (existsSync(WEB_DIST)) {
  app.get('*', (c) => {
    const url = new URL(c.req.url);
    let path = url.pathname === '/' ? '/index.html' : url.pathname;
    let abs = join(WEB_DIST, path);
    if (!existsSync(abs) || path.endsWith('/')) {
      abs = join(WEB_DIST, 'index.html');
      path = '/index.html';
    }
    const ext = extname(path);
    const mime = MIME[ext] ?? 'application/octet-stream';
    const body = readFileSync(abs);
    return c.body(body, 200, { 'Content-Type': mime });
  });
}

import type { Server } from 'node:http';

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[chess] listening on http://${info.address}:${info.port}`);
});

attachPlayWebSocket(server as unknown as Server);
attachLobbyWebSocket(server as unknown as Server);
