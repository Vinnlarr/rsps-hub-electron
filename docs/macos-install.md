# Installing RSPS Hub on macOS

The macOS build is **unsigned** because we don't (yet) have an Apple Developer
certificate. macOS Gatekeeper will quarantine the app on first launch and
refuse to open it. Here's how to get past that.

## First-launch steps

1. Download the latest DMG from
   https://github.com/Vinnlarr/rsps-hub-electron/releases
   (file looks like `RSPSHub-Setup-v1.0.59-mac-x64.dmg`)

2. Open the DMG and drag **RSPS Hub** into your Applications folder.

3. Open Terminal and run this command to remove the quarantine flag:
   ```
   xattr -dr com.apple.quarantine "/Applications/RSPS Hub.app"
   ```
   This is a one-time fix per install. Without it macOS will show
   "RSPS Hub is damaged and can't be opened" and refuse to launch the app.

4. Launch RSPS Hub from Applications.

## Optional: allow with right-click

Instead of step 3 you can also:
1. Right-click **RSPS Hub.app** in Applications
2. Click **Open**
3. macOS shows a warning, click **Open** again
4. The app opens and is permanently trusted from now on

## Why no signing?

Apple charges $99 / year for a Developer ID certificate. We're keeping the
launcher free with no ads or paid features, so signing happens when the user
base is big enough to justify the cost. Until then, the manual unquarantine
step is the price of admission on Mac. Sorry for the friction.

## What's bundled

The DMG includes:
- The Electron launcher
- A bundled Temurin 17 JRE (no system Java required)
- The Java backend JAR

Total install: ~280 MB.

## Reporting issues

Mac is a fresh platform for us, so if anything misbehaves please grab the
log file at `~/Library/Logs/RSPS Hub/main.log` and send it over Discord.
