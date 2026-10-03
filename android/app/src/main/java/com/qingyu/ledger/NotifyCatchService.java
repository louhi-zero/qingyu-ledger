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
 * v2.0.2 漏单修复（重构核心）：
 * - 旧实现 App 进程死亡时 emit 直接丢弃（instance==null）→ 支付通知蒸发，监控"不起作用"
 * - 现实现：收到目标通知【先持久化入队】（SharedPreferences，无论 App 死活），
 *   插件活着才额外实时 emit。App 下次启动/回前台经 pendingList() 补弹，
 *   处理完 pendingRemove() 删除 —— App 被杀也不漏单
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
            // v2.0.2 统一时间戳：postTime 贯通入队与实时链路（同一条通知同签名，JS 端精确去重）
            long postTime = sbn.getPostTime();
            NotifyCatchPlugin.enqueue(this, title, text, pkg, postTime);
            NotifyCatchPlugin.emit(title, text, pkg, postTime);
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
