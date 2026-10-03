import UIKit
import UserNotifications

/// Push notifications (new messages from the coach or a client) and how notifications
/// behave while RENOVO is open.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// Called with the device's push token (hex) once Apple hands it over.
    static var onToken: ((String) -> Void)?
    static private(set) var token: String?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Self.token = hex
        Self.onToken?(hex)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {}

    /// Asks once for permission, then registers with Apple for message notifications.
    static func enablePush() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    /// While the app is open: show new-message banners, but not rest or workout reminders
    /// (the page already beeps and shows those).
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let id = notification.request.identifier
        if id == "rest-end" || id.hasPrefix("workout-") || id == "weekly-checkin" {
            completionHandler([])
        } else {
            completionHandler([.banner, .sound])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        completionHandler()
    }
}
