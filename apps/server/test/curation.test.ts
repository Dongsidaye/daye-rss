import { describe, expect, it } from 'vitest';
import { fallbackCuration, parseCuration, selectCurationCandidates } from '../src/curation.js';
import type { Article } from '../src/types.js';

function article(id: string, sourceId: string, score: number, clusterId?: string): Article {
  return {
    id, sourceId, sourceTitle: sourceId, title: `Title ${id}`, titleZh: `标题 ${id}`, titleEn: `Title ${id}`,
    url: `https://example.com/${id}`, publishedAt: `2026-07-15T0${score % 9}:00:00Z`, excerpt: 'excerpt', contentHtml: '<p>body</p>',
    summaryZh: `摘要 ${id}`, topics: ['科技'], importance: score > 80 ? 'high' : 'normal', importanceScore: score,
    importanceReason: `理由 ${id}`, clusterId, status: 'unread', createdAt: '2026-07-15T00:00:00Z'
  };
}

describe('real AI curation boundary', () => {
  it('deduplicates event clusters and caps one source', () => {
    const candidates = selectCurationCandidates([
      article('a', 'same', 99, 'event'), article('b', 'same', 98, 'event'), article('c', 'same', 97),
      article('d', 'same', 96), article('e', 'same', 95), article('f', 'same', 94), article('g', 'other', 93)
    ]);
    expect(candidates.filter((item) => item.sourceId === 'same')).toHaveLength(4);
    expect(candidates.filter((item) => item.clusterId === 'event')).toHaveLength(1);
    expect(candidates.some((item) => item.id === 'g')).toBe(true);
  });

  it('rejects fabricated or duplicate IDs returned by a model', () => {
    const items = parseCuration(JSON.stringify({ items: [
      { id: 'a', reason: '影响开发流程' }, { id: 'missing', reason: '不存在' },
      { id: 'a', reason: '重复' }, { id: 'b', reason: '影响市场' }, { id: 'c', reason: '重要更新' }
    ] }), new Set(['a', 'b', 'c']));
    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns a small rules-based subset rather than selecting every article', () => {
    const articles = Array.from({ length: 30 }, (_, index) => article(String(index), `source-${index % 6}`, 100 - index));
    expect(fallbackCuration(articles)).toHaveLength(9);
  });
});
