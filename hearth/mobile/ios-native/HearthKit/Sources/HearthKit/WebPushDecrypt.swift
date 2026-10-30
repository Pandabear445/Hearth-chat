import CryptoKit
import Foundation

/// Decrypts a push the server encrypted to this phone's own keys: RFC 8291 (Web Push message encryption) in the
/// RFC 8188 "aes128gcm" format, the same bytes a browser or the Android app would get. The server sends them as `enc`
/// beside a privacy-safe visible alert (server/apns.js); the Notification Service Extension decrypts them here.
///
/// body = salt (16) | rs (4, big endian) | idlen (1) | keyid (the server's one-off 65-byte public key) | records
///   ecdh  = ECDH(this phone's private key, keyid)
///   IKM   = HKDF(salt: auth, ecdh, "WebPush: info\0" | phone public key | keyid, 32)
///   CEK   = HKDF(salt: salt, IKM, "Content-Encoding: aes128gcm\0", 16)
///   nonce = HKDF(salt: salt, IKM, "Content-Encoding: nonce\0", 12), XOR the record number
/// Each record is AES-128-GCM; its text ends with a 0x01 (more records follow) or 0x02 (the last) delimiter and
/// then zero padding.
public enum WebPushDecrypt {
    public enum Failure: Error, Equatable {
        /// Too short, a record size below 18, or nothing after the header.
        case header
        /// keyid isn't an uncompressed P-256 point.
        case key
        /// The auth secret isn't 16 bytes.
        case auth
        /// A record didn't decrypt (wrong keys, or it was changed on the way).
        case decrypt
        /// A record's padding or delimiter is wrong.
        case padding
        /// `enc` isn't base64.
        case base64
    }

    public static func decrypt(_ body: Data, privateKey: P256.KeyAgreement.PrivateKey, auth: Data) throws -> Data {
        let b = [UInt8](body)
        guard b.count > 21 else { throw Failure.header }
        if auth.count != 16 { throw Failure.auth }
        let salt = Data(b[0..<16])
        let rs = Int(b[16]) << 24 | Int(b[17]) << 16 | Int(b[18]) << 8 | Int(b[19])
        let idlen = Int(b[20])
        guard rs >= 18 else { throw Failure.header }
        guard idlen == 65, b.count > 21 + idlen else { throw idlen == 65 ? Failure.header : Failure.key }
        let senderBytes = Data(b[21..<(21 + idlen)])
        let sender: P256.KeyAgreement.PublicKey
        do { sender = try P256.KeyAgreement.PublicKey(x963Representation: senderBytes) } catch { throw Failure.key }
        let shared: SharedSecret
        do { shared = try privateKey.sharedSecretFromKeyAgreement(with: sender) } catch { throw Failure.key }
        let ecdh = shared.withUnsafeBytes { Data($0) }

        var keyInfo = Data("WebPush: info".utf8)
        keyInfo.append(0)
        keyInfo.append(privateKey.publicKey.x963Representation)
        keyInfo.append(senderBytes)
        let ikm = hkdf(salt: auth, ikm: ecdh, info: keyInfo, count: 32)
        let cek = SymmetricKey(data: hkdf(salt: salt, ikm: ikm, info: Data("Content-Encoding: aes128gcm\u{0}".utf8), count: 16))
        let baseNonce = [UInt8](hkdf(salt: salt, ikm: ikm, info: Data("Content-Encoding: nonce\u{0}".utf8), count: 12))

        var out = Data()
        var start = 21 + idlen
        var seq: UInt64 = 0
        while start < b.count {
            let end = min(start + rs, b.count)
            let last = end == b.count
            let record = b[start..<end]
            guard record.count > 16 else { throw Failure.decrypt }
            var nonce = baseNonce
            for k in 0..<8 { nonce[11 - k] ^= UInt8(truncatingIfNeeded: seq >> (8 * UInt64(k))) }
            let plain: Data
            do {
                let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce),
                                                ciphertext: Data(record.dropLast(16)), tag: Data(record.suffix(16)))
                plain = try AES.GCM.open(box, using: cek)
            } catch { throw Failure.decrypt }
            let p = [UInt8](plain)
            var i = p.count - 1
            while i >= 0 && p[i] == 0 { i -= 1 }
            guard i >= 0, p[i] == (last ? 2 : 1) else { throw Failure.padding }
            out.append(contentsOf: p[0..<i])
            start = end
            seq += 1
        }
        return out
    }

    public static func decrypt(_ body: Data, keys: DeviceKeys) throws -> Data {
        try decrypt(body, privateKey: keys.privateKey, auth: keys.auth)
    }

    /// `enc` from the APNs payload: standard base64 (base64url and missing padding are accepted too).
    public static func decrypt(base64 enc: String, keys: DeviceKeys) throws -> Data {
        guard let body = base64Decode(enc) else { throw Failure.base64 }
        return try decrypt(body, keys: keys)
    }

    public static func base64Decode(_ s: String) -> Data? {
        var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while t.hasSuffix("=") { t.removeLast() }
        if t.utf8.count % 4 == 1 { return nil }
        t += String(repeating: "=", count: (4 - t.utf8.count % 4) % 4)
        return Data(base64Encoded: t)
    }

    public static func base64URL(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func hkdf(salt: Data, ikm: Data, info: Data, count: Int) -> Data {
        let key = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: ikm), salt: salt, info: info, outputByteCount: count)
        return key.withUnsafeBytes { Data($0) }
    }
}
