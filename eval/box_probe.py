"""Can the depth model point at its reference object? A gate for drawing a box on evidence photos.

  python -m eval.box_probe [--n 20]          (run on the Nebius model; reads cached dev-split predictions)

Separate from the depth prompt on purpose: the shipped prompt (and the eval numbers behind it) stay unchanged.
For each dev photo whose cached prediction named a reference object, asks only for that object's box, draws it, and
writes eval/results/box_probe/<photo>.jpg plus index.json. A human then marks each box hit/miss in index.json
("hit": true/false). Ship the overlay (labelled "approximate") only if >= 80% hit; otherwise keep the schematic.
"""
import argparse, base64, io, json, os, pathlib, re

os.environ.setdefault("WATERLINE_LOAD_ENV", "1")
from PIL import Image, ImageDraw
from backend import depth

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "eval/results/box_probe"
ASK = ('Find the "{ref}" in this photo. Reply with JSON only: {{"box": [x0, y0, x1, y1]}} as fractions of image width '
       'and height (0-1, top-left origin), or {{"box": null}} if it is not visible.')


def parse_box(text):
    """[x0,y0,x1,y1] in 0-1 with x0<x1, y0<y1, or None. Reasoning models think first; take the last JSON object."""
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)
    for m in reversed(re.findall(r"\{[^{}]*\}", text)):
        try:
            b = json.loads(m).get("box")
        except ValueError:
            continue
        if b is None:
            return None
        if isinstance(b, list) and len(b) == 4 and all(isinstance(v, (int, float)) for v in b):
            x0, y0, x1, y1 = b
            if 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1:
                return [x0, y0, x1, y1]
    return None


def main(n):
    preds = [json.loads(l) for l in open(next((ROOT / "eval/results").glob("preds_*.jsonl")))]
    dev = {r["path"] for r in __import__("csv").DictReader(open(ROOT / "eval/labels.csv")) if r["split"] == "dev"}
    todo = [p for p in preds if p["path"] in dev and p.get("status") == "ok" and p.get("reference")][:n]
    OUT.mkdir(parents=True, exist_ok=True)
    c, rows = depth.client(), []
    for p in todo:
        img = depth.prepare_image((ROOT / p["path"]).read_bytes())
        r = c.chat.completions.create(model=depth.model(), temperature=0, max_tokens=depth.P.DEPTH_MAX_TOKENS, messages=[{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(img).decode()}},
            {"type": "text", "text": ASK.format(ref=p["reference"])}]}])
        box = parse_box(r.choices[0].message.content)
        im = Image.open(io.BytesIO(img)).convert("RGB")
        if box:
            w, h = im.size
            ImageDraw.Draw(im).rectangle([box[0] * w, box[1] * h, box[2] * w, box[3] * h], outline=(103, 232, 249), width=4)
        name = pathlib.Path(p["path"]).stem + ".jpg"
        im.save(OUT / name, quality=85)
        rows.append({"photo": name, "reference": p["reference"], "box": box, "model": depth.model(), "hit": None})
        print(name, p["reference"], box)
    (OUT / "index.json").write_text(json.dumps(rows, indent=1))
    print(f"{len(rows)} probed, {sum(r['box'] is not None for r in rows)} boxed -> mark 'hit' in {OUT / 'index.json'}")


def _selftest():
    assert parse_box('<think>x</think>{"box": [0.1, 0.2, 0.5, 0.6]}') == [0.1, 0.2, 0.5, 0.6]
    assert parse_box('{"box": null}') is None and parse_box('{"box": [0.5, 0.2, 0.1, 0.6]}') is None and parse_box("no") is None


if __name__ == "__main__":
    _selftest()
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20)
    main(ap.parse_args().n)
