import Foundation

/// One decrypted push from the Hearth server: { title, body, tag, url, at, generic?, _ }. A port of
/// mobile/native/PushPayload.java.
///
/// Strict: anything that isn't a JSON object of at most 4096 bytes with a valid tag is dropped. Unknown keys are
/// skipped whatever their value, so a newer server adding fields never breaks an older app. The url always comes
/// out as an in-app address. The text isn't cleaned here; display(now:) does that.
public struct PushPayload: Equatable {
    public let title: String
    public let body: String
    public let tag: String
    public let url: String
    public let generic: String
    public let at: Int64

    public static func parse(_ utf8: Data) -> PushPayload? {
        if utf8.isEmpty || utf8.count > PushPolicy.maxPayloadBytes { return nil }
        var r = Reader(String(decoding: utf8, as: UTF8.self))
        guard let m = try? r.object() else { return nil }
        let tag = str(m["tag"])
        if !PushPolicy.validTag(tag) { return nil }
        var when: Int64 = 0
        if case .number(let d)? = m["at"], !d.isNaN, !d.isInfinite { when = javaLong(d) }
        return PushPayload(title: str(m["title"]), body: str(m["body"]), tag: tag, url: PushPolicy.safeOpenPath(str(m["url"])),
                           generic: str(m["generic"]), at: max(0, when))
    }

    /// A call ring ("call:<room>").
    public var isCall: Bool { tag.utf16.starts(with: "call:".utf16) }

    /// What the notification shows, by the rules of HearthNotifications.showPush on Android.
    public func display(now: Int64) -> PushDisplay {
        let call = isCall
        let fresh = !call || PushPolicy.freshCall(at: at, now: now)
        var shownBody = call && !fresh ? "Missed call" : PushPolicy.clean(body, maxCodePoints: 240)
        if shownBody.isEmpty { shownBody = "New activity" }
        return PushDisplay(title: PushPolicy.clean(title, maxCodePoints: 120), body: shownBody,
                           tag: call && !fresh ? "missed-" + tag : tag, url: url, ring: call && fresh, missedCall: call && !fresh)
    }

    private static func str(_ v: Value?) -> String {
        if case .string(let s)? = v { return s }
        return ""
    }

    // Java's (long) cast of a double: toward zero, and clamped instead of overflowing.
    private static func javaLong(_ d: Double) -> Int64 {
        if d >= 9_223_372_036_854_775_807.0 { return Int64.max }
        if d <= -9_223_372_036_854_775_808.0 { return Int64.min }
        return Int64(d)
    }

    enum Value { case string(String), number(Double) }

    struct Bad: Error {}

    /// A small JSON reader for one flat object: string and number values are kept, anything else (objects, arrays,
    /// true/false/null) is skipped. Throws on malformed input. Works on UTF-16 units, as the Java one does.
    struct Reader {
        private let s: [UInt16]
        private var i = 0
        private var depth = 0

        init(_ text: String) { s = Array(text.utf16) }

        mutating func object() throws -> [String: Value]? {
            ws()
            if !eat("{") { return nil }
            var out = [String: Value]()
            ws()
            if eat("}") { return try end(out) }
            while true {
                ws()
                let key = try string()
                ws()
                try expect(":")
                ws()
                let v = try topValue()
                if let v = v { out[key] = v } else { out.removeValue(forKey: key) } // last one wins, even a skipped one
                ws()
                if eat(",") { continue }
                try expect("}")
                return try end(out)
            }
        }

        private mutating func end(_ out: [String: Value]) throws -> [String: Value] {
            ws()
            if i != s.count { throw Bad() }
            return out
        }

        private mutating func topValue() throws -> Value? {
            let c = try peek()
            if c == 0x22 { return .string(try string()) }
            if c == 0x2D || (c >= 0x30 && c <= 0x39) { return .number(try number()) }
            try skipValue()
            return nil
        }

        private mutating func skipValue() throws {
            let c = try peek()
            if c == 0x22 { _ = try string(); return }
            if c == 0x2D || (c >= 0x30 && c <= 0x39) { _ = try number(); return }
            if c == 0x7B || c == 0x5B {
                depth += 1
                if depth > 32 { throw Bad() }
                let close: UInt16 = c == 0x7B ? 0x7D : 0x5D
                i += 1
                ws()
                if eatUnit(close) { depth -= 1; return }
                while true {
                    ws()
                    if close == 0x7D { _ = try string(); ws(); try expect(":"); ws() }
                    try skipValue()
                    ws()
                    if eat(",") { continue }
                    if !eatUnit(close) { throw Bad() }
                    depth -= 1
                    return
                }
            }
            for w in ["true", "false", "null"] {
                let u = Array(w.utf16)
                if i + u.count <= s.count && Array(s[i..<(i + u.count)]) == u { i += u.count; return }
            }
            throw Bad()
        }

