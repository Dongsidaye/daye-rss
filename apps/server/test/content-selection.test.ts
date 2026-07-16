import { describe, expect, it } from 'vitest';
import { chooseOrMergeArticleHtml, contentText, extractStructuredArticleHtml } from '../src/content-selection.js';

describe('content candidate selection', () => {
  it('extracts a long hydrated article instead of accepting the short rendered shell', () => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', value: `Paragraph ${index + 1} contains the complete reported story with enough distinct context, evidence, names, dates, and consequences for a reliable reader extraction.` }] }));
    const html = `<article><p>Only a short teaser is rendered.</p></article><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { story: { body: { content: paragraphs } } } } })}</script>`;
    const extracted = extractStructuredArticleHtml(html);
    expect(extracted).toBeTruthy();
    expect(contentText(extracted!)).toContain('Paragraph 12');
    expect(contentText(extracted!).length).toBeGreaterThan(1_000);
  });

  it('never replaces richer RSS content with a shorter web fragment', () => {
    const rss = `<p>${'RSS source detail '.repeat(100)}</p>`;
    const web = '<p>Short paywall teaser.</p>';
    expect(chooseOrMergeArticleHtml(rss, web)).toBe(rss);
  });
});
