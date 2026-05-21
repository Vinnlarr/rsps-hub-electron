/**
 * prebuild-jar.js, runs before `electron-builder` via the "prebuild" npm hook.
 *
 * Why this exists:
 *   The Electron installer bundles the Java backend (java-backend/lib/*.jar +
 *   the RSPSHub start script). We used to ship the jar by hand which led to
 *   v1.0.30 going out with a stale build (UI + jar drifted, stats page silently
 *   broken). This script makes that impossible: every `npm run build` rebuilds
 *   the backend from source and copies the full distribution into place.
 *
 * How it works:
 *   1. Run `gradle installDist` in the launcher source repo. This produces
 *      build/install/RSPSHub/{lib,bin}/ with the main jar plus every dependency
 *      jar (gson, javalin, jackson, etc.) and the gradle-generated start scripts.
 *   2. Mirror lib/ and bin/ into java-backend/.
 *
 * Why installDist and not just `jar`:
 *   `gradle jar` only produces the main jar, not the 40+ dependency jars the
 *   backend needs at runtime. On a clean CI clone java-backend/ doesn't exist
 *   (gitignored), so we have to populate it from scratch from the gradle output.
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// CI can override the Java source location via RSPS_HUB_JAVA_SRC env var, since
// actions/checkout can't easily escape $GITHUB_WORKSPACE with ../ paths.
const LAUNCHER_SRC = process.env.RSPS_HUB_JAVA_SRC
  ? path.resolve(process.env.RSPS_HUB_JAVA_SRC)
  : path.resolve(__dirname, '..', '..', 'RSPS-Hub-Launcher-main');

const INSTALL_LIB  = path.join(LAUNCHER_SRC, 'build', 'install', 'RSPSHub', 'lib');
const INSTALL_BIN  = path.join(LAUNCHER_SRC, 'build', 'install', 'RSPSHub', 'bin');
const DEST_LIB     = path.resolve(__dirname, '..', 'java-backend', 'lib');
const DEST_BIN     = path.resolve(__dirname, '..', 'java-backend', 'bin');
const MAIN_JAR     = 'rsps-hub-launcher-1.0.0.jar';

const gradleCmd = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';

function fail(msg) {
  console.error('\n[prebuild-jar] ERROR: ' + msg);
  process.exit(1);
}

function copyDir(src, dest, label) {
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const stat = fs.lstatSync(s);
    if (stat.isFile()) {
      fs.copyFileSync(s, d);
      count++;
    }
  }
  console.log(`[prebuild-jar] ${label}: copied ${count} files to ${dest}`);
}

if (!fs.existsSync(LAUNCHER_SRC)) {
  // CI fallback: if the sibling Java repo isn't available (e.g. it's private
  // and we couldn't clone it), we can still build the installer as long as a
  // previously-built backend is already staged. This is rarely useful for Mac
  // CI but covers local builds where someone copied the artifacts manually.
  if (fs.existsSync(path.join(DEST_LIB, MAIN_JAR))) {
    console.log(`[prebuild-jar] Java source missing at ${LAUNCHER_SRC}`);
    console.log(`[prebuild-jar] Reusing pre-staged backend at ${DEST_LIB}`);
    process.exit(0);
  }
  fail(`Launcher source not found at ${LAUNCHER_SRC}\n` +
       `  Expected layout:\n` +
       `    C:/Users/vinny/rsps-hub-electron/        (this repo)\n` +
       `    C:/Users/vinny/RSPS-Hub-Launcher-main/   (Java source, sibling)\n` +
       `  Or set RSPS_HUB_JAVA_SRC to point at the Java repo,\n` +
       `  Or pre-stage the built backend at: ${DEST_LIB}`);
}

console.log('[prebuild-jar] Building Java backend from ' + LAUNCHER_SRC);
try {
  execSync(`${gradleCmd} installDist`, { cwd: LAUNCHER_SRC, stdio: 'inherit' });
} catch (err) {
  fail('gradle installDist failed, see above');
}

if (!fs.existsSync(path.join(INSTALL_LIB, MAIN_JAR))) {
  fail(`Built backend missing at ${INSTALL_LIB}/${MAIN_JAR}`);
}

// Wipe the destination lib/ first so a removed dependency doesn't leak through
// from a previous build. bin/ we leave alone since other files may live there
// (e.g. RSPSHub.bat tweaks) that aren't from gradle.
if (fs.existsSync(DEST_LIB)) {
  for (const name of fs.readdirSync(DEST_LIB)) {
    if (name.endsWith('.jar')) fs.rmSync(path.join(DEST_LIB, name));
  }
}

copyDir(INSTALL_LIB, DEST_LIB, 'lib');
copyDir(INSTALL_BIN, DEST_BIN, 'bin');

console.log('[prebuild-jar] done');
