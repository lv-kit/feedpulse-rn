require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "feedpulse-react-native"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.license      = "MIT"
  s.authors      = "Feedpulse"
  s.homepage     = "https://github.com/lv-kit/feedpulse-rn"
  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "https://github.com/lv-kit/feedpulse-rn.git", :tag => s.version.to_s }
  s.source_files = "ios/**/*.{h,m,swift}"
  s.swift_version = "5.0"
  s.dependency "React-Core"
  # TODO: iOS SDK (#114) の Pod 名・バージョン確定後に合わせる。
  s.dependency "Feedpulse"
end
