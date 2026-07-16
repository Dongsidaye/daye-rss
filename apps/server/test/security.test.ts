import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, safeFetchText, signSession, verifySession } from '../src/security.js';

describe('security boundaries', () => {
  it('encrypts secrets with authenticated encryption', () => {
    const encrypted = encryptSecret('sk-private-value');
    expect(encrypted).not.toContain('sk-private-value');
    expect(decryptSecret(encrypted)).toBe('sk-private-value');
  });

  it('signs and verifies only the configured personal account', () => {
    expect(verifySession(signSession('you@example.com'))?.email).toBe('you@example.com');
    expect(verifySession(signSession('attacker@example.com'))).toBeNull();
    expect(verifySession(`${signSession('you@example.com')}tampered`)).toBeNull();
  });

  it('blocks local addresses before fetching a feed', async () => {
    await expect(safeFetchText('http://127.0.0.1/private')).rejects.toThrow(/Private/);
    await expect(safeFetchText('http://100.64.0.1/private')).rejects.toThrow(/Private/);
    await expect(safeFetchText('http://198.18.0.1/private')).rejects.toThrow(/Private/);
    await expect(safeFetchText('http://[::1]/private')).rejects.toThrow(/Private/);
  });
});
