# Web-Launch Servers: VPS Deploy Steps

The launcher side (v1.0.59+) supports browser-based RSPS via a new
`launchType='web'` mode. To finish wiring it up the hub VPS needs:

1. Two new columns on the `servers` table
2. `/api/servers/list.php` returning them
3. Manually setting them on Xternium's row (or any other web server)

## 1. SQL migration

Run against the hub DB on the VPS:

```sql
ALTER TABLE servers
  ADD COLUMN launch_type ENUM('jar', 'web') NOT NULL DEFAULT 'jar' AFTER jvm_args,
  ADD COLUMN web_url     VARCHAR(512)       NULL                   AFTER launch_type;
```

Existing rows all become `launch_type='jar'` automatically, no behavior change.

## 2. PHP list.php

In `/var/www/html/api/servers/list.php`, add the two columns to the SELECT
and the JSON output. Find the existing select that builds each server row
and add:

```php
'launch_type' => $row['launch_type'] ?? 'jar',
'web_url'     => $row['web_url'] ?? null,
```

(The Java side maps `launch_type` to `launchType` and `web_url` to `webUrl`
on the way through via `@SerializedName`.)

## 3. Setting Xternium (or any web server) to web mode

After approving the server in the dev portal, run:

```sql
UPDATE servers
   SET launch_type = 'web',
       web_url     = 'https://play.xternium.com/'   -- whatever URL he gives you
 WHERE name = 'Xternium';
```

The launcher caches the server list for 60s in quiet mode, so the change
shows up within a minute of the SQL update.

## 4. What the user sees

On a web-launch server's card:
- Button reads PLAY (never INSTALL)
- Clicking PLAY opens a dedicated BrowserWindow at the web_url
- Active session chip appears top-right with the server name + elapsed time
- Playtime accrues at the same rate as JAR sessions
- Closing the game window ends the session

The launcher's reaper still cleans up sessions if the user kills the
launcher hard or the OS crashes, so playtime stays accurate within ~5 min
of any unexpected exit.

## Notes

- Player count / heartbeat: web-server owners send heartbeats to
  `/api/servers/update_players.php` the same way JAR-server owners do.
  Nothing changes on that side.
- Owner dashboard: editing launch_type / web_url isn't in the dashboard UI
  yet. Set them via SQL for now. Add a UI field in the owner dashboard
  when the second or third web server lands.
- Discord RPC: the bundled Java backend ties RPC to the JAR process tree,
  so web sessions don't currently show "Playing X" in Discord. Add later
  by lifting RPC into the Electron main process.
