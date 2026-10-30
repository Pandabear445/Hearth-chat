import XCTest
@testable import HearthKit

/// Who may send which hearthIOS message, which links leave the app, and the certificate fingerprint. Cases from
/// mobile/native/test/PushPolicyTest.java plus every message type the iPhone bridge takes.
final class BridgePolicyTests: XCTestCase {
    private let local = BridgePolicy.localOrigin
    private let server = "https://chat.example.com"
    private let evil = "https://evil.example"

    func testOnlyTheServersPageManagesPushAndCalls() {
        for t in ["pushRegister", "pushPick", "pushUnregister", "pushState", "callStart", "callEnd"] {
            XCTAssertTrue(BridgePolicy.allowed(type: t, origin: server, serverOrigin: server), t)
            XCTAssertFalse(BridgePolicy.allowed(type: t, origin: local, serverOrigin: server), t)
            XCTAssertFalse(BridgePolicy.allowed(type: t, origin: evil, serverOrigin: server), t)
            XCTAssertFalse(BridgePolicy.allowed(type: t, origin: local, serverOrigin: ""), t + " with no server yet")
        }
        XCTAssertTrue(BridgePolicy.allowed(type: "setServer", origin: local, serverOrigin: server))
        XCTAssertTrue(BridgePolicy.allowed(type: "setServer", origin: local, serverOrigin: nil), "the first connect")
        XCTAssertFalse(BridgePolicy.allowed(type: "setServer", origin: server, serverOrigin: server))
        XCTAssertFalse(BridgePolicy.allowed(type: "setServer", origin: evil, serverOrigin: server))
    }

    func testEveryMessageTypeFromEveryOrigin() {
        // type: (connect screen, server's page)
        let rules: [String: (Bool, Bool)] = [
            "hello": (true, true), "setServer": (true, false), "changeServer": (true, true),
            "pushState": (false, true), "pushRegister": (false, true), "pushUnregister": (false, true),
            "callStart": (false, true), "callEnd": (false, true),
            "notify": (true, true), "cancel": (true, true), "askNotify": (true, true),
            "saveStart": (true, true), "saveChunk": (true, true), "saveEnd": (true, true),
        ]
        for (type, rule) in rules {
            let (fromLocal, fromServer) = rule
            XCTAssertEqual(BridgePolicy.allowed(type: type, origin: local, serverOrigin: server), fromLocal, type + " from the connect screen")
            XCTAssertEqual(BridgePolicy.allowed(type: type, origin: server, serverOrigin: server), fromServer, type + " from the server")
            for other in [evil, "https://chat.example.com:8443", "http://chat.example.com", "https://chat.example.com.evil.example",
                          "capacitor://evil", "null", "", "https://CHAT.example.com"] {
                XCTAssertFalse(BridgePolicy.allowed(type: type, origin: other, serverOrigin: server), type + " from " + other)
            }
            XCTAssertFalse(BridgePolicy.allowed(type: type, origin: nil, serverOrigin: server))
            XCTAssertFalse(BridgePolicy.allowed(type: type, origin: server, localOrigin: nil, serverOrigin: nil))
            XCTAssertFalse(BridgePolicy.allowed(type: type, origin: "", localOrigin: "", serverOrigin: ""))
        }
        XCTAssertFalse(BridgePolicy.allowed(type: nil, origin: server, serverOrigin: server))
    }

    func testOriginsFromWebKit() {
        XCTAssertEqual(BridgePolicy.origin(protocol: "capacitor", host: "localhost", port: 0), BridgePolicy.localOrigin)
        XCTAssertEqual(BridgePolicy.origin(protocol: "https", host: "Chat.Example.com", port: 0), "https://chat.example.com")
        XCTAssertEqual(BridgePolicy.origin(protocol: "https", host: "chat.example.com", port: 443), "https://chat.example.com")
        XCTAssertEqual(BridgePolicy.origin(protocol: "https", host: "1.2.3.4", port: 3000), "https://1.2.3.4:3000")
        XCTAssertEqual(BridgePolicy.origin(protocol: "http", host: "chat.example.com", port: 80), "http://chat.example.com")
        XCTAssertEqual(BridgePolicy.origin(protocol: "https", host: "::1", port: 8443), "https://[::1]:8443")
        XCTAssertEqual(BridgePolicy.origin(protocol: "https", host: "[::1]", port: 0), "https://[::1]")
    }

