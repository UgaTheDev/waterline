"""Tiny local labeling page for depth bands.  python eval/label.py  ->  http://localhost:8766

Reads eval/pool.csv (path,source,license,credit,lat,lon), appends to eval/labels.csv.
Label by reference objects in the frame: curb 15 cm, door sill 30, tire top 65, knee 50, waist 100.
Split is hash(group or path) -> dev (60%) / test (40%): fixed by construction, so it
can't drift, and a dedupe cluster (see scripts/dedupe_pool.py) stays on one side.
"""
import csv, hashlib, html, http.server, pathlib, re, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
POOL, LABELS = ROOT / "eval/pool.csv", ROOT / "eval/labels.csv"
FIELDS = ["path", "true_cm", "band_low_cm", "band_high_cm", "split", "source", "license", "credit", "lat", "lon", "annotator"]
ANNOTATOR_RE = re.compile(r"^[a-z0-9_-]{1,20}$")
# (label, low, high, nominal true_cm used for MAE). ponytail: bands, not exact cm; exact labels if a second annotator joins
BANDS = [("No water on road", 0, 0, 0), ("Under 15 cm (below curb)", 1, 15, 8), ("15-30 cm (curb to door sill)", 15, 30, 22),
         ("30-60 cm (sill to above tire middle)", 30, 60, 45), ("Over 60 cm (tire covered)", 60, 150, 80)]


def split(path, group=""):
    # hash the group (a dedupe cluster id) when present, so a whole near-duplicate
    # cluster lands on one side of dev/test instead of leaking across the split
    key = group or path
    return "dev" if int(hashlib.sha1(key.encode()).hexdigest(), 16) % 10 < 6 else "test"


def migrate_labels():
    """One-time backfill: old labels.csv rows (before the annotator column existed)
    count as annotator "kush". Rewrites the file only if the header is missing it,
    so this is idempotent and safe to call on every request."""
    if not LABELS.exists():
        return
    rows = list(csv.DictReader(open(LABELS)))
    if rows and "annotator" in rows[0]:
        return
    for r in rows:
        r.setdefault("annotator", "kush")
    with open(LABELS, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def all_labels():
    return list(csv.DictReader(open(LABELS))) if LABELS.exists() else []


def skip_file(annotator):
    return ROOT / f"eval/skipped_{annotator}.txt"


def todo(annotator, mode="normal"):
    labels = all_labels()
    done_by = lambda a: {r["path"] for r in labels if (r.get("annotator") or "kush") == a}
    mine = done_by(annotator)
    skipped = set(skip_file(annotator).read_text().split()) if skip_file(annotator).exists() else set()
    if annotator == "kush" and (ROOT / "eval/skipped.txt").exists():  # legacy shared skip file
        skipped |= set((ROOT / "eval/skipped.txt").read_text().split())
    pool = list(csv.DictReader(open(POOL)))
    if mode == "agreement":
        others_done = {r["path"] for r in labels if (r.get("annotator") or "kush") != annotator}
        rows = [r for r in pool if r["path"] in others_done and r["path"] not in mine]
    else:
        rows = [r for r in pool if r["path"] not in mine | skipped]
    return rows, len(mine)


def cookie_annotator(handler):
    for part in handler.headers.get("Cookie", "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == "annotator" and ANNOTATOR_RE.match(v):
            return v
    return None


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        if u.path == "/set-annotator":
            name = q.get("name", "")
            if not ANNOTATOR_RE.match(name):
                return self.send_error(400, "name must match ^[a-z0-9_-]{1,20}$")
            self.send_response(303)
            self.send_header("Set-Cookie", f"annotator={name}; Path=/; Max-Age=31536000")
            self.send_header("Location", "/")
            return self.end_headers()
        annotator = cookie_annotator(self)
        if u.path == "/label":
            return self.do_label(q, annotator)
        if u.path.startswith("/img/"):
            p = (ROOT / urllib.parse.unquote(u.path[5:])).resolve()
            if ROOT / "data/raw" not in p.parents or not p.is_file():
                return self.send_error(404)
            self.send_response(200); self.send_header("Content-Type", "image/jpeg"); self.end_headers()
            return self.wfile.write(p.read_bytes())
        if not annotator:
            body = ('<h2>Who are you?</h2><form action=/set-annotator><input name=name pattern="[a-z0-9_-]{1,20}" '
                     'placeholder="short handle, e.g. kush" required><button>Start labeling</button></form>')
            return self.render(body)
        migrate_labels()
        mode = "agreement" if q.get("mode") == "agreement" else "normal"
        rows, n = todo(annotator, mode)
        toggle = ('<a href="/?mode=agreement">Switch to agreement mode</a>' if mode == "normal"
                  else '<a href="/">Switch to normal mode</a>')
        if not rows:
            done_msg = "Nothing labeled by another annotator yet." if mode == "agreement" and n == 0 else f"Done: {n} labeled."
            body = f"<h2>{done_msg}</h2><p>{toggle}</p>"
        else:
            r = rows[0]
            ql = lambda i: urllib.parse.urlencode({"path": r["path"], "band": i, "mode": mode})
            buttons = "".join(f'<a class=b href="/label?{ql(i)}">{i + 1}. {html.escape(b[0])}</a>' for i, b in enumerate(BANDS))
            mode_note = " (agreement mode: labeled by another annotator, no peeking)" if mode == "agreement" else ""
            body = (f'<p>{annotator} &middot; {n} labeled, {len(rows)} left{mode_note}. Keys 1-5 label, s = skip (unclear / no reference object). {toggle}</p>'
                    f'<img src="/img/{urllib.parse.quote(r["path"])}"><div>{buttons}<a class=b href="/label?{ql(-1)}">s. Skip</a></div>'
                    f'<small>{html.escape(r["credit"])}</small>')
        self.render(body)

    def render(self, body):
        page = ("<!doctype html><meta charset=utf-8><title>Depth labels</title><style>body{font:16px system-ui;margin:16px;max-width:1100px}"
                "img{max-width:100%;max-height:70vh;display:block;margin:8px 0}.b{display:inline-block;margin:4px;padding:10px 14px;"
                "background:#eee;border-radius:6px;color:#000;text-decoration:none}</style>" + body +
                "<script>document.onkeydown=e=>{const a=[...document.querySelectorAll('.b')];const i='12345s'.indexOf(e.key);if(i>=0&&a[i])location=a[i].href}</script>")
        self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers()
        self.wfile.write(page.encode())

    def do_label(self, q, annotator):
        if not annotator:
            self.send_response(303); self.send_header("Location", "/"); return self.end_headers()
        mode = "agreement" if q.get("mode") == "agreement" else "normal"
        rows, _ = todo(annotator, mode)
        r = next((x for x in rows if x["path"] == q["path"]), None)
        if r:
            i = int(q["band"])
            if i < 0:
                with open(skip_file(annotator), "a") as fh:
                    fh.write(r["path"] + "\n")
            else:
                _, lo, hi, nominal = BANDS[i]
                new = not LABELS.exists()
                with open(LABELS, "a", newline="") as fh:
                    w = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction="ignore")
                    if new:
                        w.writeheader()
                    w.writerow({**r, "true_cm": nominal, "band_low_cm": lo, "band_high_cm": hi,
                                "split": split(r["path"], r.get("group", "")), "annotator": annotator})
        self.send_response(303); self.send_header("Location", f"/?mode={mode}" if mode == "agreement" else "/"); self.end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print("http://localhost:8766")
    http.server.HTTPServer(("127.0.0.1", 8766), H).serve_forever()
