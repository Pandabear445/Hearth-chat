import CryptoKit
import XCTest
@testable import HearthKit

/// RFC 8291 decryption against the RFC's own example, pushes the server's library encrypted (node-vector.json and
/// the server's test/fixtures/apns-enc-vector.json), and messages that were changed on the way.
final class WebPushDecryptTests: XCTestCase {
    private func b64(_ s: String) -> Data { WebPushDecrypt.base64Decode(s)! }

    private func key(_ s: String) throws -> P256.KeyAgreement.PrivateKey {
        try P256.KeyAgreement.PrivateKey(rawRepresentation: b64(s))
    }

    // RFC 8291 Appendix A.
    private let rfcBody = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    private let rfcUAPrivate = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"
    private let rfcUAPublic = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
    private let rfcASPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
    private let rfcAuth = "BTBZMqHH6r4Tts7J_aSIgg" // gitleaks:allow (the RFC's published example)
    private let rfcSalt = "DGv6ra1nlYgDCS1FRnbzlw"
    private let rfcPlaintext = "When I grow up, I want to be a watermelon"

    func testRFC8291AppendixA() throws {
        let ua = try key(rfcUAPrivate)
        XCTAssertEqual(ua.publicKey.x963Representation, b64(rfcUAPublic))
        let plain = try WebPushDecrypt.decrypt(b64(rfcBody), privateKey: ua, auth: b64(rfcAuth))
        XCTAssertEqual(String(decoding: plain, as: UTF8.self), rfcPlaintext)
        // Through the keys type and the base64 `enc` entry point too.
        let keys = DeviceKeys(privateKey: ua, auth: b64(rfcAuth))
        let std = b64(rfcBody).base64EncodedString()
        XCTAssertEqual(try WebPushDecrypt.decrypt(base64: std, keys: keys), Data(rfcPlaintext.utf8))
        XCTAssertEqual(try WebPushDecrypt.decrypt(base64: rfcBody, keys: keys), Data(rfcPlaintext.utf8))
    }

