import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { assertProductionConfig, config } from './config.js';
import { registerAuthRoutes, requireAuth } from './auth.js';
import { refreshDueSources } from './feeds.js';
import { maybeGenerateScheduledBrief, notifyCriticalArticles } from './notifications.js';
import { registerRoutes } from './routes.js';
import { compactStoredSummaries, queueArticleEnrichment } from './article-processing.js';

assertProductionConfig();
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', '*.apiKey', '*.token'] }, bodyLimit: 2_500_000 });
await app.register(cors, { origin: config.appOrigin.split(',').map((value) => value.trim()), methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
await app.register(rateLimit, { global: false });
app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('referrer-policy', 'strict-origin-when-cross-origin');
  reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('content-security-policy', "default-src 'self'; connect-src 'self' https:; img-src 'self' data: https:; media-src https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  return payload;
});

app.get('/api/health', async () => ({ ok: true, name: '大爷的 RSS', time: new Date().toISOString() }));
await registerAuthRoutes(app);
const compactedSummaries = compactStoredSummaries();
if (compactedSummaries) app.log.info({ count: compactedSummaries }, 'compacted stored AI summaries');
app.addHook('preHandler', async (request) => {
  if (!request.url.startsWith('/api/') || request.url === '/api/health' || request.url.startsWith('/api/auth/')) return;
  requireAuth(request);
});
await registerRoutes(app);

const webRoot = path.resolve('apps/web/dist');
if (fs.existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.get('/*', async (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: '接口不存在' });
    return reply.sendFile('index.html');
  });
}

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'request failed');
  const err = error as Error & { statusCode?: number };
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  reply.code(status).send({ error: status === 500 ? '服务器处理失败，请查看日志' : err.message });
});

const runBackgroundWork = async () => {
  try {
    await refreshDueSources(false);
    queueArticleEnrichment({ limit: 24 });
    await notifyCriticalArticles();
    await maybeGenerateScheduledBrief();
  } catch (error) { app.log.error({ err: error }, 'background task failed'); }
};

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`大爷的 RSS server listening on ${config.port}`);
void runBackgroundWork();
const timer = setInterval(() => void runBackgroundWork(), 5 * 60_000);

const shutdown = async () => { clearInterval(timer); await app.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
