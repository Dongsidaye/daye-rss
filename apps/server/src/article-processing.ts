import sanitizeHtml from 'sanitize-html';
import { askAI, getAIStatus, getRoleModelCandidates, hasModel, roleConcurrencyLimit, summarizeArticleBody, translateArticleTitle } from './ai.js';
import { articleParagraphs, articlePlainText } from './article-content.js';
import { db, rowToArticle } from './db.js';
import { extractFullArticle } from './feeds.js';
import { limitSummaryMarkdown } from './summary-format.js';
import { mapConcurrent } from './concurrency.js';
import { chooseOrMergeArticleHtml } from './content-selection.js';

const FULLTEXT_THRESHOLD = 1_800;
const AUTO_BATCH_SIZE = 24;
const ENRICHMENT_CONCURRENCY = 3;
const RETRY_COOLDOWN_MS = 30 * 60_000;

type QueueMode = 'background' | 'interactive';
type QueueStage = 'title' | 'summary' | 'interactive';
type QueueItem = { id: string; mode: QueueMode; stage: QueueStage };

const queue: QueueItem[] = [];
const queuedModes = new Map<string, QueueMode>();
const lastAttempt = new Map<string, number>();
const activeModes = new Map<string, QueueMode>();
let running = false;
let processed = 0;
let failed = 0;
let lastError: string | undefined;

export function shouldGenerateFullTranslation(mode: QueueMode) {
  return mode === 'interactive';
}

