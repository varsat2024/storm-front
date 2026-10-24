"""Build training tables from the raw shapefiles/DBFs and the upstream topology file.

Outputs (data/processed/):
  cells.csv         one row per ~400 m cell that has customers, with static features
  panel.csv         cell x event rows with damage counts (outage model training table)
  circuits.csv      per-circuit customer-weighted features and observed damage
  restoration.csv   one row per damage record in the restoration event (AFT training table)
  premises.csv.gz   one row per premise with topology (INTERNAL, never ship to the frontend)
  build_report.json counts, exclusions and data-quality notes
"""
import json
from collections import Counter

import numpy as np
import pandas as pd

import config as C
from gis_io import read_dbf, read_points, read_polylines, web_mercator_to_lonlat  # noqa: F401

FEATURES = [  # key, label, unit/description
    ("log_n", "Customer density", "ln(customers in the 400 m cell)"),
    ("oh_share", "Overhead service share", "fraction of cell customers on overhead service"),
    ("pole_age", "Median pole age", "years since install (at 2025)"),
    ("tall_share", "Tall-pole share", "fraction of poles 50 ft or taller"),
    ("ln_poles_pc", "Poles per customer", "ln((poles+1)/customers)"),
    ("ln_line_pc", "Primary line per customer", "ln((meters of primary line+1)/customers)"),
    ("ln_dev_pc", "Protective devices per customer", "ln((fuses+reclosers+switches+1)/customers)"),
]
ASSET_GROUPS = {
    "primary": "Primary wire", "secondary": "Secondary wire", "Pole": "Pole",
    "Fuse Bank": "Fuse bank", "Transformer": "Transformer",
}  # everything else -> "Other"


def _cell_index(lon, lat):
    return (np.floor(lon / C.CELL_LON).astype(int), np.floor(lat / C.CELL_LAT).astype(int))


def _event_of(ts):
    out = pd.Series("Other", index=ts.index)
    for name, (a, b) in C.EVENTS.items():
        out[(ts >= pd.Timestamp(a)) & (ts <= pd.Timestamp(b))] = name
    return out


