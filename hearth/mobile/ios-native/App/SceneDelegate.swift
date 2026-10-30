import UIKit
import Capacitor

/// Replaces the SceneDelegate.swift `npx cap add ios` generates (scripts/patch-ios.rb copies this over it): the
/// window shows HearthViewController instead of CAPBridgeViewController, invite links go to LinkRouter (Capacitor's
/// SceneDelegateProxy still gets them, for its plugins), and coming on screen stops a ringing call's notification
/// and picks up a link shared from another app.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = HearthViewController()
        window?.makeKeyAndVisible()

        // Opened by a link: it waits in LinkRouter until the server's page says hello.
        for context in connectionOptions.urlContexts { LinkRouter.shared.handle(context.url) }
        for activity in connectionOptions.userActivities where activity.activityType == NSUserActivityTypeBrowsingWeb {
            LinkRouter.shared.handle(activity.webpageURL)
        }
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { LinkRouter.shared.handle(context.url) }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if userActivity.activityType == NSUserActivityTypeBrowsingWeb { LinkRouter.shared.handle(userActivity.webpageURL) }
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        HearthNotificationsNative.shared.sceneDidBecomeActive()
        LinkRouter.shared.sceneDidBecomeActive()
    }
}
