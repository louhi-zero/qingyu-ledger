package com.qingyu.ledger;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * v1.7.0 应用内更新插件（安卓模式，对标 NexBox Tauri 下载器但按 Android 重写）：
 * - installerInfo(): 平台/SDK/是否允许安装未知来源应用
 * - openInstallSettings(): 跳转「安装未知应用」系统授权页（API 26+）
 * - download({url, fileName}): 后台线程流式下载 APK 到 app-specific Download 目录
 *     · 手动跟随最多 5 跳重定向（GitHub release 会 302 到对象存储）
 *     · 每 chunk 检查取消标志；进度事件 200ms 且有前进才 emit（防数字跳闪）
 *     · 边下边算 SHA-256；Content-Length 与实际字节数双校验（防把限流错误页写成安装包）
 *     · sync() 强制刷盘后再返回
 * - cancelDownload(): 置取消标志并删除半成品文件
 * - install({path}): FileProvider 授 URI 权限 + ACTION_VIEW 拉起系统安装器
 *     未获「未知来源」授权时返回 needPermission，由 JS 引导用户去设置（安卓无法静默安装）
 *
 * 下载目录用 getExternalFilesDir —— app-specific 外部目录，免存储运行时权限；
 * 路径穿越防护：只接受落在该目录内的 canonical path。
 */
@CapacitorPlugin(name = "AppUpdate")
public class UpdatePlugin extends Plugin {

    private static final AtomicBoolean CANCEL = new AtomicBoolean(false);
    private static volatile boolean downloading = false;
    private static volatile String currentPath = null;

    private static final int MAX_REDIRECTS = 5;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;
    private static final int BUFFER_SIZE = 64 * 1024;

