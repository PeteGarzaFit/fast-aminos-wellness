import SafariServices
import SwiftUI
import UIKit
import WebKit

/// Owns the web view that shows the tracker, and passes messages between the
/// tracker page and Apple Health.
///
/// The page signs the client in and saves the Health data with its own session,
/// so the app never sees passwords or login tokens. The page talks to the app
/// through `window.webkit.messageHandlers.faApp.postMessage(...)`:
///   { type: "ready", role: "client" }  page loaded for a signed-in client
///   { type: "connectHealth" }          client tapped "Connect Apple Health"
///   { type: "syncHealth" }             client tapped "Sync now"
/// and the app answers by calling `window.faAppHealth({ connected, lastSync, rows, error })`.
final class AppModel: NSObject, ObservableObject {
    static let trackerURL = URL(string: "https://fastaminoswellness.com/tracker/")!
    /// Pages on these hosts open inside the app; everything else opens in Safari.
    static let inAppHosts: Set<String> = ["fastaminoswellness.com", "www.fastaminoswellness.com"]

    @Published var isLoading = true
    @Published var hasLoadedOnce = false
    @Published var loadError: String?

    private var webView: WKWebView?
    private let health = HealthSync()
    private var clientReady = false
    private var syncing = false
    private var lastSync: Date?

    // MARK: Web view

    func makeWebView() -> WKWebView {
        if let existing = webView { return existing }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()          // keeps the client signed in between launches
        config.applicationNameForUserAgent = "RenovoApp/1.0"
        config.userContentController.add(WeakScriptHandler(self), name: "faApp")
        // Lock the page at 100% so it feels like an app: no pinch zoom, no zoom when tapping a field.
        let noZoom = """
        (function(){var m=document.querySelector('meta[name=viewport]');if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}
        m.content='width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';})();
        """
        config.userContentController.addUserScript(WKUserScript(source: noZoom, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = true
        view.backgroundColor = .white
        view.isOpaque = false
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
        view.scrollView.refreshControl = refresh
        view.scrollView.minimumZoomScale = 1
        view.scrollView.maximumZoomScale = 1
        view.scrollView.bouncesZoom = false
        #if DEBUG
        if #available(iOS 16.4, *) { view.isInspectable = true }   // Safari > Develop menu while testing
        #endif

        webView = view
        view.load(Self.freshRequest)
        return view
    }

    func reload() {
        loadError = nil
        isLoading = true
        if let view = webView, view.url != nil { view.reloadFromOrigin() } else { webView?.load(Self.freshRequest) }
    }

    /// Always checks the site for a newer version, so updates show up the next time the app opens.
    static var freshRequest: URLRequest { URLRequest(url: trackerURL, cachePolicy: .reloadRevalidatingCacheData) }

    @objc private func pullToRefresh() { webView?.reloadFromOrigin() }

    // MARK: App lifecycle

    @MainActor
    func appBecameActive() {
        // Refresh Health data when the client comes back to the app, at most every 2 minutes.
        guard clientReady, health.isConnected else { return }
        if let last = lastSync, Date().timeIntervalSince(last) < 2 * 60 { return }   // quick refresh after logging food elsewhere
        Task { await syncNow(days: 14) }
    }

    // MARK: Messages from the page

    @MainActor
    private func handle(_ body: [String: Any]) {
        guard let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            clientReady = (body["role"] as? String) == "client"
            guard clientReady else { return }
            if health.isConnected {
                // One-time 90-day backfill for the trend charts, then the last 2 weeks on each open.
                Task {
                    // Version 2 added food (MyFitnessPal etc.), version 3 heart rate variability. Apple only asks about new types.
                    if UserDefaults.standard.integer(forKey: "healthAuthVersion") < 3 {
                        try? await health.requestAuthorization()
                        UserDefaults.standard.set(3, forKey: "healthAuthVersion")
                        UserDefaults.standard.set(false, forKey: "healthBackfill90")   // pull 90 days of the new data too
                    }
                    let backfilled = UserDefaults.standard.bool(forKey: "healthBackfill90")
                    await syncNow(days: backfilled ? 14 : 90, force: !backfilled)
                    UserDefaults.standard.set(true, forKey: "healthBackfill90")
                }
            } else {
                callPage(["connected": false])
            }
        case "connectHealth":
            Task { await connectHealth() }
        case "syncHealth":
            Task { await syncNow(days: 90, force: true) }
        default:
            break
        }
    }

    @MainActor
    private func connectHealth() async {
        guard HealthSync.isAvailable else {
            callPage(["connected": false, "error": "Apple Health isn't available on this device."])
            return
        }
        do {
            try await health.requestAuthorization()
            health.isConnected = true
            UserDefaults.standard.set(3, forKey: "healthAuthVersion")
            await syncNow(days: 90, force: true)
            UserDefaults.standard.set(true, forKey: "healthBackfill90")
            Reminders.requestAndScheduleWeeklyCheckIn()
        } catch {
            callPage(["connected": false, "error": "Couldn't connect to Apple Health. Please try again."])
        }
    }

    @MainActor
    private func syncNow(days: Int, force: Bool = false) async {
        if syncing { return }
        if !force, let last = lastSync, Date().timeIntervalSince(last) < 60 { return }
        syncing = true
        defer { syncing = false }

        let rows = await health.dailyRows(days: days).filter { $0.hasData }
        lastSync = Date()
        var payload: [String: Any] = [
            "connected": true,
            "lastSync": ISO8601DateFormatter().string(from: Date()),
            "rows": rows.map { $0.json },
        ]
        if rows.isEmpty && force {
            payload["error"] = "No Apple Health data found yet. To check what RENOVO can read: Health app > your profile picture > Apps > RENOVO."
        }
        callPage(payload)
    }

    /// Calls `window.faAppHealth(payload)` on the page.
    private func callPage(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        let script = "window.faAppHealth && window.faAppHealth(\(json));"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(script, completionHandler: nil)
        }
    }
}

