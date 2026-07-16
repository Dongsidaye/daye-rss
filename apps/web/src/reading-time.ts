import type { Article } from './types';

const CJK_PER_MINUTE = 350;
const LATIN_WORDS_PER_MINUTE = 220;

export function articleReadableText(article: Pick<Article, 'contentHtml' | 'excerpt'>) {
  const content = article.contentHtml
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return content || article.excerpt.replace(/\s+/g, ' ').trim();
}

export function readingMinutesForText(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 1;
  const cjkCount = normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
  const latinText = normalized.replace(/[\u3400-\u9fff\uf900-\ufaff]/gu, ' ');
  const latinWords = latinText.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return Math.max(1, Math.ceil(cjkCount / CJK_PER_MINUTE + latinWords / LATIN_WORDS_PER_MINUTE));
}

export function articleReadingMinutes(article: Pick<Article, 'contentHtml' | 'excerpt'>) {
  return readingMinutesForText(articleReadableText(article));
}
