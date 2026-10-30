import UIKit
import WebKit
import HearthKit

/// Messages from the page (window.HearthIOS.postMessage, public/js/ios.js and the connect screen's tellApp), the
/// iPhone side of MainActivity.onMessage. Each one is JSON text with a type; the answer comes back as JSON text
/// through the promise postMessage returned (or null when there's nothing to say), and later news as CustomEvents
/// (HearthViewController.toPage). Only the main frame counts, and who sent it decides what it may do (BridgePolicy):
/// only the connect screen may change the saved server; only the server's page may manage push and calls.
@MainActor
final class HearthBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var controller: HearthViewController?

    // A saveChunk is 384 KB as base64 (512 KB) plus its id: nothing the page sends is near this.
    private static let maxMessage = 1 << 20

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let vc = controller, let m = HearthBridge.parse(message.body),
              let type = m["type"] as? String else {
            replyHandler(nil, "refused")
            return
        }
        let from = originOf(message.frameInfo.securityOrigin)
        guard BridgePolicy.allowed(type: type, origin: from, localOrigin: vc.localOrigin, serverOrigin: vc.serverOrigin) else {
            replyHandler(nil, "refused")
            return
        }
        let answer: @MainActor (Any) -> Void = { replyHandler(jsonText($0), nil) }
        switch type {
        case "hello":
            // Only the server's own page gets push state, a tapped notification's address, an invite or a share.
            let server = from == vc.serverOrigin
            vc.pageReady = server
            vc.pageApi = max(1, HearthBridge.int(m["v"]) ?? 1)
            info(server: server, api: vc.pageApi) { o in
                answer(o)
                if server { LinkRouter.shared.pageSaidHello() }
            }
        case "setServer":
            let o = originOf(URL(string: m["origin"] as? String ?? ""))
            vc.setServerOrigin(o)
            answer(["type": "serverSet"])
        case "pushState":
            HearthPushNative.shared.state { answer($0) }
        case "pushRegister":
            HearthPushNative.shared.register(origin: vc.serverOrigin) { answer($0) }
        case "pushUnregister":
            HearthPushNative.shared.unregister(origin: vc.serverOrigin) { answer($0) }
        case "callStart":
            CallAudio.shared.start()
            replyHandler(nil, nil)
        case "callEnd":
            CallAudio.shared.stop()
            replyHandler(nil, nil)
        case "changeServer":
            // An app built for one server has nowhere else to go.
            if HearthViewController.lockedServer == nil { vc.showConnect("?change=1") }
            replyHandler(nil, nil)
        case "notify":
            HearthNotificationsNative.shared.notify(title: m["title"] as? String ?? "", body: m["body"] as? String ?? "", tag: m["tag"] as? String ?? "")
            replyHandler(nil, nil)
        case "cancel":
            HearthNotificationsNative.shared.cancel(tag: m["tag"] as? String ?? "")
            replyHandler(nil, nil)
        case "askNotify":
            HearthNotificationsNative.shared.askNotify()
            replyHandler(nil, nil)
        case "saveStart":
            SaveFiles.shared.start(id: m["id"] as? String ?? "", name: m["name"] as? String ?? "", mime: m["mime"] as? String ?? "")
            replyHandler(nil, nil)
        case "saveChunk":
            SaveFiles.shared.chunk(id: m["id"] as? String ?? "", data: m["data"] as? String ?? "")
            replyHandler(nil, nil)
        case "saveEnd":
            SaveFiles.shared.end(id: m["id"] as? String ?? "")
            replyHandler(nil, nil)
        default:
            replyHandler(nil, nil)
        }
    }

    // The app's answer to hello: { type:'info', version, notify, server, platform:'ios' }, and for the server's own
    // page also push (its push state), call (this app keeps a call's audio going with the screen locked) and, once,
    // where a tapped notification leads (open), an invite code and a shared link (only for a page that takes it).
    private func info(server: Bool, api: Int, _ done: @escaping @MainActor ([String: Any]) -> Void) {
        HearthNotificationsNative.shared.permission { notify in
            var o: [String: Any] = [
                "type": "info",
                "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                "notify": notify,
                "server": HearthViewController.serverOrigin,
                "platform": "ios",
            ]
            guard server else { done(o); return }
            HearthPushNative.shared.state { push in
                o["push"] = push
                o["call"] = true
                for (k, v) in LinkRouter.shared.takeForHello(api: api) { o[k] = v }
                done(o)
            }
        }
    }

    private static func parse(_ body: Any) -> [String: Any]? {
        if let o = body as? [String: Any] { return o }
        guard let s = body as? String, s.utf8.count <= maxMessage, let data = s.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private static func int(_ v: Any?) -> Int? {
        if let n = v as? NSNumber { return n.intValue }
        if let s = v as? String { return Int(s) }
        return nil
    }
}
