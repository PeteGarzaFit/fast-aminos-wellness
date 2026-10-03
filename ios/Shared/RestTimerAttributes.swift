import ActivityKit
import Foundation

/// The rest timer shown on the Lock Screen and in the Dynamic Island.
/// Compiled into both the app and the widget extension.
struct RestTimerAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var endDate: Date
        var next: String
    }
}
