import type { Article } from './types.js';

export type CurationItem = { id: string; reason: string };

export function selectCurationCandidates(articles: Article[], limit = 18) {
  const seen = new Set<string>();
  const sourceCounts = new Map<string, number>();
  return [...articles]
    .filter((article) => article.summaryZh && article.titleZh)
    .sort((a, b) => b.importanceScore - a.importanceScore || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter((article) => {
      const identity = article.clusterId || article.url;
      const sourceCount = sourceCounts.get(article.sourceId) ?? 0;
      if (seen.has(identity) || sourceCount >= 4) return false;
      seen.add(identity);
      sourceCounts.set(article.sourceId, sourceCount + 1);
      return true;
    })
    .slice(0, limit);
}

export function fallbackCuration(articles: Article[], limit = 9): CurationItem[] {
  const seen = new Set<string>(); const sourceCounts = new Map<string, number>();
  return [...articles]
    .sort((a, b) => b.importanceScore - a.importanceScore || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter((article) => {
      const identity = article.clusterId || article.url; const count = sourceCounts.get(article.sourceId) ?? 0;
      if (seen.has(identity) || count >= 3) return false;
      seen.add(identity); sourceCounts.set(article.sourceId, count + 1); return true;
    }).slice(0, limit).map((article) => ({
    id: article.id,
    reason: article.importanceReason || (article.importance === 'critical' || article.importance === 'high' ? '高重要性资讯' : '近期高价值更新')
  }));
}

export function parseCuration(raw: string, allowedIds: Set<string>, limit = 9): CurationItem[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(cleaned) as { items?: Array<{ id?: unknown; reason?: unknown }> };
  const seen = new Set<string>();
  const items = (parsed.items ?? []).flatMap((item) => {
    const id = String(item.id ?? '');
    if (!allowedIds.has(id) || seen.has(id)) return [];
    seen.add(id);
    return [{ id, reason: [...String(item.reason ?? '值得关注').replace(/\s+/g, ' ').trim()].slice(0, 36).join('') }];
  }).slice(0, limit);
  if (items.length < Math.min(3, allowedIds.size)) throw new Error('AI 精选结果不足');
  return items;
}
