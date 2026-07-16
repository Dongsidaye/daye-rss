import { describe, expect, it } from 'vitest';
import { articleReadingMinutes, readingMinutesForText } from './reading-time';

describe('dynamic article reading time', () => {
  it('uses Chinese character volume', () => {
    expect(readingMinutesForText('中'.repeat(700))).toBe(2);
  });

  it('uses English word volume', () => {
    expect(readingMinutesForText(Array.from({ length: 440 }, (_, index) => `word${index}`).join(' '))).toBe(2);
  });

  it('does not count HTML markup as article content', () => {
    expect(articleReadingMinutes({ contentHtml: `<article class="${'layout-token '.repeat(500)}"><p>很短的正文。</p></article>`, excerpt: '' })).toBe(1);
  });

  it('falls back to the feed excerpt when full text is unavailable', () => {
    expect(articleReadingMinutes({ contentHtml: '', excerpt: '中'.repeat(701) })).toBe(3);
  });
});
