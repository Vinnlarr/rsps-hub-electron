// electron-builder afterPack hook.
//
// On macOS and Linux the bundled Temurin JRE and the RSPSHub launch script
// need the executable bit, otherwise the Java backend never starts
// ("Permission denied" on jre/bin/java or the shell script). When the JRE
// is downloaded inside a Linux/Mac CI runner the bit is already set, but the
// project also ships JRE copies from Windows where filesystems don't carry
// that bit, so re-apply it during pack regardless of the build host.

const fs   = require('fs');
const path = require('path');

function chmodRecursive(p, mode) {
  if (!fs.existsSync(p)) return;
  const stat = fs.lstatSync(p);
  if (stat.isDirectory()) {
    try { fs.chmodSync(p, 0o755); } catch (_) {}
    for (const child of fs.readdirSync(p)) {
      chmodRecursive(path.join(p, child), mode);
    }
  } else {
    try { fs.chmodSync(p, mode); } catch (_) {}
  }
}

function macResourcesDir(outDir) {
  // Locate the .app bundle. electron-builder names it after productFilename
  // which can vary across versions, so glob for any *.app to stay safe.
  for (const entry of fs.readdirSync(outDir)) {
    if (entry.endsWith('.app')) {
      return path.join(outDir, entry, 'Contents', 'Resources', 'java-backend');
    }
  }
  return null;
}

module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName; // "darwin" | "linux" | "win32"
  if (platform !== 'darwin' && platform !== 'linux') return;

  let resourcesDir;
  if (platform === 'darwin') {
    resourcesDir = macResourcesDir(context.appOutDir);
    if (!resourcesDir) {
      console.warn('[afterPack] no .app bundle found in', context.appOutDir);
      return;
    }
  } else {
    // Linux unpacked layout: ${appOutDir}/resources/java-backend/
    resourcesDir = path.join(context.appOutDir, 'resources', 'java-backend');
  }

  const targets = [
    path.join(resourcesDir, 'bin', 'RSPSHub'),
    path.join(resourcesDir, 'jre', 'bin'),
    path.join(resourcesDir, 'jre', 'lib', 'jspawnhelper'),
  ];

  for (const t of targets) chmodRecursive(t, 0o755);

  console.log(`[afterPack] chmod +x applied to bundled JRE and launcher script (${platform})`);
};
