# Challenge data

Datasets for the AEP HackOHI/O 2026 AI Outage Concierge challenge. Full inventory: [`inventory/DATA_DICTIONARY.md`](inventory/DATA_DICTIONARY.md).

## Layout

| Path | Contents |
| --- | --- |
| `raw/Data1.zip` | Archive of Data1 shapefiles (18.3 MiB) |
| `raw/Data1/` | **Organized** GIS: ARCOS damage, circuit GIS (customers, primary, poles, fuses), priority locations |
| `raw/Data2.zip` | Archive of Data2 shapefiles (12.1 MiB) |
| `raw/Data2/` | **Organized** GIS: secondary lines, transformers, switches, reclosers |
| `raw/matched_upstream/` | `matched_upstream.txt` — upstream topology (§4.3) |
| `Install_Labor_HackOHIO.xlsx` | STORMS labor hours & indirect multiplier (§4.4) |
| `inventory/` | JSON schemas, data dictionary, `generate_inventory.py` |

See [`raw/Data1/README.md`](raw/Data1/README.md) and [`raw/Data2/README.md`](raw/Data2/README.md) for layer tables.

## Extract from zip (optional)

If you only have the zips, extract into the same folder structure (flat filenames). Then run the organizer to match the repo layout:

```powershell
Expand-Archive -Path data/raw/Data1.zip -DestinationPath data/raw/Data1 -Force
Expand-Archive -Path data/raw/Data2.zip -DestinationPath data/raw/Data2 -Force
python data/inventory/organize_raw_gis.py
```

Legacy `data/extracted/` paths from earlier docs are equivalent to `raw/Data1` and `raw/Data2` once organized; extracted copies remain gitignored.

## Processing notes

- Keep each shapefile’s companion files together in its layer directory.
- Use `matched_upstream.txt` for electrical connectivity; do not infer topology from distance alone.
- Regenerate JSON inventories: `python data/inventory/generate_inventory.py` (needs `pyshp`, `openpyxl`).

Challenge brief: [`../docs/AEP_Challenge_Track_Explanation.md`](../docs/AEP_Challenge_Track_Explanation.md).
