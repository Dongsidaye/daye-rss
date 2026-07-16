import { createHash, randomUUID } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import sanitizeHtml from 'sanitize-html';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { marked } from 'marked';
import { db, rowToSource } from './db.js';
import { safeFetchText } from './security.js';
import type { Importance, Source } from './types.js';
import { chooseOrMergeArticleHtml, contentText, extractStructuredArticleHtml } from './content-selection.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: false, trimValues: true });
const allowedTags = ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'code', 'pre', 'figure', 'figcaption', 'img', 'a', 'video', 'audio', 'source'];
const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags, allowedAttributes: { a: ['href', 'title', 'rel', 'target'], img: ['src', 'alt', 'width', 'height', 'loading', 'referrerpolicy'], video: ['src', 'controls', 'poster'], audio: ['src', 'controls'], source: ['src', 'type'] },
  allowedSchemes: ['http', 'https'], transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noreferrer noopener', target: '_blank' }),
    img: sanitizeHtml.simpleTransform('img', { loading: 'lazy', referrerpolicy: 'no-referrer' })
  }
};

function list<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object') return text((value as Record<string, unknown>)['#text'] ?? (value as Record<string, unknown>).cdata);
  return '';
}
function resolveUrl(value: string | undefined, base: string) { try { return value ? new URL(value, base).toString() : undefined; } catch { return undefined; } }
function stripHtml(value: string) { return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim(); }

function sanitizeArticleHtml(value: string, base: string) {
  return sanitizeHtml(value, {
    ...sanitizeOptions,
    transformTags: {
      a: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs, rel: 'noreferrer noopener', target: '_blank' };
        const href = resolveUrl(attribs.href, base); if (href) next.href = href; else delete next.href;
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs, loading: 'lazy', referrerpolicy: 'no-referrer' };
        const src = resolveUrl(attribs.src, base); if (src) next.src = src; else delete next.src;
        return { tagName, attribs: next };
      }
    }
  });
}

export function extractObsidianPreloadUrl(html: string) {
  const match = html.match(/window\.preloadPage\s*=\s*f\(\s*("(?:\\.|[^"\\])*")\s*\)/);
  if (!match?.[1]) return undefined;
  try {
    const raw = JSON.parse(match[1]) as string;
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !/(^|\.)obsidian\.md$/i.test(url.hostname) || !url.pathname.includes('/access/') || !url.pathname.endsWith('.md')) return undefined;
    return url.toString();
  } catch { return undefined; }
}

export function renderMarkdownArticle(markdown: string, base: string) {
  return sanitizeArticleHtml(marked.parse(markdown, { gfm: true, async: false }) as string, base);
}
function imageFromHtml(value: string, base: string) {
  const match = value.match(/<img\b[^>]*\b(?:src|data-src)=["']([^"']+)["']/i);
  return resolveUrl(match?.[1], base);
}
function normalizeTitle(title: string) { return title.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '').slice(0, 72); }
function clusterId(title: string, publishedAt: string) { return createHash('sha256').update(`${normalizeTitle(title)}:${publishedAt.slice(0, 10)}`).digest('hex').slice(0, 16); }

const topicRules: Array<[string, RegExp]> = [
  ['人工智能', /\b(ai|llm|gpt|gemini|claude|人工智能|大模型|机器学习)\b/i],
  ['芯片', /nvidia|amd|intel|芯片|半导体|gpu/i],
  ['市场', /stock|market|earnings|股票|市场|财报|融资|并购/i],
  ['政策', /policy|regulation|government|政策|监管|法规/i],
  ['安全', /security|breach|vulnerability|安全|漏洞|攻击/i],
  ['研究', /research|paper|study|论文|研究|实验/i]
];

