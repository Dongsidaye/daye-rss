import path from 'node:path';

function bool(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  appOrigin: process.env.APP_ORIGIN ?? 'http://localhost:5173',
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  allowedEmail: (process.env.ALLOWED_EMAIL ?? 'you@example.com').toLowerCase(),
  tokenSecret: process.env.TOKEN_SECRET ?? 'development-only-token-secret-change-me',
  encryptionSecret: process.env.KEY_ENCRYPTION_SECRET ?? 'development-only-key-secret-change-me',
  devAuthBypass: bool(process.env.DEV_AUTH_BYPASS, process.env.NODE_ENV !== 'production'),
  braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY,
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? '大爷的 RSS <rss@localhost>'
  },
  fcm: {
    projectId: process.env.FCM_PROJECT_ID,
    clientEmail: process.env.FCM_CLIENT_EMAIL,
    privateKey: process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n')
  }
};

export function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const weak = [config.tokenSecret, config.encryptionSecret].some((v) => v.includes('development-only') || v.length < 32);
  if (weak) throw new Error('Production secrets must be unique and at least 32 characters long.');
  if (config.allowedEmail === 'you@example.com') throw new Error('ALLOWED_EMAIL must be configured in production.');
  if (config.devAuthBypass) throw new Error('DEV_AUTH_BYPASS must be disabled in production.');
}
