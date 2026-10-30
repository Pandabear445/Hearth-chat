import UIKit
import UserNotifications
import HearthKit

/// Notifications the open page posts (its window.Notification, ios.js), and what happens when any notification is
/// shown or tapped. The page's own are keyed by their tag, so a newer one for the same conversation replaces the
/// last and "cancel" removes it. Notifications from the server while Hearth is closed come through Apple's push
/// service and the notification extension (NotificationService); tapping one opens the place it's about.
/// AppDelegate makes this the notification center's delegate at launch, before any tap can arrive.
@MainActor
final class HearthNotificationsNative: NSObject, UNUserNotificationCenterDelegate {
    static let shared = HearthNotificationsNative()

    // What the page was last told about permission (hearth-notify-permission), to tell it again when it changes.
    private var announced: String?

    /// Notification permission as the web's Notification.permission says it: granted, denied or default.
    func permission(_ done: @escaping @MainActor (String) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let status = settings.authorizationStatus
            DispatchQueue.main.async { done(HearthNotificationsNative.name(status)) }
        }
    }

    nonisolated static func name(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized, .provisional, .ephemeral: return "granted"
        case .denied: return "denied"
        default: return "default"
        }
    }

    // The page's Notification.requestPermission(): iOS asks once; after that the answer is whatever Settings says.
    func askNotify() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            DispatchQueue.main.async { HearthNotificationsNative.shared.announce(force: true) }
        }
    }

    private func announce(force: Bool) {
        permission { [weak self] state in
            guard let self = self, force || self.announced != state else { return }
            let first = self.announced == nil
            self.announced = state
            if force || !first { HearthViewController.current?.toPage("hearth-notify-permission", jsonText(state)) }
        }
    }

    func notify(title: String, body: String, tag: String) {
        guard !tag.isEmpty, tag.count <= 200 else { return }
        permission { state in
            guard state == "granted" else { return }
            let c = UNMutableNotificationContent()
            c.title = String(title.prefix(200))
            c.body = String(body.prefix(2000))
            c.sound = .default
            c.threadIdentifier = tag
            c.userInfo = ["hearthTag": tag]
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: tag, content: c, trigger: nil), withCompletionHandler: nil)
        }
    }

    func cancel(tag: String) {
        guard !tag.isEmpty else { return }
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [tag])
        center.removeDeliveredNotifications(withIdentifiers: [tag])
        // A push from the server shown by the notification extension has an identifier Apple chose; its tag is in
        // userInfo (and is its thread).
        center.getDeliveredNotifications { notes in
            let ids = notes.filter { n in
                let c = n.request.content
                return (c.userInfo["tag"] as? String) == tag || c.threadIdentifier == tag
            }.map { $0.request.identifier }
            if !ids.isEmpty { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids) }
        }
    }

    // ------------------------------------------------------------------ the notification center's delegate
    // With the server's page on screen, its own notices show what came in: a push isn't shown again on top. What the
    // page posts itself is shown (it only posts when it means to), and so is a push while the connect screen shows.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let mine = notification.request.content.userInfo["hearthTag"] != nil
        if !mine && UIApplication.shared.applicationState == .active && HearthViewController.current?.showingServerPage == true {
            completionHandler([])
            return
        }
        completionHandler([.banner, .list, .sound])
    }

    // A tap: one the page posted goes back to it (its onclick); one from the server opens the place it's about, now
    // if the page is ready, else once it says hello (only Hearth's own links, PushPolicy.safeOpenPath).
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        defer { completionHandler() }
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else { return }
        let info = response.notification.request.content.userInfo
        if let tag = info["hearthTag"] as? String {
            HearthViewController.current?.toPage("hearth-notification-click", jsonText(tag))
            return
        }
        LinkRouter.shared.open(info["url"] as? String)
    }

    // ------------------------------------------------------------------ Hearth comes on screen
    // A call rang while Hearth was in the background or closed, and Hearth was opened some other way than its
    // notification (the Home Screen, the app switcher): the ring's notification goes, and the app goes to the call
    // as a tap would (the page shows its own ring card if the call is still on). Missed calls and messages stay.
    func sceneDidBecomeActive() {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { list in
            var ids: [String] = []
            var newest: Date?
            var path: String?
            let now = PushPolicy.nowMs()
            for n in list {
                let c = n.request.content
                let tag = (c.userInfo["tag"] as? String) ?? c.threadIdentifier
                guard let p = PushPolicy.ringingCallPath(tag) else { continue }
                ids.append(n.request.identifier)
                let at = (c.userInfo["at"] as? NSNumber)?.int64Value ?? 0
                if at > 0 && !PushPolicy.freshCall(at: at, now: now) { continue }
                if newest == nil || n.date > newest! { newest = n.date; path = p }
            }
            if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
            let open = path
            DispatchQueue.main.async { if let open = open { LinkRouter.shared.open(open) } }
        }
        // Notifications turned on or off in Settings while Hearth was away: the page's shim and push state follow.
        announce(force: false)
        HearthPushNative.shared.sceneDidBecomeActive()
    }
}
