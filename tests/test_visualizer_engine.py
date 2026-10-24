"""Parity checks: backend engine loads the same artifacts as the static site."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

html = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
MODEL = json.loads(re.search(r"const MODEL=(.+?);\s*\nconst DATA=", html, re.S).group(1))
DATA = json.loads((ROOT / "site" / "data.json").read_text(encoding="utf-8"))

from app.visualizer_engine import compute_status, resolve_premise_index  # noqa: E402


def test_resolve_premise_id():
    idx = resolve_premise_index(DATA, premise_id="P-0001")
    status = compute_status(MODEL, DATA, idx)
    assert status["premise_id"] == "P-0001"
    assert status["outage_risk"]["band"] in ("Low", "Moderate", "High", "Imminent")
    assert 0 <= status["outage_risk"]["probability"] <= 1


def test_nearest_premise_to_cell_centre():
    p0 = DATA["prem"][0]
    idx = resolve_premise_index(DATA, latitude=p0["p"][1], longitude=p0["p"][0])
    assert idx == 0


def test_upstream_exposure_structure():
    from app.grid_exposure import compute_exposure_risks, topology_summary

    idx = resolve_premise_index(DATA, premise_id="P-0001")
    topo = topology_summary(DATA, idx)
    assert "upstream_device_path" in topo
    storm_harsh = {"gust": 80, "rain": 4, "snow": 0, "ante": 2, "leaf": 0}
    storm_calm = {"gust": 20, "rain": 0, "snow": 0, "ante": 0, "leaf": 0}
    exp = compute_exposure_risks(MODEL, DATA, idx, storm_calm, {"local": storm_calm, "feeder_cell_1": storm_harsh})
    assert exp["combined_outage_probability"] >= exp["local_outage_probability"]


if __name__ == "__main__":
    test_resolve_premise_id()
    test_nearest_premise_to_cell_centre()
    test_upstream_exposure_structure()
    print("ok")
