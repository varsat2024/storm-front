"""Write site/data.json: anonymized premises, circuit summaries and map geometry for the frontend.

Privacy: premise ids are re-numbered, positions are 400 m cell centres, and only cell-level
features are shipped. No addresses, premise numbers, meter ids or exact customer coordinates.
"""
import json
from collections import defaultdict

import numpy as np
import pandas as pd

import config as C
from features import FEATURES
from gis_io import read_dbf, read_points, read_polylines, web_mercator_to_lonlat

KEYS = [f[0] for f in FEATURES]


def main(raw_dir=C.RAW_DIR):
    from pathlib import Path
    raw_dir = Path(raw_dir)
    P = C.PROCESSED
    cells = pd.read_csv(P / "cells.csv", dtype={"circuit": str})
    circ = pd.read_csv(P / "circuits.csv", dtype={"circuit": str})
    prem = pd.read_csv(P / "premises.csv.gz", dtype={"premise_nu": str, "circuit_id": str})
    arc = pd.read_csv(P / "arcos_points.csv")

    order = circ.sort_values("n", ascending=False).circuit.tolist()
    cidx = {c: i for i, c in enumerate(order)}
    cells["ci"] = cells.circuit.map(cidx)

    # ---- fire / hospital distance, banded for privacy
    k, c0 = 111320.0, np.cos(np.deg2rad(37.25))
    from scipy.spatial import cKDTree
    xy = lambda a: np.c_[a[:, 0] * k * c0, a[:, 1] * k]  # noqa: E731
    cust_xy = prem[["lon", "lat"]].values
    fire = read_points(raw_dir / "Fire_Stations_E_Pairwis_Clip.shp", mercator=True)
    hosp = read_points(raw_dir / "Hospitals_Medic_Pairwis_Clip.shp", mercator=True)
    prem["fk"] = cKDTree(xy(fire)).query(xy(cust_xy))[0] / 1000
    prem["hk"] = cKDTree(xy(hosp)).query(xy(cust_xy))[0] / 1000

    # ---- demo premise sample (life-support and no-device premises over-sampled on purpose)
    prem = prem[prem.circuit_id.isin(cidx) & (prem.cell >= 0)]
    ls = prem[prem.critical_c.fillna("").str.startswith("LS")]
    ls_s = ls.sample(min(C.N_DEMO_LIFE_SUPPORT, len(ls)), random_state=1)
    rest = prem.drop(ls_s.index)
    nd_s = rest[rest.n_dev == 0].sample(C.N_DEMO_NO_DEVICE, random_state=2)
    rnd = rest.drop(nd_s.index).sample(C.N_DEMO_PREMISES - len(ls_s) - len(nd_s), random_state=3)
    S = pd.concat([ls_s, nd_s, rnd]).sample(frac=1, random_state=4).reset_index(drop=True)
    S = S[S.cell >= 0]
    out_prem = []
    for i, r in S.iterrows():
        c = cells.loc[int(r.cell)]
        out_prem.append({
            "id": f"P-{i + 1:04d}", "c": int(cidx[r.circuit_id]), "nd": int(r.n_dev), "ch": r.chain,
            "z": int(r.zone), "ls": int(str(r.critical_c).startswith("LS")), "st": int(bool(r.step)),
            "fk": round(float(r.fk), 1), "hk": round(float(r.hk), 1),
            "p": [round(float((c.cx + .5) * C.CELL_LON), 5), round(float((c.cy + .5) * C.CELL_LAT), 5)],
            "f": [round(float(c[kk]), 4) for kk in KEYS], "cn": int(c.n)})

    # ---- circuits
    arc["circuit"] = arc.cell.map(lambda x: cells.circuit.get(x) if x >= 0 else None)
    obs = arc.groupby(["circuit", "event"]).size().unstack(fill_value=0)
    circs = []
    for c in order:
        row = circ[circ.circuit == c].iloc[0]
        o = obs.loc[c] if c in obs.index else {}
        circs.append({"n": int(row.n), "feb": int(o.get("Feb2025", 0)), "sep": int(o.get("Sep2024", 0)),
                      "oth": int(o.get("Other", 0)), "f": [round(float(row[kk]), 4) for kk in KEYS]})

    # ---- map layers
    dmg_all = arc.groupby("cell").size()
    cell_rows = [[round(float(r.lon0), 5), round(float(r.lat0), 5), int(r.n), int(dmg_all.get(i, 0)), int(r.ci)]
                 for i, r in cells.iterrows()]
    evc = {"Feb2025": 0, "Sep2024": 1, "Other": 2}
    dm = [[round(float(r.Longitude), 4), round(float(r.Latitude), 4), evc[r.event]] for r in arc.itertuples()]
    dev = []
    for nm, t in [("Recloser_Bank_Clip", 0), ("Switch_Clip", 1)]:
        pts = read_points(raw_dir / f"{nm}.shp")
        dev += [[round(float(x), 4), round(float(y), 4), t] for x, y in pts if x == x]

    pc = read_dbf(raw_dir / "Primary_ExportFeatures.dbf", ["circuit_id"]).circuit_id
    lines = defaultdict(list)
    for i, parts in read_polylines(raw_dir / "Primary_ExportFeatures.shp"):
        ci = cidx.get(pc.iloc[i])
        if ci is None:
            continue
        for seg in parts:
            keep = [seg[0]]
            for q in seg[1:-1]:
                if np.hypot((q[0] - keep[-1][0]) * k * c0, (q[1] - keep[-1][1]) * k) > 40:
                    keep.append(q)
            keep.append(seg[-1])
            lines[ci].append([round(float(v), 4) for q in keep for v in q])
    L = [lines.get(i, []) for i in range(len(order))]
    for i, c in enumerate(circs):
        pts = np.array([(x[j], x[j + 1]) for x in L[i] for j in range(0, len(x), 2)]) if L[i] else np.array([[-80., 37.2], [-79.9, 37.3]])
        c["b"] = [round(float(pts[:, 0].min()), 4), round(float(pts[:, 1].min()), 4),
                  round(float(pts[:, 0].max()), 4), round(float(pts[:, 1].max()), 4)]

    data = {"circ": circs, "prem": out_prem, "cells": cell_rows, "lines": L, "dmg": dm, "dev": dev,
            "cell_size": [C.CELL_LON, C.CELL_LAT], "feature_keys": KEYS}
    C.SITE.mkdir(parents=True, exist_ok=True)
    s = json.dumps(data, separators=(",", ":"))
    (C.SITE / "data.json").write_text(s)
    print(f"data.json {len(s) / 1e6:.2f} MB; premises {len(out_prem)}, circuits {len(circs)}, cells {len(cell_rows)}")


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else C.RAW_DIR)
