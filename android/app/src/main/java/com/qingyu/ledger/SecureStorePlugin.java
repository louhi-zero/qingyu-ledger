package com.qingyu.ledger;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * v3.1 敏感配置安全存储（API Key 等脱离明文 SharedPreferences/localStorage）：
 * - AndroidKeyStore 生成 AES-256-GCM 密钥，密钥不可导出（强密钥盒/TEE 保护）
 * - 密文 Base64 后存 app 专属 SharedPreferences（不用 external 存储，随卸载清除）
 * - get/set/remove 三个最小接口；key 白名单消毒，杜绝 prefs 注入
 * - 不绑定用户认证（setUserAuthenticationRequired 不设），避免锁屏变更导致密钥永久失效丢配置
 * - 加密失败时 reject("CRYPTO_FAILED")，由 JS 侧回落旧 localStorage 明文（降级可用性优先）
 *
 * 密文格式：Base64(IV[12] || GCM 密文)，每次加密随机 IV。
 */
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {

    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "qingyu_secure_v1";
    private static final String PREFS_FILE = "qy_secure_store";
    private static final String PREF_PREFIX = "enc_";
    private static final int GCM_IV_LEN = 12;
    private static final int GCM_TAG_BITS = 128;

    /** key 消毒：只允许字母数字下划线点连字符，防止拼出任意 prefs 条目 */
    private static boolean validKey(String key) {
        return key != null && !key.isEmpty() && key.length() <= 64
                && key.matches("[A-Za-z0-9._-]+");
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
    }

    /** 取或首次生成 AndroidKeyStore AES-256 密钥（失败抛异常由调用方 reject） */
    private SecretKey getOrCreateKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator kg = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build());
        return kg.generateKey();
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key", "");
        if (!validKey(key)) { call.reject("BAD_KEY"); return; }
        try {
            String stored = prefs().getString(PREF_PREFIX + key, null);
            JSObject r = new JSObject();
            if (stored == null) {
                r.put("value", null);
                call.resolve(r);
                return;
            }
            byte[] blob = Base64.getDecoder().decode(stored);
            if (blob.length <= GCM_IV_LEN) { call.reject("CORRUPTED"); return; }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(),
                    new GCMParameterSpec(GCM_TAG_BITS, blob, 0, GCM_IV_LEN));
            byte[] plain = cipher.doFinal(blob, GCM_IV_LEN, blob.length - GCM_IV_LEN);
            r.put("value", new String(plain, java.nio.charset.StandardCharsets.UTF_8));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("CRYPTO_FAILED", e);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key", "");
        String value = call.getString("value", "");
        if (!validKey(key)) { call.reject("BAD_KEY"); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] iv = cipher.getIV();
            byte[] plain = value.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            byte[] ct = cipher.doFinal(plain);
            byte[] blob = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, blob, 0, iv.length);
            System.arraycopy(ct, 0, blob, iv.length, ct.length);
            prefs().edit()
                    .putString(PREF_PREFIX + key, Base64.getEncoder().encodeToString(blob))
                    .apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("CRYPTO_FAILED", e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key", "");
        if (!validKey(key)) { call.reject("BAD_KEY"); return; }
        boolean removed = prefs().edit().remove(PREF_PREFIX + key).commit();
        JSObject r = new JSObject();
        r.put("removed", removed);
        call.resolve(r);
    }
}
