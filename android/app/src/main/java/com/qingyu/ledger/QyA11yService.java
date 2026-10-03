package com.qingyu.ledger;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * v2.1 无障碍交易捕获服务（替代截图记录方式）：
 * - 仅监听微信(com.tencent.mm)/支付宝(com.eg.android.AlipayGphone)（见 res/xml/a11y_service_config.xml packageNames）
 * - 支付成功/收款/转账页出现时，采集页面文本节点（DFS，上限 400 节点）→ 预过滤（金额+收支关键词双命中才转发）
 * - 采集结果交给 QyA11yPlugin：先持久化入队（App 死亡也能补弹），插件活着再实时 emit
 * - 节流：单包名 800ms 最小间隔；同内容签名 30s 内只发一次（页面局部刷新防抖）
 * - 权限由系统 BIND_ACCESSIBILITY_SERVICE 保护；用户需在系统「无障碍」设置中手动开启，
 *   JS 层提供分步引导（见 SettingsSections 无障碍监控区块）
 *
 * 隐私边界：只读取支付相关页面的文本内容用于提取交易要素（金额/时间/对象/类型），
 * 不采集密码框（canRetrieveWindowContent 不含密码内容，系统自动屏蔽）、不上传任何页面原文。
 */
public class QyA11yService extends AccessibilityService {

    static final String PKG_WECHAT = "com.tencent.mm";
    static final String PKG_ALIPAY = "com.eg.android.AlipayGphone";

    private static final int MAX_NODES = 400;          // 单页文本节点上限（防超大页面卡顿）
    private static final int MAX_TEXT_LEN = 300;       // 单节点文本截断
    private static final int MAX_DEPTH = 30;           // DFS 深度上限
    private static final long MIN_INTERVAL_MS = 800;   // 单包名最小采集间隔（content-changed 风暴节流）
    private static final long SAME_SIG_INTERVAL_MS = 30_000; // 同内容签名最小重发间隔

    private long lastWechatAt = 0L;
    private long lastAlipayAt = 0L;
    private String lastWechatSig = "";
    private String lastAlipaySig = "";
    private long lastWechatSigAt = 0L;
    private long lastAlipaySigAt = 0L;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        try {
            if (event == null) return;
            CharSequence pkgCs = event.getPackageName();
            String pkg = pkgCs == null ? "" : pkgCs.toString();
            if (!PKG_WECHAT.equals(pkg) && !PKG_ALIPAY.equals(pkg)) return;
            int type = event.getEventType();
            if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                    && type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return;

            long now = System.currentTimeMillis();
            // 节流：content-changed 在输入/动画期间高频触发，单包名 800ms 才采一次
            if (pkg.equals(PKG_WECHAT)) {
                if (now - lastWechatAt < MIN_INTERVAL_MS) return;
                lastWechatAt = now;
            } else {
                if (now - lastAlipayAt < MIN_INTERVAL_MS) return;
                lastAlipayAt = now;
            }

            JSONArray texts = collectTexts();
            if (texts == null || texts.length() == 0) return;
            String joined = texts.join(" ");
            // 预过滤：金额（¥/￥/两位小数+元）与收支关键词双命中才转发，普通聊天页零流量
            if (!MONEY.matcher(joined).find() || !KEYWORD.matcher(joined).find()) return;

            String sig = md5(joined);
            // 同内容签名 30s 内只发一次（同页面停留时的局部刷新）
            if (pkg.equals(PKG_WECHAT)) {
                if (sig.equals(lastWechatSig) && now - lastWechatSigAt < SAME_SIG_INTERVAL_MS) return;
                lastWechatSig = sig; lastWechatSigAt = now;
            } else {
                if (sig.equals(lastAlipaySig) && now - lastAlipaySigAt < SAME_SIG_INTERVAL_MS) return;
                lastAlipaySig = sig; lastAlipaySigAt = now;
            }

            QyA11yPlugin.enqueuePage(this, pkg, now, sig, texts);
            QyA11yPlugin.emitPage(pkg, now, sig, texts);
        } catch (Exception ignored) {
            // 单事件异常不影响服务存活
        }
    }

    @Override
    public void onInterrupt() { /* 服务中断无需处理，系统会重连 */ }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        QyA11yPlugin.setA11yConnected(true);
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        QyA11yPlugin.setA11yConnected(false);
        return super.onUnbind(intent);
    }

    // ---------- 页面文本采集 ----------

    private JSONArray collectTexts() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        JSONArray out = new JSONArray();
        Deque<AccessibilityNodeInfo> stack = new ArrayDeque<>();
        Deque<Integer> depths = new ArrayDeque<>();
        stack.push(root);
        depths.push(0);
        int visited = 0;
        while (!stack.isEmpty() && visited < MAX_NODES) {
            AccessibilityNodeInfo node = stack.pop();
            int depth = depths.pop();
            try {
                if (node == null) continue;
                visited++;
                CharSequence t = node.getText();
                if (t == null || t.length() == 0) t = node.getContentDescription();
                if (t != null && t.length() > 0) {
                    String s = t.toString().trim();
                    if (!s.isEmpty()) out.put(s.length() > MAX_TEXT_LEN ? s.substring(0, MAX_TEXT_LEN) : s);
                }
                if (depth >= MAX_DEPTH) continue;
                for (int i = node.getChildCount() - 1; i >= 0; i--) {
                    AccessibilityNodeInfo child = node.getChild(i);
                    if (child != null) {
                        stack.push(child);
                        depths.push(depth + 1);
                    }
                }
            } finally {
                // API 33 起 recycle 已废弃为 no-op，旧版本主动回收防泄漏
                node.recycle();
            }
        }
        return out;
    }

    // ---------- 预过滤正则 ----------

    /** 金额：¥/￥ 前缀，或「两位小数 + 元」 */
    private static final java.util.regex.Pattern MONEY =
            java.util.regex.Pattern.compile("[¥￥]\\s*[0-9]+(?:\\.[0-9]{1,2})?|[0-9]+\\.[0-9]{2}\\s*元");
    /** 收支语境词 */
    private static final java.util.regex.Pattern KEYWORD =
            java.util.regex.Pattern.compile("支付|付款|收款|到账|转账|红包|消费|退款|收钱|入账|余额|零钱|扣款|转出|充值");

    private static String md5(String s) {
        try {
            java.security.MessageDigest d = java.security.MessageDigest.getInstance("MD5");
            byte[] h = d.digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder(h.length * 2);
            for (byte b : h) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(s.hashCode());
        }
    }
}
