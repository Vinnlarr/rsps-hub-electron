#!/usr/bin/env node
/**
 * Single-command release script.
 *
 *   npm run release patch "Hub Store overhaul"
 *   npm run release minor "Login system v2"
 *
 * Steps it runs in order:
 *   1. Verify clean git tree (no uncommitted changes)
 *   2. `npm version <bump>` — bumps package.json, commits, creates tag
 *   3. `npm run build` — produces dist/RSPSHub-Setup-vX.Y.Z.exe (+ blockmap, latest.yml)
 *   4. `git push --follow-tags`
 *   5. `gh release create vX.Y.Z` with the 3 dist assets attached + the
 *      release notes you passed in. Auto-update picks it up immediately.
 *
 * Pre-commit hook runs on step 2's commit; if a secret slipped in
 * the bump aborts and nothing else fires.
 */
'use strict';

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const C  = { red:'\x1b[31m', grn:'\x1b[32m', ylw:'\x1b[33m', cyn:'\x1b[36m', dim:'\x1b[2m', off:'\x1b[0m' };
const sh = (cmd, opts={}) => execSync(cmd, { stdio: 'inherit', ...opts });
const sho = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const die = (msg) => { console.error(`${C.red}✗ ${msg}${C.off}`); process.exit(1); };

const [, , bumpArg, ...notesArgs] = process.argv;
const bump  = (bumpArg || '').toLowerCase();
const notes = notesArgs.join(' ').trim();

if (!['patch', 'minor', 'major'].includes(bump)) {
  die(`First arg must be patch/minor/major. Got: ${bumpArg || '(nothing)'}\n` +
      `Usage:  npm run release -- patch "Release notes here"`);
}
if (!notes) {
  die(`Provide release notes as the second argument.\n` +
      `Usage:  npm run release -- patch "Release notes here"`);
}

// 1. Clean tree
const dirty = sho('git status --porcelain');
if (dirty) {
  console.error(`${C.red}✗ Working tree has uncommitted changes:${C.off}\n${dirty}\n`);
  die('Commit or stash, then re-run.');
}

// 2. Version bump (creates a commit + tag)
console.log(`${C.cyn}→ npm version ${bump}${C.off}`);
sh(`npm version ${bump} -m "%s — ${notes.replace(/"/g, '\\"')}"`);
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const ver = pkg.version;
const tag = `v${ver}`;
console.log(`${C.grn}✓ bumped to ${tag}${C.off}\n`);

// 3. Build installer
console.log(`${C.cyn}→ npm run build${C.off}`);
sh('npm run build');
const exePath  = path.resolve(`dist/RSPSHub-Setup-${tag}.exe`);
const blockmap = `${exePath}.blockmap`;
const latestYml = path.resolve('dist/latest.yml');
for (const p of [exePath, blockmap, latestYml]) {
  if (!fs.existsSync(p)) die(`Expected build artifact missing: ${p}`);
}
console.log(`${C.grn}✓ build OK${C.off}\n`);

// 4. Push commit + tag
console.log(`${C.cyn}→ git push --follow-tags${C.off}`);
sh('git push --follow-tags');
console.log('');

// 5. GitHub release
console.log(`${C.cyn}→ gh release create ${tag}${C.off}`);
const title = `${tag} — ${notes.length > 60 ? notes.slice(0, 57) + '...' : notes}`;
const noteBody = notes;
// Avoid quote-escaping pain: write notes to a temp file, pass via --notes-file.
const tmpNotes = path.resolve(`dist/.release-notes-${tag}.md`);
fs.writeFileSync(tmpNotes, noteBody);
try {
  sh(`gh release create ${tag} ` +
     `"${exePath}" "${blockmap}" "${latestYml}" ` +
     `--title "${title.replace(/"/g, '\\"')}" ` +
     `--notes-file "${tmpNotes}"`);
} finally {
  fs.unlinkSync(tmpNotes);
}

console.log(`\n${C.grn}✓ Release ${tag} live.${C.off}`);
console.log(`${C.dim}  https://github.com/Vinnlarr/rsps-hub-electron/releases/tag/${tag}${C.off}`);
console.log(`${C.dim}  Existing 1.0.x installs will auto-prompt on next launch.${C.off}`);
