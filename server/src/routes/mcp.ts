/** Admin-only localhost control plane for the site's MCP connection wizard. */
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin } from '../auth/middleware.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { verifyPassword } from '../auth/passwords.js';
import { getTunnelStatus, saveTunnelSetup, startTunnel, stopTunnel, testLocalMcp } from '../mcp/tunnel.js';

const router = new Hono();
const local = ['127.0.0.1', 'localhost', '::1', '[::1]'];
router.use('*', requireAdmin);
router.use('*', async (c, next) => {
  if (!local.includes(config.host) || !local.includes(new URL(c.req.url).hostname))
    return c.json({ error: 'Local MCP management is available only on a localhost-only Patzer installation.' }, 403);
  await next();
});

router.get('/status', async (c) => c.json(await getTunnelStatus()));

const setup = z.object({
  tunnelId: z.string().regex(/^tunnel_[0-9a-f]{32}$/),
  runtimeKey: z.string().max(512).optional(),
  patzerPassword: z.string().min(10).max(200).optional(),
  autoStart: z.boolean().default(true),
}).strict();
router.post('/setup', async (c) => {
  const data = setup.safeParse(await c.req.json().catch(() => null));
  if (!data.success) return c.json({ error: 'Please enter a valid tunnel ID and optional credentials.' }, 400);
  const user = c.get('user');
  if (data.data.patzerPassword) {
    const entry = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string } | undefined;
    if (!entry || !(await verifyPassword(data.data.patzerPassword, entry.password_hash)))
      return c.json({ error: 'Your Patzer account password is incorrect.' }, 400);
  }
  try {
    const status = await saveTunnelSetup({ ...data.data, username: user.username });
    return c.json(status);
  } catch (e) {
    console.warn('[mcp-setup] setup failed:', e instanceof Error ? e.name : 'unknown');
    return c.json({ error: e instanceof Error && /^(Invalid|The runtime|Enter|Install|Complete|The Patzer MCP|Invalid local)/.test(e.message)
      ? e.message : 'MCP setup failed. Check the tunnel-client installation and systemd user service.' }, 500);
  }
});

for (const [name, fn] of [['start', startTunnel], ['stop', stopTunnel]] as const) {
  router.post(`/${name}`, async (c) => {
    try { return c.json(await fn()); }
    catch { return c.json({ error: `Unable to ${name} the tunnel. Check the local systemd user service.` }, 500); }
  });
}
router.post('/test-local', async (c) => c.json(await testLocalMcp()));

export default router;