def build(raw_dir=C.RAW_DIR, topology=C.TOPOLOGY, out_dir=C.PROCESSED):
    raw_dir, out_dir = type(C.RAW_DIR)(raw_dir), type(C.PROCESSED)(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {}

    # ---- customers -> cells
    cu = read_dbf(raw_dir / "Customer_Clip.dbf", ["premise_nu", "circuit_id", "kind_of_se", "critical_c"])
    xy = read_points(raw_dir / "Customer_Clip.shp")
    cu["lon"], cu["lat"] = xy[:, 0], xy[:, 1]
    cu["cx"], cu["cy"] = _cell_index(cu.lon.values, cu.lat.values)
    cu["overhead"] = (cu.kind_of_se == "Overhead").astype(int)
    g = cu.groupby(["cx", "cy"])
    cells = g.agg(n=("premise_nu", "size"), overhead=("overhead", "sum"),
                  circuit=("circuit_id", lambda s: s.mode().iloc[0])).reset_index()
    cells["oh_share"] = cells.overhead / cells.n
    key = {(a, b): i for i, (a, b) in enumerate(zip(cells.cx, cells.cy))}

    def to_cell(lon, lat):
        cx, cy = _cell_index(np.asarray(lon), np.asarray(lat))
        return np.array([key.get((a, b), -1) for a, b in zip(cx, cy)])

    # ---- poles
    pl = read_dbf(raw_dir / "Pole_Clip.dbf", ["date_insta", "height"])
    p_xy = read_points(raw_dir / "Pole_Clip.shp")
    year = pl.date_insta.dt.year
    pl["age"] = (C.FEATURE_REF_YEAR - year.where(year.between(1900, C.FEATURE_REF_YEAR)))
    pl["h"] = pd.to_numeric(pl.height.str.extract(r"(\d+)")[0], errors="coerce")
    pl["cell"] = to_cell(p_xy[:, 0], p_xy[:, 1])
    pl = pl[pl.cell >= 0]
    pg = pl.groupby("cell")
    cells["poles"] = pg.size().reindex(range(len(cells))).fillna(0).values
    cells["pole_age"] = pg.age.median().reindex(range(len(cells))).values
    cells["tall_share"] = pg.h.apply(lambda s: (s.dropna() >= 50).mean() if s.notna().any() else 0.0) \
        .reindex(range(len(cells))).fillna(0).values

    # ---- protective devices
    dev = np.zeros(len(cells))
    for nm in ["Fuse_Bank_Clip", "Recloser_Bank_Clip", "Switch_Clip"]:
        d_xy = read_points(raw_dir / f"{nm}.shp")
        ci = to_cell(d_xy[:, 0], d_xy[:, 1])
        np.add.at(dev, ci[ci >= 0], 1)
    cells["devices"] = dev

    # ---- primary line length (segment midpoints binned to cells)
    line_m = np.zeros(len(cells))
    k, c0 = 111320.0, np.cos(np.deg2rad(37.25))
    for _, parts in read_polylines(raw_dir / "Primary_ExportFeatures.shp"):
        for seg in parts:
            d = np.diff(seg, axis=0)
            length = np.hypot(d[:, 0] * k * c0, d[:, 1] * k)
            mid = (seg[:-1] + seg[1:]) / 2
            ci = to_cell(mid[:, 0], mid[:, 1])
            ok = ci >= 0
            np.add.at(line_m, ci[ok], length[ok])
    cells["line_m"] = line_m

    # ---- derived features
    med_age = float(cells.pole_age.median())
    cells["pole_age"] = cells.pole_age.fillna(med_age)
    cells["log_n"] = np.log(cells.n)
    cells["ln_poles_pc"] = np.log((cells.poles + 1) / cells.n)
    cells["ln_line_pc"] = np.log((cells.line_m + 1) / cells.n)
    cells["ln_dev_pc"] = np.log((cells.devices + 1) / cells.n)
    cells["lon0"], cells["lat0"] = cells.cx * C.CELL_LON, cells.cy * C.CELL_LAT
    report["pole_age_fill_median_years"] = med_age

    # ---- ARCOS damage -> events and cells
    ar = read_dbf(raw_dir / "arcos_prod_damage_09_28_Clip.dbf",
                  ["Report_Tim", "Repaired", "Repaired_D", "Asset_Type", "Access_Iss",
                   "Special_Eq", "Longitude", "Latitude", "Inform_Wor"])
    ar["event"] = _event_of(ar.Report_Tim)
    ar["cell"] = to_cell(ar.Longitude.values, ar.Latitude.values)
    report["arcos_records"] = int(len(ar))
    report["arcos_by_event"] = ar.event.value_counts().to_dict()
    report["arcos_no_customer_cell"] = int((ar.cell < 0).sum())

    rows = []
    for ev in C.EVENTS:
        cnt = ar[(ar.event == ev) & (ar.cell >= 0)].groupby("cell").size()
        df = cells[["n", "circuit"] + [f[0] for f in FEATURES]].copy()
        df["cell"] = df.index
        df["event"], df["y"] = ev, cnt.reindex(df.index).fillna(0).astype(int).values
        rows.append(df)
    panel = pd.concat(rows, ignore_index=True)
    for ev in C.EVENTS:
        cells[f"y_{ev}"] = ar[(ar.event == ev) & (ar.cell >= 0)].groupby("cell").size() \
            .reindex(cells.index).fillna(0).astype(int).values
    report["panel_rows"] = int(len(panel))
    report["panel_positive_rows"] = int((panel.y > 0).sum())

    # ---- circuits (customer-weighted feature means)
    feats = [f[0] for f in FEATURES]
    circ = cells.groupby("circuit").apply(
        lambda d: pd.Series({**{f: np.average(d[f], weights=d.n) for f in feats},
                             "n": d.n.sum(), **{f"y_{e}": d[f"y_{e}"].sum() for e in C.EVENTS}}),
        include_groups=False).reset_index()

    # ---- restoration table (one event only; see README for why)
    rs = ar[(ar.event == C.RESTORATION_EVENT)].copy()
    rs["days_gap"] = (rs.Repaired_D - rs.Report_Tim).dt.days
    rs = rs[rs.days_gap.notna() & (rs.days_gap >= 0)]
    daily = ar.groupby(ar.Report_Tim.dt.date).size()
    rs["workload"] = rs.Report_Tim.dt.date.map(daily)
    repaired = rs.Repaired == "Yes"
    rs["lo"] = np.where(repaired, np.maximum(rs.days_gap - 1, C.MIN_DURATION_DAYS),
                        np.maximum(rs.days_gap, C.MIN_DURATION_DAYS))
    rs["hi"] = np.where(repaired, rs.days_gap + 1, np.inf)
    rs["asset_group"] = rs.Asset_Type.map(ASSET_GROUPS).fillna("Other")
    rs["access"] = (rs.Access_Iss == "Yes").astype(int)
    rs["special_eq"] = rs.Special_Eq.notna().astype(int)
    rs["report_date"] = rs.Report_Tim.dt.date.astype(str)
    rs = rs[["report_date", "asset_group", "access", "special_eq", "workload", "lo", "hi", "Repaired"]]
    report["restoration_rows"] = int(len(rs))
    report["restoration_right_censored"] = int((~np.isfinite(rs.hi)).sum())
    summ = {}
    for ev in C.EVENTS:
        s = ar[(ar.event == ev) & (ar.Repaired == "Yes")]
        d = (s.Repaired_D - s.Report_Tim).dt.days
        summ[ev] = {"n": int(len(s)), "median_days": float(d.median()), "p90_days": float(d.quantile(.9)),
                    "min_days": float(d.min()), "max_days": float(d.max())}
    report["repair_gap_by_event"] = summ
    feb_daily = daily[[d for d in daily.index if pd.Timestamp(C.EVENTS[C.RESTORATION_EVENT][0]) <= pd.Timestamp(d)
                       <= pd.Timestamp(C.EVENTS[C.RESTORATION_EVENT][1])]]
    report["workload"] = {"event_total": int(feb_daily.sum()), "peak_day": int(feb_daily.max()),
                          "peak_share": float(feb_daily.max() / feb_daily.sum()),
                          "min_day": int(feb_daily.min())}

    # ---- topology per premise
    top = {}
    with open(topology, encoding="utf-8", errors="replace") as f:
        for line in f:
            parts = line.rstrip("\r\n").split("\t")
            top[parts[0]] = [s.split("*") for s in parts[1:]]
    nearest = {p: next((x[3] for x in d if x[0] == "eo_isolating_eqpt_inst"), None) for p, d in top.items()}
    zsize = Counter(nearest.values())
    cu = cu[cu.premise_nu.isin(top)].copy()
    iso = lambda p: [x for x in top[p] if x[0] == "eo_isolating_eqpt_inst"]  # noqa: E731
    cu["n_dev"] = cu.premise_nu.map(lambda p: len(iso(p)))
    short = {"Recloser (Hydraulic)": "Hyd. recloser", "Recloser (Electronic)": "Elec. recloser"}
    cu["chain"] = cu.premise_nu.map(lambda p: "→".join(short.get(x[2], x[2]) for x in iso(p)) or "none")
    cu["zone"] = cu.premise_nu.map(lambda p: int(zsize[nearest[p]]) if nearest[p] else 0)
    cu["step"] = cu.premise_nu.map(lambda p: any(x[2] == "Step" for x in top[p]))
    cu["cell"] = to_cell(cu.lon.values, cu.lat.values)
    report["premises_with_topology"] = int(len(cu))
    report["premises_without_protective_device"] = int((cu.n_dev == 0).sum())

    cells.to_csv(out_dir / "cells.csv", index=False)
    panel.to_csv(out_dir / "panel.csv", index=False)
    circ.to_csv(out_dir / "circuits.csv", index=False)
    rs.to_csv(out_dir / "restoration.csv", index=False)
    cu.drop(columns=["kind_of_se"]).to_csv(out_dir / "premises.csv.gz", index=False)
    ar[["Report_Tim", "event", "cell", "Longitude", "Latitude"]].to_csv(out_dir / "arcos_points.csv", index=False)
    (out_dir / "build_report.json").write_text(json.dumps(report, indent=2, default=str))
    return report


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", default=str(C.RAW_DIR))
    ap.add_argument("--topology", default=str(C.TOPOLOGY))
    a = ap.parse_args()
    print(json.dumps(build(a.raw_dir, a.topology), indent=2, default=str))
