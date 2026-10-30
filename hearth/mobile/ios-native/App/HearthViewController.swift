import UIKit
import WebKit
import Capacitor
import HearthKit

/// Hearth for iPhone: a web view showing your Hearth server, plus the few things a web view can't do alone (the
/// iPhone counterpart of mobile/native/MainActivity.java):
///  - notifications while the app is open (HearthNotificationsNative) and while it's closed, through Apple's push
///    service with the real text decrypted on the phone (HearthPushNative, NotificationService)
///  - keeping a call's audio going with the screen locked (CallAudio), saving files through the share sheet (SaveFiles)
///  - invite links, hearth://invite/... and https://<server>/invite/..., and links shared from TikTok or Instagram
///    (LinkRouter, ShareViewController)
///  - links to other sites open in Safari; only your server (and the connect screen) load in the app (HearthNavigation)
/// The page talks to this code through window.HearthIOS (HearthBridge), which answers only the server's own pages and
/// the connect screen; BridgePolicy decides which of them may send what, as on Android.
///
/// The saved server lives in the App Group's defaults ("server"), so the notification extension can find this
/// server's push keys; SceneDelegate makes this the window's root.
final class HearthViewController: CAPBridgeViewController {
    /// The one running controller (the push, notification and link code outlives it, so it's looked up, not kept).
    static weak var current: HearthViewController?

    static let group = UserDefaults(suiteName: DeviceKeys.appGroup) ?? .standard
    private static let serverKey = "server"

    /// Whether the server's page said hello since it last loaded, and what its ios.js understands (1 = before
    /// in-place opens, 2 = notification taps and invites in place, 3 = shared links too).
    var pageReady = false
    var pageApi = 1

    // Made in capacitorDidLoad; WebKit holds its delegates weakly, so they're kept here.
    private var navigation: HearthNavigation?
    private var ui: HearthUI?
    private var messages: HearthBridge?

    // The page's side of the bridge, before any of its own scripts run. Native code answers through the promise
    // postMessage returns (WKScriptMessageHandlerWithReply) and sends events as CustomEvents (toPage).
    static let pageScript = "window.HearthIOS={postMessage:m=>webkit.messageHandlers.hearthIOS.postMessageWithReply?.(m)??webkit.messageHandlers.hearthIOS.postMessage(m),onmessage:null};"

