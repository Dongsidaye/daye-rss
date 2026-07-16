import { describe, expect, it } from 'vitest';
import { articleParagraphs, articlePlainText } from '../src/article-content.js';
import { mapConcurrent } from '../src/concurrency.js';
import { fulltextRetryDelay, parseTranslationChunk, shouldGenerateFullTranslation } from '../src/article-processing.js';

describe('article enrichment inputs', () => {
  it('extracts substantially more than a feed excerpt while preserving paragraph order', () => {
    const html = '<h2>Section</h2><p>First <strong>complete</strong> paragraph.</p><blockquote>Second paragraph.</blockquote><p>Third paragraph.</p>';
    expect(articleParagraphs(html)).toEqual(['Section', 'First complete paragraph.', 'Second paragraph.', 'Third paragraph.']);
  });

  it('removes executable markup before content is sent to a model', () => {
    expect(articlePlainText('<p>Useful text</p><script>steal()</script>')).toBe('Useful text');
  });

  it('processes translation chunks concurrently while preserving their original order', async () => {
    let active = 0; let peak = 0;
    const result = await mapConcurrent([40, 5, 20, 10], 3, async (delay, index) => {
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1; return index;
    });
    expect(peak).toBe(3);
    expect(result).toEqual([0, 1, 2, 3]);
  });

  it('never generates full translation in the background queue', () => {
    expect(shouldGenerateFullTranslation('background')).toBe(false);
    expect(shouldGenerateFullTranslation('interactive')).toBe(true);
  });

  it('accepts strict JSON and safe single-paragraph plain text from translation models', () => {
    expect(parseTranslationChunk('{"translations":["第一段","第二段"]}', 2)).toEqual(['第一段', '第二段']);
    expect(parseTranslationChunk('译文：这是单段译文', 1)).toEqual(['这是单段译文']);
    expect(parseTranslationChunk('以下是翻译：\n```json\n{"translations":["被代码围栏包装的译文"]}\n```\n完成。', 1)).toEqual(['被代码围栏包装的译文']);
    expect(parseTranslationChunk('模型说明在前。\n{"translation":"带说明文字的译文"}\n模型说明在后。', 1)).toEqual(['带说明文字的译文']);
    expect(parseTranslationChunk('["数组格式译文"]', 1)).toEqual(['数组格式译文']);
    expect(parseTranslationChunk('{broken json', 1)).toEqual([]);
  });

  it('backs off repeated full-text failures without retrying forever', () => {
    expect(fulltextRetryDelay(1)).toBe(30 * 60_000);
    expect(fulltextRetryDelay(2)).toBe(60 * 60_000);
    expect(fulltextRetryDelay(20)).toBe(24 * 60 * 60_000);
  });
});
