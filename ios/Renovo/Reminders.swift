import UserNotifications

/// Local reminders. Nothing is sent from a server; the phone schedules these itself.
enum Reminders {
    /// Every Sunday at 9:00 AM: "Check-in day". Asked for right after Apple Health is connected.
    static func requestAndScheduleWeeklyCheckIn() {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = "Check-in day 💪"
            content.body = "Weigh in, tape your measurements and tell your coach how the week went."
            content.sound = .default

            var when = DateComponents()
            when.weekday = 1      // Sunday
            when.hour = 9
            when.minute = 0
            let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: true)
            // Same identifier every time, so this never stacks up duplicates.
            center.add(UNNotificationRequest(identifier: "weekly-checkin", content: content, trigger: trigger))
        }
    }

    /// Workout reminders on training days. `days` come from the client's plan:
    /// [{ weekday: 1–7 (Sunday = 1), title, body }]. Re-sent by the page whenever the plan loads,
    /// so a changed plan replaces the old reminders.
    static func scheduleWorkouts(_ days: [[String: Any]], hour: Int, minute: Int, enabled: Bool) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: (1...7).map { "workout-\($0)" })
        guard enabled, !days.isEmpty else { return }
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            for day in days {
                guard let weekday = (day["weekday"] as? NSNumber)?.intValue, (1...7).contains(weekday) else { continue }
                let content = UNMutableNotificationContent()
                content.title = (day["title"] as? String) ?? "Workout today 💪"
                content.body = (day["body"] as? String) ?? "Open RENOVO to start."
                content.sound = .default
                var when = DateComponents()
                when.weekday = weekday
                when.hour = hour
                when.minute = minute
                let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: true)
                center.add(UNNotificationRequest(identifier: "workout-\(weekday)", content: content, trigger: trigger))
            }
        }
    }
}
