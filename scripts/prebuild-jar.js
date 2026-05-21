/**
 * prebuild-jar.js — runs before `electron-builder` via the "prebuild" npm hook.
 *
 * Why this exists:
 *   The Electron installer bundles a Java jar (java-backend/lib/rsps-hub-launcher-1.0.0.jar)
 *   which is the local API backend. Until now it was copied into place by hand, which
 *   led to us shipping v1.0.30 with a stale jar (UI + jar drifted apart, stats page
 *   silently broken). This script makes that impossible:
 *   every `npm run build` now rebuilds the jar from source and copies it in.
 *
 * How it works:
 *   1. Run `gradle jar` in the launcher source repo
 *   2. Copy the freshly-built jar into java-backend/lib/
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// Paths — relative to the electron repo root (package.json's cwd when npm runs it).
// CI can override the Java source location via RSPS_HUB_JAVA_SRC env var, since
// actions/checkout can't easily escape $GITHUB_WORKSPACE with ../ paths.
const LAUNCHER_SRC = process.env.RSPS_HUB_JAVA_SRC
  ? path.resolve(process.env.RSPS_HUB_JAVA_SRC)
  : path.resolve(__dirname, '..', '..', 'RSPS-Hub-Launcher-main');
const BUILT_JAR    = path.join(LAUNCHER_SRC, 'build', 'libs', 'rsps-hub-launcher-1.0.0.jar');
const DEST_JAR     = path.resolve(__dirname, '..', 'java-backend', 'lib', 'rsps-hub-launcher-1.0.0.jar');

const gradleCmd = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';

function fail(msg) {
  console.error('\n[prebuild-jar] ERROR: ' + msg);
  process.exit(1);
}

if (!fs.existsSync(LAUNCHER_SRC)) {
  // CI fallback: if the sibling Java repo isn't available (e.g. it's private
  // and we couldn't clone it), we can still build the installer as long as
  // a previously-built jar is already staged at DEST_JAR. This lets the Mac
  // workflow ship without needing access to the Java source.
  if (fs.existsSync(DEST_JAR)) {
    const size = fs.statSync(DEST_JAR).size;
    console.log(`[prebuild-jar] Java source missing at ${LAUNCHER_SRC}`);
    console.log(`[prebuild-jar] ✓ Reusing pre-staged jar at ${DEST_JAR} (${size} bytes)`);
    process.exit(0);
  }
  fail(`Launcher source not found at ${LAUNCHER_SRC}\n` +
       `  Expected layout:\n` +
       `    C:/Users/vinny/rsps-hub-electron/        ← this repo\n` +
       `    C:/Users/vinny/RSPS-Hub-Launcher-main/   ← Java source (sibling)\n` +
       `  Or pre-stage the built jar at: ${DEST_JAR}`);
}

console.log('[prebuild-jar] Building Java jar from ' + LAUNCHER_SRC);
try {
  execSync(`${gradleCmd} jar`, { cwd: LAUNCHER_SRC, stdio: 'inherit' });
} catch (err) {
  fail('gradle jar failed — see above');
}

if (!fs.existsSync(BUILT_JAR)) fail(`Built jar missing at ${BUILT_JAR}`);

fs.copyFileSync(BUILT_JAR, DEST_JAR);
const size = fs.statSync(DEST_JAR).size;
console.log(`[prebuild-jar] ✓ Copied ${size} bytes to java-backend/lib/`);
