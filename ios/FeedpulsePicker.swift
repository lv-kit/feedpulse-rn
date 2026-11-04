import Foundation
import UIKit
import React
// import Feedpulse  // TODO: iOS SDK (#114) の公開後に有効化

/// ブリッジ層。ピッカー本体は iOS SDK 側 (#114)。
/// 想定 API: Feedpulse.pickTarget(screen:completion:) -> [String: Any]?（キャンセル時 nil）
/// RN の testID は accessibilityIdentifier に入るため、SDK が明示 ID として読めれば target.id になる。
@objc(FeedpulsePicker)
final class FeedpulsePicker: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc func pickTarget(_ options: NSDictionary,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      // TODO: iOS SDK 接続。
      // Feedpulse.pickTarget(screen: options["screen"] as? String) { target in resolve(target) }
      reject("unavailable", "iOS SDK picker (#114) is not connected yet", nil)
    }
  }

  @objc func cancelPick() {
    DispatchQueue.main.async {
      // TODO: Feedpulse.cancelPick()
    }
  }
}
