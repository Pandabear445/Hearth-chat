import CryptoKit
import Foundation

/// The rules for notifications that arrive while Hearth is closed. A port of mobile/native/PushPolicy.java; keep the
/// two the same (test/ios-shell.test.js compares the OPEN pattern).
///
/// A notification only ever opens an address inside the app (never another site), each server gets its own push
/// keys, and a call that rang too long ago is a missed call, not a ring.
public enum PushPolicy {
    /// RFC 8291 messages from the server are at most 4096 bytes, so the decrypted one is smaller still.
    public static let maxPayloadBytes = 4096
    /// A ring older than this (APNs held it while the phone was offline) shows as a missed call.
    public static let callFreshMs: Int64 = 120_000
    /// How far the phone's clock may be ahead of the server's before a ring from "the future" is distrusted.
    public static let clockSkewMs: Int64 = 300_000

    // "/" or one of the app's own hash links. Ids are the server's newId(): lowercase letters and digits. #scheduled is
    // the person's scheduled messages (a push says one wasn't sent, or is waiting for them).
    private static let OPEN = WholeMatch("^/(#(?:m|c|d)/[a-z0-9]{1,64}|#call/(?:dm:)?[a-z0-9]{1,64}|#updates|#study|#scheduled)?$")
    private static let TAG = WholeMatch("^[A-Za-z0-9:_-]{1,100}$")
    // An uncompressed P-256 public key (65 bytes starting 0x04) in base64url without padding: 87 characters,
    // and the 0x04 makes the first one "B".
    private static let VAPID = WholeMatch("^B[A-Za-z0-9_-]{86}$")

    /// The push key name for one server: "o" and 16 hex characters of SHA-256(origin). "" without a server.
    public static func instanceFor(_ origin: String?) -> String {
        guard let origin = origin, !origin.isEmpty else { return "" }
        let d = SHA256.hash(data: Data(origin.utf8))
        return "o" + d.prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    /// url when it is "/" or one of the app's own links, else "/".
    public static func safeOpenPath(_ url: String?) -> String {
        guard let url = url, OPEN.matches(url) else { return "/" }
        return url
    }

    /// Where a ringing call's notification (tag "call:<room>") leads: "/#call/<room>", or nil for any other tag.
    public static func ringingCallPath(_ tag: String?) -> String? {
        guard let tag = tag, tag.utf16.starts(with: "call:".utf16) else { return nil }
        let path = "/#call/" + String(decoding: tag.utf16.dropFirst(5), as: UTF16.self)
        return OPEN.matches(path) ? path : nil
    }

    public static func validTag(_ tag: String?) -> Bool { TAG.matches(tag) }

    public static func validVapid(_ key: String?) -> Bool { VAPID.matches(key) }

    /// A call push sent at `at` (server time) still rings at `now`.
    public static func freshCall(at: Int64, now: Int64) -> Bool {
        at > 0 && now &- at <= callFreshMs && at &- now <= clockSkewMs
    }

    public static func nowMs() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded(.down)) }

    /// Text fit for a notification: no control characters or direction overrides (which could make a name read
    /// as something else), trimmed, and at most maxCodePoints characters (cut with "...").
    public static func clean(_ s: String?, maxCodePoints: Int) -> String {
        guard let s = s else { return "" }
        let space: Unicode.Scalar = " "
        var out = String.UnicodeScalarView()
        for u in s.unicodeScalars {
            let cp = u.value
            if cp <= 0x1f || cp == 0x7f || (cp >= 0x80 && cp <= 0x9f) { out.append(space); continue }
            if cp == 0x200e || cp == 0x200f || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) { continue }
            out.append(u)
        }
        // trim() then " {2,}" -> " "
        var scalars = Array(J.trim(String(out)).unicodeScalars)
        var squeezed = [Unicode.Scalar]()
        for u in scalars where !(u == space && squeezed.last == space) { squeezed.append(u) }
        scalars = squeezed
        if maxCodePoints < 1 { return "" }
        if scalars.count <= maxCodePoints { return String(String.UnicodeScalarView(scalars)) }
        let cut = J.trim(String(String.UnicodeScalarView(scalars[0..<(maxCodePoints - 1)])))
        return cut + "\u{2026}"
    }
}
