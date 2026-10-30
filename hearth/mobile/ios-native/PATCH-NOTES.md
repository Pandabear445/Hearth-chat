# What scripts/patch-ios.rb has to do for the Swift sources

Notes from the App / NotificationService / ShareExtension sources for the patch script. They were checked against
the project `npx cap add ios` makes with `@capacitor/ios` 8.6 (Swift Package Manager, `ios/App/CapApp-SPM`, an
`AppDelegate.swift` and a `SceneDelegate.swift` in `ios/App/App/`).

## 1. App target: copy, don't edit

- Copy every `ios-native/App/*.swift` into `ios/App/App/`, **overwriting** the generated `AppDelegate.swift` and
  `SceneDelegate.swift`. Those two are full replacements, so the script doesn't need to edit Swift text:
  - `SceneDelegate.swift` already makes `HearthViewController()` the window's root (in place of
    `CAPBridgeViewController()`), and also handles links and `sceneDidBecomeActive`.
  - `AppDelegate.swift` uses `@main` (the generated file has `@UIApplicationMain`). Exactly one entry point must
    remain, so don't keep the generated file next to ours.
- Add the other copied files to the App target's Sources build phase. `AppDelegate.swift` and `SceneDelegate.swift`
  are already in it. The files are: `HearthViewController.swift`, `HearthNavigation.swift`, `HearthUI.swift`,
  `HearthBridge.swift`, `HearthPushNative.swift`, `HearthNotificationsNative.swift`, `CallAudio.swift`,
  `SaveFiles.swift`, `LinkRouter.swift`. Glob `ios-native/App/*.swift`, so a file added later is picked up.
- `Main.storyboard` needs no change. The scene delegate replaces the window it would create, as the generated
  template already does with `CAPBridgeViewController`. Don't set its `customClass` to `HearthViewController`:
  if the storyboard's controller were ever shown, there would be a second Capacitor bridge. (Dropping
  `UISceneStoryboardFile` and `UIMainStoryboardFile` from Info.plist is optional and fine.)
- Suggested `checkPatched` assertions:
  - `ios/App/App/SceneDelegate.swift` contains `HearthViewController()` and not `CAPBridgeViewController()`.
  - `ios/App/App/AppDelegate.swift` contains `didRegisterForRemoteNotificationsWithDeviceToken` and `@main`, and not
    `@UIApplicationMain`.
  - Every `ios-native/App/*.swift` basename is in the App target's sources.

### How the push token gets through
Capacitor's `ApplicationDelegateProxy` does **not** forward Apple's token callbacks. Only
`@capacitor/push-notifications` would, and Hearth doesn't use it. So our `AppDelegate` implements
`application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` and `...didFailToRegister...`, and posts them as
Capacitor's own notifications:
- `.capacitorDidRegisterForRemoteNotifications` with the token `Data` as `object`;
- `.capacitorDidFailToRegisterForRemoteNotifications` with the `Error` as `object`.

`HearthPushNative` observes both. It starts listening in `didFinishLaunching`, where the notification center's
delegate is also set.

