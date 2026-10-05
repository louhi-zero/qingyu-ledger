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
 * v1.5 收支监控插件：桥接 NotifyCatchService（通知监听）与 JS 层。
 * - isListening(): 通知使用权是否已连接
 * - openSettings(): 跳转系统「通知使用权」设置页
 * - testEmit(): 注入一条模拟支付通知，走与真实通知完全相同的 JS 链路（v1.6.8）
 * - 事件 caught: { title, text, pkg, ts } —— 原文透传，金额/方向由 JS 解析
 * - 事件 listening: { value } —— 服务连接/断开时主动推送（v1.6.8）
 *
 * v2.0.2 离线暂存队列（漏单修复核心）：
 * - App 进程死亡时 WebView/插件随之销毁，旧实现 notifyListeners 直接丢弃 → 支付通知蒸发
 * - 现在 Service 收到目标通知先 enqueue() 持久化到 SharedPreferences（无论 App 死活），
 *   插件活着才额外实时 emit；App 启动/回前台经 pendingList() 拉取补弹，
 *   用户确认或忽略后 pendingRemove(keys) 删除 —— App 被杀、重启手机都不漏单
 * - pendingEnqueueSample(): 把一条样例写入队列，供「离线补弹测试」端到端验证
 */
@CapacitorPlugin(name = "NotifyCatch")
public class NotifyCatchPlugin extends Plugin {

    private static NotifyCatchPlugin instance;
    private static volatile boolean listening = false;

    private static final String SP_NAME = "qingyu_notify_pending";
    private static final String SP_KEY = "items";
    private static final int MAX_PENDING = 50;
    private static final long ENQUEUE_DEDUP_MS = 10_000; // 同签名通知 10s 内去重（系统重复 post）

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void isListening(PluginCall call) {
        // v3.1 修复：静态 listening 标志在「服务先于插件绑定」时丢失（onListenerConnected
        // 早于 load，setListening 时 instance 为 null）——改为系统实时查询，开启后立即可见
        JSObject r = new JSObject();
        r.put("value", isListenerEnabled(getContext()) || listening);
        call.resolve(r);
    }

