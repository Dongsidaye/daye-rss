import { DOMParser } from 'linkedom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Source } from './types';

beforeAll(() => vi.stubGlobal('DOMParser', DOMParser));

describe('Android local RSS boundary', () => {
  it('blocks local-network and unsafe feed targets', async () => {
    const { validateRemoteUrl } = await import('./local-api');
    expect(() => validateRemoteUrl('https://127.0.0.1/feed')).toThrow(/局域网/);
    expect(() => validateRemoteUrl('https://192.168.1.2/feed')).toThrow(/局域网/);
    expect(() => validateRemoteUrl('https://[::ffff:127.0.0.1]/feed')).toThrow(/局域网/);
    expect(() => validateRemoteUrl('http://example.com/feed')).toThrow(/HTTPS/);
    expect(() => validateRemoteUrl('https://example.com:8443/feed')).toThrow(/标准/);
    expect(validateRemoteUrl('https://example.com/feed')).toBe('https://example.com/feed');
  });

  it('parses RSS while removing executable markup', async () => {
    const { parseFeed } = await import('./local-api');
    const source: Source = { id: 'source-1', title: '测试源', url: 'https://example.com/feed', category: '测试', enabled: true, refreshMinutes: 60, qualityScore: 80, createdAt: new Date().toISOString() };
    const parsed = parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel><title>安全测试</title><link>https://example.com</link><item><title>重大 AI 芯片更新</title><link>/a</link><pubDate>Sun, 13 Jul 2026 01:00:00 GMT</pubDate><description><![CDATA[<p onclick="steal()">正文</p><script>alert(1)</script>]]></description></item></channel></rss>`, source, []);
    expect(parsed.articles).toHaveLength(1);
    expect(parsed.articles[0].url).toBe('https://example.com/a');
    expect(parsed.articles[0].contentHtml).not.toMatch(/script|onclick/i);
    expect(parsed.articles[0].importanceScore).toBeGreaterThan(60);
  });

  it('uses article-owned feed imagery instead of a fixed app image', async () => {
    const { parseFeed } = await import('./local-api');
    const source: Source = { id: 'source-2', title: '图片源', url: 'https://example.com/feed', category: '测试', enabled: true, refreshMinutes: 60, qualityScore: 80, createdAt: new Date().toISOString() };
    const parsed = parseFeed(`<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>图片测试</title><link>https://example.com</link><item><title>文章配图</title><link>/story</link><description><![CDATA[<p>正文</p>]]></description><media:thumbnail url="https://cdn.example.com/story.jpg" /></item></channel></rss>`, source, []);
    expect(parsed.articles[0].imageUrl).toBe('https://cdn.example.com/story.jpg');
  });

  it('normalizes Kimi Coding Plan base and full endpoint URLs', async () => {
    const { modelEndpoint } = await import('./local-api');
    const base = { id: 'kimi', provider: 'kimi-coding', label: 'Kimi', model: 'kimi-for-coding', roles: ['analysis' as const], enabled: true, priority: 10, hasApiKey: true };
    expect(modelEndpoint(base)).toBe('https://api.kimi.com/coding/v1/chat/completions');
    expect(modelEndpoint({ ...base, provider: 'custom', baseUrl: 'https://api.kimi.com/coding/v1/chat/completions' })).toBe('https://api.kimi.com/coding/v1/chat/completions');
  });

  it('uses the only temperature accepted by Kimi Coding Plan', async () => {
    const { openAiRequestData } = await import('./local-api');
    const base = { id: 'model', label: 'Model', model: 'kimi-for-coding', roles: ['analysis' as const], enabled: true, priority: 10, hasApiKey: true };
    expect(openAiRequestData({ ...base, provider: 'kimi-coding' }, 'system', 'input').temperature).toBe(1);
    expect(openAiRequestData({ ...base, provider: 'openai' }, 'system', 'input').temperature).toBe(0.2);
  });

  it('uses a high but device-safe DeepSeek translation concurrency', async () => {
    const { localTranslationConcurrency, parseLocalTranslationChunk } = await import('./local-api');
    expect(localTranslationConcurrency('deepseek')).toBe(32);
    expect(localTranslationConcurrency('kimi-coding')).toBe(8);
    expect(parseLocalTranslationChunk('说明：\n```json\n{"translations":["移动端译文"]}\n```', 1)).toEqual(['移动端译文']);
    expect(parseLocalTranslationChunk('{"translations":["第一段","第二段"]}', 2)).toEqual(['第一段', '第二段']);
  });
});
