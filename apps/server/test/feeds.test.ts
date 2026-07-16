import { describe, expect, it } from 'vitest';
import { classify, exportOpml, extractObsidianPreloadUrl, parseOpml, renderMarkdownArticle } from '../src/feeds.js';

describe('feed domain logic', () => {
  it('imports nested OPML groups', () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><body><outline text="科技"><outline text="Example" xmlUrl="https://example.com/feed.xml"/></outline></body></opml>`;
    expect(parseOpml(xml)).toEqual([{ title: 'Example', url: 'https://example.com/feed.xml', category: '科技' }]);
  });

  it('exports valid OPML without allowing XML injection', () => {
    const xml = exportOpml([{ id: '1', title: 'A & B', url: 'https://example.com/?a=1&b=2', category: '科技', enabled: true, refreshMinutes: 60, qualityScore: 80, createdAt: new Date().toISOString() }]);
    expect(xml).toContain('A &amp; B');
    expect(xml).toContain('&amp;b=2');
  });

  it('raises importance for explicit breaking security events', () => {
    const result = classify('重大：AI 芯片安全漏洞正式发布', '官方报告确认该漏洞影响多个产品', 95);
    expect(result.score).toBeGreaterThanOrEqual(68);
    expect(result.topics).toContain('人工智能');
    expect(result.topics).toContain('安全');
  });

  it('accepts only the trusted Obsidian Markdown preload endpoint', () => {
    const valid = 'window.preloadPage=f("https://publish-01.obsidian.md/access/abc123/coding/tips/rust-and-react.md")';
    const attacker = 'window.preloadPage=f("https://attacker.example/access/abc123/secret.md")';
    expect(extractObsidianPreloadUrl(valid)).toBe('https://publish-01.obsidian.md/access/abc123/coding/tips/rust-and-react.md');
    expect(extractObsidianPreloadUrl(attacker)).toBeUndefined();
  });

  it('renders dynamic Markdown as sanitized article HTML', () => {
    const html = renderMarkdownArticle('# Title\n\nReal body.\n\n<script>alert(1)</script>\n\n[Source](/source)', 'https://example.com/post');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('https://example.com/source');
  });
});
