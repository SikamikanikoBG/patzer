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
import statsRoutes from './routes/stats.js';
import { attachPlayWebSocket } from './ws/play.js';
import { attachLobbyWebSocket } from './ws/lobby.js';

const app = new Hono();
app.use('*', logger());

// In development, the Vite dev server runs on a different port and proxies /api;
// CORS is allowed for localhost so the browser can hit the server directly too.
app.use('/api/*', cors({
  origin: (origin) => origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : undefined,
  credentials: true,
}));

app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.route('/api/meta', metaRoutes);
app.route('/api/setup', setupRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/games', gamesRoutes);
app.route('/api/analyze', analyzeRoutes);
app.route('/api/coach', coachRoutes);
app.route('/api/lobby', lobbyRoutes);
app.route('/api/challenges', challengesRoutes);
app.route('/api/stats', statsRoutes);

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
