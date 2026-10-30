import XCTest
@testable import HearthKit

/// InviteLinks and ShareLinks: the cases of PushPolicyTest.java and test/reels-intake.test.js, plus what the Java
/// code (java.net.URI underneath) gives for awkward links, so the iPhone takes exactly the links Android takes.
final class LinksTests: XCTestCase {
    func testInviteLinksOnlyEverOpenAnInviteOnTheAppsServer() throws {
        let server = "https://chat.example.com"
        let h = try XCTUnwrap(InviteLinks.parse("hearth://invite/abcd2345"))
        XCTAssertEqual(h, Invite(origin: "", code: "abcd2345"))
        XCTAssertTrue(InviteLinks.forServer(h, serverOrigin: server))
        XCTAssertFalse(InviteLinks.forServer(h, serverOrigin: ""), "no server yet")
        XCTAssertFalse(InviteLinks.forServer(h, serverOrigin: nil))
        XCTAssertFalse(InviteLinks.forServer(nil, serverOrigin: server))
        let w = try XCTUnwrap(InviteLinks.parse("https://Chat.Example.com/invite/abcd2345/"))
        XCTAssertEqual(w.origin, "https://chat.example.com")
        XCTAssertTrue(InviteLinks.forServer(w, serverOrigin: server))
        XCTAssertTrue(InviteLinks.forServer(w, serverOrigin: "https://chat.example.com:443"))
        XCTAssertTrue(InviteLinks.forServer(w, serverOrigin: " https://Chat.Example.com/ "))
        XCTAssertFalse(InviteLinks.forServer(w, serverOrigin: "https://other.example"))
        XCTAssertEqual(InviteLinks.target(serverOrigin: server, code: w.code), "https://chat.example.com/invite/abcd2345")
        XCTAssertEqual(InviteLinks.target(serverOrigin: "https://chat.example.com:443/", code: "ab"), "https://chat.example.com/invite/ab")
        XCTAssertEqual(InviteLinks.parse("https://1.2.3.4:3000/invite/abcd2345")?.origin, "https://1.2.3.4:3000")
        for bad: String? in ["hearth://invite/", "hearth://invite/a", "hearth://invite/ab/cd", "hearth://evil/abcd2345",
                             "https://chat.example.com/invite/ab%2F..", "https://chat.example.com/x/invite/abcd", "http://chat.example.com/invite/abcd2345",
                             "https://user@chat.example.com/invite/abcd2345", "javascript:alert(1)", "hearth://invite/abcd2345?x=<script>", nil, ""] {
            let r = InviteLinks.parse(bad)
            XCTAssertTrue(r == nil || r?.code == "abcd2345", String(describing: bad))
        }
        XCTAssertNil(InviteLinks.parse("hearth://invite/ab/cd"))
        XCTAssertNil(InviteLinks.parse("https://user@chat.example.com/invite/abcd2345"))
        XCTAssertNil(InviteLinks.parse("https://chat.example.com/invite/" + String(repeating: "a", count: 65)))
        XCTAssertNotNil(InviteLinks.parse("https://chat.example.com/invite/" + String(repeating: "a", count: 64)))
        XCTAssertNil(InviteLinks.parse("https://chat.example.com/invite/abcd2345?" + String(repeating: "x", count: 2000)), "over 2000 characters")
    }

    /// InviteLinks.parse in Java gives these: "origin|code", or nil.
    func testInviteLinksMatchJava() {
        let cases: [(String, String?)] = [
            ("hearth://invite/abcd2345", "|abcd2345"),
            ("HEARTH://INVITE/abcd2345/", "|abcd2345"),
            ("hearth://invite/abcd2345?x=1", "|abcd2345"),
            ("hearth://invite/abcd2345#frag", "|abcd2345"),
            ("hearth:invite/abcd2345", nil),
            ("hearth://user@invite/abcd2345", nil),
            ("hearth://invite:99/abcd2345", "|abcd2345"),
            ("hearth:///abcd2345", nil),
            ("https://Chat.Example.com/invite/abcd2345/", "https://chat.example.com|abcd2345"),
            ("https://chat.example.com:443/invite/abcd2345", "https://chat.example.com|abcd2345"),
            ("https://chat.example.com:0/invite/abcd2345", "https://chat.example.com|abcd2345"),
            ("https://chat.example.com:/invite/abcd2345", "https://chat.example.com|abcd2345"),
            ("https://chat.example.com:99999999999/invite/abcd2345", nil),
            ("https://1.2.3.4:3000/invite/abcd2345", "https://1.2.3.4:3000|abcd2345"),
            ("https://1.2.3.256/invite/abcd2345", nil),
            ("https://1.2.3/invite/abcd2345", nil),
            ("https://123/invite/abcd2345", "https://123|abcd2345"),
            ("https://a-.example/invite/abcd2345", nil),
            ("https://a_b.example/invite/abcd2345", nil),
            ("https://[::1]:8443/invite/abcd2345", "https://[::1]:8443|abcd2345"),
            ("https://chat.example.com/invite/abcd2345?x=|", nil),
            ("https://chat.example.com/invite/abcd2345?x=%zz", nil),
            ("https://chat.example.com/invite/abcd2345?x=%41", "https://chat.example.com|abcd2345"),
            ("https://chat.example.com/invite/abcd2345#a#b", nil),
            ("https://chat.example.com./invite/abcd2345", "https://chat.example.com.|abcd2345"),
            ("https://chat.example.com/invite/ab cd", nil),
            ("https://chat.example.com/invite/abcd2345?q=\u{e9}", "https://chat.example.com|abcd2345"),
            ("https://chat.example.com/invite/abcd2345\n", nil),
            ("https:///invite/abcd2345", nil),
            ("https://", nil),
            ("https://chat.example.com/invite//", nil),
            ("https://chat.example.com/invite/a", nil),
        ]
        for (link, want) in cases {
            let r = InviteLinks.parse(link)
            XCTAssertEqual(r.map { $0.origin + "|" + $0.code }, want, link)
        }
    }

