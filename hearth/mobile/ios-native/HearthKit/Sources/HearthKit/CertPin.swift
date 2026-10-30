import CryptoKit
import Foundation

/// A server certificate's fingerprint, for self-hosted servers without a publicly trusted certificate: the person
/// checks it with the server owner once and the app remembers that exact certificate (MainActivity.fingerprint on
/// Android). Always compiled; the app uses it only in builds with HEARTH_CUSTOM_SERVER (never the App Store build).
public enum CertPin {
    /// SHA-256 of the leaf certificate's DER, as uppercase hex pairs joined by ":" (the text Android shows).
    public static func fingerprint(der: Data) -> String {
        SHA256.hash(data: der).map { String(format: "%02X", $0) }.joined(separator: ":")
    }

    /// Whether a certificate is the one remembered. Case and separators in the remembered text don't matter.
    public static func matches(der: Data, pinned: String?) -> Bool {
        guard let pinned = pinned else { return false }
        let want = pinned.uppercased().filter { $0.isASCII && $0.isHexDigit }
        return want.count == 64 && want == fingerprint(der: der).filter { $0.isASCII && $0.isHexDigit }
    }
}