    /** 通知使用权是否已在系统侧启用（enabled_notification_listeners 精确匹配本服务） */
    static boolean isListenerEnabled(Context ctx) {
        try {
            String flat = Settings.Secure.getString(
                    ctx.getContentResolver(), "enabled_notification_listeners");
            if (flat == null || flat.isEmpty()) return false;
            ComponentName self = new ComponentName(ctx, NotifyCatchService.class);
            for (String item : flat.split(":")) {
                if (item == null || item.trim().isEmpty()) continue;
                ComponentName cn = ComponentName.unflattenFromString(item.trim());
                if (self.equals(cn)) return true;
            }
        } catch (Exception ignored) { /* 读取失败回落静态标志 */ }
        return false;
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开通知使用权设置页");
        }
    }

    /** 注入模拟通知（默认微信收款 0.01 元），走实时链路：emit（不入队；真实通知的双轨由 Service 保证）。
     *  test=true：JS 管线跳过 15s/30s 时间窗抑制（连点测试按钮每次都弹，不与真实支付互吞） */
    @PluginMethod
    public void testEmit(PluginCall call) {
        String title = call.getString("title", "微信支付");
        String text = call.getString("text", "微信支付收款0.01元，可在账单详情查看");
        String pkg = call.getString("pkg", "com.tencent.mm");
        emit(title, text, pkg, System.currentTimeMillis(), true);
        JSObject r = new JSObject();
        r.put("ok", true);
        call.resolve(r);
    }

    /** v2.0.2 离线补弹测试：把样例写入持久化队列（模拟 App 死亡期间收到的通知），启动/回前台消费 */
    @PluginMethod
    public void pendingEnqueueSample(PluginCall call) {
        try {
            String title = call.getString("title", "微信支付");
            String text = call.getString("text", "微信支付收款0.01元，可在账单详情查看");
            String pkg = call.getString("pkg", "com.tencent.mm");
            enqueue(getContext(), title, text, pkg, System.currentTimeMillis(), true);
            call.resolve();
        } catch (Exception e) {
            call.reject("入队失败", e);
        }
    }

    /** v2.0.2 拉取离线暂存队列（新→旧），JS 消费后必须 pendingRemove 对应 key */
    @PluginMethod
    public void pendingList(PluginCall call) {
        try {
            JSONArray arr = readQueue(getContext());
            JSObject r = new JSObject();
            r.put("items", arr); // JSObject.put 接受 JSONArray，Capacitor 原生序列化
            call.resolve(r);
        } catch (Exception e) {
            call.reject("读取暂存队列失败", e);
        }
    }

    /** v2.0.2 按 key 数组删除已处理条目（确认入账/忽略后都必须调用，否则重复弹） */
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

    /** 由 NotifyCatchService 回调：服务连接状态变化，同时推送给 JS 层 */
    static void setListening(boolean v) {
        listening = v;
        NotifyCatchPlugin p = instance;
        if (p != null && p.bridge != null) {
            JSObject data = new JSObject();
            data.put("value", v);
            p.notifyListeners("listening", data, false);
        }
    }

    /** 由 NotifyCatchService 回调：转发通知原文给 JS（插件未加载时忽略——此时已入队，App 下次启动补弹）。
     *  真实通知 4 参重载（test=false）；testEmit 走 5 参注入测试标记 */
    static void emit(String title, String text, String pkg, long ts) {
        emit(title, text, pkg, ts, false);
    }

    static void emit(String title, String text, String pkg, long ts, boolean isTest) {
        NotifyCatchPlugin p = instance;
        if (p == null || p.bridge == null) return;
        JSObject data = new JSObject();
        data.put("title", title == null ? "" : title);
        data.put("text", text == null ? "" : text);
        data.put("pkg", pkg == null ? "" : pkg);
        data.put("ts", ts); // 与入队时间戳一致（postTime），JS 端双轨精确去重依赖此值
        data.put("test", isTest); // JS 管线据此跳过时间窗抑制（仅测试注入为 true）
        // retainUntilDelivered=false：App 未在前台/无人监听时直接丢弃，避免打开 App 弹旧账
        // （离线场景由持久化队列兜底，见 enqueue/pendingList）
        p.notifyListeners("caught", data, false);
    }

    // ---------------- 离线暂存队列（v2.0.2） ----------------

    /** 持久化入队（Service 调用，ctx=Service 自身；App 死亡也照常写入）。新→旧，上限 50 条。
     *  真实通知 4 参重载（test=false）；pendingEnqueueSample 走 5 参写入测试标记 */
    static void enqueue(Context ctx, String title, String text, String pkg, long ts) {
        enqueue(ctx, title, text, pkg, ts, false);
    }

    static void enqueue(Context ctx, String title, String text, String pkg, long ts, boolean isTest) {
        if (ctx == null) return;
        try {
            String sig = pkg + "|" + (title == null ? "" : title) + "|" + (text == null ? "" : text);
            JSONArray arr = readQueue(ctx);
            // 同签名 10s 内去重：系统对分组通知会重复 post（防负时间差：新 ts 更早视为异常，不判重复）
            for (int i = 0; i < arr.length(); i++) {
                JSONObject it = arr.optJSONObject(i);
                if (it == null) continue;
                long dt = ts - it.optLong("ts");
                if (sig.equals(it.optString("sig")) && dt >= 0 && dt < ENQUEUE_DEDUP_MS) return;
            }
            JSONObject item = new JSONObject();
            item.put("key", ts + "-" + Integer.toHexString(sig.hashCode()));
            item.put("sig", sig);
            item.put("title", title == null ? "" : title);
            item.put("text", text == null ? "" : text);
            item.put("pkg", pkg == null ? "" : pkg);
            item.put("ts", ts);
            item.put("test", isTest); // 离线消费时透传 JS（补弹测试不受 30s 金额去重抑制）
            JSONArray out = new JSONArray();
            out.put(item);
            for (int i = 0; i < arr.length() && out.length() < MAX_PENDING; i++) out.put(arr.get(i));
            writeQueue(ctx, out);
        } catch (Exception ignored) {
            // 队列写入失败不影响实时链路
        }
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
