import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

const ALLOWED_HOSTS = new Set([
  'api.kimi.com',
  'api.openai.com',
  'api.anthropic.com',
  'api.deepseek.com',
  'openrouter.ai',
  'generativelanguage.googleapis.com'
]);
const ALLOWED_HEADERS = new Set(['authorization', 'content-type', 'x-api-key', 'anthropic-version']);
const MAX_REQUEST_BYTES = 256_000;
const MAX_RESPONSE_BYTES = 2_000_000;

export function validateModelProxyTarget(raw: unknown) {
  if (typeof raw !== 'string') throw new Error('模型地址无效');
  const target = new URL(raw);
  if (target.protocol !== 'https:' || target.username || target.password || target.port) throw new Error('仅允许标准 HTTPS 模型地址');
  if (!ALLOWED_HOSTS.has(target.hostname.toLowerCase())) throw new Error('浏览器 Demo 仅允许连接受支持的官方模型域名');
  return target;
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_REQUEST_BYTES) throw new Error('请求内容过大');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as { url?: unknown; headers?: unknown; data?: unknown };
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(body));
}

async function proxyModel(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') return send(response, 405, { error: '仅支持 POST' });
  try {
    const body = await readJson(request);
    const target = validateModelProxyTarget(body.url);
    const headers = Object.fromEntries(
      Object.entries(body.headers && typeof body.headers === 'object' ? body.headers as Record<string, unknown> : {})
        .filter(([name, value]) => ALLOWED_HEADERS.has(name.toLowerCase()) && typeof value === 'string')
        .map(([name, value]) => [name, String(value)])
    );
    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(body.data ?? {}),
      signal: AbortSignal.timeout(95_000),
      redirect: 'error'
    });
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) return send(response, 502, { error: '模型响应超过 2 MB 安全限制' });
    response.statusCode = upstream.status;
    response.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.end(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : '模型转发失败';
    const status = message.includes('仅允许') || message.includes('无效') || message.includes('过大') ? 400 : 502;
    send(response, status, { error: { message } });
  }
}

export function devModelProxy(): Plugin {
  return {
    name: 'daye-dev-model-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__daye_model_proxy', (request, response) => { void proxyModel(request, response); });
      server.middlewares.use('/__daye_apk', (request, response) => {
        if (request.method !== 'GET') return send(response, 405, { error: '仅支持 GET' });
        const apkPath = path.resolve(import.meta.dirname, '../../outputs/daye-rss-v1.5-kimi-xfold.apk');
        void stat(apkPath).then((info) => {
          response.statusCode = 200;
          response.setHeader('content-type', 'application/vnd.android.package-archive');
          response.setHeader('content-length', info.size);
          response.setHeader('content-disposition', 'attachment; filename="daye-rss-v1.5-kimi-xfold.apk"');
          response.setHeader('cache-control', 'no-store');
          createReadStream(apkPath).pipe(response);
        }).catch(() => send(response, 404, { error: 'APK 仍在构建，请稍后重试' }));
      });
    }
  };
}
