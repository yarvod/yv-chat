package de.com.yoowee.chat;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallAudioPlugin.class);
        registerPlugin(NativeRealtimePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
