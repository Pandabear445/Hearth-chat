// swift-tools-version:5.9
// Hearth's shared iPhone logic: the rules ported from mobile/native/*.java plus Web Push decryption, the push keys
// and certificate fingerprints. The App, NotificationService and ShareExtension targets link it (scripts/patch-ios.rb);
// CI runs `swift test` here on macOS. API.md lists every public signature.
import PackageDescription

let package = Package(
    name: "HearthKit",
    platforms: [.iOS("16.4"), .macOS(.v13)],
    products: [
        .library(name: "HearthKit", targets: ["HearthKit"]),
    ],
    targets: [
        .target(name: "HearthKit"),
        .testTarget(
            name: "HearthKitTests",
            dependencies: ["HearthKit"],
            resources: [.copy("Resources/node-vector.json")]
        ),
    ]
)
