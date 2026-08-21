package ru.yoowee.chat;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.PowerManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {
    private AudioManager audioManager;
    private PowerManager powerManager;
    private PowerManager.WakeLock proximityWakeLock;
    private AudioFocusRequest audioFocusRequest;
    private AudioManager.OnAudioFocusChangeListener audioFocusListener;
    private AudioManager.OnCommunicationDeviceChangedListener communicationDeviceListener;
    private boolean active;
    private boolean proximityRequested;
    private int previousMode = AudioManager.MODE_NORMAL;
    private boolean previousSpeakerphone;

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            communicationDeviceListener = device -> {
                syncProximity();
                notifyListeners("routeChanged", routeState());
            };
            audioManager.addOnCommunicationDeviceChangedListener(
                getContext().getMainExecutor(),
                communicationDeviceListener
            );
        }
    }

    @PluginMethod
    public void activate(PluginCall call) {
        if (!active) {
            previousMode = audioManager.getMode();
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                previousSpeakerphone = audioManager.isSpeakerphoneOn();
            }
            requestAudioFocus();
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            active = true;
        }
        call.resolve(routeState());
    }

    @PluginMethod
    public void setVideo(PluginCall call) {
        call.resolve(routeState());
    }

    @PluginMethod
    public void setRoute(PluginCall call) {
        if (!active) {
            call.reject("call audio is inactive");
            return;
        }
        String route = call.getString("route", "system");
        boolean selected = selectRoute(route);
        if (!selected) {
            call.reject("requested audio route is unavailable");
            return;
        }
        syncProximity();
        JSObject state = routeState();
        notifyListeners("routeChanged", state);
        call.resolve(state);
    }

    @PluginMethod
    public void setProximity(PluginCall call) {
        proximityRequested = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        syncProximity();
        call.resolve();
    }

    @PluginMethod
    public void deactivate(PluginCall call) {
        deactivateAudio();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        deactivateAudio();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && communicationDeviceListener != null) {
            audioManager.removeOnCommunicationDeviceChangedListener(communicationDeviceListener);
        }
        super.handleOnDestroy();
    }

    private void requestAudioFocus() {
        audioFocusListener = focusChange -> { };
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(audioFocusListener)
                .build();
            audioManager.requestAudioFocus(audioFocusRequest);
        } else {
            audioManager.requestAudioFocus(
                audioFocusListener,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
            );
        }
    }

    @SuppressWarnings("deprecation")
    private boolean selectRoute(String route) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if ("system".equals(route)) {
                audioManager.clearCommunicationDevice();
                return true;
            }
            int desiredType = "speaker".equals(route)
                ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                : "earpiece".equals(route)
                    ? AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                    : -1;
            if (desiredType == -1) return false;
            for (AudioDeviceInfo device : audioManager.getAvailableCommunicationDevices()) {
                if (device.getType() == desiredType) {
                    return audioManager.setCommunicationDevice(device);
                }
            }
            return false;
        }
        if ("system".equals(route) || "earpiece".equals(route)) {
            audioManager.setSpeakerphoneOn(false);
            return true;
        }
        if ("speaker".equals(route)) {
            audioManager.setSpeakerphoneOn(true);
            return true;
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    private JSObject routeState() {
        JSObject state = new JSObject();
        state.put("selectedRoute", currentRoute());
        state.put("earpieceAvailable", hasEarpiece());
        return state;
    }

    @SuppressWarnings("deprecation")
    private String currentRoute() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo selected = audioManager.getCommunicationDevice();
            if (selected != null && selected.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                return "speaker";
            } else if (selected != null && selected.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
                return "earpiece";
            }
            return "system";
        }
        if (audioManager.isSpeakerphoneOn()) return "speaker";
        if (audioManager.isBluetoothScoOn() || audioManager.isWiredHeadsetOn()) return "system";
        return hasEarpiece() ? "earpiece" : "system";
    }

    private boolean hasEarpiece() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
            for (AudioDeviceInfo device : devices) {
                if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) return true;
            }
            return false;
        }
        for (AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) return true;
        }
        return false;
    }

    private void syncProximity() {
        boolean shouldHold = active && proximityRequested && "earpiece".equals(currentRoute())
            && powerManager.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK);
        if (shouldHold) {
            if (proximityWakeLock == null) {
                proximityWakeLock = powerManager.newWakeLock(
                    PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK,
                    getContext().getPackageName() + ":call-proximity"
                );
                proximityWakeLock.setReferenceCounted(false);
            }
            if (!proximityWakeLock.isHeld()) proximityWakeLock.acquire(8 * 60 * 60 * 1000L);
        } else {
            releaseProximity();
        }
    }

    private void releaseProximity() {
        if (proximityWakeLock != null && proximityWakeLock.isHeld()) {
            proximityWakeLock.release();
        }
    }

    @SuppressWarnings("deprecation")
    private void deactivateAudio() {
        proximityRequested = false;
        releaseProximity();
        if (!active) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.clearCommunicationDevice();
        } else {
            audioManager.setSpeakerphoneOn(previousSpeakerphone);
        }
        audioManager.setMode(previousMode);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        } else if (audioFocusListener != null) {
            audioManager.abandonAudioFocus(audioFocusListener);
        }
        audioFocusRequest = null;
        audioFocusListener = null;
        active = false;
    }
}
