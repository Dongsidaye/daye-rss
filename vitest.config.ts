import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['apps/server/test/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    environment: 'node',
    env: {
      NODE_ENV: 'test', DATA_DIR: path.resolve('.test-data'), ALLOWED_EMAIL: 'you@example.com',
      TOKEN_SECRET: 'test-token-secret-that-is-at-least-32-characters',
      KEY_ENCRYPTION_SECRET: 'test-encryption-secret-that-is-at-least-32-characters'
    }
  }
});
