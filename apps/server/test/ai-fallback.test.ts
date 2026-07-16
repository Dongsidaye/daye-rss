import { describe, expect, it, vi } from 'vitest';
import { runWithModelFallback, safeAIError } from '../src/ai.js';
import type { ModelConfig } from '../src/types.js';

const model = (id: string): ModelConfig => ({
  id, provider: 'openai', label: id, model: id, encryptedApiKey: 'secret', roles: ['analysis'], enabled: id === 'primary', priority: 100
});

describe('AI model fallback chain', () => {
  it('moves to the saved backup and reports the transition', async () => {
    const events: string[] = [];
    const run = vi.fn(async (candidate: ModelConfig) => {
      if (candidate.id === 'primary') throw new Error('timeout');
      return 'backup answer';
    });
    const outcome = await runWithModelFallback([model('primary'), model('backup')], run, (event) => events.push(`${event.type}:${event.model.id}`));
    expect(outcome.result).toBe('backup answer');
    expect(outcome.model.id).toBe('backup');
    expect(outcome.fallbackUsed).toBe(true);
    expect(events).toEqual(['attempt:primary', 'fallback:primary', 'attempt:backup', 'success:backup']);
  });

  it('stops with a combined error when every configured model fails', async () => {
    await expect(runWithModelFallback([model('primary'), model('backup')], async (candidate) => { throw new Error(`${candidate.id} offline`); }))
      .rejects.toThrow('所有可用模型均失败');
  });

  it('turns provider failures into actionable details without exposing the response body', () => {
    const auth = safeAIError(['Kimi: provider 返回 401: secret upstream response']);
    const quota = safeAIError(['Kimi: HTTP 429 too many requests']);
    expect(auth).toEqual({ kind: 'auth', detail: '认证失败，请修改或重新填写 API Key 后再测试。' });
    expect(quota.kind).toBe('quota');
    expect(auth.detail).not.toContain('secret upstream response');
  });
});