    func testShareTakesOnlyATikTokOrInstagramLink() {
        let id = "7234567890123456789"
        let cases: [(String?, String?, String?)] = [
            ("Check this out! https://vm.tiktok.com/ZMabc123/", nil, "https://vm.tiktok.com/ZMabc123/"),
            ("https://www.tiktok.com/@hearth/video/\(id)?is_from_webapp=1&sender_device=pc).", nil,
             "https://www.tiktok.com/@hearth/video/\(id)?is_from_webapp=1&sender_device=pc"),
            ("nothing here", "https://www.instagram.com/reel/C9abc_DEF-1/", "https://www.instagram.com/reel/C9abc_DEF-1/"),
            ("http://www.tiktok.com/@a/video/\(id)", nil, nil),
            ("https://user:pw@www.tiktok.com/@a/video/\(id)", nil, nil),
            ("https://www.tiktok.com:8443/@a/video/\(id)", nil, nil),
            ("https://www.tiktok.com.evil.net/@a/video/\(id)", nil, nil),
            ("https://www.tiktok.com/%2e%2e/%2fsettings", nil, nil),
            ("https://www.instagram.com/", nil, nil),
            ("javascript:alert(1)//https://www.tiktok.com/x", nil, "https://www.tiktok.com/x"),
            (String(repeating: "x ", count: 5000) + "https://www.tiktok.com/@a/video/\(id)", nil, nil),
            (nil, nil, nil),
        ]
        for (text, subject, want) in cases {
            XCTAssertEqual(ShareLinks.extract(text: text, subject: subject), want, String(describing: text?.prefix(60)))
        }
    }

    /// ShareLinks.first in Java gives these.
    func testShareLinksMatchJava() {
        let cases: [(String, String?)] = [
            ("HTTPS://WWW.TIKTOK.COM/@a/video/1", "HTTPS://WWW.TIKTOK.COM/@a/video/1"),
            ("https://www.tiktok.com:/@a/video/1", "https://www.tiktok.com:/@a/video/1"),
            ("https://www.tiktok.com/@a/video/1?x={y}", nil),
            ("https://www.tiktok.com/@a/video/1?x=1#y", "https://www.tiktok.com/@a/video/1?x=1#y"),
            ("https://www.tiktok.com/@a/video/1?x=%zz", nil),
            ("see https://www.instagram.com/reel/abc/\u{a0}more", nil), // Java's \s isn't a no-break space
            ("see https://www.tiktok.com/@a/video/1\u{2028}x", nil),
            ("https://m.tiktok.com/v/1.html", "https://m.tiktok.com/v/1.html"),
            ("https://tiktok.com/@a/video/1)))...", "https://tiktok.com/@a/video/1"),
            ("https://www.tiktok.com/@a/video/1?x=\u{e9}", "https://www.tiktok.com/@a/video/1?x=\u{e9}"),
            ("https://www.tiktok.com/@a%2Fb", nil),
            ("a https://evil.example/x then https://vt.tiktok.com/ZS1/ ok", "https://vt.tiktok.com/ZS1/"),
            ("<https://www.tiktok.com/@a/video/1>", "https://www.tiktok.com/@a/video/1"),
            ("\u{201c}https://www.tiktok.com/@a/video/1\u{201d}", "https://www.tiktok.com/@a/video/1"),
        ]
        for (text, want) in cases {
            XCTAssertEqual(ShareLinks.first(text), want, text)
        }
        XCTAssertEqual(ShareLinks.trimTail("x.,;:!?)]'\"\u{bb}\u{201d}"), "x")
        XCTAssertEqual(ShareLinks.trimTail("...."), "")
        XCTAssertNil(ShareLinks.first(""))
        XCTAssertFalse(ShareLinks.ok("https://www.tiktok.com/" + String(repeating: "a", count: 300)), "path over 300 characters")
        XCTAssertTrue(ShareLinks.ok("https://www.tiktok.com/" + String(repeating: "a", count: 299)))
    }
}