// MARK: - WKScriptMessageHandler

extension AppModel: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "faApp", let body = message.body as? [String: Any] else { return }
        DispatchQueue.main.async { self.handle(body) }
    }
}

/// Holds the message handler weakly so the web view doesn't keep the model alive forever.
final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

// MARK: - Navigation: tracker pages stay in the app, other links open in Safari

extension AppModel: WKNavigationDelegate, WKUIDelegate {
    private func opensInApp(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "about" || scheme == "blob" || scheme == "data" { return true }
        guard scheme == "https", let host = url.host?.lowercased() else { return false }
        return Self.inAppHosts.contains(host)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        // Only top-level page loads are checked; images, scripts and the sign-in service load normally.
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if !isMainFrame || opensInApp(url) {
            decisionHandler(.allow)
        } else {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    /// Links with target="_blank" (exercise form photos, the workout library, the shop):
    /// our own pages open in a sheet over the tracker, so a workout in progress is never lost;
    /// other sites open in Safari.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if opensInApp(url), url.scheme?.lowercased() == "https", let top = Self.topViewController() {
            let sheet = SFSafariViewController(url: url)
            sheet.preferredControlTintColor = UIColor(red: 0.086, green: 0.514, blue: 1.0, alpha: 1)   // #1683ff
            sheet.dismissButtonStyle = .done
            top.present(sheet, animated: true)
        } else {
            UIApplication.shared.open(url)
        }
        return nil
    }

    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive } ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        isLoading = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoading = false
        hasLoadedOnce = true
        loadError = nil
        webView.scrollView.refreshControl?.endRefreshing()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showLoadError(error, in: webView)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showLoadError(error, in: webView)
    }

    private func showLoadError(_ error: Error, in webView: WKWebView) {
        isLoading = false
        webView.scrollView.refreshControl?.endRefreshing()
        if (error as NSError).code == NSURLErrorCancelled { return }   // a new page load replaced this one
        if !hasLoadedOnce { loadError = "Can't reach RENOVO right now. Check your internet connection and try again." }
    }

    /// The web view's process can be stopped by iOS while the app is in the background; reload it.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}

// MARK: - SwiftUI wrapper

struct TrackerWebView: UIViewRepresentable {
    let model: AppModel
    func makeUIView(context: Context) -> WKWebView { model.makeWebView() }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
