import Foundation

/// Which page may send which hearthIOS message. A port of mobile/native/BridgePolicy.java; keep the two the same
/// (test/ios-shell.test.js compares the payment hosts).
///
/// "setServer" re-points the whole app at another site from then on: only the app's own connect screen may
/// send it, after the person typed an address there and pressed Connect. The server's page (and anything
/// injected into it) can't, so a compromised server can't move people to a look-alike that keeps them.
/// "changeServer" only opens the connect screen, where the person decides, so the server's page may ask for it.
/// "push..." (notifications while the app is closed) and "call..." (keeping a call going with the screen off) are
/// only for the server's own page: they belong to the account signed in there, and the connect screen has none.
/// Also which of the connect screen's links open in the browser instead (opensInBrowser), and which pages the app
/// never opens at all (isPaymentPage).
public enum BridgePolicy {
    /// The connect screen bundled in the app (Capacitor's default iOS scheme).
    public static let localOrigin = "capacitor://localhost"

    public static func allowed(type: String?, origin: String?, localOrigin: String? = BridgePolicy.localOrigin, serverOrigin: String?) -> Bool {
        guard let type = type, let origin = origin, !origin.isEmpty else { return false }
        // Compared as UTF-16, like Java's equals (Swift's == would also take canonically equivalent text).
        let local = localOrigin.map { !$0.isEmpty && J.same(origin, $0) } ?? false
        let server = serverOrigin.map { !$0.isEmpty && J.same(origin, $0) } ?? false
        if J.same(type, "setServer") { return local }
        if type.utf16.starts(with: "push".utf16) || type.utf16.starts(with: "call".utf16) { return server }
        return local || server
    }

    /// The origin of a WKSecurityOrigin (its protocol, host and port, 0 meaning the scheme's default), written the
    /// way the saved server origin is: "https://chat.example.com", "https://1.2.3.4:3000", "capacitor://localhost".
    public static func origin(protocol scheme: String, host: String, port: Int) -> String {
        let s = scheme.lowercased()
        var h = host.lowercased()
        if h.contains(":") && !h.hasPrefix("[") { h = "[" + h + "]" }
        let isDefault = port <= 0 || (s == "https" && port == 443) || (s == "http" && port == 80)
        return s + "://" + h + (isDefault ? "" : ":" + String(port))
    }

    /// Hearth's own website, where the connect screen's privacy policy link goes.
    public static let site = "https://pandabear445.github.io/Hearth-chat/"

    /// Whether a link the connect screen opens goes to the browser. Any other https:// address the connect screen
    /// goes to is the server the person chose, so a link to Hearth's website must not become the server.
    public static func opensInBrowser(_ url: String?) -> Bool {
        guard let url = url else { return false }
        return url.utf16.starts(with: site.utf16)
    }

    /// Where Hearth's ways to pay lead: Stripe's checkout, payment links and billing pages, and Ko-fi.
    public static let paymentHosts = ["checkout.stripe.com", "buy.stripe.com", "donate.stripe.com", "billing.stripe.com"]

    /// Whether a link goes to a page for paying. The app doesn't open those (the App Store doesn't allow an app to
    /// send people to pay outside Apple's in-app purchase). Hearth 1.29.1 and newer show no way to pay in the app, but
    /// a server on an older version still does, and anyone can post such a link in a message. Only the host counts,
    /// so a link that merely mentions one of these addresses still opens.
    public static func isPaymentPage(_ url: String?) -> Bool {
        guard let url = url else { return false }
        let s = J.units(J.trim(url).lowercased())
        var start = J.indexOf(s, "://")
        if start < 0 { return false }
        let scheme = J.string(s, 0, start)
        if scheme != "https" && scheme != "http" { return false }
        start += 3
        var end = s.count
        for c in ["/", "?", "#", "\\"] {
            let j = J.indexOf(s, c, from: start)
            if j >= 0 && j < end { end = j }
        }
        var host = Array(s[start..<end])
        let at = J.lastIndexOf(host, "@")
        if at >= 0 { host = Array(host[(at + 1)...]) }
        let colon = J.lastIndexOf(host, ":")
        if colon >= 0 && host.last != J.code("]") { host = Array(host[..<colon]) }
        while host.last == J.code(".") { host.removeLast() }
        if host == J.units("ko-fi.com") || (host.count >= 10 && Array(host.suffix(10)) == J.units(".ko-fi.com")) { return true }
        return paymentHosts.contains { J.units($0) == host }
    }

    public static func isPaymentPage(_ url: URL) -> Bool { isPaymentPage(url.absoluteString) }
}