    func testTheConnectScreensPrivacyLinkOpensInTheBrowser() {
        XCTAssertTrue(BridgePolicy.opensInBrowser("https://pandabear445.github.io/Hearth-chat/privacy.html"))
        for other: String? in ["https://kappachat.duckdns.org/", "https://pandabear445.github.io/", "https://pandabear445.github.io/Hearth-chat",
                               "https://pandabear445.github.io.evil.example/Hearth-chat/privacy.html", "https://pandabear445.github.io@evil.example/Hearth-chat/",
                               "http://pandabear445.github.io/Hearth-chat/privacy.html", "", nil] {
            XCTAssertFalse(BridgePolicy.opensInBrowser(other), String(describing: other))
        }
    }

    func testPaymentPagesDontOpenFromTheApp() throws {
        for pay in ["https://checkout.stripe.com/c/pay/cs_test_a1", "https://buy.stripe.com/test_123", "https://donate.stripe.com/x",
                    "https://billing.stripe.com/p/session/x", "https://ko-fi.com/hearth", "https://www.ko-fi.com/hearth", "https://KO-FI.COM/hearth",
                    "http://ko-fi.com/hearth", "https://ko-fi.com./hearth", "https://ko-fi.com:443/hearth", "https://someone@ko-fi.com/hearth", "https://ko-fi.com",
                    "https://ko-fi.com?x=1", "https://ko-fi.com#top", "  https://ko-fi.com/x  ", "https://ko-fi.com\\@evil.example/"] {
            XCTAssertTrue(BridgePolicy.isPaymentPage(pay), pay)
        }
        for other: String? in ["https://kappachat.duckdns.org/", "https://stripe.com/docs", "https://connect.stripe.com/express/x",
                               "https://notko-fi.com/x", "https://ko-fi.com.evil.example/x", "https://evil.example/ko-fi.com", "https://evil.example/?u=https://ko-fi.com",
                               "https://ko-fi.com@evil.example/", "https://[::1]:3000/", "ftp://ko-fi.com/", "ko-fi.com", "", nil,
                               "https://pandabear445.github.io/Hearth-chat/privacy.html"] {
            XCTAssertFalse(BridgePolicy.isPaymentPage(other), String(describing: other))
        }
        XCTAssertTrue(BridgePolicy.isPaymentPage(try XCTUnwrap(URL(string: "https://buy.stripe.com/x"))))
        XCTAssertFalse(BridgePolicy.isPaymentPage(try XCTUnwrap(URL(string: "https://chat.example.com/"))))
        XCTAssertEqual(BridgePolicy.paymentHosts, ["checkout.stripe.com", "buy.stripe.com", "donate.stripe.com", "billing.stripe.com"])
    }

    func testCertificateFingerprints() {
        let der = Data("hello".utf8)
        let fp = "2C:F2:4D:BA:5F:B0:A3:0E:26:E8:3B:2A:C5:B9:E2:9E:1B:16:1E:5C:1F:A7:42:5E:73:04:33:62:93:8B:98:24"
        XCTAssertEqual(CertPin.fingerprint(der: der), fp)
        XCTAssertTrue(CertPin.matches(der: der, pinned: fp))
        XCTAssertTrue(CertPin.matches(der: der, pinned: fp.lowercased().replacingOccurrences(of: ":", with: "")))
        XCTAssertFalse(CertPin.matches(der: Data("hello!".utf8), pinned: fp))
        XCTAssertFalse(CertPin.matches(der: der, pinned: ""))
        XCTAssertFalse(CertPin.matches(der: der, pinned: nil))
        XCTAssertFalse(CertPin.matches(der: der, pinned: String(fp.dropLast(3))))
    }
}
