import { Capacitor, registerPlugin } from '@capacitor/core';

interface LocalSecretsPlugin {
  set(options: { name: string; value: string }): Promise<void>;
  get(options: { name: string }): Promise<{ value: string | null }>;
  delete(options: { name: string }): Promise<void>;
}

const LocalSecrets = registerPlugin<LocalSecretsPlugin>('LocalSecrets');

const browserKey = (name: string) => `daye_session_secret:${name}`;

export const saveLocalSecret = async (name: string, value: string) => {
  if (Capacitor.isNativePlatform()) return LocalSecrets.set({ name, value });
  if (!import.meta.env.DEV) throw new Error('浏览器正式版不保存模型密钥');
  sessionStorage.setItem(browserKey(name), value);
};
export const readLocalSecret = async (name: string) => {
  if (Capacitor.isNativePlatform()) return (await LocalSecrets.get({ name })).value;
  return import.meta.env.DEV ? sessionStorage.getItem(browserKey(name)) : null;
};
export const deleteLocalSecret = async (name: string) => {
  if (Capacitor.isNativePlatform()) return LocalSecrets.delete({ name });
  sessionStorage.removeItem(browserKey(name));
};
