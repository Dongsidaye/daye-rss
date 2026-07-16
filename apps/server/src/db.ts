import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import type { Article, ModelConfig, Monitor, Source } from './types.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'daye-rss.db'));
// Apply the wait policy before WAL negotiation so concurrent test workers or a
// running background queue cannot fail immediately during connection startup.
db.exec('PRAGMA busy_timeout=5000;');
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE, site_url TEXT,
    category TEXT NOT NULL DEFAULT '未分类', enabled INTEGER NOT NULL DEFAULT 1,
    refresh_minutes INTEGER NOT NULL DEFAULT 60, quality_score REAL NOT NULL DEFAULT 80,
    last_fetched_at TEXT, last_error TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, source_title TEXT NOT NULL, title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE, author TEXT, published_at TEXT NOT NULL, excerpt TEXT NOT NULL DEFAULT '',
    content_html TEXT NOT NULL DEFAULT '', summary_zh TEXT, translation_zh TEXT, image_url TEXT, media_url TEXT,
    topics_json TEXT NOT NULL DEFAULT '[]', importance TEXT NOT NULL DEFAULT 'normal',
    importance_score REAL NOT NULL DEFAULT 50, importance_reason TEXT NOT NULL DEFAULT '常规更新',
    cluster_id TEXT, status TEXT NOT NULL DEFAULT 'unread', created_at TEXT NOT NULL,
    FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_articles_cluster ON articles(cluster_id);
  CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, query TEXT NOT NULL, topics_json TEXT NOT NULL DEFAULT '[]',
    importance TEXT NOT NULL DEFAULT 'high', notification_mode TEXT NOT NULL DEFAULT 'instant',
    enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS model_configs (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT NOT NULL, model TEXT NOT NULL,
    base_url TEXT, encrypted_api_key TEXT NOT NULL, roles_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 100
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS magic_links (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS devices (token TEXT PRIMARY KEY, platform TEXT NOT NULL DEFAULT 'android', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS briefs (id TEXT PRIMARY KEY, period TEXT NOT NULL, title TEXT NOT NULL, content_json TEXT NOT NULL, created_at TEXT NOT NULL);
`);

const articleColumns = db.prepare('PRAGMA table_info(articles)').all() as Array<{ name: string }>;
const addedBilingualTitles = !articleColumns.some((column) => column.name === 'title_zh') || !articleColumns.some((column) => column.name === 'title_en');
if (!articleColumns.some((column) => column.name === 'title_zh')) db.exec('ALTER TABLE articles ADD COLUMN title_zh TEXT');
if (!articleColumns.some((column) => column.name === 'title_en')) db.exec('ALTER TABLE articles ADD COLUMN title_en TEXT');
if (!articleColumns.some((column) => column.name === 'enrichment_attempted_at')) db.exec('ALTER TABLE articles ADD COLUMN enrichment_attempted_at TEXT');
if (!articleColumns.some((column) => column.name === 'enrichment_error')) db.exec('ALTER TABLE articles ADD COLUMN enrichment_error TEXT');
const addArticleColumn = (name: string, definition: string) => {
  if (articleColumns.some((column) => column.name === name)) return;
  try { db.exec(`ALTER TABLE articles ADD COLUMN ${name} ${definition}`); }
  catch (error) { if (!/duplicate column/i.test(error instanceof Error ? error.message : String(error))) throw error; }
};
addArticleColumn('fulltext_attempted_at', 'TEXT');
addArticleColumn('fulltext_error', 'TEXT');
addArticleColumn('fulltext_retry_count', 'INTEGER NOT NULL DEFAULT 0');
if (addedBilingualTitles) db.exec('UPDATE articles SET enrichment_attempted_at=NULL');

const modelColumns = db.prepare('PRAGMA table_info(model_configs)').all() as Array<{ name: string }>;
if (!modelColumns.some((column) => column.name === 'priority')) {
  try { db.exec('ALTER TABLE model_configs ADD COLUMN priority INTEGER NOT NULL DEFAULT 100'); }
  catch (error) { if (!/duplicate column/i.test(error instanceof Error ? error.message : String(error))) throw error; }
}

const asBool = (value: unknown) => Boolean(value);
const parse = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value)) as T; } catch { return fallback; } };
const publicProcessingError = (value: unknown) => {
  if (!value) return undefined;
  const message = String(value);
  if (/usage limit|quota|billing cycle|access_terminated|额度/i.test(message)) return 'AI 额度不足，请恢复额度或切换备用模型';
  if (/后台 AI 处理已暂停|本地每日限额/i.test(message)) return '后台 AI 处理已暂停，请测试并恢复';
  if (/401|403|api.?key|unauthori[sz]ed|forbidden/i.test(message)) return 'AI 鉴权失败，请检查 API Key 或模型权限';
  return message.replace(/sk-[A-Za-z0-9_-]+/g, '[已隐藏密钥]').slice(0, 180);
};

export function rowToSource(row: Record<string, unknown>): Source {
  return { id: String(row.id), title: String(row.title), url: String(row.url), siteUrl: row.site_url ? String(row.site_url) : undefined, category: String(row.category), enabled: asBool(row.enabled), refreshMinutes: Number(row.refresh_minutes), qualityScore: Number(row.quality_score), lastFetchedAt: row.last_fetched_at ? String(row.last_fetched_at) : undefined, lastError: row.last_error ? String(row.last_error) : undefined, createdAt: String(row.created_at) };
}

export function rowToArticle(row: Record<string, unknown>): Article {
  return { id: String(row.id), sourceId: String(row.source_id), sourceTitle: String(row.source_title), title: String(row.title), titleZh: row.title_zh ? String(row.title_zh) : undefined, titleEn: row.title_en ? String(row.title_en) : undefined, url: String(row.url), author: row.author ? String(row.author) : undefined, publishedAt: String(row.published_at), excerpt: String(row.excerpt), contentHtml: String(row.content_html), summaryZh: row.summary_zh ? String(row.summary_zh) : undefined, translationZh: row.translation_zh ? String(row.translation_zh) : undefined, imageUrl: row.image_url ? String(row.image_url) : undefined, mediaUrl: row.media_url ? String(row.media_url) : undefined, topics: parse<string[]>(row.topics_json, []), importance: String(row.importance) as Article['importance'], importanceScore: Number(row.importance_score), importanceReason: String(row.importance_reason), clusterId: row.cluster_id ? String(row.cluster_id) : undefined, status: String(row.status) as Article['status'], createdAt: String(row.created_at), enrichmentAttemptedAt: row.enrichment_attempted_at ? String(row.enrichment_attempted_at) : undefined, enrichmentError: publicProcessingError(row.enrichment_error), fulltextAttemptedAt: row.fulltext_attempted_at ? String(row.fulltext_attempted_at) : undefined, fulltextError: publicProcessingError(row.fulltext_error), fulltextRetryCount: Number(row.fulltext_retry_count || 0) };
}

export function rowToMonitor(row: Record<string, unknown>): Monitor {
  return { id: String(row.id), name: String(row.name), query: String(row.query), topics: parse<string[]>(row.topics_json, []), importance: String(row.importance) as Monitor['importance'], notificationMode: String(row.notification_mode) as Monitor['notificationMode'], enabled: asBool(row.enabled), createdAt: String(row.created_at) };
}

export function rowToModel(row: Record<string, unknown>): ModelConfig {
  return { id: String(row.id), provider: String(row.provider) as ModelConfig['provider'], label: String(row.label), model: String(row.model), baseUrl: row.base_url ? String(row.base_url) : undefined, encryptedApiKey: String(row.encrypted_api_key), roles: parse<ModelConfig['roles']>(row.roles_json, []), enabled: asBool(row.enabled), priority: Number(row.priority ?? 100) };
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value_json FROM settings WHERE key=?').get(key) as { value_json: string } | undefined;
  return row ? parse<T>(row.value_json, fallback) : fallback;
}

export function setSetting(key: string, value: unknown) {
  db.prepare('INSERT INTO settings(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run(key, JSON.stringify(value));
}
