# RENOVO iPhone app

The app shows the client tracker (`fastaminoswellness.com/tracker`) with RENOVO branding,
adds Apple Health sync, and sends a weekly check-in reminder. Everything else (plans, workout
logging, rest timer, check-ins, coach replies) comes from the tracker, so website updates show
up in the app right away without a new App Store release.

| What | Where |
|---|---|
| App name on the home screen | **RENOVO** (`project.yml` → `CFBundleDisplayName`) |
| Bundle ID | `com.renovocoach.app` |
| Minimum iOS | 16 |
| Health data read | steps, sleep, weight, active calories, exercise minutes, resting heart rate |
| Writes to Health | never |
| Reminder | Sundays at 9:00 AM (`Reminders.swift`) |

## How it fits together

- The tracker page tells the app when a client is signed in. When the client taps
  **Connect Apple Health**, the app asks for permission, reads up to 30 days of daily totals,
  and hands them to the page. The page saves them to the `health_daily` table with the client's
  own sign-in. **The app never handles passwords or login tokens.**
- Each time the client opens the app, it syncs the last 14 days (at most every 15 minutes).
- Links to other sites (like the Fast Aminos shop) open in Safari.

## One-time Mac setup

1. Install **Xcode** from the Mac App Store and open it once. When it asks, install the iOS platform.
2. Install Homebrew if you don't have it (see brew.sh), then in Terminal:
   ```
   brew install xcodegen
   ```
3. Get the code (or pull the latest if you already have it):
   ```
   git clone https://github.com/PeteGarzaFit/fast-aminos-wellness.git
   cd fast-aminos-wellness/ios
   xcodegen
   open Renovo.xcodeproj
   ```

## Run it

1. In Xcode, click **Renovo** in the left sidebar → **Signing & Capabilities** → **Team**:
   pick your Apple developer account. Xcode registers the bundle ID and HealthKit for you.
2. Pick a simulator (for example iPhone 15) at the top and press **▶ Run**.
   - The simulator's Health app starts empty. Open it and add a few steps or a weight
     (Browse → Activity → Steps → Add Data) to test syncing.
3. To run on your iPhone: plug it in, select it at the top, press **▶ Run**. The first time,
   allow developer mode on the phone (Settings → Privacy & Security → Developer Mode).

## Send it to clients with TestFlight

1. **App Store Connect** (appstoreconnect.apple.com) → **Apps** → **+** → **New App**.
   Platform iOS, name **Renovo Coach** (the store name must be unique), bundle ID
   `com.renovocoach.app`, SKU `renovo-ios`.
2. In Xcode: set the run destination to **Any iOS Device**, then **Product → Archive** →
   **Distribute App** → **TestFlight & App Store**.
3. In App Store Connect → **TestFlight**:
   - Fill in **Test Information** and **Beta App Review** details. Give Apple a demo login:
     a test client email and password with a plan and a few check-ins.
   - Create an **External** group, add the build, and turn on the **public link**.
     Clients install the free TestFlight app and tap your link.
4. Each new upload: raise `CURRENT_PROJECT_VERSION` in `project.yml` (2, 3, …),
   run `xcodegen` again, and archive.

## Required before Apple review

- **Privacy policy URL:** `https://fastaminoswellness.com/privacy/` (Apple requires one for Health apps).
- **App Privacy questions** in App Store Connect: Health & Fitness, Contact info (name, email),
  and Photos are collected, linked to the user, for app functionality only, with no tracking.
  This matches `PrivacyInfo.xcprivacy`.
- Keep GLP-1 prescriptions and telehealth out of the app's store listing and screenshots.
  RENOVO is a coaching app, which keeps review simple.
- **Sign-in tip:** inside the app, clients sign in with their email and password, or with the
  6-digit code from the email. Set up the custom email template in `tracker/SETUP.md` so the
  code is included.

## Change the icon

Replace `Renovo/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` with your own
1024×1024 PNG (square, no transparency, no rounded corners; iOS rounds them).
