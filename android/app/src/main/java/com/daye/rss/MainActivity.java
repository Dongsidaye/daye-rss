package com.daye.rss;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Build;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean isDarkMode() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    private void updateSystemBarAppearance() {
        boolean dark = isDarkMode();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }

    private void updateWebViewBackground() {
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setBackgroundColor(
                    isDarkMode() ? Color.rgb(8, 12, 20) : Color.rgb(246, 248, 243)
            );
        }
    }

    private void stabilizeWebViewport() {
        if (bridge == null || bridge.getWebView() == null) return;
        WebView webView = bridge.getWebView();
        WebSettings settings = webView.getSettings();
        settings.setTextZoom(100);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        webView.setInitialScale(0);
        webView.post(() -> webView.evaluateJavascript(
                "document.documentElement.style.width='100%';" +
                "document.body.style.width='100%';" +
                "window.dispatchEvent(new Event('resize'));", null));
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalSecretsPlugin.class);
        registerPlugin(SafeAreaPlugin.class);
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        updateSystemBarAppearance();
        updateWebViewBackground();
        stabilizeWebViewport();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView() != null && bridge.getWebView().canGoBack()) {
                    bridge.getWebView().goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        updateSystemBarAppearance();
        updateWebViewBackground();
        stabilizeWebViewport();
    }
}
