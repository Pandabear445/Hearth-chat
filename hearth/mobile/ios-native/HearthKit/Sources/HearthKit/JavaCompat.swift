import Foundation

// Small pieces that make the ports behave exactly like the Java they come from: Java strings are UTF-16, its
// Matcher.matches() takes the whole string, and String.trim() drops every character up to U+0020.

/// A regular expression that, like Java's Matcher.matches(), must match the whole string (a trailing newline
/// included, which "$" alone would let through).
struct WholeMatch {
    private let re: NSRegularExpression

    init(_ pattern: String, caseInsensitive: Bool = false) {
        // The patterns are constants, so a bad one is a programming error caught by the tests.
        re = try! NSRegularExpression(pattern: "\\A(?:" + pattern + ")\\z", options: caseInsensitive ? [.caseInsensitive] : [])
    }

    func matches(_ s: String?) -> Bool {
        guard let s = s else { return false }
        return re.firstMatch(in: s, options: [], range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }
}

enum J {
    static func units(_ s: String) -> [UInt16] { Array(s.utf16) }

    static func string(_ u: [UInt16], _ from: Int, _ to: Int) -> String {
        String(decoding: u[from..<to], as: UTF16.self)
    }

    /// Java's String.trim(): every leading and trailing character at or below U+0020.
    static func trim(_ s: String) -> String {
        let u = units(s)
        var a = 0, b = u.count
        while a < b && u[a] <= 0x20 { a += 1 }
        while b > a && u[b - 1] <= 0x20 { b -= 1 }
        return string(u, a, b)
    }

    /// Java's String.indexOf(String, from), on UTF-16 units; -1 when absent.
    static func indexOf(_ u: [UInt16], _ needle: String, from: Int = 0) -> Int {
        let n = units(needle)
        if n.isEmpty || u.count < n.count { return n.isEmpty ? min(max(from, 0), u.count) : -1 }
        var i = max(from, 0)
        while i + n.count <= u.count {
            if Array(u[i..<(i + n.count)]) == n { return i }
            i += 1
        }
        return -1
    }

    static func lastIndexOf(_ u: [UInt16], _ c: Character) -> Int {
        let x = units(String(c))[0]
        var i = u.count - 1
        while i >= 0 { if u[i] == x { return i }; i -= 1 }
        return -1
    }

    static func code(_ c: Character) -> UInt16 { units(String(c))[0] }

    /// Java's String.equals: the same UTF-16 units.
    static func same(_ a: String, _ b: String) -> Bool { a.utf16.elementsEqual(b.utf16) }
}

/// The parts of a link the way java.net.URI(String) parses it, for the checks ported from InviteLinks.java and
/// ShareLinks.java. nil where Java throws URISyntaxException. A server authority Java can't parse (Java then treats
/// it as a "registry" authority) comes out with host nil, as getHost() does, and so does one with user info in it:
/// both are refused by every caller. Not ported: an IPv6 scope id ("[fe80::1%en0]"), which is refused here.
struct JavaURI {
    var scheme: String?
    var host: String?
    var hasUserInfo = false
    var port = -1
    var rawPath: String?
    var rawQuery: String?
    var rawFragment: String?

    init?(_ input: String) {
        let u = J.units(input)
        let n = u.count
        var p = 0
        // A scheme is everything before the first ":" when no "/", "?" or "#" comes before it.
        var colon = -1
        for i in 0..<n {
            let c = u[i]
            if c == 0x2F || c == 0x3F || c == 0x23 { break }
            if c == 0x3A { colon = i; break }
        }
        if colon >= 0 {
            if colon == 0 || !JavaURI.isAlpha(u[0]) { return nil }
            for i in 1..<colon where !(JavaURI.isAlphaNum(u[i]) || u[i] == 0x2B || u[i] == 0x2D || u[i] == 0x2E) { return nil }
            scheme = J.string(u, 0, colon)
            p = colon + 1
            if !(p < n && u[p] == 0x2F) {
                // Opaque ("mailto:x"): no host or path. Java still checks the characters.
                var q = p
                while q < n && u[q] != 0x23 { q += 1 }
                if q <= p { return nil }
                guard JavaURI.check(u, p, q, JavaURI.uric) else { return nil }
                if q < n { guard JavaURI.check(u, q + 1, n, JavaURI.uric) else { return nil } }
                return
            }
        }
        // Hierarchical.
        if p + 1 < n && u[p] == 0x2F && u[p + 1] == 0x2F {
            p += 2
            var q = p
            while q < n && u[q] != 0x2F && u[q] != 0x3F && u[q] != 0x23 { q += 1 }
            if q > p {
                parseAuthority(u, p, q)
                p = q
            } else if q >= n {
                return nil // "https://" with nothing after it
            }
        }
        var q = p
        while q < n && u[q] != 0x3F && u[q] != 0x23 { q += 1 }
        guard JavaURI.check(u, p, q, JavaURI.path) else { return nil }
        rawPath = J.string(u, p, q)
        p = q
        if p < n && u[p] == 0x3F {
            p += 1
            q = p
            while q < n && u[q] != 0x23 { q += 1 }
            guard JavaURI.check(u, p, q, JavaURI.uric) else { return nil }
            rawQuery = J.string(u, p, q)
            p = q
        }
        if p < n && u[p] == 0x23 {
            guard JavaURI.check(u, p + 1, n, JavaURI.uric) else { return nil }
            rawFragment = J.string(u, p + 1, n)
        }
    }

    // Where Java's whole parse would fail on the authority (a bad escape, a stray character) or where it reads it as a
    // "registry" authority, host stays nil, and every caller refuses a link without a host either way.
    private mutating func parseAuthority(_ u: [UInt16], _ start: Int, _ end: Int) {
        if !parseServer(u, start, end) { host = nil; port = -1 }
    }

