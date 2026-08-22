package de.com.yoowee.chat;

import android.webkit.CookieManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

@CapacitorPlugin(name = "NativeRealtime")
public final class NativeRealtimePlugin extends Plugin {
    private static final int NORMAL_CLOSE = 1000;
    private static final int INVALID_PAYLOAD_CLOSE = 4400;
    private static final int MAX_FRAME_CHARACTERS = 262_144;

    private final Object stateLock = new Object();
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build();
    private SocketState active;

    private final class SocketState extends WebSocketListener {
        private final long connectionId;
        private final AtomicBoolean closeNotified = new AtomicBoolean(false);
        private WebSocket socket;

        private SocketState(long connectionId) {
            this.connectionId = connectionId;
        }

        @Override
        public void onOpen(WebSocket webSocket, Response response) {
            socket = webSocket;
            JSObject event = event(connectionId);
            notifyListeners("realtimeOpen", event);
        }

        @Override
        public void onMessage(WebSocket webSocket, String text) {
            if (text.length() > MAX_FRAME_CHARACTERS) {
                webSocket.close(INVALID_PAYLOAD_CLOSE, "invalid frame");
                return;
            }
            JSObject event = event(connectionId);
            event.put("data", text);
            notifyListeners("realtimeMessage", event);
        }

        @Override
        public void onClosing(WebSocket webSocket, int code, String reason) {
            webSocket.close(code, null);
        }

        @Override
        public void onClosed(WebSocket webSocket, int code, String reason) {
            emitClose(code);
            clearIfActive(this);
        }

        @Override
        public void onFailure(WebSocket webSocket, Throwable error, Response response) {
            emitClose(1006);
            clearIfActive(this);
        }

        private void emitClose(int code) {
            if (!closeNotified.compareAndSet(false, true)) return;
            JSObject event = event(connectionId);
            event.put("code", code);
            notifyListeners("realtimeClose", event);
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String url = call.getString("url");
        String origin = call.getString("origin");
        Long connectionId = call.getLong("connectionId");
        if (url == null || origin == null || connectionId == null) {
            call.reject("native realtime options are incomplete");
            return;
        }
        if (!validSocketUrl(url) || !validAppOrigin(origin)) {
            call.reject("native realtime endpoint is invalid");
            return;
        }
        String cookie = CookieManager.getInstance().getCookie(httpCookieUrl(url));
        if (cookie == null || cookie.isBlank()) {
            call.reject("native realtime session cookie is unavailable");
            return;
        }

        SocketState next = new SocketState(connectionId);
        synchronized (stateLock) {
            if (active != null && active.socket != null) {
                active.socket.close(NORMAL_CLOSE, "replaced");
            }
            active = next;
        }
        Request request = new Request.Builder()
            .url(url)
            .header("Origin", origin)
            .header("Cookie", cookie)
            .build();
        next.socket = client.newWebSocket(request, next);
        call.resolve();
    }

    @PluginMethod
    public void send(PluginCall call) {
        String data = call.getString("data");
        Long connectionId = call.getLong("connectionId");
        if (data == null || connectionId == null || data.length() > MAX_FRAME_CHARACTERS) {
            call.reject("native realtime frame is invalid");
            return;
        }
        SocketState current;
        synchronized (stateLock) {
            current = active;
        }
        if (current == null || current.connectionId != connectionId || current.socket == null
            || !current.socket.send(data)) {
            call.reject("native realtime connection is unavailable");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void close(PluginCall call) {
        Long connectionId = call.getLong("connectionId");
        if (connectionId == null) {
            call.reject("native realtime connection id is missing");
            return;
        }
        SocketState current;
        synchronized (stateLock) {
            current = active;
            if (current != null && current.connectionId == connectionId) active = null;
        }
        if (current != null && current.connectionId == connectionId && current.socket != null) {
            current.socket.close(NORMAL_CLOSE, "page closed");
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        SocketState current;
        synchronized (stateLock) {
            current = active;
            active = null;
        }
        if (current != null && current.socket != null) {
            current.socket.close(NORMAL_CLOSE, "app closed");
        }
        client.dispatcher().executorService().shutdown();
        client.connectionPool().evictAll();
    }

    private void clearIfActive(SocketState expected) {
        synchronized (stateLock) {
            if (active == expected) active = null;
        }
    }

    private static JSObject event(long connectionId) {
        JSObject event = new JSObject();
        event.put("connectionId", connectionId);
        return event;
    }

    private static boolean validSocketUrl(String value) {
        try {
            URI uri = new URI(value);
            return "wss".equals(uri.getScheme())
                && uri.getHost() != null
                && uri.getUserInfo() == null
                && "/api/v1/realtime".equals(uri.getPath())
                && uri.getQuery() == null
                && uri.getFragment() == null;
        } catch (URISyntaxException error) {
            return false;
        }
    }

    private static boolean validAppOrigin(String value) {
        try {
            URI uri = new URI(value);
            return ("https".equals(uri.getScheme()) || "capacitor".equals(uri.getScheme()))
                && "app.yvchat.local".equals(uri.getHost())
                && uri.getPort() == -1
                && (uri.getPath() == null || uri.getPath().isEmpty())
                && uri.getQuery() == null
                && uri.getFragment() == null
                && uri.getUserInfo() == null;
        } catch (URISyntaxException error) {
            return false;
        }
    }

    private static String httpCookieUrl(String socketUrl) {
        return "https:" + socketUrl.substring("wss:".length());
    }
}
