# Security Phase 2: JAR Integrity Verification

Phase 1 (v1.0.54) shipped the client-side groundwork. Phase 2 needs PHP + DB
changes on the VPS so the launcher actually has hashes to verify against.

This doc lists exactly what to deploy. Until you ship it the launcher just
logs hashes to the console (warning mode); nothing is enforced.

## 1. SQL schema change

Run on the production MySQL:

```sql
ALTER TABLE servers
  ADD COLUMN jar_sha256 CHAR(64) NULL AFTER jar_url,
  ADD COLUMN jar_size_bytes BIGINT NULL AFTER jar_sha256,
  ADD COLUMN pending_jar_url TEXT NULL AFTER jar_size_bytes;
```

`pending_jar_url` is for the "lock changes behind admin re-approval" flow
(section 4 below).

## 2. Update `list.php` to return the new fields

In `/api/servers/list.php`, the row enrichment currently strips `api_key`.
Add the two new fields to the public payload:

```php
// inside the row-mapping loop
$row['jar_sha256']     = $row['jar_sha256']     ?? null;
$row['jar_size_bytes'] = isset($row['jar_size_bytes']) ? (int)$row['jar_size_bytes'] : null;
unset($row['pending_jar_url']);  // never expose pending edits
unset($row['api_key']);
```

Same for `mine.php` (owners can see their own pending_jar_url if useful).

## 3. Admin endpoint: record hash for a server

The simplest path is to compute the hash server-side when you approve a
server (or click a "Re-hash" button in the admin panel). Drop this in
`/api/admin/rehash_server.php`:

```php
<?php
require_once __DIR__ . '/../../config/db.php';
require_once __DIR__ . '/../../config/staff_auth.php';

requireStaff();

$id = (int)($_POST['id'] ?? 0);
if ($id <= 0) { http_response_code(400); exit('bad id'); }

$st = $pdo->prepare("SELECT jar_url FROM servers WHERE id = ?");
$st->execute([$id]);
$row = $st->fetch();
if (!$row || !$row['jar_url']) { http_response_code(404); exit('no jar'); }

// Stream-download and hash. cURL with FILE write target avoids loading
// 500MB into memory.
$tmp = tempnam(sys_get_temp_dir(), 'rspshub_hash_');
$fp = fopen($tmp, 'w+');
$ch = curl_init($row['jar_url']);
curl_setopt($ch, CURLOPT_FILE, $fp);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 600);
curl_setopt($ch, CURLOPT_USERAGENT, 'RSPSHub-Admin-Hasher/1.0');
$ok = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
fclose($fp);

if (!$ok || $httpCode !== 200) {
    @unlink($tmp);
    http_response_code(502);
    exit(json_encode(['error' => 'download failed', 'http' => $httpCode]));
}

$sha = hash_file('sha256', $tmp);
$size = filesize($tmp);
@unlink($tmp);

$upd = $pdo->prepare("UPDATE servers SET jar_sha256 = ?, jar_size_bytes = ? WHERE id = ?");
$upd->execute([$sha, $size, $id]);

header('Content-Type: application/json');
echo json_encode(['ok' => true, 'sha256' => $sha, 'size' => $size]);
```

Wire it into the dev portal admin panel with a "Re-hash JAR" button next to
each server. Click it whenever a server pushes a real client update.

## 4. Lock `jar_url` changes behind admin re-approval

In `/api/servers/update.php`, when an owner edits their listing, treat
`jar_url` specially:

```php
// inside the update handler, after auth checks
if (isset($input['jar_url']) && $input['jar_url'] !== $existing['jar_url']) {
    // Don't apply directly. Stash as pending and notify admin.
    $st = $pdo->prepare("UPDATE servers SET pending_jar_url = ? WHERE id = ?");
    $st->execute([$input['jar_url'], $id]);
    // Optional: email/Discord-webhook the admin so you know to review.
    unset($input['jar_url']);  // strip from the rest of the update
}
```

Admin approval flow: when you click "Approve pending jar_url" in the admin
panel, copy `pending_jar_url` into `jar_url`, recompute the hash via section
3, clear `pending_jar_url`.

## 5. Rollout plan

The client already supports all three modes via the `jar_sha256` field. To
move between modes, just change the launcher's enforcement logic (currently
"warn always") in `LauncherEngine.java#downloadClient`:

| Mode  | Launcher behavior                                              | Ship as |
|-------|----------------------------------------------------------------|---------|
| Warn  | Log hash. If mismatch, log loudly but launch anyway.           | v1.0.54 |
| Soft  | If hash set and mismatches, REFUSE launch. Null hash = allow.  | v1.0.55 |
| Hard  | If hash null OR mismatch, REFUSE launch. All servers must hash.| v1.0.56 |

Before flipping to Soft (v1.0.55), do a one-shot pass through every approved
server using the admin rehash endpoint so the DB has a baseline. Before
Hard (v1.0.56), confirm every server has a non-null `jar_sha256`.

## 6. Server-owner communication

When a server owner pushes a new client, their users will hit "hash
mismatch, refusing to launch" once we're in Soft mode. Mitigation options
in order of effort:

1. **Manual**: owner DMs you, you click "Re-hash JAR" in admin panel
2. **Webhook**: owner POSTs to `/api/dev/notify-update?api_key=...` which
   re-hashes automatically (still requires their auth)
3. **Auto**: nightly cron re-hashes every server, only logs to admin

Option 1 is fine for launch. Phase 3-ish: option 2 with rate limiting.

## What's already shipped in v1.0.54 client

- `ServerProfile.jarSha256` and `jarSizeBytes` fields, mapped from
  `jar_sha256` / `jar_size_bytes` JSON
- `LauncherEngine.sha256Hex(Path)` helper
- `LauncherEngine.downloadClient` computes hash on every download, logs it,
  compares to `server.jarSha256` if set (warn-only mode)
- `ApiServer.java` passes both fields through to the renderer
- Renderer shows a "✓ Verified" section with the first 16 chars of the hash
  on the server detail page, plus a copy button
- Existing `data-copy-url` handler reused for the copy button

Nothing else needs to change in the client until you want to flip to Soft
mode.
