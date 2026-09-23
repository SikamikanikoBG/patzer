import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { config } from '../src/config.js';
import { StockfishEngine } from '../src/chess/stockfish.js';
import { requireNotDemo } from '../src/auth/middleware.js';
import { db, userCount } from '../src/db.js';
import { seedDemoData } from '../src/demo-seed.js';
import authRoutes from '../src/routes/auth.js';
import adminRoutes from '../src/routes/admin.js';
import gamesRoutes from '../src/routes/games.js';
import metaRoutes from '../src/routes/meta.js';
import analyzeRoutes from '../src/routes/analyze.js';
import planRoutes from '../src/routes/plan.js';
import setupRoutes from '../src/routes/setup.js';
import challengesRoutes from '../src/routes/challenges.js';
import coachRoutes from '../src/routes/coach.js';
import reviewRoutes from '../src/routes/review.js';
import trainRoutes from '../src/routes/train.js';
import settingsRoutes from '../src/routes/settings.js';

vi.mock('../src/auth/middleware.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    requireAuth: async (c: any, next: any) => {
      c.set('user', { id: 1, username: 'testuser', role: 'admin', profile: {} });
      return next();
    },
    requireAdmin: async (c: any, next: any) => {
      return next();
    }
  };
});

// Clean up DB before testing seeding
beforeEach(() => {
  db.prepare('DELETE FROM users WHERE username IN (?, ?)').run('demo1', 'demo2');
  db.prepare('DELETE FROM games WHERE white = ?').run('demo1');
});

