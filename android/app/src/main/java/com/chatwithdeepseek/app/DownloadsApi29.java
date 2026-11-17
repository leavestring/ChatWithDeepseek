package com.chatwithdeepseek.app;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import androidx.annotation.RequiresApi;

import java.io.OutputStream;

/** Android 10 以上使用系统公共 Downloads；整类隔离，避免旧系统加载新 API 引用。 */
@RequiresApi(Build.VERSION_CODES.Q)
final class DownloadsApi29 {

    private DownloadsApi29() {
    }

    static boolean save(Context context, String fileName, String mimeType, byte[] bytes) {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            if (mimeType != null && !mimeType.isEmpty()) {
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            }
            // 让文件立刻出现在「下载」中，不需要额外的存储权限
            values.put(MediaStore.Downloads.IS_PENDING, 0);

            Uri target = context.getContentResolver()
                    .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (target == null) {
                return false;
            }
            try (OutputStream out = context.getContentResolver().openOutputStream(target)) {
                if (out == null) {
                    return false;
                }
                out.write(bytes);
                out.flush();
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
