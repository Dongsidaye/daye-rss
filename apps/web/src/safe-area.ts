import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface Insets { top: number; right: number; bottom: number; left: number; }
interface SafeAreaPlugin {
  getInsets(): Promise<Insets>;
  addListener(eventName: 'insetsChanged', listener: (insets: Insets) => void): Promise<PluginListenerHandle>;
}

const SafeArea = registerPlugin<SafeAreaPlugin>('SafeArea');

function applyInsets(insets: Insets) {
  const root = document.documentElement;
  root.style.setProperty('--safe-top', `${Math.max(0, insets.top)}px`);
  root.style.setProperty('--safe-right', `${Math.max(0, insets.right)}px`);
  root.style.setProperty('--safe-bottom', `${Math.max(0, insets.bottom)}px`);
  root.style.setProperty('--safe-left', `${Math.max(0, insets.left)}px`);
}

export async function installSafeArea() {
  const params = new URLSearchParams(window.location.search);
  const nativePreview = import.meta.env.DEV && params.get('previewNative') === '1';
  if (!Capacitor.isNativePlatform() && !nativePreview) return;
  const root = document.documentElement;
  root.classList.add('native-shell');
  root.classList.toggle(
    'android-webview',
    Capacitor.isNativePlatform() && /android/i.test(navigator.userAgent),
  );
  if (nativePreview) {
    // Keep the deterministic light palette only for the light preview.
    // Leaving this class on a dark preview makes its higher-specificity light
    // tokens win over theme-dark and produces dark text on a dark reader.
    document.documentElement.classList.toggle('preview-light', params.get('previewTheme') !== 'dark');
    applyInsets({ top: 46, right: 0, bottom: 12, left: 0 });
    return;
  }
  try {
    applyInsets(await SafeArea.getInsets());
    await SafeArea.addListener('insetsChanged', applyInsets);
  } catch {
    document.documentElement.style.setProperty('--safe-top', '32px');
    document.documentElement.style.setProperty('--safe-bottom', '12px');
  }
}
