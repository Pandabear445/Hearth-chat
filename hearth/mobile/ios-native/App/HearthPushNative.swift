import UIKit
import UserNotifications
import Capacitor
import HearthKit

/// Notifications while Hearth is closed, through Apple's push service (APNs): the iPhone side of HearthPush.java.
/// Apple gives the phone a device token; the app makes this server's own encryption keys (a P-256 key and a 16-byte
/// auth secret, DeviceKeys, in the Keychain shared with the notification extension, never backed up); the server's
/// page subscribes the token and the public keys with the server (ios-push.js, POST /api/push/subscribe, type
/// 'apns'). The server then sends Apple only "New activity", with the real notification encrypted to those keys, and
/// NotificationService decrypts it on the phone. Native code never talks to the server and never sees the sign-in
/// token.
///
/// What the page sees (pushState answers and hearth-push events):
///   { type:'pushState', state, reason, token?, environment?, keys?: { p256dh, auth }, previous? }
/// with state none | pending | registered | blocked | failed, token in hex, and previous the token this one replaced
/// (the page sends it as `replaces`, so the server keeps one row per phone). State lives in the app's defaults:
///   push.instance (PushPolicy.instanceFor(server)), push.state, push.reason, push.token, push.previous
///
/// AppDelegate hands on Apple's answers as Capacitor's notifications (.capacitorDidRegisterForRemoteNotifications
/// with the token Data, .capacitorDidFailToRegisterForRemoteNotifications with the Error).
@MainActor
final class HearthPushNative: NSObject {
    static let shared = HearthPushNative()

    private let prefs = UserDefaults.standard
    private var lastAnnounced = ""

    // Debug builds run from Xcode get tokens for Apple's sandbox; TestFlight and the App Store, production ones.
    #if DEBUG
    static let environment = "sandbox"
    #else
    static let environment = "production"
    #endif

    /// At launch (AppDelegate): listens for Apple's answers, and asks for this launch's token if push is on, since
    /// Apple can change it (after a restore, a reinstall); a new one reaches the page as hearth-push with previous.
    func start() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(didRegister(_:)), name: .capacitorDidRegisterForRemoteNotifications, object: nil)
        nc.addObserver(self, selector: #selector(didFail(_:)), name: .capacitorDidFailToRegisterForRemoteNotifications, object: nil)
        guard prefs.string(forKey: "push.state") == "registered" else { return }
        HearthNotificationsNative.shared.permission { state in
            if state == "granted" { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    private var currentInstance: String { PushPolicy.instanceFor(HearthViewController.serverOrigin) }

    /// The push state for the current server, keys included (only the server's own page asks; BridgePolicy).
    func state(_ done: @escaping @MainActor ([String: Any]) -> Void) {
        HearthNotificationsNative.shared.permission { [weak self] notify in
            guard let self = self else { return }
            done(self.snapshot(notify: notify))
        }
    }

    private func snapshot(notify: String) -> [String: Any] {
        var st = prefs.string(forKey: "push.state") ?? "none"
        var reason = prefs.string(forKey: "push.reason") ?? ""
        let instance = currentInstance
        let mine = !instance.isEmpty && instance == prefs.string(forKey: "push.instance")
        if (st == "registered" || st == "pending") && !mine { st = "none"; reason = "" }
        // Turned off in Settings since: blocked until turned on again.
        if st == "registered" && notify == "denied" { st = "blocked"; reason = "" }
        var o: [String: Any] = ["type": "pushState", "state": st, "reason": reason]
        guard st == "registered" else { return o }
        let token = prefs.string(forKey: "push.token") ?? ""
        guard !token.isEmpty, let keys = DeviceKeys.load(instance: instance) else {
            o["state"] = "failed"
            o["reason"] = "NO_KEYS"
            return o
        }
        o["token"] = token
        o["environment"] = HearthPushNative.environment
        o["keys"] = ["p256dh": keys.p256dhBase64URL, "auth": keys.authBase64URL]
        if let previous = prefs.string(forKey: "push.previous"), !previous.isEmpty, previous != token { o["previous"] = previous }
        return o
    }

    private func set(_ state: String, _ reason: String = "") {
        prefs.set(state, forKey: "push.state")
        prefs.set(reason, forKey: "push.reason")
    }

    /// Asks iOS for permission (once; Settings decides after that), makes this server's keys, and asks Apple for a
    /// token. The answer now is "pending" (or why not); the token comes later, as hearth-push.
    func register(origin: String, _ done: @escaping @MainActor ([String: Any]) -> Void) {
        let instance = PushPolicy.instanceFor(origin)
        guard !instance.isEmpty else {
            set("failed", "INTERNAL_ERROR")
            state(done)
            return
        }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            DispatchQueue.main.async { HearthPushNative.shared.authorized(granted, instance: instance, done) }
        }
    }

    private func authorized(_ granted: Bool, instance: String, _ done: @escaping @MainActor ([String: Any]) -> Void) {
        guard instance == currentInstance else { state(done); return } // the server changed meanwhile
        prefs.set(instance, forKey: "push.instance")
        guard granted else {
            set("blocked")
            state(done)
            return
        }
        do {
            _ = try DeviceKeys.ensure(instance: instance)
        } catch {
            set("failed", "NO_KEYS")
            state(done)
            return
        }
        // A token Apple already gave this launch is still good: no need to wait for another.
        set("pending")
        state(done)
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Removes this phone's registration for the current server: its keys go, so nothing sent to the old
    /// subscription can be read here again. (The token stays: it belongs to the phone, not the server.)
    func unregister(origin: String, _ done: @escaping @MainActor ([String: Any]) -> Void) {
        forget(origin: origin)
        state(done)
    }

    /// Leaving a server (HearthViewController.setServerOrigin) or turning push off there.
    func forget(origin: String) {
        let instance = PushPolicy.instanceFor(origin)
        if !instance.isEmpty { DeviceKeys.delete(instance: instance) }
        if instance.isEmpty || instance == prefs.string(forKey: "push.instance") {
            set("none")
            prefs.removeObject(forKey: "push.instance")
            prefs.removeObject(forKey: "push.previous")
        }
    }

    @objc private func didRegister(_ n: Notification) {
        guard let data = n.object as? Data, !data.isEmpty else { return }
        let token = data.map { String(format: "%02x", $0) }.joined()
        let old = prefs.string(forKey: "push.token") ?? ""
        if !old.isEmpty && old != token { prefs.set(old, forKey: "push.previous") }
        prefs.set(token, forKey: "push.token")
        let st = prefs.string(forKey: "push.state")
        // Only a registration waiting for it (or one already on, whose token changed) cares.
        guard st == "pending" || (st == "registered" && old != token) else { return }
        set("registered")
        announce()
    }

    @objc private func didFail(_ n: Notification) {
        guard prefs.string(forKey: "push.state") == "pending" else { return }
        set("failed", "NETWORK")
        announce()
    }

    private func announce() {
        state { [weak self] st in
            self?.lastAnnounced = st["state"] as? String ?? ""
            HearthViewController.current?.toServerPage("hearth-push", jsonText(st))
        }
    }

    /// Hearth on screen again: tells the page if notifications were turned off (or back on) in Settings meanwhile.
    func sceneDidBecomeActive() {
        state { [weak self] st in
            guard let self = self else { return }
            let now = st["state"] as? String ?? ""
            if !self.lastAnnounced.isEmpty && now != self.lastAnnounced {
                HearthViewController.current?.toServerPage("hearth-push", jsonText(st))
            }
            self.lastAnnounced = now
        }
    }
}
