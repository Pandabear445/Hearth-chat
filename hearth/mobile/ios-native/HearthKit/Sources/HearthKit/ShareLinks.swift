import Foundation

/// Links shared to the app (the Share extension): the first TikTok or Instagram link in what was shared, or nil.
/// A port of mobile/native/ShareLinks.java.
///
/// Any app can share anything, so what's shared is untrusted: only an https link on TikTok's or Instagram's own names
/// is taken (no user name or password, no other port), and only that link travels on to the page, which checks it
/// again (public/js/share.js) and opens a picker. Nothing is sent anywhere until the person picks a conversation.
public enum ShareLinks {
    public static let textMax = 8000
    // Java's \s is ASCII whitespace only (ICU's would also stop at a no-break space), so it is spelled out here.
    private static let LINK = try! NSRegularExpression(pattern: "https?://[^ \\t\\n\\x0B\\f\\r<>\"'`]{1,2048}", options: [.caseInsensitive])
    private static let HOSTS: Set<String> = ["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
                                             "instagram.com", "www.instagram.com", "m.instagram.com"]
    private static let PATH = WholeMatch("[A-Za-z0-9/@._-]+")

    /// The first TikTok or Instagram link in the shared text (then its subject), or nil.
    public static func extract(text: String?, subject: String?) -> String? {
        first(text) ?? first(subject)
    }

    public static func first(_ text: String?) -> String? {
        guard let text = text, !text.isEmpty else { return nil }
        let units = J.units(text)
        let s = units.count > textMax ? J.string(units, 0, textMax) : text
        let ns = s as NSString
        for m in LINK.matches(in: s, options: [], range: NSRange(location: 0, length: ns.length)) {
            let raw = trimTail(ns.substring(with: m.range))
            if ok(raw) { return raw }
        }
        return nil
    }

    // Punctuation after a link isn't part of it; trimmed one character at a time.
    public static func trimTail(_ s: String) -> String {
        let tail = Set(J.units(")].,;:!?'\"\u{00bb}\u{201d}"))
        let u = J.units(s)
        var end = u.count
        while end > 0 && tail.contains(u[end - 1]) { end -= 1 }
        return J.string(u, 0, end)
    }

    public static func ok(_ link: String) -> Bool {
        guard let u = JavaURI(link), let scheme = u.scheme, scheme.lowercased() == "https", !u.hasUserInfo, u.port == -1,
              let host = u.host else { return false }
        if !HOSTS.contains(host.lowercased()) { return false }
        let path = u.rawPath ?? ""
        return path.utf16.count > 1 && path.utf16.count <= 300 && PATH.matches(path)
    }
}
