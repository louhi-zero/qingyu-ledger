package com.qingyu.ledger;

import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v1.5 收支监控插件：桥接 NotifyCatchService（通知监听）与 JS 层。
 * - isListening(): 通知使用权是否已连接
 * - openSettings(): 跳转系统「通知使用权」设置页
 * - testEmit(): 注入一条模拟支付通知，走与真实通知完全相同的 JS 链路（v1.6.8）
 * - 事件 caught: { title, text, pkg, ts } —— 原文透传，金额/方向由 JS 解析
 * - 事件 listening: { value } —— 服务连接/断开时主动推送（v1.6.8）
 */
@CapacitorPlugin(name = "NotifyCatch")
public class NotifyCatchPlugin extends Plugin {

    private static NotifyCatchPlugin instance;
    private static volatile boolean listening = false;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void isListening(PluginCall call) {
        JSObject r = new JSObject();
        r.put("value", listening);
        call.resolve(r);
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

    /** 注入模拟通知（默认微信收款 0.01 元），用于端到端验证监听→解析→确认弹窗全链路 */
    @PluginMethod
    public void testEmit(PluginCall call) {
        String title = call.getString("title", "微信支付");
        String text = call.getString("text", "微信支付收款0.01元，可在账单详情查看");
        String pkg = call.getString("pkg", "com.tencent.mm");
        emit(title, text, pkg);
        JSObject r = new JSObject();
        r.put("ok", true);
        call.resolve(r);
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

    /** 由 NotifyCatchService 回调：转发通知原文给 JS（插件未加载时忽略） */
    static void emit(String title, String text, String pkg) {
        NotifyCatchPlugin p = instance;
        if (p == null || p.bridge == null) return;
        JSObject data = new JSObject();
        data.put("title", title == null ? "" : title);
        data.put("text", text == null ? "" : text);
        data.put("pkg", pkg == null ? "" : pkg);
        data.put("ts", System.currentTimeMillis());
        // retainUntilDelivered=false：App 未在前台/无人监听时直接丢弃，避免打开 App 弹旧账
        p.notifyListeners("caught", data, false);
    }
}
