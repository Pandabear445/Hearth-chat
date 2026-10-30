import AVFoundation

/// Keeps a call's audio going with the screen locked or Hearth in the background, between the page's callStart and
/// callEnd (CallService.java's job on Android). iOS keeps an app running while it holds an active voice-chat audio
/// session (UIBackgroundModes audio); the call itself stays in the web view. Whether WebKit keeps the microphone
/// running once the screen locks is up to iOS: see docs/IOS-STORE.md. When iOS takes the audio away for good (a
/// phone call, say), the page is told to hang up (hearth-hangup), as Android's Hang up button does.
@MainActor
final class CallAudio: NSObject {
    static let shared = CallAudio()

    private var active = false
    private var observing = false

    func start() {
        let session = AVAudioSession.sharedInstance()
        if !observing {
            observing = true
            NotificationCenter.default.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: session)
        }
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .defaultToSpeaker])
            try session.setActive(true)
            active = true
        } catch {
            active = false
        }
    }

    /// callEnd, a new page loading, or leaving the server: the session goes, and other apps' audio may resume.
    func stop() {
        guard active else { return }
        active = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    @objc private func interrupted(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw), type == .began else { return }
        // Only during a call (the session is Hearth's then, and the app isn't suspended).
        DispatchQueue.main.async {
            guard CallAudio.shared.active else { return }
            CallAudio.shared.active = false
            HearthViewController.current?.toServerPage("hearth-hangup", "true")
        }
    }
}
