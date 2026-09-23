import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { lookupUser, SESSION_COOKIE_NAME } from './sessions.js';
import { userCount } from '../db.js';
import type { AuthedUser } from '../types.js';
import { config } from '../config.js';

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthedUser;
  }
}

export const requireSetupComplete: MiddlewareHandler = async (c, next) => {
  if (userCount() === 0) return c.json({ error: 'setup_required' }, 409);
  await next();
};

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  const user = lookupUser(cookie);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', user);
  await next();
};

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  const user = lookupUser(cookie);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  c.set('user', user);
  await next();
};

export const requireNotDemo: MiddlewareHandler = async (c, next) => {
  if (config.demoMode) {
    return c.json({ error: 'demo_mode', message: 'Not available in demo mode' }, 403);
  }
  await next();
};
