import { describe, expect, it } from 'vitest';
import { validateModelProxyTarget } from '../dev-model-proxy';

describe('development model proxy target validation', () => {
  it('allows the official Kimi Coding Plan endpoint', () => {
    expect(validateModelProxyTarget('https://api.kimi.com/coding/v1/chat/completions').hostname).toBe('api.kimi.com');
  });

  it.each([
    'http://api.kimi.com/coding/v1/chat/completions',
    'https://api.kimi.com.evil.example/coding/v1/chat/completions',
    'https://127.0.0.1/chat/completions',
    'https://api.kimi.com:8443/coding/v1/chat/completions'
  ])('blocks unsafe or non-official target %s', (target) => {
    expect(() => validateModelProxyTarget(target)).toThrow();
  });
});
