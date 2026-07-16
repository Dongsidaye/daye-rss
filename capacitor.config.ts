import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.daye.rss',
  appName: '大爷的 RSS',
  webDir: 'apps/web/dist',
  server: { androidScheme: 'https' },
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] }
  }
};

export default config;
