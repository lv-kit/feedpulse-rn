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
  # iOS SDK は CocoaPods の podspec（lv-kit/feedpulse-ios）。利用側の Podfile に :git と :tag の指定が要る（README 参照）。
  s.dependency "Feedpulse", "~> 0.1"
end
