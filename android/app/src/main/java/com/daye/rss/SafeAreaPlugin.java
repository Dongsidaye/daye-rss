package com.daye.rss;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SafeArea")
public class SafeAreaPlugin extends Plugin {
    private JSObject payload(WindowInsetsCompat windowInsets) {
        Insets bars = windowInsets == null
            ? Insets.NONE
            : windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        float density = getContext().getResources().getDisplayMetrics().density;
        JSObject result = new JSObject();
        result.put("top", bars.top / density);
        result.put("right", bars.right / density);
        result.put("bottom", bars.bottom / density);
        result.put("left", bars.left / density);
        return result;
    }

    private void publish(WindowInsetsCompat insets) {
        notifyListeners("insetsChanged", payload(insets), true);
    }

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            ViewCompat.setOnApplyWindowInsetsListener(getBridge().getWebView(), (view, insets) -> {
                publish(insets);
                return insets;
            });
            ViewCompat.requestApplyInsets(getBridge().getWebView());
        });
    }

    @PluginMethod
    public void getInsets(PluginCall call) {
        getActivity().runOnUiThread(() -> call.resolve(payload(ViewCompat.getRootWindowInsets(getBridge().getWebView()))));
    }
}
