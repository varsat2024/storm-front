"""Dependency-free shapefile (.shp) and dBase (.dbf) readers (numpy/pandas only)."""
import struct
from pathlib import Path

import numpy as np
import pandas as pd


def read_dbf(path, columns=None, encoding="latin-1"):
    """Read a .dbf attribute table into a DataFrame, row-aligned with the .shp records."""
    path = Path(path)
    with open(path, "rb") as f:
        head = f.read(32)
        n, header_len, rec_len = struct.unpack("<IHH", head[4:12])
        fields = []
        while True:
            d = f.read(32)
            if d[0] == 0x0D:
                break
            fields.append((d[:11].split(b"\x00")[0].decode(), chr(d[11]), d[16]))
        f.seek(header_len)
        raw = np.frombuffer(f.read(rec_len * n), dtype=np.uint8).reshape(n, rec_len)
    out, off = {}, 1
    for name, ftype, ln in fields:
        if columns is None or name in columns:
            col = np.ascontiguousarray(raw[:, off:off + ln]).view(f"S{ln}").ravel()
            s = pd.Series(np.char.decode(col, encoding)).str.strip()
            s = s.replace("", np.nan)
            if ftype in "NF":
                s = pd.to_numeric(s, errors="coerce")
            elif ftype == "D":
                s = pd.to_datetime(s, format="%Y%m%d", errors="coerce")
            out[name] = s
        off += ln
    return pd.DataFrame(out)


def _records(path):
    b = Path(path).read_bytes()
    shape_type = struct.unpack("<i", b[32:36])[0]
    pos = 100
    while pos + 8 <= len(b):
        _, clen = struct.unpack(">ii", b[pos:pos + 8])
        yield shape_type, b[pos + 8:pos + 8 + clen * 2]
        pos += 8 + clen * 2


def web_mercator_to_lonlat(a):
    lon = a[:, 0] / 6378137.0 * 180.0 / np.pi
    lat = (2 * np.arctan(np.exp(a[:, 1] / 6378137.0)) - np.pi / 2) * 180.0 / np.pi
    return np.c_[lon, lat]


def read_points(path, mercator=False):
    """Return an (n, 2) array of x, y (NaN for null shapes)."""
    pts = []
    for _, body in _records(path):
        t = struct.unpack("<i", body[:4])[0]
        pts.append(struct.unpack("<2d", body[4:20]) if t else (np.nan, np.nan))
    a = np.array(pts, dtype=float)
    return web_mercator_to_lonlat(a) if mercator else a


def read_polylines(path):
    """Yield (record_index, parts) where parts is a list of (k, 2) arrays."""
    for i, (_, body) in enumerate(_records(path)):
        if struct.unpack("<i", body[:4])[0] == 0:
            continue
        nparts, npts = struct.unpack("<2i", body[36:44])
        starts = list(struct.unpack(f"<{nparts}i", body[44:44 + 4 * nparts]))
        off = 44 + 4 * nparts
        xy = np.frombuffer(body[off:off + 16 * npts], dtype="<f8").reshape(npts, 2)
        ends = starts[1:] + [npts]
        yield i, [xy[s:e] for s, e in zip(starts, ends) if e - s >= 2]