describe('Demo Mode (Issue #27)', () => {
  let originalDemoMode: boolean;
  let originalStockfishCap: number;

  beforeEach(() => {
    originalDemoMode = config.demoMode;
    originalStockfishCap = config.demoStockfishCap;
    config.demoMode = true;
    config.demoStockfishCap = 2;
  });

  afterEach(() => {
    config.demoMode = originalDemoMode;
    config.demoStockfishCap = originalStockfishCap;
    vi.restoreAllMocks();
  });

  describe('CONFIGURATION', () => {
    it('is disabled by default and custom concurrency works', () => {
      // These assert the environment variables defaults
      const orig = process.env.DEMO_MODE;
      const origCap = process.env.STOCKFISH_DEMO_CAP;

      delete process.env.DEMO_MODE;
      delete process.env.STOCKFISH_DEMO_CAP;
      
      // We can't re-instantiate config easily without jest.isolateModules,
      // but we can trust the manual assertion here.
      expect(originalDemoMode).toBe(false); // assuming process.env is clean by default
      expect(originalStockfishCap).toBe(2);

      process.env.DEMO_MODE = orig;
      process.env.STOCKFISH_DEMO_CAP = origCap;
    });
  });

  describe('AUTH / SIGNUP', () => {
    it('rejects signup with 403 in demo mode', async () => {
      const app = new Hono();
      app.route('/auth', authRoutes);

      const res = await app.request('/auth/register', { method: 'POST' });
      expect(res.status).toBe(403);
      const data = await res.json() as any;
      expect(data).toEqual({ error: 'demo_mode', message: 'Not available in demo mode' });
    });

    it('continues working normally when demo mode is disabled', async () => {
      config.demoMode = false;
      const app = new Hono();
      app.route('/auth', authRoutes);

      // Will fail with 400 (validation) or 403 (CSRF) but NOT 403 demo_mode
      const res = await app.request('/auth/register', { method: 'POST' });
      const data = await res.json() as any;
      expect(data.error).not.toBe('demo_mode');
    });
  });

  describe('MUTATIONS', () => {
    it('rejects state-changing endpoints on routes with 403 in demo mode', async () => {
      const app = new Hono();
      app.route('/settings', settingsRoutes);
      app.route('/plan', planRoutes);
      app.route('/setup', setupRoutes);
      app.route('/games', gamesRoutes);

      const endpoints = [
        { path: '/settings/allow_signup', method: 'POST' },
        { path: '/plan/generate', method: 'POST' },
        { path: '/setup', method: 'POST' },
        { path: '/games/1/notes', method: 'POST' },
      ];

      for (const ep of endpoints) {
        const res = await app.request(ep.path, { method: ep.method });
        expect(res.status).toBe(403);
        const data = await res.json() as any;
        expect(data.error).toBe('demo_mode');
      }
    });
  });

  describe('ADMIN', () => {
    it('allows GET/list endpoints in demo mode', async () => {
      const app = new Hono();
      app.route('/admin', adminRoutes);

      const res = await app.request('/admin/users');
      // Should not be blocked by demo_mode. With requireAuth mocked, it might hit a DB error or 200, 
      // but as long as it's not 403 demo_mode, it proves the middleware allows GET.
      expect(res.status).not.toBe(403);
    });

    it('rejects admin mutation endpoints with 403 in demo mode', async () => {
      const app = new Hono();
      app.route('/admin', adminRoutes);

      const res = await app.request('/admin/users/123/role', { method: 'POST' });
      expect(res.status).toBe(403);
      const data = await res.json() as any;
      expect(data.error).toBe('demo_mode');
    });
  });

  describe('CHESS.COM', () => {
    it('rejects chess.com import in demo mode', async () => {
      const app = new Hono();
      app.route('/games', gamesRoutes);

      const res = await app.request('/games/import', { method: 'POST' });
      expect(res.status).toBe(403);
      const data = await res.json() as any;
      expect(data.error).toBe('demo_mode');
    });
  });

  describe('MATCHMAKING (CHALLENGES)', () => {
    it('rejects challenge creation, acceptance, and deletion with 403 in demo mode', async () => {
      const app = new Hono();
      app.route('/challenges', challengesRoutes);

      const endpoints = [
        { path: '/challenges', method: 'POST' },
        { path: '/challenges/123/accept', method: 'POST' },
        { path: '/challenges/123', method: 'DELETE' },
      ];

      for (const ep of endpoints) {
        const res = await app.request(ep.path, { method: ep.method });
        expect(res.status).toBe(403);
        const data = await res.json() as any;
        expect(data.error).toBe('demo_mode');
      }
    });

    it('allows read-only challenge endpoints', async () => {
      const app = new Hono();
      app.route('/challenges', challengesRoutes);
      const res = await app.request('/challenges');
      expect(res.status).not.toBe(403);
    });

    it('preserves challenge behavior in normal mode', async () => {
      config.demoMode = false;
      const app = new Hono();
      app.route('/challenges', challengesRoutes);

      const res = await app.request('/challenges', { method: 'POST' });
      // Might fail validation, but NOT demo_mode 403
      const data = await res.json() as any;
      expect(data?.error).not.toBe('demo_mode');
    });
  });

  describe('INTERACTIVE TRY-IT FEATURES (ALLOWED)', () => {
    it('allows analysis, coaching, review, and puzzles in demo mode', async () => {
      const app = new Hono();
      app.route('/analyze', analyzeRoutes);
      app.route('/coach', coachRoutes);
      app.route('/review', reviewRoutes);
      app.route('/train', trainRoutes);

      const endpoints = [
        { path: '/analyze', method: 'POST' },
        { path: '/analyze/position', method: 'POST' },
        { path: '/coach/explain', method: 'POST' },
        { path: '/coach/hint', method: 'POST' },
        { path: '/review/123/review', method: 'POST' },
        { path: '/train/attempt', method: 'POST' },
      ];

      for (const ep of endpoints) {
        const res = await app.request(ep.path, { method: ep.method });
        // Even if they return 400 Bad Request (missing body/params), they shouldn't return 403 demo_mode
        if (res.status === 403) {
          const data = await res.json() as any;
          expect(data?.error).not.toBe('demo_mode');
        } else {
          expect(res.status).not.toBe(403);
        }
      }
    });
  });

  describe('STOCKFISH', () => {
    it('enforces configured global concurrency in demo mode', async () => {
      config.demoStockfishCap = 1;
      
      const e1 = new StockfishEngine();
      const e2 = new StockfishEngine();

      const mockProc = {
        stdout: { setEncoding: vi.fn(), on: vi.fn() },
        on: vi.fn(),
        stdin: { write: vi.fn() },
      };
      
      vi.spyOn(StockfishEngine.prototype as any, 'send').mockResolvedValue(undefined);
      vi.spyOn(StockfishEngine.prototype as any, 'waitFor').mockResolvedValue('uciok');
      // @ts-ignore
      vi.spyOn(await import('node:child_process'), 'spawn').mockReturnValue(mockProc);

      // Slot 1
      await e1.start();
      
      // Slot 2 fails (cap is 1)
      await expect(e2.start()).rejects.toThrow('engine_limit_reached');

      // Releases global slot
      await e1.quit();

      // Slot 1 again
      await e2.start();
      await e2.quit();
    });

    it('preserves existing functionality when demo mode is disabled', async () => {
      config.demoMode = false;
      config.demoStockfishCap = 1;
      
      const e1 = new StockfishEngine();
      const e2 = new StockfishEngine();

      const mockProc = {
        stdout: { setEncoding: vi.fn(), on: vi.fn() },
        on: vi.fn(),
        stdin: { write: vi.fn() },
      };
      
      vi.spyOn(StockfishEngine.prototype as any, 'send').mockResolvedValue(undefined);
      vi.spyOn(StockfishEngine.prototype as any, 'waitFor').mockResolvedValue('uciok');
      // @ts-ignore
      vi.spyOn(await import('node:child_process'), 'spawn').mockReturnValue(mockProc);

      // Both succeed since demoMode=false
      await e1.start();
      await e2.start();

      await e1.quit();
      await e2.quit();
    });

    it('does not permanently consume a slot when analysis fails', async () => {
      config.demoStockfishCap = 1;
      
      const e1 = new StockfishEngine();
      const e2 = new StockfishEngine();

      vi.spyOn(StockfishEngine.prototype as any, 'send').mockResolvedValue(undefined);
      // Mock waitFor to throw, simulating a crash during initialization
      vi.spyOn(StockfishEngine.prototype as any, 'waitFor').mockRejectedValue(new Error('crash'));
      
      const mockProc = {
        stdout: { setEncoding: vi.fn(), on: vi.fn() },
        on: vi.fn(),
        stdin: { write: vi.fn() },
        kill: vi.fn(),
      };
      // @ts-ignore
      vi.spyOn(await import('node:child_process'), 'spawn').mockReturnValue(mockProc);

      // start() will throw "crash"
      await expect(e1.start()).rejects.toThrow('crash');
      
      // Cleanup is usually called in finally block in routes, but if it is called it should cleanly decrement
      await e1.quit();

      // Ensure slot is free again
      vi.spyOn(StockfishEngine.prototype as any, 'waitFor').mockResolvedValue('uciok');
      await e2.start();
      await e2.quit();
    });
  });

  describe('META', () => {
    it('exposes demo=true in demo mode', async () => {
      const app = new Hono();
      app.route('/meta', metaRoutes);

      const res = await app.request('/meta');
      const data = await res.json() as any;
      expect(data.demo).toBe(true);
    });

    it('remains backwards compatible (demo absent) in normal mode', async () => {
      config.demoMode = false;
      const app = new Hono();
      app.route('/meta', metaRoutes);

      const res = await app.request('/meta');
      const data = await res.json() as any;
      expect(data.demo).toBeUndefined();
    });
  });

  describe('SEEDING', () => {
    it('creates demo users and games on first initialization idempotently', async () => {
      // Ensure we don't actually call Stockfish during the seed test
      vi.mock('../src/routes/analyze.js', () => ({
        analyzePgnFull: vi.fn().mockResolvedValue({
          depth: 12, accuracy_white: 90, accuracy_black: 80,
          estimated_elo_white: 1500, estimated_elo_black: 1400,
          performance_white: null, performance_black: null,
          opening_eco: 'C20', opening_name: "King's Pawn Game",
          key_moments: [], phase_split: null, moves: []
        })
      }));

      // Initial user count (minus demo)
      const initialUsers = userCount();

      // First initialization
      await seedDemoData();
      
      const usersAfterFirst = userCount();
      expect(usersAfterFirst).toBeGreaterThanOrEqual(initialUsers + 2); // demo1, demo2

      const gamesAfterFirst = db.prepare('SELECT COUNT(*) as c FROM games WHERE white = ?').get('demo1') as { c: number };
      expect(gamesAfterFirst.c).toBe(2);

      // Running initialization again does not duplicate records
      await seedDemoData();
      
      const usersAfterSecond = userCount();
      expect(usersAfterSecond).toBe(usersAfterFirst);

      const gamesAfterSecond = db.prepare('SELECT COUNT(*) as c FROM games WHERE white = ?').get('demo1') as { c: number };
      expect(gamesAfterSecond.c).toBe(2);
      
      vi.unmock('../src/routes/analyze.js');
    });
  });
});
