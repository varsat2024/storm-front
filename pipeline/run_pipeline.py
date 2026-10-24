"""Run the whole pipeline end to end.

    python run_pipeline.py --raw-dir path/to/extracted_shapefiles \
        --topology path/to/matched_upstream.txt --labor path/to/Install_Labor_HackOHIO.xlsx \
        [--fetch-weather] [--zips Data1.zip Data2.zip]

Stages: features -> outage model -> restoration model -> severity model -> export -> frontend build.
"""
import argparse
import zipfile
from pathlib import Path

import config as C
import build_frontend
import export_frontend_data
import export_model
import features
import train_outage
import train_restoration
import train_severity


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", default=str(C.RAW_DIR))
    ap.add_argument("--topology", default=str(C.TOPOLOGY))
    ap.add_argument("--labor", default=str(C.RAW_DIR / "Install_Labor_HackOHIO.xlsx"))
    ap.add_argument("--zips", nargs="*", default=[], help="zip files to extract into --raw-dir first")
    ap.add_argument("--fetch-weather", action="store_true", help="download ERA5 weather (needs internet)")
    a = ap.parse_args()

    raw = Path(a.raw_dir)
    raw.mkdir(parents=True, exist_ok=True)
    for z in a.zips:
        with zipfile.ZipFile(z) as f:
            f.extractall(raw)
    if a.fetch_weather:
        import weather
        w = weather.add_features(weather.fetch("2022-10-01", "2026-08-31"))
        C.WEATHER_CSV.parent.mkdir(parents=True, exist_ok=True)
        w.to_csv(C.WEATHER_CSV, index_label="date")

    print("== features");    features.build(raw, a.topology)
    print("== outage");      train_outage.main()
    print("== restoration"); train_restoration.main()
    print("== severity");    train_severity.main()
    print("== export");      export_model.main(a.labor); export_frontend_data.main(raw)
    print("== frontend");    build_frontend.main()


if __name__ == "__main__":
    main()