### Links
Capacitor 8's template is scene-based, so links arrive in `SceneDelegate`: `openURLContexts` and `continue
userActivity`, or on a cold start through `connectionOptions`. Ours hands each one to `LinkRouter` and still
forwards it to `SceneDelegateProxy.shared`. `AppDelegate` covers `application(_:open:)` and `continue
userActivity` the same way, through `ApplicationDelegateProxy.shared`.

## 2. Extension targets

| | NotificationService | ShareExtension |
|---|---|---|
| Sources | `ios-native/NotificationService/*.swift` | `ios-native/ShareExtension/*.swift` |
| Bundle ID | `app.hearth.mobile.NotificationService` | `app.hearth.mobile.ShareExtension` |
| `NSExtensionPointIdentifier` | `com.apple.usernotifications.service` | `com.apple.share-services` |
| `NSExtensionPrincipalClass` | `NotificationService` | `ShareViewController` |
| Storyboard | none | none (no `NSExtensionMainStoryboard`) |
| Links | HearthKit | HearthKit |

- The principal class names are plain, with no `$(PRODUCT_MODULE_NAME).` prefix. Both classes carry `@objc(Name)`,
  so their Objective-C names don't depend on the module name. A module-qualified name would **not** resolve.
- Share's `NSExtensionAttributes` → `NSExtensionActivationRule` =
  `{NSExtensionActivationSupportsWebURLWithMaxCount: 1, NSExtensionActivationSupportsText: true}`. The code reads
  the first `public.url` attachment, otherwise the first `public.plain-text` one.
- Set `APPLICATION_EXTENSION_API_ONLY = YES` on both extensions. HearthKit uses no app-only API.
- `CFBundleShortVersionString` and `CFBundleVersion` must equal the app's, or App Store validation fails.
- Both are embedded in the App target's "Embed Foundation Extensions" phase (spec 1.1, step 3).
- System frameworks come in through `import` (autolinking): UserNotifications, UIKit and UniformTypeIdentifiers.
  Nothing to add by hand.

## 3. Resources

- `ring.wav` goes into the **App** target's Copy Bundle Resources, at the bundle root, named exactly `ring.wav`. The
  extension sets `UNNotificationSound(named: "ring.wav")` and iOS looks the sound up in the containing app's bundle,
  so the extension needs no copy of its own. (The server's `aps.sound` uses the same name.)
- The app reads `public/config.json` from its bundle (`cap sync` puts it there) to learn `lockServer` and
  `defaultServer`. With `lockServer: true`, the app refuses any other server and ignores `changeServer`.

## 4. Entitlements and build settings the code relies on

- **Keychain:** App and NSE: the first `keychain-access-groups` entry must be
  `$(AppIdentifierPrefix)group.app.hearth.mobile`. `DeviceKeys` is called with `accessGroup: nil`, which means the
  default group, and the default group is that first entry. The Share extension doesn't use the Keychain.
- **App Group** `group.app.hearth.mobile` on all three. The shared defaults suite holds:
  - `server`: the saved origin. Written by the app, read by the NSE.
  - `pendingShare`: the link. Written by the Share extension, read and removed by the app.
  - `cert:<origin>`: only in `HEARTH_CUSTOM_SERVER` builds.

  The app's own push state is kept in `UserDefaults.standard` under the `push.*` keys.
- **App Info.plist:**
  - `UIBackgroundModes = [audio]` (CallAudio).
  - `NSMicrophoneUsageDescription` and `NSCameraUsageDescription`, needed by `HearthUI` for media capture.
  - `CFBundleURLTypes` with the `hearth` scheme (LinkRouter).
  - Associated Domains `applinks:<host>`, for Universal Link invites.
- **`SWIFT_ACTIVE_COMPILATION_CONDITIONS`:**
  - Keep the generated `DEBUG` in the Debug configuration. It selects the APNs `sandbox` environment and
    `isInspectable`. Release has `""`, which means `production`.
  - Add `HEARTH_CUSTOM_SERVER` only when that environment variable is 1. That compiles in the self-signed
    certificate prompt in `HearthNavigation`. Append it, and keep `DEBUG`.
- **Swift:**
  - Use `SWIFT_VERSION = 5`.
  - Don't set `SWIFT_STRICT_CONCURRENCY = complete`, and don't set `SWIFT_DEFAULT_ACTOR_ISOLATION`.
  - The App classes are explicitly `@MainActor`. They hop to the main queue from system callbacks.
- **Deployment target** 16.4 on all three targets. The code uses `isInspectable` (16.4), `SecTrustCopyCertificateChain`
  (15), `interruptionLevel` (15) and `URL.host(percentEncoded:)` (16) without `#available`.

## 5. Things that are not Swift but are needed for it to work

- `capacitor.config.json`:
  - Keep `CapacitorCookies` and `CapacitorHttp` disabled. `HearthUI` answers Capacitor's `prompt()` probes for those
    two through Capacitor, and refuses its other `prompt()` calls.
  - `contentInset: "never"` and `appendUserAgent: "HearthiOS"` are as in spec 1.1.
- The bridge contract, which `public/js/ios.js` and `www/index.html` already follow:
  - Handler name `hearthIOS`, page object `window.HearthIOS`.
  - Every message is JSON text with a `type`.
  - Answers come as the JSON text the `postMessage` promise resolves to (`null` when there's nothing to say). The
    promise rejects with `"refused"` when `BridgePolicy` says no.
  - Events are `CustomEvent`s on `window`: `hearth-push`, `hearth-open`, `hearth-invite`, `hearth-share`,
    `hearth-hangup`, `hearth-notification-click`, `hearth-notify-permission`.
