package com.qingyu.ledger;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // v1.5 收支监控：注册本地通知监听插件
        registerPlugin(NotifyCatchPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
