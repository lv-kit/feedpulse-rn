package dev.feedpulse.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.feedpulse.android.picker.Feedpulse
import com.feedpulse.android.picker.PickResult
import com.feedpulse.android.picker.PickerHandle
import com.feedpulse.android.picker.PickerOptions

/**
 * ブリッジ層。ピッカー本体は Android SDK（`Feedpulse.pickTarget`）。
 * RN の testID は View tag に入る。
 */
class FeedpulsePickerModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    private var handle: PickerHandle? = null

    override fun getName() = "FeedpulsePicker"

    @ReactMethod
    fun pickTarget(options: ReadableMap, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            val activity = reactApplicationContext.currentActivity
            if (activity == null) {
                promise.reject("unavailable", "No current Activity")
                return@runOnUiThread
            }
            if (handle?.isActive == true) {
                promise.reject("already_picking", "A target pick is already in progress")
                return@runOnUiThread
            }
            val labelMax = if (options.hasKey("labelMaxLength")) options.getInt("labelMaxLength") else 40
            val screen = if (options.hasKey("screen")) options.getString("screen") else null
            handle = Feedpulse.pickTarget(
                activity,
                PickerOptions(labelMaxChars = labelMax.coerceIn(0, 200), screenName = screen),
            ) { result ->
                handle = null
                when (result) {
                    is PickResult.Selected -> promise.resolve(toWritableMap(result.target.toMap()))
                    PickResult.Cancelled -> promise.resolve(null)
                    is PickResult.Unavailable -> promise.reject("unavailable", "Picker unavailable: ${result.reason}")
                }
            }
        }
    }

    @ReactMethod
    fun cancelPick() {
        UiThreadUtil.runOnUiThread { handle?.cancel() }
    }

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
