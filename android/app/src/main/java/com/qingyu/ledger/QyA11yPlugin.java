package com.qingyu.ledger;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * v2.1 无障碍交易捕获插件：桥接 QyA11yService（无障碍服务）与 JS 层。
 * - isA11yEnabled(): 无障碍服务是否已开启（逐条解析系统已启用服务串，精确匹配本服务组件）
 * - openA11ySettings(): 跳转系统「无障碍」设置页（JS 分步引导使用）
 * - 事件 page: { texts: [...], pkg, sig, ts } —— 支付页面文本透传，金额/方向/对象由 JS 提取
 * - 事件 a11yConnected: { value } —— 服务连接/断开推送
 * - testA11yEmit(): 注入模拟支付页文本，走与真实捕获完全相同的 JS 链路
 * - pendingEnqueueSample()/pendingList()/pendingRemove(): 离线补弹队列（模拟 App 被杀期间的支付页）
 *
 * 隐私：页面文本仅在本机处理，入队上限 30 条、处理完即删，不上传不持久原文（入队除外，处理完即删）。
 */
@CapacitorPlugin(name = "A11yCatch")
public class QyA11yPlugin extends Plugin {

    private static QyA11yPlugin instance;
    private static volatile boolean a11yConnected = false;

    private static final String SP_NAME = "qingyu_a11y_pending";
    private static final String SP_KEY = "items";
    private static final int MAX_PENDING = 30;
    private static final long ENQUEUE_DEDUP_MS = 10_000; // 同签名 10s 内去重

    @Override
    public void load() {
        instance = this;
    }

    /** 无障碍服务是否已开启：解析系统已启用服务列表，精确匹配本服务组件（兼容扁平/短扁平两种写法） */
    @PluginMethod
    public void isA11yEnabled(PluginCall call) {
        JSObject r = new JSObject();
        r.put("value", isServiceEnabled(getContext()));
        r.put("connected", a11yConnected);
        call.resolve(r);
    }

