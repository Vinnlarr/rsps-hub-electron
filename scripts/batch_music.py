"""
Download every OSRS music track via the wiki API, upload to VPS, seed DB.
Uses batched imageinfo queries (50 files per call) and exponential backoff
on 429. Idempotent: re-running skips tracks already present.
"""
import os, sys, json, time, tempfile, traceback, urllib.parse, urllib.request
import paramiko

WIKI_API = "https://oldschool.runescape.wiki/api.php"
HDR = {"User-Agent": "RSPSHubLauncher/1.0 (admin@therspshub.com)"}
VPS_HOST = "91.223.119.235"
VPS_USER = "root"
VPS_PASS = "zQx5unfLiTvm1pvkqqAD"
DB_PASS  = "Hub2026Secure!"
BATCH    = 50  # max titles per API call for anon users


def wiki_get(params, max_retries=6):
    """GET with exponential backoff on 429/transient errors."""
    qs = urllib.parse.urlencode({**params, "format": "json"}, doseq=True)
    delay = 1.5
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(f"{WIKI_API}?{qs}", headers=HDR)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 or 500 <= e.code < 600:
                print(f"  (HTTP {e.code}, sleeping {delay:.0f}s…)", flush=True)
                time.sleep(delay)
                delay = min(60, delay * 2)
                continue
            raise
        except Exception:
            time.sleep(delay)
            delay = min(60, delay * 2)
    raise RuntimeError("wiki_get: out of retries")


def all_music_titles():
    titles, cont = [], None
    while True:
        p = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": "Category:Music_tracks",
            "cmlimit": 500,
            "cmnamespace": 0,
        }
        if cont:
            p.update(cont)
        data = wiki_get(p)
        for m in data.get("query", {}).get("categorymembers", []):
            titles.append(m["title"])
        if "continue" in data:
            cont = data["continue"]
        else:
            break
        time.sleep(0.4)
    return titles


def safe_filename(title):
    s = title.replace(" ", "_")
    s = "".join(c if (c.isalnum() or c in "_-") else "_" for c in s)
    return s + ".ogg"


def chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i+n]


def fetch_file_urls(titles):
    """Return {title: (url, size)} via batched API calls (50 per).
    Uses the page title verbatim with ' (music track)' suffix stripped if needed."""
    out = {}
    for group in chunks(titles, BATCH):
        # Build File: titles directly from the page title (preserves apostrophes etc.)
        # "Apology" → "File:Apology.ogg"
        # "Zealot (music track)" → "File:Zealot.ogg" (wiki files drop the disambig suffix)
        file_map = {}  # File title -> page title
        for t in group:
            base = t
            # Strip " (music track)" or similar disambiguation
            for suffix in [' (music track)', ' (music)', ' (track)']:
                if base.endswith(suffix):
                    base = base[:-len(suffix)]
                    break
            file_map[f"File:{base}.ogg"] = t

        # Batched imageinfo query + redirect resolution
        p = {
            "action": "query",
            "titles": "|".join(file_map.keys()),
            "prop": "imageinfo",
            "iiprop": "url|size",
            "redirects": 1,
        }
        data = wiki_get(p)

        # normalized/redirected File title -> original page title
        normalize = {}
        for n in data.get("query", {}).get("normalized", []) or []:
            normalize[n["to"]] = file_map.get(n["from"], file_map.get(n["to"]))
        for r in data.get("query", {}).get("redirects", []) or []:
            orig = normalize.get(r["from"], file_map.get(r["from"]))
            if orig:
                normalize[r["to"]] = orig

        pages = data.get("query", {}).get("pages", {})
        for _, page in pages.items():
            if "imageinfo" not in page:
                continue
            file_title = page["title"]
            orig_title = normalize.get(file_title) or file_map.get(file_title)
            if not orig_title:
                continue
            info = page["imageinfo"][0]
            out[orig_title] = (info.get("url"), info.get("size", 0))

        for t in group:
            if t not in out:
                out[t] = (None, 0)

        time.sleep(0.7)
    return out


def download(url):
    req = urllib.request.Request(url, headers=HDR)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    print("Connecting to VPS...", flush=True)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(VPS_HOST, username=VPS_USER, password=VPS_PASS, timeout=30)
    sftp = ssh.open_sftp()

    try:
        existing = set(sftp.listdir("/var/www/html/music"))
    except Exception:
        existing = set()
    print(f"Already on VPS: {len(existing)}", flush=True)

    print("Querying wiki for track list...", flush=True)
    titles = all_music_titles()
    print(f"Found {len(titles)} music track pages", flush=True)

    # Only resolve URLs for the tracks we don't already have
    needed = [t for t in titles if safe_filename(t) not in existing]
    print(f"Need to fetch: {len(needed)}", flush=True)

    print("Resolving file URLs in batches of", BATCH, "...", flush=True)
    url_map = fetch_file_urls(needed) if needed else {}

    ok = failed = 0
    tmpdir = tempfile.mkdtemp(prefix="rh_music_")
    mappings = []  # (title, filename, size)

    # Pre-populate mappings with already-present titles so they end up in DB
    for t in titles:
        if safe_filename(t) in existing:
            mappings.append((t, safe_filename(t), 0))

    for idx, title in enumerate(needed, 1):
        fn = safe_filename(title)
        url, size = url_map.get(title, (None, 0))
        if not url:
            failed += 1
            if failed <= 10 or idx % 25 == 0:
                print(f"[{idx}/{len(needed)}] NO URL  {title}", flush=True)
            continue
        try:
            data = download(url)
            local = os.path.join(tmpdir, fn)
            with open(local, "wb") as f:
                f.write(data)
            sftp.put(local, f"/var/www/html/music/{fn}")
            os.unlink(local)
            existing.add(fn)
            mappings.append((title, fn, size))
            ok += 1
            if idx % 25 == 0 or idx == len(needed):
                print(f"[{idx}/{len(needed)}] ok={ok} fail={failed}", flush=True)
            time.sleep(0.25)
        except Exception as e:
            failed += 1
            print(f"[{idx}/{len(needed)}] ERR {title}: {e}", flush=True)

    ssh.exec_command("chmod 644 /var/www/html/music/*.ogg")[1].read()

    if mappings:
        print(f"Seeding DB ({len(mappings)} rows)...", flush=True)
        pairs = []
        for title, fname, size in mappings:
            t_esc = title.replace("\\", "\\\\").replace("'", "''")
            f_esc = fname.replace("\\", "\\\\").replace("'", "''")
            pairs.append(f"('{t_esc}','{f_esc}','Ambient',{int(size)},0)")
        sql = (
            "INSERT IGNORE INTO music (name, filename, category, size_bytes, duration_seconds) VALUES "
            + ",".join(pairs) + ";"
        )
        remote_sql = "/root/_music_seed.sql"
        with sftp.open(remote_sql, "w") as f:
            f.write(sql)
        _, out, _ = ssh.exec_command(
            f"mysql -urspshub -p'{DB_PASS}' rspshub < {remote_sql} 2>&1 | grep -v password; "
            f"mysql -urspshub -p'{DB_PASS}' rspshub -e 'SELECT COUNT(*) AS n FROM music;' 2>&1 | grep -v password; "
            f"rm -f {remote_sql}"
        )
        print("DB:", out.read().decode(), flush=True)

    sftp.close()
    ssh.close()
    print(f"DONE. uploaded={ok} failed={failed}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
