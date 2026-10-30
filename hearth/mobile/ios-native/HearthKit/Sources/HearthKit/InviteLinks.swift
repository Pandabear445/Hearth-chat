import Foundation

/// An invite from a link: the server it names ("" for hearth://, which means "my server") and its code.
public struct Invite: Equatable {
    public let origin: String
    public let code: String

    public init(origin: String, code: String) {
        self.origin = origin
        self.code = code
    }
}

/// Invite links that open in the app: hearth://invite/CODE (the same links the desktop app takes) and
/// https://your-server/invite/CODE (Universal Links, for an app built for one server). A port of
/// mobile/native/InviteLinks.java.
///
/// Only the code is taken from a link, never an address to load: the app opens /invite/CODE on the server it is
/// already set up for, so a link can't point the app at another site. An https link for a different server than
/// the app's is refused (the person switches server first).
public enum InviteLinks {
    private static let CODE = WholeMatch("^[A-Za-z0-9]{2,64}$")

    /// The invite in a link, or nil if it isn't one.
    public static func parse(_ link: String?) -> Invite? {
        guard let link = link, link.utf16.count <= 2000, let u = JavaURI(link) else { return nil }
        let scheme = (u.scheme ?? "").lowercased()
        if u.hasUserInfo { return nil }
        let path = u.rawPath ?? ""
        if scheme == "hearth" {
            guard let host = u.host, host.lowercased() == "invite" else { return nil }
            let code = trimSlash(path.hasPrefix("/") ? String(path.dropFirst()) : path)
            return CODE.matches(code) ? Invite(origin: "", code: code) : nil
        }
        guard scheme == "https", let host = u.host else { return nil }
        guard path.hasPrefix("/invite/") else { return nil }
        let code = trimSlash(String(path.dropFirst("/invite/".count)))
        if !CODE.matches(code) { return nil }
        let port = u.port
        let origin = "https://" + host.lowercased() + (port > 0 && port != 443 ? ":" + String(port) : "")
        return Invite(origin: origin, code: code)
    }

    /// Whether an invite parsed from a link can be opened on the server the app uses.
    public static func forServer(_ invite: Invite?, serverOrigin: String?) -> Bool {
        guard let invite = invite, let serverOrigin = serverOrigin, !serverOrigin.isEmpty else { return false }
        return invite.origin.isEmpty || J.same(invite.origin, normalOrigin(serverOrigin))
    }

    /// The page to open for an invite on the app's server.
    public static func target(serverOrigin: String, code: String) -> String {
        normalOrigin(serverOrigin) + "/invite/" + code
    }

    /// "https://Chat.Example.com:443" -> "https://chat.example.com"
    public static func normalOrigin(_ origin: String?) -> String {
        guard let origin = origin else { return "" }
        let o = J.trim(origin)
        let u = J.units(o)
        let i = J.indexOf(u, "://")
        if i < 0 { return o }
        let scheme = J.string(u, 0, i).lowercased()
        var rest = J.string(u, i + 3, u.count).lowercased()
        if rest.hasSuffix("/") { rest = String(rest.dropLast()) }
        if scheme == "https" && rest.hasSuffix(":443") { rest = String(rest.dropLast(4)) }
        if scheme == "http" && rest.hasSuffix(":80") { rest = String(rest.dropLast(3)) }
        return scheme + "://" + rest
    }

    private static func trimSlash(_ s: String) -> String { s.hasSuffix("/") ? String(s.dropLast()) : s }
}
