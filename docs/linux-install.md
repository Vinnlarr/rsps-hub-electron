# Installing RSPS Hub on Linux

The Linux build ships as an **AppImage**: a single self-contained executable
that bundles the launcher, Electron, the Java backend, and a Java 17 runtime.
No package install required.

## First-launch steps

1. Download the latest AppImage from
   https://github.com/Vinnlarr/rsps-hub-electron/releases
   (file looks like `RSPSHub-Setup-v1.0.59-linux-x86_64.AppImage`)

2. Make it executable:
   ```
   chmod +x RSPSHub-Setup-v*-linux-x86_64.AppImage
   ```

3. Run it:
   ```
   ./RSPSHub-Setup-v*-linux-x86_64.AppImage
   ```

That's it. No system Java install needed, no PPA, no root.

## Optional: integrate with your desktop environment

If you want RSPS Hub to appear in your application menu / dock:

- **Most distros:** Install [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher),
  then double-click the AppImage. It auto-registers in your menu.
- **Manual:** Move the AppImage somewhere stable like `~/Applications/` and
  create a `.desktop` entry pointing at it.

## Requirements

- 64-bit Linux (x86_64)
- glibc 2.28 or newer (Ubuntu 20.04+, Debian 11+, Fedora 32+, basically any
  distro from 2019 onward)
- FUSE 2 (pre-installed on most desktop distros). On minimal systems install
  with `sudo apt install libfuse2` (Debian/Ubuntu) or equivalent.

## Discord Rich Presence

Discord on Linux works the same as on Windows/Mac. As long as you have the
Discord app running (native, Flatpak, or Snap), the launcher will detect it
and show your activity.

## Reporting issues

If something misbehaves, logs are at `~/.config/RSPS Hub/logs/main.log`.
Grab those plus a description of what went wrong and ping over Discord.
