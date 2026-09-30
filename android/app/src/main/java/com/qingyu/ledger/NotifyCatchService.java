package com.qingyu.ledger;

import android.app.Notification;
import android.os.Build;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * v1.5 收支监控服务：监听系统通知，只转发微信/支付宝的通知原文给插件。
 * 权限由系统 BIND_NOTIFICATION_LISTENER_SERVICE 保护；用户需在系统设置
 * 「通知使用权」中手动授权。金额解析与弹窗在 JS 层完成。
 */
public class NotifyCatchService extends NotificationListenerService {

    private static final Set<String> TARGET_PACKAGES = new HashSet<>(Arrays.asList(
            "com.tencent.mm",               // 微信
            "com.eg.android.AlipayGphone"   // 支付宝
    ));

    @Override
    public void onListenerConnected() {
        NotifyCatchPlugin.setListening(true);
    }

    @Override
    public void onListenerDisconnected() {
        NotifyCatchPlugin.setListening(false);
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null || sbn.getNotification() == null) return;
            if (Build.VERSION.SDK_INT >= 24 && sbn.isOngoing()) return;
            String pkg = sbn.getPackageName();
            if (pkg == null || !TARGET_PACKAGES.contains(pkg)) return;

            Notification n = sbn.getNotification();
            if (n.extras == null) return;
            CharSequence title = n.extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = n.extras.getCharSequence(Notification.EXTRA_TEXT);
            String t = title == null ? "" : title.toString().trim();
            String x = text == null ? "" : text.toString().trim();
            if (t.isEmpty() && x.isEmpty()) return;
            NotifyCatchPlugin.emit(t, x, pkg);
        } catch (Exception ignored) {
            // 单条通知处理异常不影响服务存活
        }
    }
}
