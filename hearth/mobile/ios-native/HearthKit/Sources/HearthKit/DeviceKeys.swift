import CryptoKit
import Foundation
import Security

/// This phone's push keys for one server: a P-256 key pair and a 16-byte auth secret (RFC 8291), sent to the server
/// as the subscription's p256dh and auth. The server encrypts each push to them, so only this phone can read it.
///
/// Kept in the Keychain group the app shares with its Notification Service Extension, one item per server
/// (named by PushPolicy.instanceFor), readable after the first unlock and only on this phone: never in a backup,
/// never moved to a new phone (which then registers for push again).
public struct DeviceKeys {
    public static let service = "app.hearth.mobile.push"
    public static let appGroup = "group.app.hearth.mobile"

    public let privateKey: P256.KeyAgreement.PrivateKey
    public let auth: Data

    public init(privateKey: P256.KeyAgreement.PrivateKey, auth: Data) {
        self.privateKey = privateKey
        self.auth = auth
    }

    /// The 65-byte uncompressed public point (0x04 | x | y).
    public var p256dh: Data { privateKey.publicKey.x963Representation }
    public var p256dhBase64URL: String { WebPushDecrypt.base64URL(p256dh) }
    public var authBase64URL: String { WebPushDecrypt.base64URL(auth) }

    public static func generate() -> DeviceKeys {
        var auth = Data(count: 16)
        let status = auth.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        if status != errSecSuccess {
            // SecRandomCopyBytes doesn't fail in practice; a key from CryptoKit's generator is the fallback.
            auth = SymmetricKey(size: .bits128).withUnsafeBytes { Data($0) }
        }
        return DeviceKeys(privateKey: P256.KeyAgreement.PrivateKey(), auth: auth)
    }

    public enum KeychainError: Error {
        /// No server yet (an empty instance name).
        case noInstance
        case status(OSStatus)
        case corrupt
    }

    /// The keys for a server, made and saved the first time.
    public static func ensure(instance: String, accessGroup: String? = nil) throws -> DeviceKeys {
        if instance.isEmpty { throw KeychainError.noInstance }
        switch read(instance: instance, accessGroup: accessGroup) {
        case .found(let keys): return keys
        case .failed(let status): throw KeychainError.status(status)
        case .corrupt: delete(instance: instance, accessGroup: accessGroup)
        case .missing: break
        }
        let keys = generate()
        var add = query(instance: instance, accessGroup: accessGroup)
        add[kSecValueData as String] = keys.serialized
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        add[kSecAttrSynchronizable as String] = kCFBooleanFalse
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem, case .found(let other) = read(instance: instance, accessGroup: accessGroup) {
            return other // made at the same moment by the other process; both now use the saved ones
        }
        if status != errSecSuccess { throw KeychainError.status(status) }
        return keys
    }

    /// The saved keys for a server, or nil.
    public static func load(instance: String, accessGroup: String? = nil) -> DeviceKeys? {
        if instance.isEmpty { return nil }
        if case .found(let keys) = read(instance: instance, accessGroup: accessGroup) { return keys }
        return nil
    }

    /// Forgets a server's keys (push turned off, or the app moved to another server). true if there were any.
    @discardableResult
    public static func delete(instance: String, accessGroup: String? = nil) -> Bool {
        if instance.isEmpty { return false }
        return SecItemDelete(query(instance: instance, accessGroup: accessGroup) as CFDictionary) == errSecSuccess
    }

    // ---- storage: the 32-byte private scalar, then the 16-byte auth secret

    var serialized: Data { privateKey.rawRepresentation + auth }

    init?(serialized d: Data) {
        guard d.count == 48, let key = try? P256.KeyAgreement.PrivateKey(rawRepresentation: d.prefix(32)) else { return nil }
        self.init(privateKey: key, auth: Data(d.suffix(16)))
    }

    private enum Lookup { case found(DeviceKeys), missing, corrupt, failed(OSStatus) }

    private static func read(instance: String, accessGroup: String?) -> Lookup {
        var q = query(instance: instance, accessGroup: accessGroup)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecItemNotFound { return .missing }
        if status != errSecSuccess { return .failed(status) }
        guard let data = out as? Data, let keys = DeviceKeys(serialized: data) else { return .corrupt }
        return .found(keys)
    }

    // accessGroup nil: the default group, the first keychain-access-groups entitlement
    // ($(AppIdentifierPrefix)group.app.hearth.mobile in both the app and the extension).
    private static func query(instance: String, accessGroup: String?) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: instance,
            kSecUseDataProtectionKeychain as String: true,
        ]
        if let g = accessGroup { q[kSecAttrAccessGroup as String] = g }
        return q
    }
}