    // ------------------------------------------------------------------ setting up the web view
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let c = super.webViewConfiguration(for: instanceConfiguration)
        // Calls and voice messages play without a tap first, inline rather than in the full-screen player.
        c.mediaTypesRequiringUserActionForPlayback = []
        c.allowsInlineMediaPlayback = true
        return c
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        HearthViewController.current = self
        guard let web = webView else { return }
        // Capacitor puts its own content controller on the configuration after webViewConfiguration(for:) returns,
        // so the bridge goes on that one here (before the first page loads, in viewDidLoad).
        let content = web.configuration.userContentController
        content.addUserScript(WKUserScript(source: HearthViewController.pageScript, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        let bridgeHandler = HearthBridge()
        bridgeHandler.controller = self
        messages = bridgeHandler
        content.addScriptMessageHandler(bridgeHandler, contentWorld: .page, name: "hearthIOS")
        // Capacitor's own bridge (its built-in plugins: HTTP without CORS, cookies, the web view's base path) answers
        // any frame on any page. Hearth's pages don't use it, so only the connect screen's main frame reaches it.
        let capacitor = web.navigationDelegate as? WebViewDelegationHandler
        content.removeScriptMessageHandler(forName: "bridge")
        let gate = CapacitorGate()
        gate.controller = self
        gate.capacitor = capacitor
        content.add(gate, name: "bridge")

        // Capacitor would open a server chosen at run time in Safari: Hearth decides which pages load, and hands
        // everything else (its loading state, the JS bridge reset) on to Capacitor's own delegate.
        let nav = HearthNavigation(controller: self, capacitor: capacitor)
        navigation = nav
        web.navigationDelegate = nav
        let windows = HearthUI()
        windows.controller = self
        windows.capacitor = capacitor
        ui = windows
        web.uiDelegate = windows
        // No back button on iPhone: the edge swipe goes back a page instead.
        web.allowsBackForwardNavigationGestures = true
        #if DEBUG
        web.isInspectable = true
        #endif
        // Hearth's dark background, so the first load doesn't flash white.
        let dark = UIColor(red: 0x10 / 255.0, green: 0x0E / 255.0, blue: 0x16 / 255.0, alpha: 1)
        web.backgroundColor = dark
        web.scrollView.backgroundColor = dark
        HearthViewController.keepWebDataOffBackups()
        SaveFiles.shared.cleanLeftovers()
    }

    // The web view's data (the sign-in, the encryption keys the page keeps) stays on this phone: never in an iCloud
    // or computer backup, never moved to a new phone. (The push keys are this-device-only Keychain items.)
    private static func keepWebDataOffBackups() {
        guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        var dir = library.appendingPathComponent("WebKit", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
    }

    // ------------------------------------------------------------------ which pages may load in the app
    static var serverOrigin: String { group.string(forKey: serverKey) ?? "" }
    var serverOrigin: String { HearthViewController.serverOrigin }

    var localOrigin: String {
        let o = originOf(bridge?.config.localURL)
        return o.isEmpty ? BridgePolicy.localOrigin : o
    }

    /// An app built for one server (www/config.json lockServer, set in CI from HEARTH_SERVER) only ever uses that one.
    static let lockedServer: String? = {
        guard let url = Bundle.main.url(forResource: "config", withExtension: "json", subdirectory: "public"),
              let data = try? Data(contentsOf: url),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              (o["lockServer"] as? Bool) == true,
              let s = o["defaultServer"] as? String else { return nil }
        let origin = originOf(URL(string: s))
        return origin.isEmpty ? nil : origin
    }()

    /// The one place the saved server changes. Leaving a server removes this phone's push keys for it (the old
    /// server would otherwise keep a working address for this phone), and ends a call there.
    @discardableResult
    func setServerOrigin(_ o: String) -> Bool {
        guard o.hasPrefix("https://") || o.hasPrefix("http://") else { return false }
        if let locked = HearthViewController.lockedServer, o != locked { return false }
        let old = serverOrigin
        if o != old {
            HearthPushNative.shared.forget(origin: old)
            CallAudio.shared.stop()
        }
        HearthViewController.group.set(o, forKey: HearthViewController.serverKey)
        return true
    }

    func isOurs(_ url: URL?) -> Bool {
        let o = originOf(url)
        return !o.isEmpty && (o == localOrigin || o == serverOrigin)
    }

    /// Whether the server's own page is what's showing (not the connect screen, not an error).
    var showingServerPage: Bool {
        let o = originOf(webView?.url)
        return !o.isEmpty && o == serverOrigin
    }

    func showConnect(_ query: String) {
        guard let local = bridge?.config.localURL, let url = URL(string: local.absoluteString + "/" + query) else { return }
        webView?.load(URLRequest(url: url))
    }

    func showConnectError(_ text: String) {
        let q = text.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        showConnect("?error=" + q)
    }

    func load(_ url: URL) {
        webView?.load(URLRequest(url: url))
    }

    /// A link that leaves Hearth: Safari (or the app for mail and phone links). Never a payment page.
    func openOutside(_ url: URL) {
        if BridgePolicy.isPaymentPage(url) { notice("Payments aren\u{2019}t available in the iPhone app."); return }
        guard let scheme = url.scheme?.lowercased(), ["https", "http", "mailto", "tel"].contains(scheme) else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    // ------------------------------------------------------------------ to the page
    func toPage(_ event: String, _ detailJson: String) {
        guard let web = webView, isOurs(web.url) else { return }
        web.evaluateJavaScript(HearthViewController.eventScript(event, detailJson), completionHandler: nil)
    }

    /// Only to the server's own page (not the connect screen): push keys, call controls and links belong to it.
    func toServerPage(_ event: String, _ detailJson: String) {
        guard let web = webView, showingServerPage else { return }
        web.evaluateJavaScript(HearthViewController.eventScript(event, detailJson), completionHandler: nil)
    }

    private static func eventScript(_ event: String, _ detailJson: String) -> String {
        "window.dispatchEvent(new CustomEvent(\(jsonText(event)),{detail:\(detailJson)}))"
    }

    // ------------------------------------------------------------------ short notices (Android's toasts)
    func notice(_ text: String) {
        let alert = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        topController()?.present(alert, animated: true)
    }

    /// Where a sheet or an alert goes: on top of whatever is already shown (nil while one is being dismissed).
    func topController() -> UIViewController? {
        var top: UIViewController = self
        while let p = top.presentedViewController {
            if p.isBeingDismissed { return nil }
            top = p
        }
        return top
    }
}

/// Capacitor's "bridge" message handler, passed on only from the connect screen's main frame (see capacitorDidLoad).
/// The content controller keeps this; it keeps Capacitor's handler weakly, as Capacitor's own registration would loop.
@MainActor
final class CapacitorGate: NSObject, WKScriptMessageHandler {
    weak var controller: HearthViewController?
    weak var capacitor: WebViewDelegationHandler?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let vc = controller, let capacitor = capacitor,
              originOf(message.frameInfo.securityOrigin) == vc.localOrigin else { return }
        capacitor.userContentController(userContentController, didReceive: message)
    }
}

/// "scheme://host[:port]" as WebKit's security origins give it, or "" for addresses without a host (blob:, data:).
func originOf(_ url: URL?) -> String {
    guard let url = url, let scheme = url.scheme, let host = url.host(percentEncoded: false), !host.isEmpty else { return "" }
    return BridgePolicy.origin(protocol: scheme, host: host, port: url.port ?? 0)
}

@MainActor
func originOf(_ o: WKSecurityOrigin) -> String {
    BridgePolicy.origin(protocol: o.`protocol`, host: o.host, port: o.port)
}

/// A value as JSON text (a string comes out quoted), for replies and event details.
func jsonText(_ value: Any) -> String {
    guard JSONSerialization.isValidJSONObject([value]),
          let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
          let s = String(data: data, encoding: .utf8) else { return "null" }
    return s
}
