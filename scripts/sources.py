"""Regenerate SOURCES.md (media credits) from the replay manifest and eval labels.  python3 scripts/sources.py"""
import csv, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
rows = lambda p: list(csv.DictReader(open(p))) if p.exists() else []
replay = [r for r in rows(ROOT / "data/cache/replay_manifest.csv") if r.get("use_in_replay") == "yes"]
labeled = {r["path"] for r in rows(ROOT / "eval/labels.csv")}
evalset = [r for r in rows(ROOT / "eval/pool.csv") if r["path"] in labeled]
out = ["# Sources", "", "All media is public domain or CC BY, credited below. Raw files are not in the repo (data/raw/ is gitignored).", "",
       "Data: USGS Short-Term Network (public domain); NWS warnings via Iowa Environmental Mesonet (public domain);",
       "road network © OpenStreetMap contributors (ODbL); geocoding by Nominatim; thresholds from NWS \"Turn Around, Don't Drown\".", "",
       "## Demo video", "",
       "- [Highway 610 near Braeswood Blvd in Houston Texas](https://commons.wikimedia.org/wiki/File:Highway_610_near_Braeswood_Blvd_in_Houston_Texas.webm): "
       "Texas Army National Guard, Aug 31 2017, public domain (work of a U.S. National Guard member in official duties). "
       "Handheld from the overpass, not dashcam footage; replayed through Drive mode as a demo.", ""]
for title, rs, key in (("Replay photos", replay, "source_url"), ("Evaluation photos", evalset, "source")):
    out += [f"## {title} ({len(rs)})", ""] + [f"- [{r.get('title') or r['path'].split('/')[-1]}]({r[key]}): {r['credit']}" for r in rs] + [""]
(ROOT / "SOURCES.md").write_text("\n".join(out))
print(f"SOURCES.md: {len(replay)} replay, {len(evalset)} eval")
