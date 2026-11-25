package dev.feedpulse.reactnative

import android.content.Context
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.feedpulse.android.picker.Feedpulse
import com.feedpulse.android.picker.PickResult
import com.feedpulse.android.picker.PickerHandle
import com.feedpulse.android.picker.PickerOptions
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import java.util.TimeZone

/**
 * ブリッジ層。ピッカー本体は Android SDK（`Feedpulse.pickTarget`）。
 * アプリ証明（Play Integrity）・端末情報・config の保存は、このパッケージ自身の実装（Android SDK の新 API には依存しない）。
 * 実機の Play Integrity 動作は CI では検証していない。
 * RN の testID は View tag に入る。
 */
class FeedpulsePickerModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    private var handle: PickerHandle? = null

    override fun getName() = "FeedpulsePicker"

    @ReactMethod
    fun pickTarget(options: ReadableMap, promise: Promise) {
        val labelMax: Int
        val screen: String?
        try {
            labelMax = readLabelMaxLength(options)
            screen = readScreen(options)
        } catch (e: IllegalArgumentException) {
            promise.reject("invalid_options", e.message)
            return
        }
        UiThreadUtil.runOnUiThread {
            try {
                val activity = reactApplicationContext.currentActivity
                if (activity == null) {
                    promise.reject("unavailable", "No current Activity")
                    return@runOnUiThread
                }
                if (handle?.isActive == true) {
                    promise.reject("already_picking", "A target pick is already in progress")
                    return@runOnUiThread
                }
                handle = Feedpulse.pickTarget(
                    activity,
                    PickerOptions(labelMaxChars = labelMax, screenName = screen),
                ) { result ->
                    handle = null
                    try {
                        when (result) {
                            is PickResult.Selected -> promise.resolve(toWritableMap(result.target.toMap()))
                            PickResult.Cancelled -> promise.resolve(null)
                            is PickResult.Unavailable -> promise.reject("unavailable", "Picker unavailable: ${result.reason}")
                        }
                    } catch (e: Exception) {
                        promise.reject("pick_failed", e.message, e)
                    }
                }
            } catch (e: Exception) {
                handle = null
                promise.reject("pick_failed", e.message, e)
            }
        }
    }

    /** 未指定・null は既定の 40。数値以外・非有限・整数でない値は `invalid_options`。 */
    private fun readLabelMaxLength(options: ReadableMap): Int {
        if (!options.hasKey("labelMaxLength") || options.isNull("labelMaxLength")) return 40
        if (options.getType("labelMaxLength") != ReadableType.Number) {
            throw IllegalArgumentException("labelMaxLength must be a number")
        }
        val v = options.getDouble("labelMaxLength")
        if (v.isNaN() || v.isInfinite() || v != Math.floor(v)) {
            throw IllegalArgumentException("labelMaxLength must be an integer")
        }
        return v.coerceIn(0.0, 200.0).toInt()
    }

    /** 未指定・null は指定なし。文字列以外は `invalid_options`。 */
    private fun readScreen(options: ReadableMap): String? {
        if (!options.hasKey("screen") || options.isNull("screen")) return null
        if (options.getType("screen") != ReadableType.String) {
            throw IllegalArgumentException("screen must be a string")
        }
        return options.getString("screen")
    }

    @ReactMethod
    fun cancelPick() {
        UiThreadUtil.runOnUiThread { handle?.cancel() }
    }

    @ReactMethod
    fun environment(promise: Promise) {
        val out = Arguments.createMap()
        out.putString("platform", "android")
        out.putString("appId", reactApplicationContext.packageName)
        out.putString("os", "Android ${Build.VERSION.RELEASE}")
        out.putString("timezone", TimeZone.getDefault().id)
        promise.resolve(out)
    }

    /** classic request。サーバーは復号した判定の nonce == challenge を照合する。 */
    @ReactMethod
    fun attest(challenge: String, promise: Promise) {
        try {
            IntegrityManagerFactory.create(reactApplicationContext)
                .requestIntegrityToken(IntegrityTokenRequest.builder().setNonce(challenge).build())
                .addOnSuccessListener {
                    val out = Arguments.createMap()
                    out.putString("type", "play_integrity")
                    out.putString("token", it.token())
                    promise.resolve(out)
                }
                .addOnFailureListener { promise.reject("play_integrity_failed", it.message, it) }
        } catch (e: Exception) {
            promise.reject("play_integrity_failed", e.message, e)
        }
    }

    @ReactMethod
    fun commitAttestation(promise: Promise) = promise.resolve(null)

    @ReactMethod
    fun resetAttestation(promise: Promise) = promise.resolve(null)

    @ReactMethod
    fun storeRead(key: String, promise: Promise) = promise.resolve(prefs().getString(key, null))

    @ReactMethod
    fun storeWrite(key: String, value: String, promise: Promise) {
        prefs().edit().putString(key, value).apply()
        promise.resolve(null)
    }

    private fun prefs() = reactApplicationContext.getSharedPreferences("dev.feedpulse", Context.MODE_PRIVATE)

    private fun toWritableMap(map: Map<String, Any>): WritableMap {
        val out = Arguments.createMap()
        for ((k, v) in map) {
            when (v) {
                is String -> out.putString(k, v)
                is Int -> out.putInt(k, v)
                is Number -> out.putDouble(k, v.toDouble())
                is Boolean -> out.putBoolean(k, v)
                is Map<*, *> -> {
                    @Suppress("UNCHECKED_CAST")
                    out.putMap(k, toWritableMap(v as Map<String, Any>))
                }
            }
        }
        return out
    }
}
