const markdownPatterns: Array<[RegExp, string]> = [
  [/```[\s\S]*?```/g, ' '],
  [/`([^`]+)`/g, '$1'],
  [/!\[[^\]]*\]\([^)]*\)/g, ' '],
  [/\[([^\]]+)\]\([^)]*\)/g, '$1'],
  [/(^|\n)\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s*/g, '$1'],
  [/[*_~]/g, '']
];

function codePoints(value: string) {
  return [...value];
}

/**
 * Keeps compliant Markdown intact. If a model ignores the requested budget,
 * it falls back to safe plain text so truncation cannot leave broken markup.
 */
export function limitSummaryMarkdown(value: string, maxCharacters = 200) {
  const max = Math.max(1, Math.floor(maxCharacters));
  const normalized = value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (codePoints(normalized).length <= max) return normalized;

  const plain = markdownPatterns.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), normalized)
    .replace(/\s+/g, ' ')
    .trim();
  if (codePoints(plain).length <= max) return plain;
  if (max === 1) return '…';
  return `${codePoints(plain).slice(0, max - 1).join('').trimEnd()}…`;
}
