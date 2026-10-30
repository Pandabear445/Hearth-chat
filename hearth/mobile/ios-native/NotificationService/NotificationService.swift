import UserNotifications
import HearthKit

/// Hearth's notification extension: turns the notice Apple delivers into the real notification, on the phone.
///
/// The server never tells Apple who wrote or where: the alert it sends always says only the app's name and
/// something like "New message". The real notification (the same JSON the Android app and browsers get, already
/// reduced to that by the server when previews are hidden) comes along as `enc`, encrypted (RFC 8291 aes128gcm) to
/// keys this phone made for this server (DeviceKeys, in the Keychain shared with the app). This decrypts it and shows
/// what it says, by the same rules as the Android app (PushPayload.display): a ring that's too old becomes "Missed
/// call" without a sound; a fresh one keeps the ring. If anything about it is wrong (not for this server's keys,
/// tampered, unreadable) or time runs out, the notice is shown as Apple delivered it, which is already private.
///
/// The App Group's defaults hold the app's current server ("server"); the keys are looked up by its instance name.
/// Info.plist: NSExtensionPrincipalClass "NotificationService" (the @objc name below).
@objc(NotificationService)
final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var original: UNNotificationContent?

    // The longest `enc` worth reading: a 4096-byte payload, its 256-byte padding and the header, as base64.
    private static let maxEnc = 8192

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        original = request.content
        deliver(NotificationService.shaped(request.content) ?? request.content)
    }

    override func serviceExtensionTimeWillExpire() {
        if let o = original { deliver(o) }
    }

    // Exactly once.
    private func deliver(_ content: UNNotificationContent) {
        guard let done = contentHandler else { return }
        contentHandler = nil
        done(content)
    }

    static func shaped(_ content: UNNotificationContent) -> UNNotificationContent? {
        let info = content.userInfo
        guard let enc = info["enc"] as? String, !enc.isEmpty, enc.utf8.count <= maxEnc else { return nil }
        let server = UserDefaults(suiteName: DeviceKeys.appGroup)?.string(forKey: "server") ?? ""
        let instance = PushPolicy.instanceFor(server)
        guard !instance.isEmpty, let keys = DeviceKeys.load(instance: instance),
              let plain = try? WebPushDecrypt.decrypt(base64: enc, keys: keys),
              let push = PushPayload.parse(plain) else { return nil }
        // The tag Apple saw (and grouped by) must be the one inside.
        if let tag = info["tag"] as? String, tag != push.tag { return nil }
        let shown = push.display(now: PushPolicy.nowMs())
        guard let c = content.mutableCopy() as? UNMutableNotificationContent else { return nil }
        if !shown.title.isEmpty { c.title = shown.title }
        c.body = shown.body
        c.threadIdentifier = shown.tag
        var extra = c.userInfo
        extra["url"] = shown.url
        extra["tag"] = shown.tag
        extra.removeValue(forKey: "enc")
        c.userInfo = extra
        if shown.missedCall {
            c.sound = nil
            c.interruptionLevel = .active
        } else if shown.ring {
            c.sound = UNNotificationSound(named: UNNotificationSoundName("ring.wav"))
            c.interruptionLevel = .timeSensitive
        }
        return c
    }
}
