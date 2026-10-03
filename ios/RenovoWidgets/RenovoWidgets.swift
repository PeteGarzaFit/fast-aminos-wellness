import ActivityKit
import SwiftUI
import WidgetKit

@main
struct RenovoWidgets: WidgetBundle {
    var body: some Widget {
        RestTimerLiveActivity()
    }
}

extension Color {
    static let renovoBlue = Color(red: 0.086, green: 0.514, blue: 1.0)     // #1683ff
    static let renovoNavy = Color(red: 0.02, green: 0.043, blue: 0.071)    // #050b12
}

/// Counts down to `end` on its own, even while RENOVO is closed.
private func countdown(_ end: Date) -> Text {
    Text(timerInterval: Date()...max(end, Date()), countsDown: true)
}

struct RestTimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestTimerAttributes.self) { context in
            RestLockScreenView(state: context.state)
                .activityBackgroundTint(Color.renovoNavy)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Rest", systemImage: "timer")
                        .font(.headline)
                        .foregroundStyle(Color.renovoBlue)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    countdown(context.state.endDate)
                        .font(.system(size: 30, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 110)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.next)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: "timer").foregroundStyle(Color.renovoBlue)
            } compactTrailing: {
                countdown(context.state.endDate)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 46)
            } minimal: {
                Image(systemName: "timer").foregroundStyle(Color.renovoBlue)
            }
            .keylineTint(Color.renovoBlue)
        }
    }
}

struct RestLockScreenView: View {
    let state: RestTimerAttributes.ContentState

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("RENOVO · REST")
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(Color.renovoBlue)
                Text(state.next)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            countdown(state.endDate)
                .font(.system(size: 44, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
                .foregroundStyle(.white)
                .frame(maxWidth: 140)
        }
        .padding(16)
    }
}
