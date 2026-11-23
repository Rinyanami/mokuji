package app.mokuji.reader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String LOCAL_HOST = "local.mokuji.app";
    private static final String START_URL = "https://" + LOCAL_HOST + "/#/shelf";
    private static final int FILE_CHOOSER_REQ = 4102;
    private static final int EXPORT_FILE_REQ = 4103;

    private WebView webView;
    private ValueCallback<Uri[]> pendingUpload;
    private String pendingExportText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(247, 247, 242));
        getWindow().setNavigationBarColor(Color.rgb(247, 247, 242));
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        );

        webView = new WebView(this);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new NativeBridge(), "MokujiNative");
        webView.setWebViewClient(new OfflineAssetClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingUpload != null) pendingUpload.onReceiveValue(null);
                pendingUpload = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQ);
                    return true;
                } catch (Exception e) {
                    pendingUpload = null;
                    return false;
                }
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("目次 Mokuji")
                    .setMessage(message)
                    .setPositiveButton("确定", (d, w) -> result.confirm())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("确认操作")
                    .setMessage(message)
                    .setPositiveButton("确定", (d, w) -> result.confirm())
                    .setNegativeButton("取消", (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                EditText input = new EditText(MainActivity.this);
                input.setInputType(InputType.TYPE_CLASS_TEXT);
                if (defaultValue != null) input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("目次 Mokuji")
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton("确定", (d, w) -> result.confirm(input.getText().toString()))
                    .setNegativeButton("取消", (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
                return true;
            }
        });

        setContentView(webView);
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(resolveInitialUrl(getIntent()));
        }
    }

    private String resolveInitialUrl(Intent intent) {
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())) {
            String shared = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (shared != null && !shared.trim().isEmpty()) {
                try {
                    String q = URLEncoder.encode(shared.trim(), "UTF-8");
                    return "https://" + LOCAL_HOST + "/?sniff=" + q + "#/sources";
                } catch (Exception ignored) {}
            }
        }
        return START_URL;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String next = resolveInitialUrl(intent);
        if (!START_URL.equals(next) && webView != null) {
            webView.loadUrl(next);
        }
    }

    @Override
    protected void onActivityResult(int reqCode, int resultCode, Intent data) {
        super.onActivityResult(reqCode, resultCode, data);
        if (reqCode == FILE_CHOOSER_REQ && pendingUpload != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            pendingUpload.onReceiveValue(result);
            pendingUpload = null;
        } else if (reqCode == EXPORT_FILE_REQ && resultCode == RESULT_OK && data != null && data.getData() != null && pendingExportText != null) {
            try (OutputStream os = getContentResolver().openOutputStream(data.getData())) {
                if (os != null) os.write(pendingExportText.getBytes(StandardCharsets.UTF_8));
            } catch (Exception ignored) {}
            pendingExportText = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private String guessMime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".json") || path.endsWith(".webmanifest")) return "application/json";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private final class OfflineAssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!LOCAL_HOST.equalsIgnoreCase(uri.getHost())) return null;
            String rawPath = uri.getPath();
            if (rawPath == null || "/".equals(rawPath) || rawPath.isEmpty()) rawPath = "/index.html";
            if (rawPath.startsWith("/api/")) return null;
            String clean = rawPath.replaceAll("^/+", "");
            if (clean.contains("..")) return null;
            try {
                InputStream in = getAssets().open("web/" + clean);
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                headers.put("Cache-Control", "no-store");
                return new WebResourceResponse(guessMime(clean), "UTF-8", 200, "OK", headers, in);
            } catch (IOException missing) {
                return null;
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String host = uri.getHost();
            if (host != null && (LOCAL_HOST.equalsIgnoreCase(host) || "127.0.0.1".equals(host) || host.startsWith("192.168.") || host.startsWith("10."))) {
                return false;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {}
            return true;
        }
    }

    public final class NativeBridge {
        @JavascriptInterface
        public boolean isOfflineShell() {
            return true;
        }

        @JavascriptInterface
        public void setSystemTheme(String theme) {
            boolean dark = "dark".equalsIgnoreCase(theme);
            runOnUiThread(() -> {
                int bg = dark ? Color.rgb(14, 16, 21) : Color.rgb(248, 249, 251);
                getWindow().setStatusBarColor(bg);
                getWindow().setNavigationBarColor(bg);
                getWindow().getDecorView().setSystemUiVisibility(
                    dark ? 0 : (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)
                );
            });
        }

        @JavascriptInterface
        public String fetchText(String urlStr) {
            try {
                JSONObject res = new JSONObject(httpRequest(urlStr, "GET", "{}", ""));
                return res.optString("body", "");
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String httpRequest(String urlStr, String method, String headersJson, String bodyBase64) {
            HttpURLConnection conn = null;
            JSONObject out = new JSONObject();
            try {
                URL url = new URL(urlStr);
                conn = (HttpURLConnection) url.openConnection();
                String upperMethod = (method == null || method.isEmpty()) ? "GET" : method.toUpperCase();
                conn.setRequestMethod(upperMethod);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(25000);
                conn.setRequestProperty("User-Agent", "MokujiAndroid/2.0");

                if (headersJson != null && !headersJson.isEmpty()) {
                    JSONObject hdrs = new JSONObject(headersJson);
                    Iterator<String> keys = hdrs.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        if (!"host".equalsIgnoreCase(k) && !"content-length".equalsIgnoreCase(k)) {
                            conn.setRequestProperty(k, hdrs.optString(k, ""));
                        }
                    }
                }

                if (bodyBase64 != null && !bodyBase64.isEmpty() && !"GET".equals(upperMethod) && !"HEAD".equals(upperMethod)) {
                    byte[] payload = Base64.decode(bodyBase64, Base64.DEFAULT);
                    conn.setDoOutput(true);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(payload);
                    }
                }

                int code = conn.getResponseCode();
                InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                ByteArrayOutputStream bufOut = new ByteArrayOutputStream();
                if (in != null) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) bufOut.write(buf, 0, n);
                }
                out.put("ok", code >= 200 && code < 300);
                out.put("status", code);
                out.put("body", new String(bufOut.toByteArray(), StandardCharsets.UTF_8));
                return out.toString();
            } catch (Exception e) {
                try {
                    out.put("ok", false);
                    out.put("status", 0);
                    out.put("body", "");
                    out.put("error", e.getMessage() != null ? e.getMessage() : "network error");
                } catch (Exception ignored) {}
                return out.toString();
            } finally {
                if (conn != null) conn.disconnect();
            }
        }

        @JavascriptInterface
        public boolean saveTextFile(String filename, String content) {
            pendingExportText = content;
            runOnUiThread(() -> {
                try {
                    Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    create.addCategory(Intent.CATEGORY_OPENABLE);
                    create.setType("application/json");
                    create.putExtra(Intent.EXTRA_TITLE, filename != null && !filename.isEmpty() ? filename : "mokuji-backup.json");
                    startActivityForResult(create, EXPORT_FILE_REQ);
                } catch (Exception ignored) {}
            });
            return true;
        }
    }
}
