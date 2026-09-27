"""Stream B (nowcast). CONTRACT, frozen 2026-09-27: GET /risk?t=&session= -> FeatureCollection of LineStrings with
properties {edge_id, name, risk: 0..1, band: "elevated"|"high", drivers: {rain_3h_mm, depression_cm, hand_m}}.
Uses only data <= t. Separate from /segments: never blocks routes, never says dry; routes may add a warning."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/risk")
def risk(t: str | None = None, session: str | None = None):
    return {"type": "FeatureCollection", "features": []}  # stub until stream B lands
