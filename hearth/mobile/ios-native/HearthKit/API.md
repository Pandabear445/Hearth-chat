# HearthKit public API

The Swift package the App, NotificationService and ShareExtension targets link (library product `HearthKit`,
`import HearthKit`). Pure logic: Foundation, CryptoKit and Security only, no UIKit or WebKit. Platforms: iOS 16.4,
macOS 13 (so `swift test` runs on the macOS runner). Each type ports the Java file of the same name in
`mobile/native/` with the same constants and regular expressions; "Java" below means that file.

All types are caseless `enum`s (namespaces) except `PushPayload`, `PushDisplay`, `DeviceKeys` and `WebPushDecrypt.Failure`.
Times are milliseconds since 1970 as `Int64`, like Java's `long`.

## BridgePolicy

```swift
public enum BridgePolicy {
    public static let localOrigin: String                // "capacitor://localhost", the connect screen
    public static let site: String                       // "https://pandabear445.github.io/Hearth-chat/"
    public static let paymentHosts: [String]             // checkout./buy./donate./billing.stripe.com (ko-fi.com is checked apart)

    // Java allowed(type, sourceOrigin, localOrigin, serverOrigin). "setServer": connect screen only;
    // "push*" / "call*": the server's page only; anything else: either.
    public static func allowed(type: String?, origin: String?, localOrigin: String? = BridgePolicy.localOrigin, serverOrigin: String?) -> Bool

    // The origin string for a WKSecurityOrigin: origin(protocol: o.protocol, host: o.host, port: o.port).
    // Lowercases scheme and host, drops port 0 and the scheme's default port (https 443, http 80),
    // brackets a bare IPv6 host. "capacitor", "localhost", 0 gives "capacitor://localhost".
    public static func origin(protocol scheme: String, host: String, port: Int) -> String

    public static func opensInBrowser(_ url: String?) -> Bool
    public static func isPaymentPage(_ url: String?) -> Bool
    public static func isPaymentPage(_ url: URL) -> Bool  // isPaymentPage(url.absoluteString)
}
```

## PushPolicy

```swift
public enum PushPolicy {
    public static let maxPayloadBytes: Int   // 4096
    public static let callFreshMs: Int64     // 120_000
    public static let clockSkewMs: Int64     // 300_000

    public static func instanceFor(_ origin: String?) -> String          // "o" + 16 hex of SHA-256(origin UTF-8); "" for nil/""
    public static func safeOpenPath(_ url: String?) -> String           // url when it matches OPEN, else "/"
    public static func ringingCallPath(_ tag: String?) -> String?       // "call:<room>" -> "/#call/<room>", else nil
    public static func validTag(_ tag: String?) -> Bool                 // ^[A-Za-z0-9:_-]{1,100}$
    public static func validVapid(_ key: String?) -> Bool
    public static func freshCall(at: Int64, now: Int64) -> Bool
    public static func nowMs() -> Int64                                 // Date() in ms
    public static func clean(_ s: String?, maxCodePoints: Int) -> String
}
```

## PushPayload / PushDisplay

```swift
public struct PushPayload: Equatable {
    public let title: String, body: String, tag: String, url: String, generic: String
    public let at: Int64
    // Java parse: nil unless a JSON object of 1...4096 bytes with a valid tag. url is already safeOpenPath'd.
    // Text is NOT cleaned here (as in Java); use display(now:) or PushPolicy.clean.
    public static func parse(_ utf8: Data) -> PushPayload?
    public var isCall: Bool { get }                                     // tag starts with "call:"
    // What the notification shows, the rules of HearthNotifications.showPush:
    public func display(now: Int64) -> PushDisplay
}

public struct PushDisplay: Equatable {
    public let title: String      // clean(title, 120); "" means use the original alert's title (the app name)
    public let body: String       // clean(body, 240), "New activity" when empty, "Missed call" for a stale ring
    public let tag: String        // the tag, or "missed-" + tag for a stale ring (use as threadIdentifier)
    public let url: String        // safe in-app path for userInfo["url"]
    public let ring: Bool         // a fresh call ring: keep the ring sound and time-sensitive level
    public let missedCall: Bool   // a call ring that is too old: no sound, "Missed call"
}
```

## InviteLinks

```swift
public struct Invite: Equatable { public let origin: String; public let code: String }  // origin "" for hearth://

public enum InviteLinks {
    public static func parse(_ link: String?) -> Invite?                 // hearth://invite/CODE or https://host/invite/CODE
    public static func forServer(_ invite: Invite?, serverOrigin: String?) -> Bool
    public static func target(serverOrigin: String, code: String) -> String   // "<origin>/invite/<code>"
    public static func normalOrigin(_ origin: String?) -> String
}
```

