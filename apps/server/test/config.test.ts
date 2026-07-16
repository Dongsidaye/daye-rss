import { afterEach, describe, expect, it, vi } from 'vitest';

describe('production configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('refuses to start when the development login bypass is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOWED_EMAIL', 'owner@example.com');
    vi.stubEnv('TOKEN_SECRET', 'a'.repeat(32));
    vi.stubEnv('KEY_ENCRYPTION_SECRET', 'b'.repeat(32));
    vi.stubEnv('DEV_AUTH_BYPASS', 'true');
    vi.resetModules();

    const { assertProductionConfig } = await import('../src/config.js');
    expect(() => assertProductionConfig()).toThrow(/DEV_AUTH_BYPASS/);
  });
});
