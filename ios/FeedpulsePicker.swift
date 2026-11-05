import CryptoKit
import DeviceCheck
import Foundation
import UIKit
import React
import Feedpulse

/// ブリッジ層。ピッカー本体は iOS SDK（`Feedpulse.pickTarget`）。
/// アプリ証明（App Attest）・端末情報・config の保存は、このパッケージ自身の実装（iOS SDK の新 API には依存しない）。
/// 実機の App Attest 動作は CI では検証していない（シミュレーターは App Attest 非対応）。
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

  // MARK: - アプリ証明・端末情報・保存

  private static let keyIdDefaultsKey = "dev.feedpulse.appattest.keyId"
  private static let pendingKeyIdDefaultsKey = "dev.feedpulse.appattest.pendingKeyId"
  private static let storePrefix = "dev.feedpulse.store."

  @objc func environment(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    let v = ProcessInfo.processInfo.operatingSystemVersion
    let os = v.patchVersion > 0
      ? "iOS \(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
      : "iOS \(v.majorVersion).\(v.minorVersion)"
    resolve([
      "platform": "ios",
      "appId": Bundle.main.bundleIdentifier ?? "",
      "os": os,
      "timezone": TimeZone.current.identifier,
    ])
  }

  /// 鍵 ID が保存済みなら assertion、無ければ鍵を作って attestation。
  /// clientDataHash = SHA256(challenge の UTF-8)。keyId は base64（標準、パディングあり）のまま送る。
  /// 新しい鍵の keyId は保留にし、サーバーが受理した後の `commitAttestation` で確定する。
  @objc func attest(_ challenge: String,
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
    let service = DCAppAttestService.shared
    guard service.isSupported else {
      reject("app_attest_unsupported", "この端末は App Attest 非対応（シミュレーターなど）", nil)
      return
    }
    let hash = Data(SHA256.hash(data: Data(challenge.utf8)))
    if let keyId = UserDefaults.standard.string(forKey: Self.keyIdDefaultsKey) {
      service.generateAssertion(keyId, clientDataHash: hash) { assertion, _ in
        if let assertion = assertion {
          resolve([
            "type": "app_attest_assertion",
            "keyId": keyId,
            "assertion": assertion.base64EncodedString(),
          ])
          return
        }
        // 保存した鍵が使えない（復元・端末移行など）。捨てて新しい鍵で attestation に進む。
        UserDefaults.standard.removeObject(forKey: Self.keyIdDefaultsKey)
        self.attestNewKey(service: service, hash: hash, resolve: resolve, reject: reject)
      }
      return
    }
    attestNewKey(service: service, hash: hash, resolve: resolve, reject: reject)
  }

  private func attestNewKey(service: DCAppAttestService, hash: Data,
                            resolve: @escaping RCTPromiseResolveBlock,
                            reject: @escaping RCTPromiseRejectBlock) {
    service.generateKey { keyId, error in
      guard let keyId = keyId else {
        reject("app_attest_failed", error?.localizedDescription ?? "generateKey failed", error as NSError?)
        return
      }
      service.attestKey(keyId, clientDataHash: hash) { attestation, error in
        if let attestation = attestation {
          UserDefaults.standard.set(keyId, forKey: Self.pendingKeyIdDefaultsKey)
          resolve([
            "type": "app_attest_attestation",
            "keyId": keyId,
            "attestation": attestation.base64EncodedString(),
          ])
        } else {
          reject("app_attest_failed", error?.localizedDescription ?? "attestKey failed", error as NSError?)
        }
      }
    }
  }

  @objc func commitAttestation(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
    if let pending = UserDefaults.standard.string(forKey: Self.pendingKeyIdDefaultsKey) {
      UserDefaults.standard.set(pending, forKey: Self.keyIdDefaultsKey)
      UserDefaults.standard.removeObject(forKey: Self.pendingKeyIdDefaultsKey)
    }
    resolve(nil)
  }

  @objc func resetAttestation(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    UserDefaults.standard.removeObject(forKey: Self.keyIdDefaultsKey)
    UserDefaults.standard.removeObject(forKey: Self.pendingKeyIdDefaultsKey)
    resolve(nil)
  }

  @objc func storeRead(_ key: String,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(UserDefaults.standard.string(forKey: Self.storePrefix + key))
  }

  @objc func storeWrite(_ key: String, value: String,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    UserDefaults.standard.set(value, forKey: Self.storePrefix + key)
    resolve(nil)
  }
}
