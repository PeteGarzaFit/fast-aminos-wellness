import ActivityKit
import Foundation
import UserNotifications

/// Rest timer outside the app: a Live Activity on the Lock Screen / Dynamic Island,
/// plus a notification when rest ends (which also taps the client's Apple Watch).
enum LiveRest {
    static func start(seconds: Int, next: String) {
        let endDate = Date().addingTimeInterval(TimeInterval(max(1, seconds)))
        scheduleEndAlert(at: endDate, next: next)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let state = RestTimerAttributes.ContentState(endDate: endDate, next: next)
        let content = ActivityContent(state: state, staleDate: endDate.addingTimeInterval(30))
        Task {
            if let current = Activity<RestTimerAttributes>.activities.first {
                await current.update(content)
            } else {
                _ = try? Activity.request(attributes: RestTimerAttributes(), content: content, pushType: nil)
            }
        }
    }

    static func stop() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["rest-end"])
        Task {
            for activity in Activity<RestTimerAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    /// Clears a finished timer left on the Lock Screen.
    static func endFinished() {
        Task {
            for activity in Activity<RestTimerAttributes>.activities where activity.content.state.endDate < Date() {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    private static func scheduleEndAlert(at date: Date, next: String) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ["rest-end"])
        let content = UNMutableNotificationContent()
        content.title = "Rest's over 💪"
        content.body = next
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, date.timeIntervalSinceNow), repeats: false)
        center.add(UNNotificationRequest(identifier: "rest-end", content: content, trigger: trigger))
    }
}
