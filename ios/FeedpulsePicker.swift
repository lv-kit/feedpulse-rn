import Foundation
import UIKit
import React
import Feedpulse

/// ブリッジ層。ピッカー本体は iOS SDK（`Feedpulse.pickTarget`）。
/// RN の testID は accessibilityIdentifier に入るため、SDK が明示 ID として読み `target.id` になる。
@objc(FeedpulsePicker)
final class FeedpulsePicker: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc func pickTarget(_ options: NSDictionary,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task { @MainActor in
      let screen = options["screen"] as? String
      let limit = (options["labelMaxLength"] as? NSNumber)?.intValue ?? FeedpulseTargetLimits.defaultLabel
      Feedpulse.pickTarget(screenName: screen, labelLimit: limit) { result in
        switch result {
        case .success(let target):
          resolve(target.jsonObject)
        case .failure(.cancelled):
          resolve(nil)
        case .failure(.alreadyActive):
          reject("already_picking", "A target pick is already in progress", nil)
        case .failure(.noActiveScene):
          reject("unavailable", "No active window scene", nil)
        }
      }
    }
  }

  @objc func cancelPick() {
    Task { @MainActor in Feedpulse.cancelPicker() }
  }
}
