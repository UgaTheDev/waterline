"""Constants and settings. Vehicle limits are deliberately conservative (NWS / FEMA)."""
import os, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "data/cache"
DB_PATH = pathlib.Path(os.getenv("DB_PATH", ROOT / "data/uploads.db"))

CITY = "Houston, TX"
EVENT = "Hurricane Harvey (2017)"
# [w, s, e, n]; downtown Houston + Buffalo Bayou + Meyerland
BBOX = [float(x) for x in os.getenv("BBOX", "-95.50,29.66,-95.33,29.81").split(",")]
# ends Sep 3: Buffalo Bayou peaked late (Addicks/Barker reservoir releases); USGS survey peaks are Sep 1-2
REPLAY = {"start": "2017-08-26T12:00:00Z", "end": "2017-09-03T00:00:00Z", "default_t": "2017-09-01T20:00:00Z"}

# Water depth (cm) at which each vehicle is blocked. ponytail: fixed table, per-model sill heights if asked.
VEHICLES = {
    "sedan": {"label": "Sedan", "limit_cm": 15},
    "suv": {"label": "SUV", "limit_cm": 30},
    "truck": {"label": "Pickup truck", "limit_cm": 45},
    "rescue": {"label": "High-water rescue truck", "limit_cm": 90},  # responder mode; FEMA high-water vehicle class
}
THRESHOLDS = [  # NWS "Turn Around, Don't Drown"
    {"cm": 15, "text": "6 in (15 cm) reaches the bottom of most cars and can cause loss of control or stalling."},
    {"cm": 30, "text": "12 in (30 cm) of moving water can float many vehicles."},
    {"cm": 60, "text": "24 in (60 cm) of rushing water can sweep away most vehicles, including SUVs and pickups."},
]

SNAP_M = 30          # max distance from a photo to the road it describes
HALF_LIFE_MIN = 45   # observation weight halves every 45 min
MIN_WEIGHT = 0.1     # below this an observation no longer counts (segment goes stale, not dry)
UNKNOWN_COST = 3     # length multiplier for streets with no reports
ALERT_UNKNOWN_COST = 10  # ... inside an active flood warning polygon

# Calibration knobs set from the eval (dev split): widen the upper bound, never narrow it.
HIGH_MARGIN_CM = float(os.getenv("HIGH_MARGIN_CM", "0"))
HIGH_SCALE = max(1.0, float(os.getenv("HIGH_SCALE", "1.0")))

# Depth model. Default: Nemotron Nano 2 VL on Token Factory (pay-per-token, no GPU to keep alive through judging).
# "cosmos": Cosmos Reason 2 self-hosted on Nebius AI Cloud, run as a benchmark on the same eval; ship the lower miss rate.
DEPTH_PROVIDER = os.getenv("DEPTH_PROVIDER", "tokenfactory")
DEPTH_MODEL = os.getenv("DEPTH_MODEL", "nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL")  # confirm the exact id with GET /v1/models
COSMOS_URL = os.getenv("COSMOS_URL")  # e.g. http://<vm-ip>:8000/v1
COSMOS_KEY = os.getenv("COSMOS_KEY", "EMPTY")
COSMOS_MODEL = os.getenv("COSMOS_MODEL", "nvidia/Cosmos-Reason2-8B")
TF_URL = os.getenv("TF_URL", "https://api.tokenfactory.nebius.com/v1/")
TF_KEY = os.getenv("TF_KEY")
NEMOTRON_MODEL = os.getenv("NEMOTRON_MODEL", "nvidia/nemotron-3-super-120b-a12b")
TAVILY_KEY = os.getenv("TAVILY_KEY")
# Flood-risk nowcast: off. On held-out streets it didn't beat a terrain-only baseline (eval/results/nowcast.json).
NOWCAST_ENABLED = os.getenv("NOWCAST_ENABLED") == "1"
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
