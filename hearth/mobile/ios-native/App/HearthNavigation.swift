import UIKit
import WebKit
import Capacitor
import HearthKit

/// Which pages load in the app (MainActivity's HearthClient). Only the connect screen and the saved server load
/// here; payment pages never open; anything else goes to Safari. Everything Capacitor's own delegate does (resetting
/// its JS bridge on each page, its first-load opacity) still happens: each callback is handed on to it.
@MainActor
final class HearthNavigation: NSObject, WKNavigationDelegate {
    private weak var controller: HearthViewController?
    private weak var capacitor: WebViewDelegationHandler?
    #if HEARTH_CUSTOM_SERVER
    private var pendingTrust: [@MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void] = []
    private var trustAlertShowing = false
    #endif

    init(controller: HearthViewController, capacitor: WebViewDelegationHandler?) {
        self.controller = controller
        self.capacitor = capacitor
        super.init()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let vc = controller, let url = navigationAction.request.url else { decisionHandler(.allow); return }
        // Frames inside a page (embedded videos) are the page's business; a new window comes to HearthUI.
        guard let target = navigationAction.targetFrame, target.isMainFrame else { decisionHandler(.allow); return }
        let o = originOf(url)
        // The connect screen: Capacitor's own rules (it serves the bundled files).
        if !o.isEmpty && o == vc.localOrigin {
            if let capacitor = capacitor { capacitor.webView(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler) } else { decisionHandler(.allow) }
            return
        }
        if !o.isEmpty && o == vc.serverOrigin { decisionHandler(.allow); return }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "blob" || scheme == "data" || scheme == "about" { decisionHandler(.allow); return }
        // No way to pay from the app, whatever the page links to (BridgePolicy.isPaymentPage).
        if BridgePolicy.isPaymentPage(url) {
            vc.notice("Payments aren\u{2019}t available in the iPhone app.")
            decisionHandler(.cancel)
            return
        }
        // Leaving the connect screen: that's the server the person just chose (the connect screen also says so over
        // the bridge first). Its privacy policy link isn't: it goes to Safari below, like links from the server's pages.
        let from = originOf(webView.url)
        if from == vc.localOrigin && (scheme == "https" || scheme == "http") && !BridgePolicy.opensInBrowser(url.absoluteString) && vc.setServerOrigin(o) {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        vc.openOutside(url)
    }

    // swiftlint:disable:next implicitly_unwrapped_optional
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        controller?.pageReady = false // until the new page says hello
        // A new page (a reload after an update, switching server, an error page): any call lived in the page being
        // replaced, so its audio session goes too. (Only whole-page loads get here, never the page's own #links.)
        CallAudio.shared.stop()
        capacitor?.webView(webView, didStartProvisionalNavigation: navigation)
    }

    // swiftlint:disable:next implicitly_unwrapped_optional
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        capacitor?.webView(webView, didFinish: navigation)
    }

    // swiftlint:disable:next implicitly_unwrapped_optional
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        capacitor?.webView(webView, didFail: navigation, withError: error)
        failed(webView, error)
    }

    // swiftlint:disable:next implicitly_unwrapped_optional
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        capacitor?.webView(webView, didFailProvisionalNavigation: navigation, withError: error)
        failed(webView, error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        capacitor?.webViewWebContentProcessDidTerminate(webView)
    }

    // The server's page didn't load: the connect screen says why, and lets the person fix the address.
    private func failed(_ webView: WKWebView, _ error: Error) {
        let e = error as NSError
        // Not failures: a load replaced by another, or one this delegate cancelled (sent to Safari, a payment page).
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        // (WebKitErrorDomain 102: interrupted by a policy change; 204: handed to a plug-in.)
        if e.domain == "WebKitErrorDomain" && (e.code == 102 || e.code == 204) { return }
        guard let vc = controller else { return }
        let failing = (e.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? webView.url
        let o = originOf(failing)
        if o.isEmpty || o == vc.localOrigin { return }
        vc.showConnectError("Couldn\u{2019}t reach the server (\(e.localizedDescription)). Check the address and your connection.")
    }

    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        #if HEARTH_CUSTOM_SERVER
        let space = challenge.protectionSpace
        guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = space.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        // A certificate the phone trusts: the normal checks apply, nothing else to decide. (Checked off the main
        // thread: it can look up revocation over the network.)
        let queue = DispatchQueue.global(qos: .userInitiated)
        queue.async {
            SecTrustEvaluateAsyncWithError(trust, queue) { _, ok, _ in
                DispatchQueue.main.async { [weak self] in
                    if ok { completionHandler(.performDefaultHandling, nil); return }
                    guard let self = self else { completionHandler(.cancelAuthenticationChallenge, nil); return }
                    self.trustSelfSigned(space, trust, completionHandler)
                }
            }
        }
        #else
        // The App Store build only talks to a server with a publicly trusted certificate: WebKit's own checks
        // already refuse anything else (and answer any other challenge as usual).
        completionHandler(.performDefaultHandling, nil)
        #endif
    }

    #if HEARTH_CUSTOM_SERVER
    // A self-hosted server without a trusted certificate (builds for any server only): asks once, shows the
    // fingerprint, remembers that exact certificate, and warns loudly when a remembered one changes.
    private func trustSelfSigned(_ space: URLProtectionSpace, _ trust: SecTrust, _ done: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard let vc = controller else { done(.cancelAuthenticationChallenge, nil); return }
        let host = BridgePolicy.origin(protocol: space.`protocol` ?? "https", host: space.host, port: space.port)
        guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first else {
            done(.cancelAuthenticationChallenge, nil)
            return
        }
        let der = SecCertificateCopyData(leaf) as Data
        let key = "cert:" + host
        let trusted = HearthViewController.group.string(forKey: key)
        if CertPin.matches(der: der, pinned: trusted) { done(.useCredential, URLCredential(trust: trust)); return }
        if host != vc.serverOrigin { done(.cancelAuthenticationChallenge, nil); return }
        let fp = CertPin.fingerprint(der: der)
        pendingTrust.append(done)
        if trustAlertShowing { return }
        trustAlertShowing = true
        let changed = !(trusted ?? "").isEmpty
        let message = (changed
            ? "The security certificate for \(host) has CHANGED. This can mean someone is intercepting your connection.\n\n"
            : "\(host) uses a certificate that isn\u{2019}t signed by a trusted authority. That\u{2019}s normal for a self-hosted server without a domain.\n\n")
            + "Only continue if the server owner confirms this fingerprint:\n\n" + fp
        let alert = UIAlertController(title: changed ? "Certificate changed" : "Unverified certificate", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self, weak vc] _ in
            self?.finishTrust(.cancelAuthenticationChallenge, nil)
            vc?.showConnectError("The server\u{2019}s certificate wasn\u{2019}t trusted.")
        })
        alert.addAction(UIAlertAction(title: "Trust this certificate", style: changed ? .destructive : .default) { [weak self] _ in
            HearthViewController.group.set(fp, forKey: key)
            self?.finishTrust(.useCredential, URLCredential(trust: trust))
        })
        guard let top = vc.topController() else { finishTrust(.cancelAuthenticationChallenge, nil); return }
        top.present(alert, animated: true)
    }

    private func finishTrust(_ disposition: URLSession.AuthChallengeDisposition, _ credential: URLCredential?) {
        trustAlertShowing = false
        let waiting = pendingTrust
        pendingTrust = []
        for done in waiting { done(disposition, credential) }
    }
    #endif
}
