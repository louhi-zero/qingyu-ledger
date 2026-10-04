package com.qingyu.ledger;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // v1.5 收支监控：注册本地通知监听插件
        registerPlugin(NotifyCatchPlugin.class);
        // v2.1 无障碍支付页捕获：App 本地插件必须手动注册（capacitor.plugins.json 只自动注册 npm 插件，
        // 漏注册会让 JS 侧所有 A11yCatch 调用 reject「not implemented」，无障碍通道整体失效）
        registerPlugin(QyA11yPlugin.class);
        // v1.7.0 应用内更新：注册 APK 下载/安装插件
        registerPlugin(UpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
