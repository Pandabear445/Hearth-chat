import UIKit
import HearthKit

/// Places the app is asked to open, held until the server's page is ready for them (MainActivity's pendingOpen,
/// pendingInvite and pendingShare):
///  - a tapped notification: one of Cindrly's own addresses (PushPolicy.safeOpenPath), as hearth-open
///  - an invite link, hearth://invite/CODE or (a Universal Link, for an app built for one server)
///    https://<server>/invite/CODE: only the code travels (InviteLinks), as hearth-invite
///  - a TikTok or Instagram link shared to Cindrly: the share extension leaves it in the App Group ("pendingShare")
///    and it's picked up when Cindrly comes on screen, as hearth-share
/// A page that says hello gets what's waiting in its info answer instead (HearthBridge). SceneDelegate and
/// AppDelegate hand links here; Capacitor's own proxies still get them too.
@MainActor
final class LinkRouter: NSObject {
    static let shared = LinkRouter()

    private var pendingOpen: String?
    private var pendingInvite: Invite?
    private var pendingShare: String?

    private var page: HearthViewController? { HearthViewController.current }
    private var pageReady: Bool { page?.pageReady == true }

    /// hearth://invite/CODE or https://<server>/invite/CODE. False when it isn't an invite link at all.
    @discardableResult
    func handle(_ url: URL?) -> Bool {
        guard let url = url, let invite = InviteLinks.parse(url.absoluteString) else { return false }
        let server = HearthViewController.serverOrigin
        if !server.isEmpty && !InviteLinks.forServer(invite, serverOrigin: server) {
            otherServer(invite)
            return true
        }
        pendingInvite = invite
        if pageReady { deliverInvite() }
        return true
    }

    /// An invite for another Cindrly server: it opens in Safari, on that server's own site, if the person wants. (The
    /// app stays on its own server: the wording doesn't suggest switching, which an app built for one server can't.)
    /// Cindrly just starting (a link that launched it): asked once its screen is up.
    private func otherServer(_ invite: Invite, tries: Int = 0) {
        guard let page = page, let top = page.topController(), page.view.window != nil else {
            if tries < 10 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.otherServer(invite, tries: tries + 1) } }
            return
        }
        guard let url = URL(string: InviteLinks.target(serverOrigin: invite.origin, code: invite.code)) else { return }
        let host = url.host ?? invite.origin
        let alert = UIAlertController(title: "This invite is for \(host)", message: "It\u{2019}s for a different Cindrly server than the one this app uses. You can open it in Safari.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Open in Safari", style: .default) { [weak page] _ in page?.openOutside(url) })
        alert.preferredAction = alert.actions.last
        top.present(alert, animated: true)
    }

    /// Opens one of the app's own addresses in the server's page: now if it's ready, else once it says hello.
    func open(_ path: String?) {
        pendingOpen = PushPolicy.safeOpenPath(path)
        guard pageReady, let page = page else { return }
        if page.pageApi >= 2, let p = pendingOpen { page.toServerPage("hearth-open", jsonText(p)) }
        pendingOpen = nil
    }

    /// What the server's page gets in its answer to hello (each only once).
    func takeForHello(api: Int) -> [String: Any] {
        var o: [String: Any] = [:]
        if let p = pendingOpen { o["open"] = p; pendingOpen = nil }
        if let code = takeInvite() { o["invite"] = code }
        if let link = pendingShare, api >= 3 { o["share"] = link; pendingShare = nil }
        return o
    }

    /// The server's page said hello: a link it couldn't take in its answer (an older page) is dealt with now.
    func pageSaidHello() {
        if pendingShare != nil { deliverShare() }
    }

    /// Cindrly on screen: a link shared to it from another app (ShareViewController) is waiting.
    func sceneDidBecomeActive() {
        let group = HearthViewController.group
        guard let link = group.string(forKey: "pendingShare") else { return }
        group.removeObject(forKey: "pendingShare")
        // Checked again here: only a TikTok or Instagram link goes on, to the page's share picker.
        guard let ok = ShareLinks.extract(text: link, subject: nil) else { return }
        pendingShare = ok
        if pageReady { deliverShare() }
    }

    // The invite waiting for this server, if any (once).
    private func takeInvite() -> String? {
        guard let invite = pendingInvite, InviteLinks.forServer(invite, serverOrigin: HearthViewController.serverOrigin) else { return nil }
        pendingInvite = nil
        return invite.code
    }

    // The page is already open: a current page shows the "Join a server" box in place (a call keeps going); an
    // older one gets the invite page loaded instead.
    private func deliverInvite() {
        guard let page = page, let code = takeInvite() else { return }
        if page.pageApi >= 2 {
            page.toServerPage("hearth-invite", jsonText(code))
        } else if let url = URL(string: InviteLinks.target(serverOrigin: page.serverOrigin, code: code)) {
            page.load(url)
        }
    }

    // The page is open: it opens its share picker in place. A page from a server older than sharing can't take it:
    // the person is told, and the page is left alone (reloading it would end a call).
    private func deliverShare() {
        guard let page = page, let link = pendingShare, !page.serverOrigin.isEmpty else { return }
        pendingShare = nil
        if page.pageApi >= 3 {
            page.toServerPage("hearth-share", jsonText(link))
        } else {
            page.notice("This Cindrly server is too old to share to. Paste the link in a conversation instead.")
        }
    }
}
