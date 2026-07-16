import sanitizeHtml from 'sanitize-html';

export function articlePlainText(html: string) {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}

export function articleParagraphs(html: string, fallback = '') {
  const raw = [...html.matchAll(/<(?:p|h[1-4]|li|blockquote)[^>]*>([\s\S]*?)<\/(?:p|h[1-4]|li|blockquote)>/gi)]
    .map((match) => ({ tag: match[0].match(/^<([a-z0-9]+)/i)?.[1]?.toLowerCase() ?? 'p', text: articlePlainText(match[1]) }))
    .filter((item) => Boolean(item.text));
  if (!raw.length && fallback.trim()) raw.push({ tag: 'p', text: fallback.trim() });
  const paragraphs: Array<{ tag: string; text: string }> = [];
  for (const item of raw) {
    const previous = paragraphs.at(-1);
    const fragments = previous && ['p', 'blockquote'].includes(previous.tag) && ['p', 'blockquote'].includes(item.tag) && !/[.!?。！？][”"']?$/.test(previous.text);
    if (fragments && previous.text.length + item.text.length < 1_200) previous.text = `${previous.text} ${item.text}`;
    else paragraphs.push({ ...item });
  }
  const selected: string[] = [];
  let characters = 0;
  for (const paragraph of paragraphs) {
    if (selected.length >= 240 || characters + paragraph.text.length > 120_000) break;
    selected.push(paragraph.text);
    characters += paragraph.text.length;
  }
  return selected;
}