        private mutating func string() throws -> String {
            try expect("\"")
            var sb = [UInt16]()
            while true {
                if i >= s.count { throw Bad() }
                let c = s[i]; i += 1
                if c == 0x22 { return String(decoding: sb, as: UTF16.self) }
                if c < 0x20 { throw Bad() }
                if c != 0x5C { sb.append(c); continue }
                if i >= s.count { throw Bad() }
                let e = s[i]; i += 1
                switch e {
                case 0x22: sb.append(0x22)
                case 0x5C: sb.append(0x5C)
                case 0x2F: sb.append(0x2F)
                case 0x62: sb.append(0x08)
                case 0x66: sb.append(0x0C)
                case 0x6E: sb.append(0x0A)
                case 0x72: sb.append(0x0D)
                case 0x74: sb.append(0x09)
                case 0x75:
                    if i + 4 > s.count { throw Bad() }
                    sb.append(try hex4(Array(s[i..<(i + 4)])))
                    i += 4
                default: throw Bad()
                }
            }
        }

        // Java's (char) Integer.parseInt(x, 16) of four characters, a leading + or - included.
        private func hex4(_ u: [UInt16]) throws -> UInt16 {
            var k = 0
            var negative = false
            if u[0] == 0x2B || u[0] == 0x2D { negative = u[0] == 0x2D; k = 1 }
            var v = 0
            for c in u[k...] {
                let d: Int
                switch c {
                case 0x30...0x39: d = Int(c) - 0x30
                case 0x41...0x46: d = Int(c) - 0x41 + 10
                case 0x61...0x66: d = Int(c) - 0x61 + 10
                default: throw Bad()
                }
                v = v * 16 + d
            }
            return UInt16(truncatingIfNeeded: negative ? -v : v)
        }

        private mutating func number() throws -> Double {
            let start = i
            if try peek() == 0x2D { i += 1 }
            while i < s.count, let c = Unicode.Scalar(s[i]), "0123456789.eE+-".unicodeScalars.contains(c) { i += 1 }
            let text = String(decoding: s[start..<i], as: UTF16.self)
            guard let d = javaDouble(text) else { throw Bad() }
            return d
        }

        // Double.valueOf for what number() collects (digits, ".", "e", "+", "-"): Java's grammar is a sign, digits
        // with at most one ".", at least one digit, then an optional exponent with digits.
        private static let decimal = WholeMatch("[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?")

        private func javaDouble(_ t: String) -> Double? {
            guard Reader.decimal.matches(t) else { return nil }
            if let d = Double(t) { return d }
            // Swift refuses what doesn't fit; Java gives infinity (or 0 for a tiny one, which Swift already returns).
            return t.hasPrefix("-") ? -Double.infinity : Double.infinity
        }

        private mutating func ws() {
            while i < s.count && (s[i] == 0x20 || s[i] == 0x09 || s[i] == 0x0D || s[i] == 0x0A) { i += 1 }
        }

        private func peek() throws -> UInt16 {
            if i >= s.count { throw Bad() }
            return s[i]
        }

        private mutating func eat(_ c: Unicode.Scalar) -> Bool { eatUnit(UInt16(c.value)) }

        private mutating func eatUnit(_ c: UInt16) -> Bool {
            if i < s.count && s[i] == c { i += 1; return true }
            return false
        }

        private mutating func expect(_ c: Unicode.Scalar) throws {
            if !eat(c) { throw Bad() }
        }
    }
}

/// What a push notification shows (PushPayload.display(now:)).
public struct PushDisplay: Equatable {
    /// The cleaned title; "" means keep the original alert's title (the app's name).
    public let title: String
    /// The cleaned body, "New activity" when there is none, "Missed call" for a ring that is too old.
    public let body: String
    /// The tag, or "missed-" + tag for a ring that is too old. Use it as the thread identifier.
    public let tag: String
    /// A safe in-app path for userInfo["url"].
    public let url: String
    /// A fresh call ring: keep the ring sound and the time-sensitive level.
    public let ring: Bool
    /// A ring that is too old: no sound.
    public let missedCall: Bool
}
