import AVFoundation
import SwiftUI
import UIKit

/// RENOVO: the client tracker (plans, workout logging, check-ins) in a native shell,
/// plus Apple Health sync and a weekly check-in reminder.
@main
struct RenovoApp: App {
    @StateObject private var model = AppModel()

    init() {
        // Let the rest-timer beeps play even with the ringer on silent, mixed over the client's music.
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
                    Task { @MainActor in model.appBecameActive() }
                }
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ZStack {
            Color("LaunchBackground").ignoresSafeArea()   // matches the dark RENOVO header
            TrackerWebView(model: model)
                .ignoresSafeArea(.container, edges: .bottom)
            if model.isLoading && !model.hasLoadedOnce {
                ProgressView()
                    .controlSize(.large)
                    .tint(Color("AccentColor"))
            }
            if let message = model.loadError {
                OfflineView(message: message) { model.reload() }
            }
        }
    }
}

struct OfflineView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("RENOVO")
                .font(.system(size: 28, weight: .black))
                .tracking(-1)
            Text(message)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 32)
            Button("Try again", action: retry)
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white)
    }
}
