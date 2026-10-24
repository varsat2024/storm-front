# AEP HackOHI/O 2026 — data inventory & dictionary

Phase 1 deliverable aligned with [`docs/AEP_Challenge_Track_Explanation.md`](../../docs/AEP_Challenge_Track_Explanation.md) §4–§5.

Machine-readable layer stats: [`Data1_inventory.json`](Data1_inventory.json), [`Data2_inventory.json`](Data2_inventory.json). Labor workbook preview: [`labor_workbook_preview.json`](labor_workbook_preview.json).

## Challenge dataset map

| Challenge dataset (§4) | Location | Format |
| --- | --- | --- |
| ARCOS damage assessments | `raw/Data1/arcos_damage/` | Shapefile |
| Circuit GIS — primary & premises | `raw/Data1/circuit_gis/` | Shapefile |
| Circuit GIS — secondary & devices | `raw/Data2/circuit_gis/` | Shapefile |
| Upline flow / topology | `raw/matched_upstream/matched_upstream.txt` | Tab-separated |
| STORMS labor & indirect time | `Install_Labor_HackOHIO.xlsx` | Excel |
| Priority / critical-load indicators | `raw/Data1/priority_locations/` | Shapefile |
| Structure diagrams | `docs/structure_drawings.pdf` | PDF (reference) |

## Identifier & join notes

Document explicitly supplied relationships separately from inferred spatial joins (§4.3, §5).

| Layer | Suggested keys | Notes |
| --- | --- | --- |
| `Customer_Clip` | `premise_nu`, `circuit_id`, `aep_xfmr_l`, `id` | Primary premise table for anonymized location selection |
| `Primary_ExportFeatures` / `Secondary_ExportFeatures` | `id`, `circuit_id`, `global_id` | Line geometry; `NEAR_FID` on damage points references primary `FID` |
| `Transformer_Clip` | `id`, `global_id`, `eo_source_*`, `circuit_id` | Matches `eo_power_xfrmr_inst*` tokens in topology file |
| `Fuse_Bank_Clip`, `Switch_Clip`, `Recloser_Bank_Clip` | `id`, `global_id`, `device_typ` | Align with `eo_isolating_eqpt_inst*` in topology |
| `matched_upstream.txt` | Column 1: premise-style ID; columns 2+: `eo_*` equipment chain | Tab-separated; upstream order toward `eo_circuit*` |
| `arcos_prod_damage_09_28_Clip` | `Circuit`, `Asset_Type`, `Status`, `Report_Tim` | Sensitive fields nulled in source metadata; includes `NEAR_DIST` to primary |

Coordinate reference: layers use WGS 84 (EPSG:4326) per `.prj` / ArcGIS metadata.

## Layer summaries

### Data1 — `arcos_damage/arcos_prod_damage_09_28_Clip`

- **Geometry:** POINTZ (1,659)
- **Use:** Historical damage, restoration modeling, spatial features (§4.1)
- **Notable fields:** `Asset_Type`, `Status`, `Repaired*`, `Circuit`, `Substation`, `Report_Tim`, `Access_Iss`, `NEAR_FID`, `NEAR_DIST`

### Data1 — `circuit_gis/customers/Customer_Clip`

- **Geometry:** POINTZ (117,642)
- **Use:** Anonymized premise selection, circuit association
- **Notable fields:** `premise_nu`, `circuit_id`, `critical_c`, `special_op`, `aep_xfmr_l`, `address` (treat as sensitive in UI)

### Data1 — `circuit_gis/primary/Primary_ExportFeatures`

- **Geometry:** POLYLINE (62,788)
- **Notable fields:** `circuit_id`, `aep_circui`, `aep_statio`, `nominal_vo`, `Shape_Leng`

### Data1 — `circuit_gis/poles/Pole_Clip`

- **Geometry:** POINTZ (107,013)

### Data1 — `circuit_gis/fuse_banks/Fuse_Bank_Clip`

- **Geometry:** POINTZ (7,616)
- **Notable fields:** `device_typ`, `circuit_id`, `global_id`

### Data1 — `priority_locations/*`

Public facility points for abstract critical-load demos (§4.5). **Do not** expose precise coordinates or identities in customer-facing output. Layers: ambulance (10), fire stations (37), hospitals (5).

### Data2 — `circuit_gis/secondary/Secondary_ExportFeatures`

- **Geometry:** POLYLINE (127,403)

### Data2 — `circuit_gis/transformers/Transformer_Clip`

- **Geometry:** POINTZ (26,959)

### Data2 — `circuit_gis/switches/Switch_Clip`

- **Geometry:** POINTZ (900)

### Data2 — `circuit_gis/reclosers/Recloser_Bank_Clip`

- **Geometry:** POINTZ (331)

## Topology file — `raw/matched_upstream/matched_upstream.txt`

- **Rows:** ~117,600
- **Format:** Tab-separated; first field premise/customer identifier; subsequent fields encode upstream equipment instances (`eo_power_xfrmr_inst*`, `eo_isolating_eqpt_inst*`, `eo_circuit*`, etc.)
- **Use:** Graph construction, upstream tracing, restoration sequencing (§4.3)

## Labor workbook — `Install_Labor_HackOHIO.xlsx`

| Sheet | Purpose |
| --- | --- |
| `CNC` | Connector construction units — install/remove hours by `CD_CU` |
| `Labor time material related` | Aggregated CU category averages |
| `Labor only work` | Anonymized adders (access, excavation, etc.) |
| `Indirect Labor Multiplier` | ILM = **4.5** (multiply direct hours per challenge formula §3.2) |
| `CU Group descriptions` | Anonymous descriptions for damage/material categories |

## Regenerating inventory

From repo root (requires `pyshp`, `openpyxl`):

```bash
python data/inventory/generate_inventory.py
```
