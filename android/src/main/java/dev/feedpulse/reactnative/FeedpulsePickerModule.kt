package dev.feedpulse.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil

/**
 * ブリッジ層。ピッカー本体は Android SDK 側 (#115)。
 * 想定 API: Feedpulse.pickTarget(activity, callback) -> Map<String, Any?>?（キャンセル時 null）
 * RN の testID は View tag に入る。SDK が明示 ID として読めるか要確認。
 */
class FeedpulsePickerModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "FeedpulsePicker"

    @ReactMethod
    fun pickTarget(options: ReadableMap, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            val activity = currentActivity
            if (activity == null) {
                promise.reject("unavailable", "No current Activity")
                return@runOnUiThread
            }
            // TODO: Android SDK 接続。
            // Feedpulse.pickTarget(activity) { target -> promise.resolve(target?.toWritableMap()) }
            promise.reject("unavailable", "Android SDK picker (#115) is not connected yet")
        }
    }

    @ReactMethod
    fun cancelPick() {
        UiThreadUtil.runOnUiThread {
            // TODO: Feedpulse.cancelPick()
        }
    }
}