    private mutating func parseServer(_ u: [UInt16], _ start: Int, _ n: Int) -> Bool {
        var p = start
        if u[start..<n].contains(0x40) {
            // User info ("name:password@host"). Every caller refuses a link with it, so it isn't kept.
            hasUserInfo = true
            return false
        }
        if p < n && u[p] == 0x5B {
            p += 1
            var q = p
            while q < n && u[q] != 0x5D { q += 1 }
            guard q > p, q < n, JavaURI.validIPv6(J.string(u, p, q)) else { return false }
            host = J.string(u, p - 1, q + 1)
            p = q + 1
        } else {
            var q = JavaURI.ipv4End(u, p, n)
            if q <= p { q = JavaURI.hostnameEnd(u, p, n) }
            guard q > p else { return false }
            host = J.string(u, p, q)
            p = q
        }
        if p < n && u[p] == 0x3A {
            p += 1
            var q = p
            while q < n && JavaURI.isDigit(u[q]) { q += 1 }
            if q > p {
                guard let v = Int32(J.string(u, p, q)) else { return false }
                port = Int(v)
                p = q
            }
        }
        return p >= n
    }

    // Java's scanIPv4Address: four dotted bytes of at most 255, followed by the end or ":". -1 if it isn't one.
    private static func ipv4End(_ u: [UInt16], _ start: Int, _ n: Int) -> Int {
        var m = start
        while m < n && (isDigit(u[m]) || u[m] == 0x2E) { m += 1 }
        if m <= start { return -1 }
        var p = start
        for i in 0..<4 {
            var q = p
            while q < m && isDigit(u[q]) { q += 1 }
            if q <= p { return -1 }
            guard let v = Int32(J.string(u, p, q)), v <= 255 else { return -1 }
            p = q
            if i < 3 {
                if p < m && u[p] == 0x2E { p += 1 } else { return -1 }
            }
        }
        if p > start && p < n && u[p] != 0x3A { return -1 }
        return p
    }

    // Java's parseHostname: labels of letters, digits and inner dashes, separated by dots (one may end it); the last
    // label starts with a letter unless it is the only one. Returns where it ends (the end or a ":"), or -1.
    private static func hostnameEnd(_ u: [UInt16], _ start: Int, _ n: Int) -> Int {
        var p = start
        var l = -1
        repeat {
            var q = p
            while q < n && isAlphaNum(u[q]) { q += 1 }
            if q <= p { break }
            l = p
            p = q
            q = p
            while q < n && (isAlphaNum(u[q]) || u[q] == 0x2D) { q += 1 }
            if q > p {
                if u[q - 1] == 0x2D { return -1 }
                p = q
            }
            if p < n && u[p] == 0x2E { p += 1 } else { break }
        } while p < n
        if p < n && u[p] != 0x3A { return -1 }
        if l < 0 { return -1 }
        if l > start && !isAlpha(u[l]) { return -1 }
        return p
    }

    static func validIPv6(_ s: String) -> Bool {
        let parts = s.components(separatedBy: "::")
        if parts.count > 2 { return false }
        var groups = 0
        for (k, part) in parts.enumerated() where !part.isEmpty {
            let gs = part.split(separator: ":", omittingEmptySubsequences: false)
            for (i, g) in gs.enumerated() {
                let last = k == parts.count - 1 && i == gs.count - 1
                if last && g.contains(".") {
                    let v4 = J.units(String(g))
                    if ipv4End(v4, 0, v4.count) != v4.count { return false }
                    groups += 2
                    continue
                }
                guard (1...4).contains(g.count), g.unicodeScalars.allSatisfy({ $0.value < 128 && isHex(UInt16($0.value)) }) else { return false }
                groups += 1
            }
        }
        return parts.count == 2 ? groups <= 7 : groups == 8
    }

    // ---- Java's character classes (RFC 2396 with RFC 2732's brackets)
    private static let alphaNum = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    private static let unreserved = alphaNum + "-_.!~*'()"
    private static let reserved = ";/?:@&=+$,[]"
    static let uric = Set(J.units(reserved + unreserved))
    static let path = Set(J.units(unreserved + ":@&=+$," + ";/"))

    static func isAlpha(_ c: UInt16) -> Bool { (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) }
    static func isDigit(_ c: UInt16) -> Bool { c >= 0x30 && c <= 0x39 }
    static func isAlphaNum(_ c: UInt16) -> Bool { isAlpha(c) || isDigit(c) }
    static func isHex(_ c: UInt16) -> Bool { isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66) }
    static func inSet(_ c: UInt16, _ set: Set<UInt16>) -> Bool { c != 0 && c < 128 && set.contains(c) }

    // Java lets visible non-ASCII characters through unescaped: above U+0080, not a space separator, not a control.
    static func isOther(_ c: UInt16) -> Bool {
        if c <= 128 { return false }
        if c <= 0x9F { return false }
        switch c {
        case 0x00A0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000: return false
        default: return true
        }
    }

    // Java's checkChars with escapes allowed: every character in the set, a %XX escape or a visible non-ASCII one.
    static func check(_ u: [UInt16], _ start: Int, _ end: Int, _ set: Set<UInt16>) -> Bool {
        var i = start
        while i < end {
            let c = u[i]
            if inSet(c, set) || isOther(c) { i += 1; continue }
            if c == 0x25 && i + 2 < end && isHex(u[i + 1]) && isHex(u[i + 2]) { i += 3; continue }
            return false
        }
        return true
    }
}