    static boolean isServiceEnabled(Context ctx) {
        try {
            String services = Settings.Secure.getString(
                    ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (services == null || services.isEmpty()) return false;
            ComponentName self = new ComponentName(ctx, QyA11yService.class);
            for (String item : services.split(":")) {
                if (item == null || item.trim().isEmpty()) continue;
                ComponentName cn = ComponentName.unflattenFromString(item.trim());
                if (self.equals(cn)) return true;
            }
        } catch (Exception ignored) { /* 读取失败按未开启 */ }
        return false;
    }

    @PluginMethod
    public void openA11ySettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开无障碍设置页");
        }
    }

    /** 注入模拟支付页文本（默认微信付款成功页），走与真实捕获完全相同的「采集→提取→解析→弹窗」链路。
     *  test=true：JS 管线跳过时间窗抑制（连点测试每次都弹） */
    @PluginMethod
    public void testA11yEmit(PluginCall call) {
        try {
            JSONArray texts = call.getArray("texts");
            if (texts == null || texts.length() == 0) {
                texts = new JSONArray();
                texts.put("支付成功");
                texts.put("¥25.00");
                texts.put("支付方式 零钱");
                texts.put("收款方 瑞幸咖啡");
            }
            String pkg = call.getString("pkg", QyA11yService.PKG_WECHAT);
            emitPage(pkg, System.currentTimeMillis(), "test-" + System.currentTimeMillis(), texts, true);
            call.resolve();
        } catch (Exception e) {
            call.reject("测试注入失败", e);
        }
    }

    /** v2.1 离线补弹测试：把样例支付页写入持久化队列 */
    @PluginMethod
    public void pendingEnqueueSample(PluginCall call) {
        try {
            JSONArray texts = call.getArray("texts");
            if (texts == null || texts.length() == 0) {
                texts = new JSONArray();
                texts.put("付款成功");
                texts.put("￥8.80");
                texts.put("收款方 便利蜂");
            }
            long now = System.currentTimeMillis();
            enqueuePage(getContext(), call.getString("pkg", QyA11yService.PKG_ALIPAY), now,
                    "sample-" + now, texts, true);
            call.resolve();
        } catch (Exception e) {
            call.reject("入队失败", e);
        }
    }

    @PluginMethod
    public void pendingList(PluginCall call) {
        try {
            JSONArray arr = readQueue(getContext());
            JSObject r = new JSObject();
            r.put("items", arr);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("读取暂存队列失败", e);
        }
    }

    @PluginMethod
    public void pendingRemove(PluginCall call) {
        try {
            JSArray keys = call.getArray("keys");
            if (keys == null) { call.resolve(); return; }
            JSONArray arr = readQueue(getContext());
            JSONArray out = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) continue;
                if (!containsKey(keys, item.optString("key"))) out.put(item);
            }
            writeQueue(getContext(), out);
            call.resolve();
        } catch (Exception e) {
            call.reject("清理暂存队列失败", e);
        }
    }

    private static boolean containsKey(JSArray keys, String key) {
        for (int i = 0; i < keys.length(); i++) {
            if (key.equals(keys.optString(i))) return true;
        }
        return false;
    }

    /** 由 QyA11yService 回调：服务连接状态变化，推送给 JS 层 */
    static void setA11yConnected(boolean v) {
        a11yConnected = v;
        QyA11yPlugin p = instance;
        if (p != null && p.bridge != null) {
            JSObject data = new JSObject();
            data.put("value", v);
            p.notifyListeners("a11yConnected", data, false);
        }
    }

    /** 由 QyA11yService 回调：持久化入队（Service 自身有 Context，App 死亡也照常写）。
     *  真实采集 5 参重载（test=false）；pendingEnqueueSample 走 6 参写入测试标记 */
    static void enqueuePage(Context ctx, String pkg, long ts, String sig, JSONArray texts) {
        enqueuePage(ctx, pkg, ts, sig, texts, false);
    }

    static void enqueuePage(Context ctx, String pkg, long ts, String sig, JSONArray texts, boolean isTest) {
        if (ctx == null || texts == null || texts.length() == 0) return;
        try {
            JSONArray arr = readQueue(ctx);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject it = arr.optJSONObject(i);
                if (it == null) continue;
                long dt = ts - it.optLong("ts");
                if (sig.equals(it.optString("sig")) && dt >= 0 && dt < ENQUEUE_DEDUP_MS) return;
            }
            JSONObject item = new JSONObject();
            item.put("key", ts + "-" + Integer.toHexString(sig.hashCode()));
            item.put("sig", sig);
            item.put("pkg", pkg == null ? "" : pkg);
            item.put("ts", ts);
            item.put("texts", texts);
            item.put("test", isTest); // 离线消费时透传 JS（补弹测试不受时间窗抑制）
            JSONArray out = new JSONArray();
            out.put(item);
            for (int i = 0; i < arr.length() && out.length() < MAX_PENDING; i++) out.put(arr.get(i));
            writeQueue(ctx, out);
        } catch (Exception ignored) {
            // 队列写入失败不影响实时链路
        }
    }

    /** 由 QyA11yService 回调：转发页面文本给 JS（插件未加载时忽略——已入队，App 下次启动补弹）。
     *  真实采集 4 参重载（test=false）；testA11yEmit 走 5 参注入测试标记 */
    static void emitPage(String pkg, long ts, String sig, JSONArray texts) {
        emitPage(pkg, ts, sig, texts, false);
    }

    static void emitPage(String pkg, long ts, String sig, JSONArray texts, boolean isTest) {
        QyA11yPlugin p = instance;
        if (p == null || p.bridge == null) return;
        try {
            JSObject data = new JSObject();
            data.put("texts", texts);
            data.put("pkg", pkg == null ? "" : pkg);
            data.put("sig", sig == null ? "" : sig);
            data.put("ts", ts);
            data.put("test", isTest);
            p.notifyListeners("page", data, false);
        } catch (Exception ignored) { /* 转发失败不影响服务 */ }
    }

    private static JSONArray readQueue(Context ctx) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(SP_NAME, Context.MODE_PRIVATE);
            return new JSONArray(sp.getString(SP_KEY, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static void writeQueue(Context ctx, JSONArray arr) {
        SharedPreferences sp = ctx.getSharedPreferences(SP_NAME, Context.MODE_PRIVATE);
        sp.edit().putString(SP_KEY, arr.toString()).apply();
    }
}
