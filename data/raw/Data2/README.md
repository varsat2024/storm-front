# Data2 — GIS extract (secondary network & devices)

Organized under `circuit_gis/` per challenge §4.2. See [`../../inventory/DATA_DICTIONARY.md`](../../inventory/DATA_DICTIONARY.md).

| Folder | Shapefile | Role | Features |
| --- | --- | --- | --- |
| `circuit_gis/secondary/` | `Secondary_ExportFeatures` | Secondary conductors | 127,403 lines |
| `circuit_gis/transformers/` | `Transformer_Clip` | Distribution transformers | 26,959 points |
| `circuit_gis/switches/` | `Switch_Clip` | Switches | 900 points |
| `circuit_gis/reclosers/` | `Recloser_Bank_Clip` | Recloser banks | 331 points |

Pair with Data1 primary/customer layers and `matched_upstream.txt` for documented upstream paths—not spatial proximity alone (§4.3).