export function parseTranslationChunk(raw: string, expectedCount: number) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const fenced = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]?.trim()).filter(Boolean) as string[];
  const objectStart = cleaned.indexOf('{'); const objectEnd = cleaned.lastIndexOf('}');
  const candidates = [...new Set([cleaned, ...fenced, objectStart >= 0 && objectEnd > objectStart ? cleaned.slice(objectStart, objectEnd + 1) : ''].filter(Boolean))];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { translations?: unknown; translation?: unknown } | unknown[];
      const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed.translations) ? parsed.translations : [];
      const values = source.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim());
      if (values.length === expectedCount) return values;
      if (expectedCount === 1 && !Array.isArray(parsed) && typeof parsed.translation === 'string' && parsed.translation.trim()) return [parsed.translation.trim()];
    } catch { /* Try the next JSON candidate or the safe plain-text fallback. */ }
  }
  if (expectedCount === 1) {
    const quoted = cleaned.match(/"(?:translation|translations)"\s*:\s*(?:\[\s*)?"((?:\\.|[^"\\])*)"/i)?.[1];
    if (quoted) { try { return [JSON.parse(`"${quoted}"`)]; } catch { /* fall through */ } }
  }
  if (expectedCount === 1 && cleaned && !/^[{[]/.test(cleaned)) {
    const plain = cleaned.replace(/^(?:以下是|这是|here(?:'s| is))?\s*(?:翻译|译文|translation)\s*[:：]\s*/i, '').trim();
    if (plain) return [plain];
  }
  return [];
}

function articleById(id: string) {
  const row = db.prepare('SELECT * FROM articles WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!row) throw Object.assign(new Error('文章不存在'), { statusCode: 404 });
  return rowToArticle(row);
}

export function fulltextRetryDelay(retryCount: number) {
  return Math.min(24 * 60 * 60_000, RETRY_COOLDOWN_MS * 2 ** Math.max(0, retryCount - 1));
}

function fulltextDue(article: ReturnType<typeof articleById>) {
  if (!article.fulltextAttemptedAt) return true;
  return Date.now() - Date.parse(article.fulltextAttemptedAt) >= fulltextRetryDelay(article.fulltextRetryCount ?? 0);
}

export async function extractArticleFulltext(id: string) {
  const article = articleById(id);
  const beforeLength = articlePlainText(article.contentHtml).length;
  db.prepare('UPDATE articles SET fulltext_attempted_at=?,fulltext_error=NULL WHERE id=?').run(new Date().toISOString(), id);
  try {
    const full = await extractFullArticle(article.url);
    const selectedHtml = chooseOrMergeArticleHtml(article.contentHtml, full.contentHtml);
    const afterLength = articlePlainText(selectedHtml).length;
    const contentExpanded = afterLength > Math.max(FULLTEXT_THRESHOLD, beforeLength * 1.35);
    db.prepare(`UPDATE articles SET content_html=?,excerpt=?,author=COALESCE(author,?),
      summary_zh=CASE WHEN ? THEN NULL ELSE summary_zh END,
      translation_zh=CASE WHEN ? THEN NULL ELSE translation_zh END,
      fulltext_error=NULL,fulltext_retry_count=0 WHERE id=?`)
      .run(selectedHtml, articlePlainText(selectedHtml).slice(0, 800) || full.excerpt || article.excerpt, full.byline || null, Number(contentExpanded), Number(contentExpanded), id);
    return articleById(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : '正文抓取失败';
    db.prepare('UPDATE articles SET fulltext_error=?,fulltext_retry_count=COALESCE(fulltext_retry_count,0)+1 WHERE id=?').run(message.slice(0, 500), id);
    throw error;
  }
}

export async function generateArticleTitles(id: string) {
  const article = articleById(id);
  if (article.titleZh && article.titleEn) return { titleZh: article.titleZh, titleEn: article.titleEn };
  const titles = await translateArticleTitle({ title: article.title, source: article.sourceTitle });
  db.prepare('UPDATE articles SET title_zh=?,title_en=? WHERE id=?').run(titles.titleZh, titles.titleEn, id);
  return titles;
}

export async function generateArticleSummary(id: string, interactive = false) {
  const article = articleById(id);
  const plain = articlePlainText(article.contentHtml) || article.excerpt;
  if (plain.trim().length < 40) throw Object.assign(new Error('正文内容不足，暂时无法生成可靠摘要'), { statusCode: 422 });
  const titles = article.titleZh && article.titleEn ? { titleZh: article.titleZh, titleEn: article.titleEn } : await generateArticleTitles(id);
  const summary = await summarizeArticleBody({ title: titles.titleZh, source: article.sourceTitle, text: plain }, { interactive });
  db.prepare('UPDATE articles SET summary_zh=? WHERE id=?').run(summary, id);
  return { ...titles, summary };
}

export async function generateArticleTranslation(id: string) {
  const article = articleById(id);
  const originals = articleParagraphs(article.contentHtml, article.excerpt);
  if (!originals.length) throw Object.assign(new Error('文章没有可翻译的正文'), { statusCode: 422 });
  const primaryModel = getRoleModelCandidates('translation')[0];
  if (!primaryModel) throw Object.assign(new Error('尚未配置翻译模型'), { statusCode: 422 });
  const highThroughput = primaryModel.provider === 'deepseek';
  const paragraphLimit = highThroughput ? 1 : 12;
  const characterLimit = highThroughput ? 1_200 : 6_000;
  const system = '你是专业中英翻译。输入 JSON 只有 paragraphs 数组；逐项忠实完整翻译为简体中文，不解释、不总结、不改写为标题、不遗漏句子、不添加事实。必须输出严格 JSON：{"translations":["第一段的完整译文","第二段的完整译文"]}，数组长度与输入一致。';
  const translateChunk = async (paragraphs: string[]): Promise<string[]> => {
    const validate = (raw: string) => {
      const values = parseTranslationChunk(raw, paragraphs.length);
      if (values.length !== paragraphs.length) throw new Error('模型返回的翻译段落数不匹配');
      if (values.some((value, index) => paragraphs[index].length >= 120 && value.length < Math.max(20, paragraphs[index].length * 0.18))) throw new Error('模型翻译明显短于原文，已切换备用模型');
    };
    const raw = await askAI('translation', system, JSON.stringify({ paragraphs }), { interactive: true, validate });
    const values = parseTranslationChunk(raw, paragraphs.length);
    if (values.length === paragraphs.length) return values;
    if (paragraphs.length === 1) throw Object.assign(new Error('模型未返回可解析的单段翻译结果，请重试'), { statusCode: 502 });
    const middle = Math.ceil(paragraphs.length / 2);
    const [left, right] = await Promise.all([translateChunk(paragraphs.slice(0, middle)), translateChunk(paragraphs.slice(middle))]);
    return [...left, ...right];
  };
  const chunks: string[][] = [];
  let chunk: string[] = []; let characters = 0;
  for (const paragraph of originals) {
    if (chunk.length && (chunk.length >= paragraphLimit || characters + paragraph.length > characterLimit)) { chunks.push(chunk); chunk = []; characters = 0; }
    chunk.push(paragraph); characters += paragraph.length;
  }
  if (chunk.length) chunks.push(chunk);
  const translatedChunks = await mapConcurrent(chunks, roleConcurrencyLimit('translation', primaryModel.provider), translateChunk);
  const translations = translatedChunks.flat();
  const normalizedTranslations = translations.map((value) => value.replace(/\s+/g, '').toLowerCase());
  const uniqueRatio = new Set(normalizedTranslations).size / Math.max(1, normalizedTranslations.length);
  if (translations.length >= 6 && uniqueRatio < 0.5) throw Object.assign(new Error('翻译结果出现大量重复内容，已拒绝保存并等待重试'), { statusCode: 502 });
  const bilingual = JSON.stringify({ originals, translations: translations.map((value) => sanitizeHtml(String(value), { allowedTags: [], allowedAttributes: {} })) });
  db.prepare('UPDATE articles SET translation_zh=? WHERE id=?').run(bilingual, id);
  return bilingual;
}

async function enrichArticle(id: string, mode: QueueMode, stage: QueueStage = 'interactive') {
  if (stage === 'title') { await generateArticleTitles(id); return; }
  let article = articleById(id);
  const currentLength = articlePlainText(article.contentHtml).length;
  if (currentLength < FULLTEXT_THRESHOLD && fulltextDue(article)) {
    try { article = await extractArticleFulltext(id); }
    catch (error) {
      if ((articlePlainText(article.contentHtml) || article.excerpt).trim().length < 40) throw error;
      article = articleById(id);
    }
  }
  const needsSummary = !article.summaryZh && hasModel('summary');
  if (!shouldGenerateFullTranslation(mode)) {
    // Background work is intentionally limited to full text + concise Chinese
    // summary. Full translations are created only after an explicit open.
    if (needsSummary) await generateArticleSummary(id, false);
    return;
  }

  // Once the reader opens the article, start summary completion and full-text
  // translation together. One failure must not prevent the other task starting.
  const jobs: Promise<unknown>[] = [];
  if (needsSummary) jobs.push(generateArticleSummary(id, true));
  if (!article.translationZh && hasModel('translation')) jobs.push(generateArticleTranslation(id));
  const results = await Promise.allSettled(jobs);
  const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []);
  if (errors.length) throw new Error(errors.join('；'));
}

async function drainQueue() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const interactive = queue.filter((item) => item.stage === 'interactive').slice(0, ENRICHMENT_CONCURRENCY);
      const titleItems = queue.filter((item) => item.stage === 'title');
      const items = interactive.length ? interactive : titleItems.length ? titleItems : queue.filter((item) => item.stage === 'summary');
      const batch = items.slice(0, items[0]?.stage === 'title' ? 8 : ENRICHMENT_CONCURRENCY);
      for (const item of batch) queue.splice(queue.indexOf(item), 1);
      await Promise.all(batch.map(async (item) => {
        queuedModes.delete(`${item.id}:${item.stage}`); activeModes.set(item.id, item.mode);
        lastAttempt.set(item.id, Date.now());
        db.prepare('UPDATE articles SET enrichment_attempted_at=?,enrichment_error=NULL WHERE id=?').run(new Date().toISOString(), item.id);
        try {
          await enrichArticle(item.id, item.mode, item.stage);
          db.prepare('UPDATE articles SET enrichment_error=NULL WHERE id=?').run(item.id);
          processed += 1;
        } catch (error) {
          failed += 1; lastError = error instanceof Error ? error.message : '文章后台处理失败';
          db.prepare('UPDATE articles SET enrichment_error=? WHERE id=?').run(lastError.slice(0, 500), item.id);
        } finally { activeModes.delete(item.id); }
      }));
    }
  } finally {
    activeModes.clear(); running = false;
    if (queue.length) void drainQueue();
  }
}

function addToQueue(id: string, mode: QueueMode, stage: QueueStage = mode === 'interactive' ? 'interactive' : 'summary') {
  const key = `${id}:${stage}`;
  if (activeModes.has(id)) return;
  const existing = queuedModes.get(key);
  if (existing) {
    if (mode === 'interactive' && existing === 'background') {
      const item = queue.find((entry) => entry.id === id && entry.stage === stage);
      if (item) { item.mode = 'interactive'; item.stage = 'interactive'; }
      queuedModes.set(key, 'interactive');
    }
    return;
  }
  if (mode === 'background' && Date.now() - (lastAttempt.get(id) ?? 0) < RETRY_COOLDOWN_MS) return;
  const item = { id, mode, stage };
  mode === 'interactive' ? queue.unshift(item) : queue.push(item);
  queuedModes.set(key, mode);
}

export function queueArticleEnrichment(options: { articleId?: string; limit?: number; interactive?: boolean } = {}) {
  if (options.articleId) {
    const mode = options.interactive === false ? 'background' : 'interactive';
    if (mode === 'interactive') db.prepare('UPDATE articles SET enrichment_error=NULL WHERE id=?').run(options.articleId);
    addToQueue(options.articleId, mode, mode === 'interactive' ? 'interactive' : 'summary');
  }
  else {
    const limit = Math.max(1, Math.min(50, options.limit ?? AUTO_BATCH_SIZE));
    if (limit > 0) {
      const rows = db.prepare(`SELECT * FROM articles
        WHERE (summary_zh IS NULL OR title_zh IS NULL OR title_en IS NULL OR length(content_html) < ?)
        AND (enrichment_attempted_at IS NULL OR enrichment_attempted_at < ?)
        ORDER BY importance_score DESC,published_at DESC LIMIT ?`).all(FULLTEXT_THRESHOLD, new Date(Date.now() - RETRY_COOLDOWN_MS).toISOString(), Math.max(limit * 8, 100)) as Array<Record<string, unknown>>;
      const candidates = rows.map(rowToArticle).filter((article) => {
        const needsSummary = !article.summaryZh || !article.titleZh || !article.titleEn;
        const hasUsableText = (articlePlainText(article.contentHtml) || article.excerpt).trim().length >= 40;
        const needsFulltext = articlePlainText(article.contentHtml).length < FULLTEXT_THRESHOLD && fulltextDue(article);
        return (needsSummary && hasUsableText && hasModel('summary')) || needsFulltext;
      }).slice(0, limit);
      // Global two-phase order: finish all bilingual titles first, then start summaries.
      candidates.filter((article) => !article.titleZh || !article.titleEn).forEach((article) => addToQueue(article.id, 'background', 'title'));
      candidates.filter((article) => !article.summaryZh).forEach((article) => addToQueue(article.id, 'background', 'summary'));
    }
  }
  void drainQueue();
  return getArticleEnrichmentStatus();
}

export function getArticleEnrichmentStatus() {
  const currentIds = [...activeModes.keys()];
  const ai = getAIStatus();
  const pausedReason = ai.state === 'error' ? ai.detail || ai.message : undefined;
  return { running, queued: queue.length, currentId: currentIds[0], currentIds, concurrency: ENRICHMENT_CONCURRENCY, processed, failed, lastError, pausedReason };
}

export function resumeArticleEnrichment() {
  db.prepare('UPDATE articles SET enrichment_attempted_at=NULL,enrichment_error=NULL WHERE summary_zh IS NULL').run();
  db.prepare('UPDATE articles SET fulltext_attempted_at=NULL WHERE fulltext_error IS NOT NULL').run();
  lastAttempt.clear(); lastError = undefined;
  return queueArticleEnrichment({ limit: AUTO_BATCH_SIZE });
}

export function compactStoredSummaries() {
  const rows = db.prepare('SELECT id,summary_zh FROM articles WHERE summary_zh IS NOT NULL').all() as Array<{ id: string; summary_zh: string }>;
  const update = db.prepare('UPDATE articles SET summary_zh=? WHERE id=?');
  let changed = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const compact = limitSummaryMarkdown(row.summary_zh, 200);
      if (compact !== row.summary_zh) { update.run(compact, row.id); changed += 1; }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return changed;
}

export function resetArticleEnrichmentForTests() {
  queue.length = 0; queuedModes.clear(); activeModes.clear(); lastAttempt.clear(); running = false; processed = 0; failed = 0; lastError = undefined;
}
