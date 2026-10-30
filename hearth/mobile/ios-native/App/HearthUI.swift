import UIKit
import WebKit
import AVFoundation
import Capacitor

/// The web view's windows and prompts: camera and microphone for the server's calls only, links that ask for a new
/// window, and the page's alert(), confirm() and prompt() as iPhone alerts.
@MainActor
final class HearthUI: NSObject, WKUIDelegate {
    weak var controller: HearthViewController?
    weak var capacitor: WebViewDelegationHandler?

    // Calls and voice messages on the server's page: iOS asked once already (the system permission), so WebKit
    // doesn't ask again on every call. Before that, WebKit's prompt leads to the system one. Nobody else gets either.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard let vc = controller, !vc.serverOrigin.isEmpty, originOf(origin) == vc.serverOrigin, originOf(frame.securityOrigin) == vc.serverOrigin else {
            decisionHandler(.deny)
            return
        }
        var kinds: [AVMediaType] = []
        switch type {
        case .camera: kinds = [.video]
        case .microphone: kinds = [.audio]
        case .cameraAndMicrophone: kinds = [.audio, .video]
        @unknown default: kinds = [.audio, .video]
        }
        let states = kinds.map { AVCaptureDevice.authorizationStatus(for: $0) }
        if states.allSatisfy({ $0 == .authorized }) { decisionHandler(.grant) }
        else if states.contains(where: { $0 == .denied || $0 == .restricted }) { decisionHandler(.deny) }
        else { decisionHandler(.prompt) }
    }

    // target=_blank: a page of the same site (the server's /terms, say) opens in place; anything else in Safari.
    // No second web view is ever made.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let vc = controller, let url = navigationAction.request.url else { return nil }
        let o = originOf(url)
        if !o.isEmpty && o == originOf(webView.url) && vc.isOurs(url) {
            vc.load(url)
        } else {
            vc.openOutside(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        guard let top = controller?.topController() else { completionHandler(); return }
        top.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        guard let top = controller?.topController() else { completionHandler(false); return }
        top.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        // Capacitor's JS (on every page it's injected into) asks through prompt() whether its cookie and HTTP
        // patches are on (both off, capacitor.config.json): Capacitor answers that without showing anything. Its
        // other prompt() messages (reading and writing cookies) only follow a yes, so they're refused here.
        if let data = prompt.data(using: .utf8), prompt.hasPrefix("{"),
           let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let type = o["type"] as? String, type.hasPrefix("Capacitor") {
            if let capacitor = capacitor, type == "CapacitorCookies.isEnabled" || type == "CapacitorHttp" {
                capacitor.webView(webView, runJavaScriptTextInputPanelWithPrompt: prompt, defaultText: defaultText, initiatedByFrame: frame, completionHandler: completionHandler)
            } else {
                completionHandler(nil)
            }
            return
        }
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in completionHandler(alert?.textFields?.first?.text ?? defaultText) })
        guard let top = controller?.topController() else { completionHandler(nil); return }
        top.present(alert, animated: true)
    }
}