    @PluginMethod
    public void installerInfo(PluginCall call) {
        Context ctx = getContext();
        boolean canInstall = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            canInstall = ctx.getPackageManager().canRequestPackageInstalls();
        }
        JSObject r = new JSObject();
        r.put("platform", "android");
        r.put("sdkInt", Build.VERSION.SDK_INT);
        r.put("canInstall", canInstall);
        call.resolve(r);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("OPEN_SETTINGS_FAILED", e);
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        CANCEL.set(true);
        String p = currentPath;
        if (p != null) {
            //noinspection ResultOfMethodCallIgnored
            new File(p).delete();
        }
        downloading = false;
        call.resolve();
    }

    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url", "");
        final String fileName = call.getString("fileName", "qingyu-update.apk");
        if (url.isEmpty() || !url.startsWith("https://")) {
            call.reject("BAD_URL");
            return;
        }
        // 文件名消毒：只允许字母数字点下划线连字符且必须 .apk 结尾，杜绝路径穿越
        if (!fileName.matches("[A-Za-z0-9._-]+") || !fileName.toLowerCase().endsWith(".apk")) {
            call.reject("BAD_FILE_NAME");
            return;
        }
        if (downloading) {
            call.reject("BUSY");
            return;
        }
        downloading = true;
        CANCEL.set(false);

        new Thread(new Runnable() {
            @Override
            public void run() {
                InputStream input = null;
                FileOutputStream output = null;
                HttpURLConnection conn = null;
                File outFile = null;
                try {
                    File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) throw new IOException("NO_EXTERNAL_DIR");
                    if (!dir.exists() && !dir.mkdirs()) throw new IOException("MKDIR_FAILED");
                    outFile = new File(dir, fileName);
                    currentPath = outFile.getAbsolutePath();

                    conn = openWithRedirects(url, MAX_REDIRECTS);
                    final long total = conn.getContentLengthLong();
                    input = new BufferedInputStream(conn.getInputStream(), BUFFER_SIZE);
                    output = new FileOutputStream(outFile, false);
                    MessageDigest digest = MessageDigest.getInstance("SHA-256");

                    byte[] buffer = new byte[BUFFER_SIZE];
                    long received = 0;
                    long lastEmitAt = 0L;
                    int lastPct = -1;
                    int n;
                    while ((n = input.read(buffer)) != -1) {
                        if (CANCEL.get()) {
                            safeClose(output);
                            //noinspection ResultOfMethodCallIgnored
                            outFile.delete();
                            currentPath = null;
                            downloading = false;
                            call.reject("CANCELLED");
                            return;
                        }
                        output.write(buffer, 0, n);
                        digest.update(buffer, 0, n);
                        received += n;

                        int pct = total > 0 ? (int) Math.min(99, (received * 100) / total) : 0;
                        long now = System.currentTimeMillis();
                        if (pct != lastPct && now - lastEmitAt >= 200) {
                            lastPct = pct;
                            lastEmitAt = now;
                            JSObject ev = new JSObject();
                            ev.put("received", received);
                            ev.put("total", total);
                            ev.put("progress", pct);
                            notifyListeners("downloadProgress", ev);
                        }
                    }
                    output.flush();
                    output.getFD().sync(); // flush 只到内核缓冲，sync 才真正落盘（杀软/断电安全）
                    safeClose(output);
                    output = null;
                    safeClose(input);
                    input = null;
                    conn.disconnect();

                    // 完整性校验①：字节数必须与 Content-Length 一致（防截断/错误页）
                    if (total > 0 && received != total) {
                        //noinspection ResultOfMethodCallIgnored
                        outFile.delete();
                        throw new IOException("SIZE_MISMATCH " + received + "/" + total);
                    }

                    String sha = toHex(digest.digest());
                    // 完成事件（进度 100 由 JS 状态机自行翻转，保证只涨不跌）
                    JSObject r = new JSObject();
                    r.put("path", outFile.getAbsolutePath());
                    r.put("sha256", sha);
                    r.put("bytes", received);
                    currentPath = null;
                    downloading = false;
                    call.resolve(r);
                } catch (Exception e) {
                    safeClose(output);
                    safeClose(input);
                    if (conn != null) conn.disconnect();
                    boolean cancelled = CANCEL.get();
                    if (outFile != null && !cancelled) {
                        //noinspection ResultOfMethodCallIgnored
                        outFile.delete();
                    }
                    currentPath = null;
                    downloading = false;
                    call.reject(cancelled ? "CANCELLED" : "DOWNLOAD_FAILED", e);
                }
            }
        }, "qy-update-download").start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path", "");
        if (path.isEmpty()) {
            call.reject("NO_PATH");
            return;
        }
        try {
            Context ctx = getContext();
            File dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            File file = new File(path);
            // 路径穿越防护：canonical 路径必须仍在下载目录内
            if (dir == null || !file.exists()
                    || !file.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator)) {
                call.reject("FILE_NOT_FOUND");
                return;
            }
            // Android 8+：未知来源安装需逐应用授权，未授权时让 JS 引导用户去设置页
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !ctx.getPackageManager().canRequestPackageInstalls()) {
                JSObject r = new JSObject();
                r.put("needPermission", true);
                call.resolve(r);
                return;
            }
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject r = new JSObject();
            r.put("launched", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("INSTALL_LAUNCH_FAILED", e);
        }
    }

    // 手动跟随重定向（HttpURLConnection 对跨域/部分 307 场景处理不一致，GitHub release 必 302）
    private HttpURLConnection openWithRedirects(String urlStr, int hopsLeft) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
        conn.setReadTimeout(READ_TIMEOUT_MS);
        conn.setInstanceFollowRedirects(false);
        conn.setRequestProperty("User-Agent", "qingyu-ledger-android");
        conn.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
        int code = conn.getResponseCode();
        if (code == HttpURLConnection.HTTP_MOVED_PERM
                || code == HttpURLConnection.HTTP_MOVED_TEMP
                || code == HttpURLConnection.HTTP_SEE_OTHER
                || code == 307 || code == 308) {
            String location = conn.getHeaderField("Location");
            conn.disconnect();
            if (hopsLeft <= 0 || location == null) throw new IOException("REDIRECT_EXHAUSTED");
            URL next = new URL(new URL(urlStr), location);
            return openWithRedirects(next.toString(), hopsLeft - 1);
        }
        if (code < 200 || code >= 300) {
            conn.disconnect();
            throw new IOException("HTTP_" + code);
        }
        return conn;
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(Character.forDigit((b >> 4) & 0xF, 16));
            sb.append(Character.forDigit(b & 0xF, 16));
        }
        return sb.toString();
    }

    private static void safeClose(java.io.Closeable c) {
        if (c != null) {
            try { c.close(); } catch (IOException ignored) { /* ignore */ }
        }
    }
}
