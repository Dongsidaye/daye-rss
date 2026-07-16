package com.daye.rss;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "LocalSecrets")
public class LocalSecretsPlugin extends Plugin {
    private static final String STORE = "daye_local_secrets";
    private static final String KEY_ALIAS = "daye-rss-local-aes";

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
         .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
         .setKeySize(256)
         .build());
        return generator.generateKey();
    }

    @PluginMethod
    public void set(PluginCall call) {
        String name = call.getString("name");
        String value = call.getString("value");
        if (name == null || value == null) { call.reject("name and value are required"); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            String payload = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP);
            preferences().edit().putString(name, payload).apply();
            call.resolve();
        } catch (Exception error) { call.reject("Unable to encrypt secret", error); }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String name = call.getString("name");
        if (name == null) { call.reject("name is required"); return; }
        String payload = preferences().getString(name, null);
        JSObject result = new JSObject();
        if (payload == null) { result.put("value", JSObject.NULL); call.resolve(result); return; }
        try {
            String[] pieces = payload.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, Base64.decode(pieces[0], Base64.NO_WRAP)));
            byte[] decrypted = cipher.doFinal(Base64.decode(pieces[1], Base64.NO_WRAP));
            result.put("value", new String(decrypted, java.nio.charset.StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) { call.reject("Unable to decrypt secret", error); }
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String name = call.getString("name");
        if (name == null) { call.reject("name is required"); return; }
        preferences().edit().remove(name).apply();
        call.resolve();
    }
}
