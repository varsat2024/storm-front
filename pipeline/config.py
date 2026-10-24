"""Central configuration for the outage pipeline. Edit here, not in the scripts."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = Path(os.environ.get("OUTAGE_RAW_DIR", ROOT / "data" / "raw"))
TOPOLOGY = Path(os.environ.get("OUTAGE_TOPOLOGY", ROOT / "data" / "raw" / "matched_upstream.txt"))
PROCESSED = ROOT / "data" / "processed"
ARTIFACTS = ROOT / "artifacts"
SITE = ROOT / "site"
FRONTEND = ROOT / "frontend"
WEATHER_CSV = ROOT / "data" / "raw" / "weather_daily.csv"  # produced by weather.py

# Spatial unit: ~400 m grid cell (degrees at ~37.25 N)
CELL_LON, CELL_LAT = 0.0045, 0.0036

# Storm events, identified from ARCOS report dates (the Event field only says "Default").
EVENTS = {
    "Feb2025": ("2025-02-12", "2025-02-18"),
    "Sep2024": ("2024-09-26", "2024-10-01"),
}
REFERENCE_EVENT = "Feb2025"
FEATURE_REF_YEAR = 2025  # pole age is measured at this year

# Outage model
L2_GRID = [0.1, 1.0, 10.0, 100.0, 1000.0]
CV_FOLDS = 5
SEED = 7

# Restoration model
RESTORATION_EVENT = "Feb2025"  # other events show batch close-out lag, see README
MIN_DURATION_DAYS = 0.02       # ~30 min floor for the interval-censored lower bound

# Risk bands (policy choice, not learned): upper bounds on P(outage)
BAND_CUTS = [0.15, 0.40, 0.65]
BAND_NAMES = ["Low", "Moderate", "High", "Imminent"]

# Number of anonymized demo premises shipped to the frontend
N_DEMO_PREMISES = 200
N_DEMO_LIFE_SUPPORT = 14
N_DEMO_NO_DEVICE = 20
