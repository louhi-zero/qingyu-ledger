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
 * - 事件 caught: { title, text, pkg, ts } —— 原文透传，金额/方向由 JS 解析
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

    /** 由 NotifyCatchService 回调：服务已与系统连接 */
    static void setListening(boolean v) {
        listening = v;
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
        p.notifyListeners("caught", data, true);
    }
}
