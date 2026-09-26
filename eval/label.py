"""Tiny local labeling page for depth bands.  python eval/label.py  ->  http://localhost:8766

Reads eval/pool.csv (path,source,license,credit,lat,lon), appends to eval/labels.csv.
Label by reference objects in the frame: curb 15 cm, door sill 30, tire top 65, knee 50, waist 100.
Split is hash(path) -> dev (60%) / test (40%): fixed by construction, so it can't drift.
"""
import csv, hashlib, html, http.server, pathlib, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
POOL, LABELS = ROOT / "eval/pool.csv", ROOT / "eval/labels.csv"
FIELDS = ["path", "true_cm", "band_low_cm", "band_high_cm", "split", "source", "license", "credit", "lat", "lon"]
# (label, low, high, nominal true_cm used for MAE). ponytail: bands, not exact cm; exact labels if a second annotator joins
BANDS = [("No water on road", 0, 0, 0), ("Under 15 cm (below curb)", 1, 15, 8), ("15-30 cm (curb to door sill)", 15, 30, 22),
         ("30-60 cm (sill to above tire middle)", 30, 60, 45), ("Over 60 cm (tire covered)", 60, 150, 80)]


def split(path):
    return "dev" if int(hashlib.sha1(path.encode()).hexdigest(), 16) % 10 < 6 else "test"


def todo():
    done = {r["path"] for r in csv.DictReader(open(LABELS))} if LABELS.exists() else set()
    skipped = set((ROOT / "eval/skipped.txt").read_text().split()) if (ROOT / "eval/skipped.txt").exists() else set()
    return [r for r in csv.DictReader(open(POOL)) if r["path"] not in done | skipped], len(done)


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/label":
            return self.do_label(dict(urllib.parse.parse_qsl(u.query)))
        if u.path.startswith("/img/"):
            p = (ROOT / urllib.parse.unquote(u.path[5:])).resolve()
            if ROOT / "data/raw" not in p.parents or not p.is_file():
                return self.send_error(404)
            self.send_response(200); self.send_header("Content-Type", "image/jpeg"); self.end_headers()
            return self.wfile.write(p.read_bytes())
        rows, n = todo()
        if not rows:
            body = f"<h2>Done: {n} labeled.</h2>"
        else:
            r = rows[0]
            q = lambda i: urllib.parse.urlencode({"path": r["path"], "band": i})
            buttons = "".join(f'<a class=b href="/label?{q(i)}">{i + 1}. {html.escape(b[0])}</a>' for i, b in enumerate(BANDS))
            body = (f'<p>{n} labeled, {len(rows)} left. Keys 1-5 label, s = skip (unclear / no reference object).</p>'
                    f'<img src="/img/{urllib.parse.quote(r["path"])}"><div>{buttons}<a class=b href="/label?{q(-1)}">s. Skip</a></div>'
                    f'<small>{html.escape(r["credit"])}</small>')
        page = ("<!doctype html><meta charset=utf-8><title>Depth labels</title><style>body{font:16px system-ui;margin:16px;max-width:1100px}"
                "img{max-width:100%;max-height:70vh;display:block;margin:8px 0}.b{display:inline-block;margin:4px;padding:10px 14px;"
                "background:#eee;border-radius:6px;color:#000;text-decoration:none}</style>" + body +
                "<script>document.onkeydown=e=>{const a=[...document.querySelectorAll('.b')];const i='12345s'.indexOf(e.key);if(i>=0&&a[i])location=a[i].href}</script>")
        self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers()
        self.wfile.write(page.encode())

    def do_label(self, q):
        rows, _ = todo()
        r = next((x for x in rows if x["path"] == q["path"]), None)
        if r:
            i = int(q["band"])
            if i < 0:
                with open(ROOT / "eval/skipped.txt", "a") as fh:
                    fh.write(r["path"] + "\n")
            else:
                _, lo, hi, nominal = BANDS[i]
                new = not LABELS.exists()
                with open(LABELS, "a", newline="") as fh:
                    w = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction="ignore")
                    if new:
                        w.writeheader()
                    w.writerow({**r, "true_cm": nominal, "band_low_cm": lo, "band_high_cm": hi, "split": split(r["path"])})
        self.send_response(303); self.send_header("Location", "/"); self.end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print("http://localhost:8766")
    http.server.HTTPServer(("127.0.0.1", 8766), H).serve_forever()