    func testRFC8291IntermediateValues() throws {
        let ua = try key(rfcUAPrivate)
        let shared = try ua.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(x963Representation: b64(rfcASPublic)))
        let ecdh = shared.withUnsafeBytes { Data($0) }
        XCTAssertEqual(ecdh, b64("kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs"))
        var info = Data("WebPush: info".utf8)
        info.append(0)
        info.append(b64(rfcUAPublic))
        info.append(b64(rfcASPublic))
        let ikm = WebPushDecrypt.hkdf(salt: b64(rfcAuth), ikm: ecdh, info: info, count: 32)
        XCTAssertEqual(ikm, b64("S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg"))
        let cek = WebPushDecrypt.hkdf(salt: b64(rfcSalt), ikm: ikm, info: Data("Content-Encoding: aes128gcm\u{0}".utf8), count: 16)
        XCTAssertEqual(cek, b64("oIhVW04MRdy2XN9CiKLxTg"))
        let nonce = WebPushDecrypt.hkdf(salt: b64(rfcSalt), ikm: ikm, info: Data("Content-Encoding: nonce\u{0}".utf8), count: 12)
        XCTAssertEqual(nonce, b64("4h_95klXJ5E_qnoN"))
    }

    private struct NodeVector: Decodable {
        struct Push: Decodable { let d: String; let s16: String; let ciphertext: String }
        let plaintext: String
        let single: Push
        let records: Push
    }

    private func nodeVector() throws -> NodeVector {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "node-vector", withExtension: "json"))
        return try JSONDecoder().decode(NodeVector.self, from: Data(contentsOf: url))
    }

    func testWhatTheServersLibraryEncrypts() throws {
        let v = try nodeVector()
        for push in [v.single, v.records] {
            let keys = DeviceKeys(privateKey: try key(push.d), auth: b64(push.s16))
            let plain = try WebPushDecrypt.decrypt(base64: push.ciphertext, keys: keys)
            XCTAssertEqual(String(decoding: plain, as: UTF8.self), v.plaintext)
            // and it is a push the app takes
            let p = try XCTUnwrap(PushPayload.parse(plain))
            XCTAssertEqual(p.title, "Zoë 🔥")
            XCTAssertEqual(p.tag, "d:abc123")
            XCTAssertEqual(p.url, "/#m/xyz789")
            XCTAssertEqual(p.at, 1_760_000_000_000)
        }
    }

    /// The server's own APNs test writes this file (test/apns.test.js): an `enc` exactly as server/apns.js sends it.
    func testTheServersApnsVector() throws {
        let hearth = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let file = hearth.appendingPathComponent("test/fixtures/apns-enc-vector.json")
        guard let data = try? Data(contentsOf: file) else { throw XCTSkip("no \(file.path) here") }
        struct Vector: Decodable { let privateKey: String; let auth: String; let enc: String; let plaintext: String }
        let v = try JSONDecoder().decode(Vector.self, from: data)
        let keys = DeviceKeys(privateKey: try key(v.privateKey), auth: b64(v.auth))
        let plain = try WebPushDecrypt.decrypt(base64: v.enc, keys: keys)
        XCTAssertEqual(String(decoding: plain, as: UTF8.self), v.plaintext)
        XCTAssertNotNil(PushPayload.parse(plain))
    }

    func testAChangedMessageOrTheWrongKeysFail() throws {
        let ua = try key(rfcUAPrivate)
        let auth = b64(rfcAuth)
        var body = [UInt8](b64(rfcBody))

        var tampered = body
        tampered[tampered.count - 1] ^= 1 // the tag
        XCTAssertThrowsError(try WebPushDecrypt.decrypt(Data(tampered), privateKey: ua, auth: auth)) {
            XCTAssertEqual($0 as? WebPushDecrypt.Failure, .decrypt)
        }
        tampered = body
        tampered[0] ^= 1 // the salt
        XCTAssertThrowsError(try WebPushDecrypt.decrypt(Data(tampered), privateKey: ua, auth: auth)) {
            XCTAssertEqual($0 as? WebPushDecrypt.Failure, .decrypt)
        }
        var wrongAuth = [UInt8](auth)
        wrongAuth[0] ^= 1
        XCTAssertThrowsError(try WebPushDecrypt.decrypt(Data(body), privateKey: ua, auth: Data(wrongAuth))) {
            XCTAssertEqual($0 as? WebPushDecrypt.Failure, .decrypt)
        }
        XCTAssertThrowsError(try WebPushDecrypt.decrypt(Data(body), privateKey: P256.KeyAgreement.PrivateKey(), auth: auth)) {
            XCTAssertEqual($0 as? WebPushDecrypt.Failure, .decrypt)
        }
        XCTAssertThrowsError(try WebPushDecrypt.decrypt(Data(body), privateKey: ua, auth: auth.prefix(15))) {
            XCTAssertEqual($0 as? WebPushDecrypt.Failure, .auth)
        }
        XCTAssertThrowsError(try WebPushDecrypt.decrypt(Data(body.prefix(20)), privateKey: ua, auth: auth)) {
            XCTAssertEqual($0 as? WebPushDecrypt.Failure, .header)
        }
        XCTAssertThrowsError(try WebPushDecrypt.decrypt(Data(body.prefix(21 + 65)), privateKey: ua, auth: auth)) {
            XCTAssertEqual($0 as? WebPushDecrypt.Failure, .header) // a header and no records
        }
        tampered = body
        tampered[16...19] = [0, 0, 0, 17] // record size below 18
        XCTAssertThrowsError(try WebPushDecrypt.decrypt(Data(tampered), privateKey: ua, auth: auth)) {
            XCTAssertEqual($0 as? WebPushDecrypt.Failure, .header)
        }
        tampered = body
        tampered[22] ^= 0xff // the sender key is no longer a point on the curve
        XCTAssertThrowsError(try WebPushDecrypt.decrypt(Data(tampered), privateKey: ua, auth: auth)) {
            XCTAssertEqual($0 as? WebPushDecrypt.Failure, .key)
        }
        tampered = body
        tampered[20] = 64 // keyid of the wrong length
        XCTAssertThrowsError(try WebPushDecrypt.decrypt(Data(tampered), privateKey: ua, auth: auth)) {
            XCTAssertEqual($0 as? WebPushDecrypt.Failure, .key)
        }
        body.removeLast(16 + 1)
        XCTAssertThrowsError(try WebPushDecrypt.decrypt(Data(body), privateKey: ua, auth: auth))
        XCTAssertThrowsError(try WebPushDecrypt.decrypt(base64: "not base64!", keys: DeviceKeys(privateKey: ua, auth: auth))) {
            XCTAssertEqual($0 as? WebPushDecrypt.Failure, .base64)
        }
    }

    /// The keys this phone makes work end to end: encrypted here the way the server does it, decrypted back.
    func testFreshDeviceKeysRoundTrip() throws {
        let keys = DeviceKeys.generate()
        XCTAssertEqual(keys.auth.count, 16)
        XCTAssertEqual(keys.p256dh.count, 65)
        XCTAssertEqual(keys.p256dh.first, 0x04)
        XCTAssertTrue(PushPolicy.validVapid(keys.p256dhBase64URL), "p256dh is 87 base64url characters starting with B")
        XCTAssertEqual(keys.authBase64URL.count, 22)
        XCTAssertFalse(keys.authBase64URL.contains("="))
        let text = Data(#"{"tag":"c:abc","title":"x","url":"/#c/abc"}"#.utf8)
        let body = try Self.encrypt(text, to: keys.p256dh, auth: keys.auth, padTo: 256)
        XCTAssertEqual(try WebPushDecrypt.decrypt(body, keys: keys), text)
        // Saved and read back the way the Keychain item holds them.
        let again = try XCTUnwrap(DeviceKeys(serialized: keys.serialized))
        XCTAssertEqual(again.p256dh, keys.p256dh)
        XCTAssertEqual(again.auth, keys.auth)
        XCTAssertNil(DeviceKeys(serialized: keys.serialized.prefix(47)))
        XCTAssertThrowsError(try DeviceKeys.ensure(instance: ""))
        XCTAssertNil(DeviceKeys.load(instance: ""))
    }

    // A minimal RFC 8291 sender (one record), only for the round trip above.
    static func encrypt(_ text: Data, to p256dh: Data, auth: Data, padTo: Int) throws -> Data {
        let sender = P256.KeyAgreement.PrivateKey()
        let ua = try P256.KeyAgreement.PublicKey(x963Representation: p256dh)
        let ecdh = try sender.sharedSecretFromKeyAgreement(with: ua).withUnsafeBytes { Data($0) }
        var salt = Data(count: 16)
        for i in 0..<16 { salt[i] = UInt8.random(in: 0...255) }
        var info = Data("WebPush: info".utf8)
        info.append(0)
        info.append(p256dh)
        info.append(sender.publicKey.x963Representation)
        let ikm = WebPushDecrypt.hkdf(salt: auth, ikm: ecdh, info: info, count: 32)
        let cek = WebPushDecrypt.hkdf(salt: salt, ikm: ikm, info: Data("Content-Encoding: aes128gcm\u{0}".utf8), count: 16)
        let nonce = WebPushDecrypt.hkdf(salt: salt, ikm: ikm, info: Data("Content-Encoding: nonce\u{0}".utf8), count: 12)
        var plain = text
        plain.append(2)
        plain.append(Data(count: max(0, padTo - plain.count)))
        let box = try AES.GCM.seal(plain, using: SymmetricKey(data: cek), nonce: AES.GCM.Nonce(data: nonce))
        var out = salt
        out.append(contentsOf: [0, 0, 0x10, 0, 65])
        out.append(sender.publicKey.x963Representation)
        out.append(box.ciphertext)
        out.append(box.tag)
        return out
    }

    func testBase64Helpers() {
        XCTAssertEqual(WebPushDecrypt.base64Decode("_-8"), Data([0xff, 0xef]))
        XCTAssertEqual(WebPushDecrypt.base64Decode("/+8="), Data([0xff, 0xef]))
        XCTAssertNil(WebPushDecrypt.base64Decode("a"))
        XCTAssertEqual(WebPushDecrypt.base64URL(Data([0xff, 0xef])), "_-8")
    }
}
