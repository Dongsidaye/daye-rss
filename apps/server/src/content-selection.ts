import sanitizeHtml from 'sanitize-html';

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function contentText(value: string) {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}

function collectParagraphs(value: unknown, output: string[], depth = 0) {
  if (depth > 16 || value == null) return;
  if (typeof value === 'string') {
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length >= 35 && !/^https?:\/\//i.test(text)) output.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectParagraphs(item, output, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.content)) {
    const inline: string[] = [];
    const collectInline = (node: unknown): void => {
      if (typeof node === 'string') { inline.push(node); return; }
      if (Array.isArray(node)) { node.forEach(collectInline); return; }
      if (!node || typeof node !== 'object') return;
      const item = node as Record<string, unknown>;
      if (typeof item.value === 'string') inline.push(item.value);
      else if (typeof item.text === 'string') inline.push(item.text);
      else if (item.content) collectInline(item.content);
    };
    collectInline(record.content);
    const joined = inline.join('').replace(/\s+/g, ' ').trim();
    if (joined.length >= 35) { output.push(joined); return; }
  }
  const preferred = ['text', 'value', 'articleBody', 'description', 'dek', 'content'];
  const matched = preferred.filter((key) => key in record);
  if (matched.length) {
    for (const key of matched) collectParagraphs(record[key], output, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (/^(?:style|css|url|href|src|id|type|slug|image|media|tracking|analytics)$/i.test(key)) continue;
    collectParagraphs(child, output, depth + 1);
  }
}

function uniqueParagraphs(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 180);
    if (key.length < 25 || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function extractStructuredArticleHtml(html: string) {
  const candidates: string[][] = [];
  const scriptPattern = /<script\b[^>]*(?:id=["']__NEXT_DATA__["']|type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      const parsed = JSON.parse(match[1]);
      const roots: unknown[] = [];
      const record = parsed as Record<string, any>;
      if (record?.props?.pageProps?.story?.body?.content) roots.push(record.props.pageProps.story.body.content);
      if (record?.articleBody) roots.push(record.articleBody);
      if (!roots.length) roots.push(parsed);
      for (const root of roots) {
        const paragraphs: string[] = [];
        collectParagraphs(root, paragraphs);
        const unique = uniqueParagraphs(paragraphs);
        if (unique.length >= 3) candidates.push(unique);
      }
    } catch { /* Ignore malformed hydration scripts. */ }
  }
  const best = candidates.sort((a, b) => b.join(' ').length - a.join(' ').length)[0];
  if (!best || best.join(' ').length < 800) return undefined;
  return best.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('');
}

export function chooseOrMergeArticleHtml(currentHtml: string, extractedHtml: string) {
  const currentText = contentText(currentHtml);
  const extractedText = contentText(extractedHtml);
  if (!currentText) return extractedHtml;
  if (!extractedText) return currentHtml;
  const currentKey = currentText.toLowerCase().replace(/\s+/g, ' ');
  const extractedKey = extractedText.toLowerCase().replace(/\s+/g, ' ');
  if (extractedKey.includes(currentKey) || extractedText.length >= currentText.length * 1.8) return extractedHtml;
  if (currentKey.includes(extractedKey) || currentText.length >= extractedText.length * 1.8) return currentHtml;
  return `${extractedHtml}<hr><h2>RSS 来源补充</h2>${currentHtml}`;
}