## ShareLinks

```swift
public enum ShareLinks {
    public static let textMax: Int                                       // 8000
    public static func extract(text: String?, subject: String?) -> String?  // first TikTok/Instagram https link
    public static func first(_ text: String?) -> String?
    public static func trimTail(_ s: String) -> String
    public static func ok(_ link: String) -> Bool
}
```

## WebPushDecrypt (RFC 8291 aes128gcm)

```swift
public enum WebPushDecrypt {
    public enum Failure: Error, Equatable { case header, key, auth, decrypt, padding, base64 }
    // body = salt(16) | rs(4, big endian) | idlen(1) | keyid (the sender's 65-byte public key) | records
    public static func decrypt(_ body: Data, privateKey: P256.KeyAgreement.PrivateKey, auth: Data) throws -> Data
    public static func decrypt(_ body: Data, keys: DeviceKeys) throws -> Data
    // `enc` from the APNs payload: standard base64 (base64url and missing padding are accepted too).
    public static func decrypt(base64 enc: String, keys: DeviceKeys) throws -> Data
    public static func base64Decode(_ s: String) -> Data?               // standard or url alphabet, padding optional
    public static func base64URL(_ d: Data) -> String                   // no padding
}
```

## DeviceKeys (shared Keychain)

```swift
public struct DeviceKeys {
    public static let service: String          // "app.hearth.mobile.push" (kSecAttrService)
    public static let appGroup: String          // "group.app.hearth.mobile"
    public let privateKey: P256.KeyAgreement.PrivateKey
    public let auth: Data                       // 16 random bytes
    public var p256dh: Data { get }             // 65-byte uncompressed public point (x963)
    public var p256dhBase64URL: String { get } // for keys.p256dh
    public var authBase64URL: String { get }   // for keys.auth
    public init(privateKey: P256.KeyAgreement.PrivateKey, auth: Data)
    public static func generate() -> DeviceKeys

    // instance = PushPolicy.instanceFor(serverOrigin). accessGroup nil = the default access group, which is the
    // first keychain-access-groups entitlement ($(AppIdentifierPrefix)group.app.hearth.mobile in the App and NSE).
    // Items: kSecClassGenericPassword, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, not synchronizable.
    public static func ensure(instance: String, accessGroup: String? = nil) throws -> DeviceKeys   // load or create
    public static func load(instance: String, accessGroup: String? = nil) -> DeviceKeys?
    @discardableResult public static func delete(instance: String, accessGroup: String? = nil) -> Bool
    public enum KeychainError: Error { case noInstance, status(OSStatus), corrupt }
}
```

## CertPin

```swift
public enum CertPin {
    // SHA-256 of the leaf certificate's DER, uppercase hex pairs joined by ":" (the same text Android shows).
    public static func fingerprint(der: Data) -> String
    public static func matches(der: Data, pinned: String?) -> Bool      // case- and separator-insensitive compare
}
```
Use `SecCertificateCopyData(SecTrustCopyCertificateChain(trust)[0]) as Data` for `der`.

## How the targets use it

```swift
// App, pushRegister: keys for the saved server, sent as the subscription's keys.
let keys = try DeviceKeys.ensure(instance: PushPolicy.instanceFor(serverOrigin))
// { p256dh: keys.p256dhBase64URL, auth: keys.authBase64URL }
// App, pushUnregister or a server change: DeviceKeys.delete(instance: PushPolicy.instanceFor(oldOrigin))

// NotificationService: on any throw or nil, deliver the original (privacy-safe) alert unchanged.
guard let enc = userInfo["enc"] as? String,
      let keys = DeviceKeys.load(instance: PushPolicy.instanceFor(serverOrigin)),
      let plain = try? WebPushDecrypt.decrypt(base64: enc, keys: keys),
      let push = PushPayload.parse(plain) else { return deliverOriginal() }
let shown = push.display(now: PushPolicy.nowMs())
// title (if not empty) / body / threadIdentifier = shown.tag / userInfo["url"] = shown.url
// shown.ring: keep sound "ring.wav" and .timeSensitive; shown.missedCall: no sound, .active

// HearthBridge: BridgePolicy.allowed(type: t, origin: BridgePolicy.origin(protocol: o.protocol, host: o.host,
//                port: o.port), serverOrigin: savedServerOrigin)
// ShareExtension: ShareLinks.extract(text: sharedTextOrURLString, subject: nil)
// LinkRouter: InviteLinks.parse(url.absoluteString), then InviteLinks.forServer(invite, serverOrigin:)
```

Ported faithfully, including java.net.URI's rules for which links parse (JavaCompat.swift), with one difference:
an IPv6 host with a scope id (`https://[fe80::1%25en0]/...`) is refused, where Java would take it.
