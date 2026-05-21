// electron-builder afterPack hook.
//
// On macOS the bundled Temurin JRE and the RSPSHub launch script need to be
// executable inside the packaged .app, otherwise the Java backend never
// starts ("Permission denied" on jre/bin/java or the shell script). When the
// JRE was downloaded on macOS the +x bit is already set, but the project
// also ships a copy from Windows where filesystems don't carry that bit, so
// we re-apply it during pack regardless of the build host.

const fs   = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // Find the .app folder inside appOutDir. electron-builder names it after
  // productFilename, which may differ from productName once spaces are
  // stripped on some versions, so glob for any *.app to stay version-proof.
  const outDir = context.appOutDir;
  let appBundle = null;
  for (const entry of fs.readdirSync(outDir)) {
    if (entry.endsWith('.app')) { appBundle = entry; break; }
  }
  if (!appBundle) {
    console.warn('[afterPack] no .app bundle found in', outDir);
    return;
  }
  const resourcesDir = path.join(
    outDir,
    appBundle,
    'Contents',
    'Resources',
    'java-backend'
  );

  // Files and directories that need the executable bit on macOS.
  const targets = [
    path.join(resourcesDir, 'bin', 'RSPSHub'),
    path.join(resourcesDir, 'jre', 'bin'),
    path.join(resourcesDir, 'jre', 'lib', 'jspawnhelper'),
  ];

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

  for (const t of targets) chmodRecursive(t, 0o755);

  console.log('[afterPack] chmod +x applied to bundled JRE and launcher script');
};
