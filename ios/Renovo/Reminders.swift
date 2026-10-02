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
}
