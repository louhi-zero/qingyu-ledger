package com.qingyu.ledger;

import android.app.Notification;
import android.content.ComponentName;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * v1.5 收支监控服务：监听系统通知，只转发微信/支付宝的通知原文给插件。
 * 权限由系统 BIND_NOTIFICATION_LISTENER_SERVICE 保护；用户需在系统设置
 * 「通知使用权」中手动授权。金额解析与弹窗在 JS 层完成。
 *
 * v1.6.8 健壮性增强：
 * - 文本提取覆盖 EXTRA_TEXT / EXTRA_BIG_TEXT / EXTRA_SUB_TEXT 与 MessagingStyle
 *   （微信/支付宝支付通知常在大文本或会话消息里，只读 EXTRA_TEXT 会漏）
 * - onListenerDisconnected 主动 requestRebind，被系统解绑后自动恢复
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
        // Android 7.0+：被系统解绑后主动请求重新绑定，避免重启手机后监听静默失效
        if (Build.VERSION.SDK_INT >= 24) {
            try {
                requestRebind(new ComponentName(this, NotifyCatchService.class));
            } catch (Exception ignored) {
                // 个别 ROM 不允许 requestRebind，等下次 App 打开时系统会自动重连
            }
        }
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
            String title = str(n.extras.getCharSequence(Notification.EXTRA_TITLE));
            // 文本优先级：大文本（展开态/支付结果）> 普通文本 > 会话最后一条 > 副标题
            String text = firstNonEmpty(
                    str(n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT)),
                    str(n.extras.getCharSequence(Notification.EXTRA_TEXT)),
                    lastMessagingText(n.extras),
                    str(n.extras.getCharSequence(Notification.EXTRA_SUB_TEXT))
            );
            if (title.isEmpty() && text.isEmpty()) return;
            NotifyCatchPlugin.emit(title, text, pkg);
        } catch (Exception ignored) {
            // 单条通知处理异常不影响服务存活
        }
    }

    private static String str(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }

    private static String firstNonEmpty(String... arr) {
        for (String s : arr) {
            if (s != null && !s.isEmpty()) return s;
        }
        return "";
    }

    /** 读取 MessagingStyle 通知（android.messages）中最后一条消息文本。 */
    private static String lastMessagingText(Bundle extras) {
        try {
            Object obj = extras.get("android.messages");
            if (!(obj instanceof List)) return "";
            List<?> list = (List<?>) obj;
            for (int i = list.size() - 1; i >= 0; i--) {
                Object item = list.get(i);
                if (!(item instanceof Bundle)) continue;
                CharSequence text = ((Bundle) item).getCharSequence("text");
                if (text != null && text.length() > 0) return text.toString().trim();
            }
        } catch (Exception ignored) {
            // 不同 ROM 的 extras 结构可能不同，读不到就忽略
        }
        return "";
    }
}