export function classify(title: string, body: string, sourceQuality = 80) {
  const sample = `${title} ${body.slice(0, 1200)}`;
  const topics = topicRules.filter(([, rule]) => rule.test(sample)).map(([name]) => name);
  const monitors = (db.prepare('SELECT query,topics_json,importance FROM monitors WHERE enabled=1').all() as Array<{ query: string; topics_json: string; importance: Importance }>);
  let score = Math.min(30, sourceQuality * 0.3) + 20;
  const reasons: string[] = [];
  if (/breaking|urgent|重大|突发|宣布|正式发布|acquisition|ban|breach/i.test(title)) { score += 22; reasons.push('包含重大事件信号'); }
  if (/report|official|官方|监管|法院|财报|发布/i.test(sample)) { score += 10; reasons.push('来源内容具有决策价值'); }
  for (const monitor of monitors) {
    const terms = monitor.query.split(/[\s,，]+/).filter((term) => term.length > 1);
    if (terms.some((term) => sample.toLowerCase().includes(term.toLowerCase()))) { score += monitor.importance === 'critical' ? 30 : 20; reasons.push(`命中监控：${monitor.query}`); }
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const importance: Importance = score >= 85 ? 'critical' : score >= 68 ? 'high' : score >= 42 ? 'normal' : 'low';
  return { topics: topics.length ? topics : ['综合'], score, importance, reason: reasons.join('；') || '来自已订阅来源的常规更新' };
}

type FeedItem = Record<string, unknown>;
function parseDocument(xml: string, feedUrl: string) {
  const doc = parser.parse(xml) as Record<string, any>;
  const channel = doc.rss?.channel ?? doc['rdf:RDF'] ?? doc.feed;
  if (!channel) throw new Error('Unsupported or invalid RSS/Atom document');
  const isAtom = Boolean(doc.feed);
  const items = list<FeedItem>(isAtom ? channel.entry : channel.item);
  const feedTitle = text(channel.title) || new URL(feedUrl).hostname;
  const siteLink = isAtom ? list(channel.link).find((link: any) => link?.['@_rel'] !== 'self')?.['@_href'] : text(channel.link);
  return { feedTitle, siteUrl: resolveUrl(siteLink, feedUrl), items: items.map((item) => {
    const links = list<any>(item.link);
    const rawLink = isAtom ? links.find((link) => !link?.['@_rel'] || link?.['@_rel'] === 'alternate')?.['@_href'] ?? text(item.link) : text(item.link) || text(item.guid);
    const content = text(item['content:encoded'] ?? item.content ?? item.description ?? item.summary);
    const enclosures = list<Record<string, string>>(item.enclosure as Record<string, string> | Record<string, string>[] | undefined);
    const mediaItems = list<Record<string, string>>(item['media:content'] as Record<string, string> | Record<string, string>[] | undefined);
    const thumbnails = list<Record<string, string>>(item['media:thumbnail'] as Record<string, string> | Record<string, string>[] | undefined);
    const enclosureImage = enclosures.find((entry) => entry['@_type']?.toLowerCase().startsWith('image/'));
    const enclosureMedia = enclosures.find((entry) => !entry['@_type']?.toLowerCase().startsWith('image/'));
    const mediaImage = mediaItems.find((entry) => entry['@_medium'] === 'image' || entry['@_type']?.toLowerCase().startsWith('image/'));
    const mediaPlayable = mediaItems.find((entry) => entry !== mediaImage);
    const published = text(item.pubDate ?? item.published ?? item.updated ?? item['dc:date']);
    return {
      title: stripHtml(text(item.title)) || '无标题', url: resolveUrl(rawLink, feedUrl), author: stripHtml(text(item.author ?? item['dc:creator'])),
      publishedAt: Number.isNaN(Date.parse(published)) ? new Date().toISOString() : new Date(published).toISOString(), content,
      imageUrl: resolveUrl(thumbnails[0]?.['@_url'] ?? mediaImage?.['@_url'] ?? enclosureImage?.['@_url'], feedUrl) ?? imageFromHtml(content, feedUrl),
      mediaUrl: resolveUrl(enclosureMedia?.['@_url'] ?? mediaPlayable?.['@_url'], feedUrl)
    };
  }).filter((item) => item.url) };
}

export async function refreshSource(source: Source) {
  try {
    const xml = await safeFetchText(source.url);
    const parsed = parseDocument(xml, source.url);
    db.prepare('UPDATE sources SET title=?,site_url=?,last_fetched_at=?,last_error=NULL WHERE id=?').run(parsed.feedTitle, parsed.siteUrl ?? null, new Date().toISOString(), source.id);
    let inserted = 0;
    for (const item of parsed.items.slice(0, 100)) {
      const clean = sanitizeHtml(item.content, sanitizeOptions);
      const plain = stripHtml(clean);
      const exists = db.prepare('SELECT id,content_html,image_url FROM articles WHERE url=?').get(item.url!) as { id: string; content_html: string; image_url?: string } | undefined;
      if (exists) {
        const merged = chooseOrMergeArticleHtml(exists.content_html || '', clean);
        if (contentText(merged).length > contentText(exists.content_html || '').length || (!exists.image_url && item.imageUrl)) {
          db.prepare('UPDATE articles SET source_title=?,content_html=?,excerpt=?,image_url=COALESCE(image_url,?) WHERE id=?')
            .run(parsed.feedTitle, merged, contentText(merged).slice(0, 420), item.imageUrl ?? null, exists.id);
        }
        continue;
      }
      const classification = classify(item.title, plain, source.qualityScore);
      const id = randomUUID();
      const itemUrl = item.url!;
      db.prepare(`INSERT INTO articles(id,source_id,source_title,title,url,author,published_at,excerpt,content_html,image_url,media_url,topics_json,importance,importance_score,importance_reason,cluster_id,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, source.id, parsed.feedTitle, item.title, itemUrl, item.author || null, item.publishedAt, plain.slice(0, 420), clean, item.imageUrl ?? null, item.mediaUrl ?? null, JSON.stringify(classification.topics), classification.importance, classification.score, classification.reason, clusterId(item.title, item.publishedAt), 'unread', new Date().toISOString());
      inserted += 1;
    }
    return { inserted, title: parsed.feedTitle };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown feed error';
    db.prepare('UPDATE sources SET last_fetched_at=?,last_error=? WHERE id=?').run(new Date().toISOString(), message, source.id);
    throw error;
  }
}

export async function extractFullArticle(url: string) {
  const html = await safeFetchText(url, 3_000_000);
  const { document } = parseHTML(html);
  Object.defineProperty(document, 'documentURI', { value: url, configurable: true });
  const parsed = new Readability(document as unknown as Document, { charThreshold: 120 }).parse();
  const candidates: Array<{ contentHtml: string; textLength: number }> = [];
  if (parsed?.content && parsed.textContent && parsed.textContent.trim().length >= 120) {
    const contentHtml = sanitizeArticleHtml(parsed.content, url);
    candidates.push({ contentHtml, textLength: contentText(contentHtml).length });
  }
  const structured = extractStructuredArticleHtml(html);
  if (structured) candidates.push({ contentHtml: sanitizeArticleHtml(structured, url), textLength: contentText(structured).length });

  // Obsidian Publish returns a small client shell; the real article is exposed
  // as a same-service Markdown preload. Strict host/path checks prevent SSRF.
  const preloadUrl = extractObsidianPreloadUrl(html);
  if (preloadUrl) {
    const markdown = await safeFetchText(preloadUrl, 3_000_000);
    const plain = markdown.replace(/^---[\s\S]*?---\s*/m, '').replace(/[`#>*_\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (plain.length >= 120) {
      const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || document.title || new URL(url).pathname.split('/').filter(Boolean).at(-1) || '文章';
      candidates.push({ contentHtml: renderMarkdownArticle(markdown, url), textLength: plain.length });
    }
  }

  const best = candidates.sort((a, b) => b.textLength - a.textLength)[0];
  if (best) return { title: parsed?.title || document.title, byline: parsed?.byline || null, excerpt: contentText(best.contentHtml).slice(0, 320), ...best };

  throw new Error('原网页没有可提取的正文，可能需要登录或该站点尚不支持阅读模式');
}

export async function refreshDueSources(force = false) {
  const sources = (db.prepare('SELECT * FROM sources WHERE enabled=1').all() as Record<string, unknown>[]).map(rowToSource);
  const due = sources.filter((source) => force || !source.lastFetchedAt || Date.now() - Date.parse(source.lastFetchedAt) >= source.refreshMinutes * 60_000);
  const results: Array<{ sourceId: string; ok: boolean; [key: string]: unknown }> = [];
  for (let index = 0; index < due.length; index += 8) {
    const batch = await Promise.all(due.slice(index, index + 8).map(async (source) => {
      try { return { sourceId: source.id, ok: true, ...(await refreshSource(source)) }; }
      catch (error) { return { sourceId: source.id, ok: false, error: error instanceof Error ? error.message : 'Unknown error' }; }
    }));
    results.push(...batch);
  }
  return results;
}

export function parseOpml(xml: string) {
  const doc = parser.parse(xml) as Record<string, any>;
  const roots = list<any>(doc.opml?.body?.outline);
  const found: Array<{ title: string; url: string; category: string }> = [];
  const walk = (nodes: any[], category = '未分类') => nodes.forEach((node) => {
    const nextCategory = node['@_xmlUrl'] ? category : node['@_title'] ?? node['@_text'] ?? category;
    if (node['@_xmlUrl']) found.push({ title: node['@_title'] ?? node['@_text'] ?? new URL(node['@_xmlUrl']).hostname, url: node['@_xmlUrl'], category });
    if (node.outline) walk(list(node.outline), nextCategory);
  });
  walk(roots);
  return found;
}

export function exportOpml(sources: Source[]) {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>大爷的 RSS</title></head><body>${sources.map((source) => `<outline type="rss" text="${escape(source.title)}" title="${escape(source.title)}" xmlUrl="${escape(source.url)}"/>`).join('')}</body></opml>`;
}
