import { randomBytes, randomInt } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db, getSetting, setSetting } from './db.js';
import { hash, signSession, verifySession } from './security.js';

declare module 'fastify' {
  interface FastifyRequest { userEmail?: string }
}

export function requireAuth(request: FastifyRequest) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const session = token ? verifySession(token) : null;
  if (!session || session.version !== getSetting('sessionVersion', 1)) {
    const error = new Error('Unauthorized') as Error & { statusCode?: number };
    error.statusCode = 401;
    throw error;
  }
  request.userEmail = session.email;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/request', { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const body = request.body as { email?: string };
    const email = body.email?.trim().toLowerCase();
    if (!email || email !== config.allowedEmail) return reply.send({ ok: true });
    db.prepare('DELETE FROM magic_links WHERE used=1 OR expires_at<?').run(Date.now());
    const rawToken = randomBytes(32).toString('base64url');
    const code = String(randomInt(100000, 1_000_000));
    db.prepare('INSERT INTO magic_links(token_hash,expires_at,used) VALUES(?,?,0)').run(hash(rawToken), Date.now() + 10 * 60_000);
    db.prepare('INSERT INTO magic_links(token_hash,expires_at,used) VALUES(?,?,0)').run(hash(`code:${code}`), Date.now() + 10 * 60_000);
    const link = `${config.appOrigin}/login?token=${encodeURIComponent(rawToken)}`;
    if (config.smtp.host && config.smtp.user && config.smtp.pass) {
      const transport = nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, auth: { user: config.smtp.user, pass: config.smtp.pass } });
      await transport.sendMail({ from: config.smtp.from, to: email, subject: '登录大爷的 RSS', text: `一次性验证码：${code}\n\n也可以使用此登录链接：${link}\n\n验证码和链接均在 10 分钟内有效，且只能使用一次。` });
    } else {
      app.log.warn({ link }, 'SMTP is not configured; magic link written to server log');
    }
    return reply.send({ ok: true, ...(config.devAuthBypass ? { devMagicLink: link, devCode: code } : {}) });
  });

  app.post('/api/auth/verify', { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const body = request.body as { token?: string; code?: string };
    if (!body.token && !body.code) return reply.code(400).send({ error: '缺少验证码或登录令牌' });
    const tokenHash = hash(body.code ? `code:${body.code.trim()}` : body.token!);
    const row = db.prepare('SELECT expires_at,used FROM magic_links WHERE token_hash=?').get(tokenHash) as { expires_at: number; used: number } | undefined;
    if (!row || row.used || row.expires_at < Date.now()) return reply.code(401).send({ error: '登录链接无效或已过期' });
    db.prepare('UPDATE magic_links SET used=1 WHERE used=0').run();
    return reply.send({ token: signSession(config.allowedEmail, 30, getSetting('sessionVersion', 1)), email: config.allowedEmail });
  });

  app.post('/api/auth/dev', async (_request, reply) => {
    if (!config.devAuthBypass) return reply.code(404).send({ error: 'Not found' });
    return reply.send({ token: signSession(config.allowedEmail, 30, getSetting('sessionVersion', 1)), email: config.allowedEmail });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    requireAuth(request);
    setSetting('sessionVersion', getSetting('sessionVersion', 1) + 1);
    return reply.send({ ok: true });
  });
}
