import XCTest
@testable import HearthKit

/// PushPolicy and PushPayload: the cases of mobile/native/test/PushPolicyTest.java, plus values the Java code gives
/// for the same input (worked out by running it), so both apps follow one set of rules.
final class PushTests: XCTestCase {
    private func parse(_ json: String) -> PushPayload? { PushPayload.parse(Data(json.utf8)) }

    func testPayloadsAreParsedStrictly() throws {
        let p = try XCTUnwrap(parse(#"{"title":"Hearth","body":"New message","tag":"d:abc123","url":"/#m/xyz789","at":1760000000000,"_":"   "}"#))
        XCTAssertEqual(p.title, "Hearth")
        XCTAssertEqual(p.body, "New message")
        XCTAssertEqual(p.tag, "d:abc123")
        XCTAssertEqual(p.url, "/#m/xyz789")
        XCTAssertEqual(p.at, 1_760_000_000_000)
        XCTAssertEqual(p.generic, "")
        XCTAssertNil(PushPayload.parse(Data(repeating: 0x20, count: 4097)), "over 4096 bytes")
        let fits = #"{"tag":"c:a","_":""# + String(repeating: " ", count: 4096 - 20) + #""}"#
        XCTAssertEqual(fits.utf8.count, 4096)
        XCTAssertNotNil(parse(fits), "exactly 4096 bytes is fine")
        XCTAssertNil(PushPayload.parse(Data()))
        XCTAssertNil(parse("[]"), "not an object")
        XCTAssertNil(parse(#"{"title":"x"}"#), "no tag")
        XCTAssertNil(parse(#"{"tag":"c:<script>"}"#), "bad tag")
        XCTAssertNil(parse(#"{"tag":""}"#), "empty tag")
        XCTAssertNil(parse(#"{"tag":"c:"# + String(repeating: "a", count: 99) + #""}"#), "tag over 100 characters")
        XCTAssertNotNil(parse(#"{"tag":"c:"# + String(repeating: "a", count: 98) + #""}"#), "tag of 100 characters")
        XCTAssertNil(parse(#"{"tag":"c:a"} x"#), "trailing junk")
        XCTAssertNil(parse(#"{"tag":"c:a""#), "unterminated")
        XCTAssertNil(parse(#"{"tag":"c:a","t":"a\qb"}"#), "unknown escape")
        XCTAssertNil(parse("{\"tag\":\"c:a\",\"t\":\"a\nb\"}"), "raw control character in a string")
        let nested = try XCTUnwrap(parse(#"{"x":{"y":[1,"}",{"z":null}]},"tag":"c:abc","ok":true,"no":false,"n":null}"#),
                                   "unknown keys are skipped whatever they hold")
        XCTAssertEqual(nested.tag, "c:abc")
        let deep = String(repeating: "[", count: 33) + String(repeating: "]", count: 33)
        XCTAssertNil(parse(#"{"tag":"c:a","x":"# + deep + "}"), "nested more than 32 deep")
        XCTAssertNotNil(parse(#"{"tag":"c:a","x":"# + String(repeating: "[", count: 32) + String(repeating: "]", count: 32) + "}"))
        let esc = try XCTUnwrap(parse(#"{"tag":"c:a","title":"café \"x\" \/ \\"}"#))
        XCTAssertEqual(esc.title, "caf\u{e9} \"x\" / \\")
        XCTAssertEqual(parse(#"{"tag":"c:a","title":"🔥"}"#)?.title, "🔥", "a surrogate pair in escapes")
        XCTAssertEqual(parse(#"{"tag":"c:a","url":"https://evil.example/"}"#)?.url, "/", "a wrong url becomes the app's start")
        XCTAssertEqual(parse(#"{"tag":"c:a","title":"one","title":"two"}"#)?.title, "two", "last key wins")
        XCTAssertEqual(parse(#"{"tag":"c:a","title":"one","title":{}}"#)?.title, "", "last key wins, even a skipped one")
        XCTAssertEqual(parse(#"{"tag":"c:a","at":"soon"}"#)?.at, 0, "a non-number time is 0")
        XCTAssertEqual(parse(#"{"tag":"c:a","title":5}"#)?.title, "", "a number where text goes is no text")
        XCTAssertEqual(parse(" \r\n\t{ \"tag\" : \"c:a\" , \"at\" : 2 } \n")?.at, 2, "white space around everything")
    }

    /// What PushPayload.java gives for the same odd input.
    func testOddInputMatchesJava() {
        XCTAssertEqual(parse(#"{"tag":"c:a","title":"\u+041"}"#)?.title, "A") // Integer.parseInt takes a sign
        XCTAssertEqual(parse(#"{"tag":"c:a","title":"\u-041"}"#)?.title.utf16.first, 0xffbf)
        XCTAssertNil(parse(#"{"tag":"c:a","title":"\u00g1"}"#))
        XCTAssertNil(parse(#"{"tag":"c:a","title":"\u00"}"#))
        XCTAssertEqual(parse(#"{"tag":"c:a","at":1e400}"#)?.at, 0)
        XCTAssertEqual(parse(#"{"tag":"c:a","at":1e999999999999}"#)?.at, 0)
        XCTAssertEqual(parse(#"{"tag":"c:a","at":-5}"#)?.at, 0)
        XCTAssertEqual(parse(#"{"tag":"c:a","at":1.9e3}"#)?.at, 1900)
        XCTAssertEqual(parse(#"{"tag":"c:a","at":1.}"#)?.at, 1)
        XCTAssertEqual(parse(#"{"tag":"c:a","at":-.5}"#)?.at, 0)
        XCTAssertEqual(parse(#"{"tag":"c:a","at":1760000000000.9}"#)?.at, 1_760_000_000_000)
        XCTAssertNil(parse(#"{"tag":"c:a","at":1e}"#))
        XCTAssertNil(parse(#"{"tag":"c:a","at":--1}"#))
        XCTAssertNil(parse(#"{"tag":"c:a","at":1-2}"#))
        XCTAssertNil(parse(#"{"tag":"c:a","at":tru}"#))
    }

    func testTextIsCleaned() {
        XCTAssertEqual(PushPolicy.clean("evil\u{202e}\u{0}txt", maxCodePoints: 50), "evil txt")
        XCTAssertEqual(PushPolicy.clean("a\u{200e}b", maxCodePoints: 50), "ab")
        XCTAssertEqual(PushPolicy.clean("a\u{2066}b\u{2069}c\u{202a}", maxCodePoints: 50), "abc")
        let cut = PushPolicy.clean(String(repeating: "x", count: 500), maxCodePoints: 120)
        XCTAssertEqual(cut.unicodeScalars.count, 120)
        XCTAssertTrue(cut.hasSuffix("\u{2026}"))
        XCTAssertEqual(PushPolicy.clean(nil, maxCodePoints: 10), "")
        XCTAssertEqual(PushPolicy.clean("\u{1F525}\u{1F525}\u{1F525}", maxCodePoints: 2), "\u{1F525}\u{2026}")
        XCTAssertEqual(PushPolicy.clean("abc", maxCodePoints: 0), "")
        XCTAssertEqual(PushPolicy.clean("  a  b  ", maxCodePoints: 50), "a b")
        XCTAssertEqual(PushPolicy.clean("\u{7}bell", maxCodePoints: 50), "bell")
        XCTAssertEqual(PushPolicy.clean("x\u{85}y", maxCodePoints: 50), "x y")
        XCTAssertEqual(PushPolicy.clean("\t\ttabs\t", maxCodePoints: 50), "tabs")
        XCTAssertEqual(PushPolicy.clean("ab cd", maxCodePoints: 4), "ab\u{2026}", "the cut is trimmed before the ellipsis")
    }

    func testNotificationsOnlyOpenInAppAddresses() {
        for ok in ["/", "/#m/abc123", "/#c/abc", "/#d/abc", "/#call/dm:abc", "/#call/abc", "/#updates", "/#study", "/#scheduled"] {
            XCTAssertEqual(PushPolicy.safeOpenPath(ok), ok)
        }
        for bad: String? in ["https://evil.example/", "//evil.example", "/#reset=AAAAAAAAAAAAAAAAAAAAAAAA", "javascript:alert(1)",
                             "/#m/ABC", "/#m/abc?x", "/#call/dm:abc/x", "", nil, "/#invite/abc", "/x", "/\n", "/#updates\n",
                             "https://chat.example.com/#m/abc", "/#m/" + String(repeating: "a", count: 65)] {
            XCTAssertEqual(PushPolicy.safeOpenPath(bad), "/", String(describing: bad))
        }
        XCTAssertEqual(PushPolicy.ringingCallPath("call:dm:abc"), "/#call/dm:abc")
        XCTAssertEqual(PushPolicy.ringingCallPath("call:abc"), "/#call/abc")
        for other: String? in ["missed-call:dm:abc", "d:abc", "c:abc", "call:", "call:ABC", "call:dm:abc/x", "event:abc", nil] {
            XCTAssertNil(PushPolicy.ringingCallPath(other), String(describing: other))
        }
    }

    func testEachServerHasItsOwnKeysAndCallsRingOnlyWhileFresh() {
        // Golden values from PushPolicy.instanceFor in Java.
        XCTAssertEqual(PushPolicy.instanceFor("https://a.example"), "o38612c965a9c4c35")
        XCTAssertEqual(PushPolicy.instanceFor("https://b.example"), "o35b22c6cbc7988f8")
        XCTAssertEqual(PushPolicy.instanceFor("https://kappachat.duckdns.org"), "oc76c55a13ca48d20")
        XCTAssertEqual(PushPolicy.instanceFor("https://chat.example.com:8443"), "oebb2bbe1199b9052")
        XCTAssertEqual(PushPolicy.instanceFor("http://192.168.1.20:3000"), "o7e04e42eeeecd94c")
        XCTAssertEqual(PushPolicy.instanceFor("https://zo\u{eb}.example"), "ode00f34b35fe9495")
        XCTAssertEqual(PushPolicy.instanceFor(""), "")
        XCTAssertEqual(PushPolicy.instanceFor(nil), "")

        let now: Int64 = 1_760_000_000_000
        XCTAssertTrue(PushPolicy.freshCall(at: now - 119_000, now: now))
        XCTAssertTrue(PushPolicy.freshCall(at: now - 120_000, now: now))
        XCTAssertFalse(PushPolicy.freshCall(at: now - 121_000, now: now))
        XCTAssertTrue(PushPolicy.freshCall(at: now + 300_000, now: now), "the phone's clock 5 minutes behind")
        XCTAssertFalse(PushPolicy.freshCall(at: now + 300_001, now: now))
        XCTAssertFalse(PushPolicy.freshCall(at: now + 400_000, now: now))
        XCTAssertFalse(PushPolicy.freshCall(at: 0, now: now))
        XCTAssertFalse(PushPolicy.freshCall(at: -1, now: now))
        XCTAssertFalse(PushPolicy.freshCall(at: Int64.max, now: now))

        let vapid = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM"
        XCTAssertTrue(PushPolicy.validVapid(vapid))
        XCTAssertFalse(PushPolicy.validVapid(vapid + "A"))
        XCTAssertFalse(PushPolicy.validVapid("A" + vapid.dropFirst()))
        XCTAssertFalse(PushPolicy.validVapid(nil))
        XCTAssertTrue(PushPolicy.validTag("missed-call:dm:abc_1"))
        XCTAssertFalse(PushPolicy.validTag("c:abc\n"))
        XCTAssertFalse(PushPolicy.validTag("c:ab c"))
    }

    func testWhatANotificationShows() throws {
        let now: Int64 = 1_760_000_000_000
        func payload(_ tag: String, at: Int64, title: String = "Alex", body: String = "hi") throws -> PushPayload {
            let json = #"{"tag":"\#(tag)","title":"\#(title)","body":"\#(body)","url":"/#call/dm:abc","at":\#(at)}"#
            return try XCTUnwrap(parse(json))
        }
        let ring = try payload("call:dm:abc", at: now - 5_000).display(now: now)
        XCTAssertEqual(ring, PushDisplay(title: "Alex", body: "hi", tag: "call:dm:abc", url: "/#call/dm:abc", ring: true, missedCall: false))
        let stale = try payload("call:dm:abc", at: now - 121_000).display(now: now)
        XCTAssertEqual(stale, PushDisplay(title: "Alex", body: "Missed call", tag: "missed-call:dm:abc", url: "/#call/dm:abc", ring: false, missedCall: true))
        XCTAssertTrue(try payload("call:dm:abc", at: 0).display(now: now).missedCall, "a ring without a time is missed")
        let message = try payload("d:abc", at: 0, title: "", body: "").display(now: now)
        XCTAssertEqual(message.title, "")
        XCTAssertEqual(message.body, "New activity")
        XCTAssertEqual(message.tag, "d:abc")
        XCTAssertFalse(message.ring || message.missedCall)
        let long = try payload("c:abc", at: 0, title: String(repeating: "t", count: 200), body: "a\\u202eb").display(now: now)
        XCTAssertEqual(long.title.unicodeScalars.count, 120)
        XCTAssertEqual(long.body, "ab")
    }
}
