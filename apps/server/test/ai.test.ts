import { describe, expect, it } from 'vitest';
import { parseArticleAnalysis, roleConcurrencyLimit, safeAIError, sortModelsForRole, temperatureForProvider } from '../src/ai.js';
import type { ModelConfig } from '../src/types.js';
import { limitSummaryMarkdown } from '../src/summary-format.js';

describe('AI provider compatibility', () => {
  it('uses the only temperature accepted by Kimi Coding Plan', () => {
    expect(temperatureForProvider('kimi-coding')).toBe(1);
  });

  it('keeps the standard temperature for other compatible providers', () => {
    expect(temperatureForProvider('openai')).toBe(0.2);
    expect(temperatureForProvider('custom')).toBe(0.2);
  });

  it('classifies a quota-style HTTP 403 as quota rather than a bad key', () => {
    expect(safeAIError(['Kimi Coding Plan 返回 403: access_terminated: usage limit for billing cycle']).kind).toBe('quota');
  });

  it('gives DeepSeek translation an isolated high-concurrency pool', () => {
    expect(roleConcurrencyLimit('translation', 'deepseek')).toBeGreaterThanOrEqual(64);
    expect(roleConcurrencyLimit('analysis', 'deepseek')).toBe(4);
    expect(roleConcurrencyLimit('translation', 'kimi-coding')).toBe(8);
  });

  it('routes each function to its own enabled priority chain', () => {
    const models: ModelConfig[] = [
      { id: 'kimi', provider: 'kimi-coding', label: 'Kimi', model: 'kimi-for-coding', encryptedApiKey: 'x', roles: ['analysis'], enabled: true, priority: 20 },
      { id: 'deepseek', provider: 'deepseek', label: 'DeepSeek', model: 'deepseek-v4-flash', encryptedApiKey: 'x', roles: ['summary', 'translation'], enabled: true, priority: 10 },
      { id: 'disabled', provider: 'openai', label: 'Disabled', model: 'gpt', encryptedApiKey: 'x', roles: ['summary'], enabled: false, priority: 1 }
    ];
    expect(sortModelsForRole(models, 'summary').map((model) => model.id)).toEqual(['deepseek']);
    expect(sortModelsForRole(models, 'translation').map((model) => model.id)).toEqual(['deepseek']);
    expect(sortModelsForRole(models, 'analysis').map((model) => model.id)).toEqual(['kimi']);
  });
});

describe('Chinese summary length guard', () => {
  it('preserves concise Markdown', () => {
    const summary = '**结论** 信息发生变化。\n- 要点一\n- 关注：需要核对来源';
    expect(limitSummaryMarkdown(summary)).toBe(summary);
  });

  it('hard-limits non-compliant model output to 200 Unicode characters', () => {
    const summary = `**一句话结论**\n\n${'很长的摘要内容'.repeat(80)}`;
    const result = limitSummaryMarkdown(summary);
    expect([...result].length).toBeLessThanOrEqual(200);
    expect(result.endsWith('…')).toBe(true);
    expect(result).not.toContain('**');
  });

  it('honors smaller edge-case budgets', () => {
    expect(limitSummaryMarkdown('abcdef', 1)).toBe('…');
    expect([...limitSummaryMarkdown('😀'.repeat(20), 8)].length).toBe(8);
  });
});

describe('bilingual article analysis parsing', () => {
  it('parses bilingual titles and preserves a compact Markdown summary', () => {
    const result = parseArticleAnalysis(JSON.stringify({
      titleZh: 'Windows 11 延长更新暂停期',
      titleEn: 'Windows 11 extends update pause controls',
      summaryMarkdown: '**结论** 更新控制更灵活。\n- 最长暂停35天\n- 可重复延期\n- 关注：安全补丁滞后'
    }), 'Windows 11 update changes');
    expect(result.titleZh).toBe('Windows 11 延长更新暂停期');
    expect(result.titleEn).toContain('Windows 11');
    expect([...result.summary].length).toBeLessThanOrEqual(200);
  });

  it('uses the original title for the language already present', () => {
    const result = parseArticleAnalysis('{"titleZh":"中文原标题","titleEn":"English translation","summaryMarkdown":"短摘要"}', '中文原标题');
    expect(result.titleZh).toBe('中文原标题');
  });

  it('rejects malformed provider output instead of storing broken titles', () => {
    expect(() => parseArticleAnalysis('not json', 'Original title')).toThrow('双语标题');
  });
});
