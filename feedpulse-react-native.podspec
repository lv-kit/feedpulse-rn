require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "feedpulse-react-native"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.license      = "MIT"
  s.authors      = "Feedpulse"
  s.homepage     = "https://github.com/lv-kit/feedpulse-rn"
  s.platforms    = { :ios => "15.0" }
  s.source       = { :git => "https://github.com/lv-kit/feedpulse-rn.git", :tag => s.version.to_s }
  s.source_files = "ios/**/*.{h,m,swift}"
  s.swift_version = "5.0"
  s.dependency "React-Core"
  # iOS SDK は SwiftPM 配布（lv-kit/feedpulse-ios）。React Native 0.75+ の spm_dependency で取り込む。
  spm_dependency(s,
    url: "https://github.com/lv-kit/feedpulse-ios.git",
    requirement: { kind: "upToNextMajorVersion", minimumVersion: "0.1.0" },
    products: ["Feedpulse"]
  )
end
