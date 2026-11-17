package com.chatwithdeepseek.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 单 WebView 壳。
 *
 * 关键点：页面通过 WebViewAssetLoader 以 https://appassets.androidplatform.net 提供，
 * 而不是 file://。file:// 页面的 origin 是 null，会让所有指向 api.deepseek.com 的
 * 跨域请求被拦截；https 伪源还有额外好处：它是 secure context，语音输入
 * （getUserMedia）在 Android 上要求安全上下文。
 */
public class MainActivity extends AppCompatActivity {

    /** 本地资源入口；末尾没有斜杠，asset 路径直接拼在后面 */
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_URL =
            "https://" + APP_HOST + "/assets/web/index.html";

    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_MIC = 1002;

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private FrameLayout rootView;

    /** 网页触发 <input type=file> 时的回调，等系统选择器返回 */
    @Nullable
    private ValueCallback<Uri[]> fileCallback;

    /** 录音授权请求：拿到系统权限后要回填给 WebView */
    @Nullable
    private PermissionRequest pendingAudioRequest;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            initialize(savedInstanceState);
        } catch (Throwable error) {
            showStartupError(error);
        }
    }

    private void initialize(@Nullable Bundle savedInstanceState) {
        // Android 9 起支持固定 WebView 数据目录；Android 8 使用系统默认目录。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WebView.setDataDirectorySuffix("chat");
        }
        // 仅调试包开放 WebView 远程调试，便于在 edge://inspect 中查看真机页面。
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        // Android 15 起 targetSdk 35+ 强制全面屏，网页会画到状态栏和导航栏下面。
        // 这里显式声明 edge-to-edge，并把真实系统栏高度作为 WebView 的布局边距。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        }

        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(APP_HOST)
                // 允许以 https 伪源读取 assets/web/ 下的构建产物
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(ContextCompat.getColor(this, R.color.window_background));
        rootView = container;

        webView = new WebView(this);
        container.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(container);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            ViewCompat.setOnApplyWindowInsetsListener(container, (view, windowInsets) -> {
                Insets systemBars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
                Insets cutout =
                        windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout());
                view.setPadding(
                        Math.max(systemBars.left, cutout.left),
                        Math.max(systemBars.top, cutout.top),
                        Math.max(systemBars.right, cutout.right),
                        Math.max(systemBars.bottom, cutout.bottom));
                return windowInsets;
            });
            ViewCompat.requestApplyInsets(container);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // 会话与附件存在 IndexedDB，需要足够的配额与持久性
        settings.setDatabasePath(getApplicationContext().getFilesDir().getAbsolutePath());
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        // 让 <input type=file> 直接打开系统选择器
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        // 历史导出使用的是 blob: 下载链接，WebView 原生不支持，交给原生桥接保存
        webView.addJavascriptInterface(new DownloadBridge(), "AndroidDownload");
        // target="_blank" 在 WebView 里不一定触发 shouldOverrideUrlLoading，
        // 网页点击外链时通过这个桥直接交给系统浏览器。
        webView.addJavascriptInterface(new ExternalLinkBridge(), "AndroidExternal");
        // 应用内手动切换深浅色时，让状态栏、导航栏和网页使用同一套背景与图标颜色
        webView.addJavascriptInterface(new ThemeBridge(), "AndroidTheme");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                // 只有本地资源交给 AssetLoader，远端请求原样放行
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(
                    WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                // 应用内部页面（含 hash 路由）留在 WebView 里
                if (APP_HOST.equals(uri.getHost())) {
                    return false;
                }
                // 其余一律交给系统浏览器 / 默认应用：
                // 例如「前往充值」跳 platform.deepseek.com/top_up、外部链接
                openExternally(uri);
                return true;
            }

            @Override
            public boolean onRenderProcessGone(
                    WebView view, RenderProcessGoneDetail detail) {
                // 渲染进程被系统回收时如果返回 false，应用会直接闪退。
                if (webView == view) {
                    webView = null;
                    ViewGroup parent = view.getParent() instanceof ViewGroup
                            ? (ViewGroup) view.getParent()
                            : null;
                    if (parent != null) {
                        parent.removeView(view);
                    }
                    view.destroy();
                    if (!isFinishing() && !isDestroyed()) {
                        Toast.makeText(
                                MainActivity.this,
                                "页面渲染进程已重启，请重新打开应用",
                                Toast.LENGTH_LONG).show();
                        recreate();
                    }
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }

            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    // 允许多选（网页最多可附多个文件）
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(intent, REQ_FILE_CHOOSER);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        // 返回手势/按键：能后退就后退，退到底再退出应用
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl(APP_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    /** 启动阶段出现原生异常时展示错误信息，避免只表现为无提示闪退。 */
    private void showStartupError(Throwable error) {
        try {
            if (webView != null) {
                webView.destroy();
                webView = null;
            }

            LinearLayout container = new LinearLayout(this);
            container.setOrientation(LinearLayout.VERTICAL);
            int padding = Math.round(20 * getResources().getDisplayMetrics().density);
            container.setPadding(padding, padding, padding, padding);

            TextView title = new TextView(this);
            title.setText("ChatWithDeepseek 启动失败");
            title.setTextSize(20);
            title.setTextColor(0xFF1B1B1C);
            container.addView(title);

            TextView detail = new TextView(this);
            StringBuilder message = new StringBuilder();
            message.append(error).append("\n\n");
            for (StackTraceElement element : error.getStackTrace()) {
                message.append(element).append('\n');
            }
            final String fullMessage = message.toString();
            detail.setText(fullMessage);
            detail.setTextSize(12);
            detail.setTextIsSelectable(true);
            detail.setTextColor(0xFF454545);
            detail.setPadding(0, padding, 0, padding);

            ScrollView scroll = new ScrollView(this);
            scroll.addView(detail, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT));
            container.addView(scroll, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

            Button copy = new Button(this);
            copy.setText("复制错误信息");
            copy.setOnClickListener(v -> {
                ClipboardManager clipboard =
                        (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(ClipData.newPlainText("startup-error", fullMessage));
                Toast.makeText(this, "错误信息已复制", Toast.LENGTH_SHORT).show();
            });
            container.addView(copy, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            container.setBackgroundColor(0xFFFFFFFF);
            setContentView(container);
        } catch (Throwable ignored) {
            throw new RuntimeException(error);
        }
    }

    /** 处理网页发起的能力请求：目前只放行麦克风，其余一律拒绝 */
    private void handleWebPermissionRequest(PermissionRequest request) {
        List<String> granted = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && hasMicPermission()) {
                granted.add(resource);
            }
        }
        if (granted.isEmpty() || !hasMicPermission()) {
            // 还没有系统录音权限：先申请，拿到后由 onRequestPermissionsResult 回填
            if (containsAudio(request.getResources())) {
                pendingAudioRequest = request;
                ActivityCompat.requestPermissions(
                        this, new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                return;
            }
            request.deny();
            return;
        }
        request.grant(granted.toArray(new String[0]));
    }

    private boolean containsAudio(String[] resources) {
        for (String resource : resources) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                return true;
            }
        }
        return false;
    }

    private boolean hasMicPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_MIC) {
            return;
        }
        PermissionRequest request = pendingAudioRequest;
        pendingAudioRequest = null;
        if (request == null) {
            return;
        }
        boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            request.deny();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE_CHOOSER || fileCallback == null) {
            return;
        }
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(results);
        fileCallback = null;
    }

    private void openExternally(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "没有可打开该链接的应用", Toast.LENGTH_SHORT).show();
        }
    }

    /** 网页外链桥：只接受 http/https，统一交给系统浏览器打开。 */
    private class ExternalLinkBridge {

        @JavascriptInterface
        public boolean open(String url) {
            if (url == null) {
                return false;
            }
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme();
            if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
                return false;
            }
            runOnUiThread(() -> openExternally(uri));
            return true;
        }
    }

    /** 网页主题桥：同步原生系统栏背景和图标明暗。 */
    private class ThemeBridge {

        @JavascriptInterface
        public void setDark(boolean dark) {
            runOnUiThread(() -> applySystemTheme(dark));
        }
    }

    private void applySystemTheme(boolean dark) {
        int color = dark ? Color.rgb(21, 21, 23) : Color.WHITE;
        if (rootView != null) {
            rootView.setBackgroundColor(color);
        }
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /**
     * 导出下载的原生桥。
     *
     * 网页用 createObjectURL 生成 blob 再触发 <a download>，WebView 不会处理这种下载，
     * 因此由网页把 Blob 读成 base64 后调用这里，写入系统「下载」目录。
     * 只接受文件名 + base64 内容，不涉及任何权限提升。
     */
    private class DownloadBridge {

        @JavascriptInterface
        public boolean save(String fileName, String mimeType, String base64Data) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                String safeName = sanitizeFileName(fileName);

                // Android 8 没有公共 Downloads 的 MediaStore 集合，保存到应用专属下载目录。
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    if (!DownloadsApi29.save(
                            getApplicationContext(), safeName, mimeType, bytes)) {
                        return false;
                    }
                    runOnUiThread(() -> Toast.makeText(
                            MainActivity.this,
                            "已保存到下载目录：" + safeName,
                            Toast.LENGTH_LONG).show());
                    return true;
                } else {
                    return saveLegacyDownload(safeName, bytes);
                }
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(
                        MainActivity.this,
                        "保存失败：" + e.getMessage(),
                        Toast.LENGTH_LONG).show());
                return false;
            }
        }

        private boolean saveLegacyDownload(String safeName, byte[] bytes) {
            try {
                File directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (directory == null) {
                    directory = new File(getFilesDir(), "downloads");
                }
                if (!directory.exists() && !directory.mkdirs()) {
                    return false;
                }
                File target = new File(directory, safeName);
                try (FileOutputStream out = new FileOutputStream(target)) {
                    out.write(bytes);
                    out.flush();
                }
                String path = target.getAbsolutePath();
                runOnUiThread(() -> Toast.makeText(
                        MainActivity.this,
                        "已保存到：" + path,
                        Toast.LENGTH_LONG).show());
                return true;
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(
                        MainActivity.this,
                        "保存失败：" + e.getMessage(),
                        Toast.LENGTH_LONG).show());
                return false;
            }
        }

        /** 去掉路径分隔符等可能触发异常或越权的字符 */
        private String sanitizeFileName(String name) {
            if (name == null || name.trim().isEmpty()) {
                return "deepseek-export.zip";
            }
            String cleaned = name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && cleaned.length() > 120) {
                cleaned = cleaned.substring(0, 120);
            }
            return cleaned.isEmpty() ? "deepseek-export.zip" : cleaned;
        }
    }
}
