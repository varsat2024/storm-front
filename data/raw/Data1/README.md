# Data1 — GIS extract (distribution context)

Organized by challenge data category (see [`../../inventory/DATA_DICTIONARY.md`](../../inventory/DATA_DICTIONARY.md)).

| Folder | Shapefile | Challenge role | Features |
| --- | --- | --- | --- |
| `arcos_damage/` | `arcos_prod_damage_09_28_Clip` | ARCOS damage assessments (§4.1) | 1,659 points |
| `circuit_gis/customers/` | `Customer_Clip` | Anonymized premises / service locations | 117,642 points |
| `circuit_gis/poles/` | `Pole_Clip` | Distribution poles | 107,013 points |
| `circuit_gis/primary/` | `Primary_ExportFeatures` | Primary conductors | 62,788 lines |
| `circuit_gis/fuse_banks/` | `Fuse_Bank_Clip` | Protective devices (fuses) | 7,616 points |
| `priority_locations/ambulance/` | `Ambulance_Servi_Pairwis_Clip` | Critical-load scenario (§4.5) | 10 points |
| `priority_locations/fire_stations/` | `Fire_Stations_E_Pairwis_Clip` | Critical-load scenario | 37 points |
| `priority_locations/hospitals/` | `Hospitals_Medic_Pairwis_Clip` | Critical-load scenario | 5 points |

Each layer directory contains the full shapefile bundle (`.shp`, `.shx`, `.dbf`, `.prj`, index files, and optional `.shp.xml` metadata).

**Related (outside Data1):** upstream topology in [`../matched_upstream/matched_upstream.txt`](../matched_upstream/matched_upstream.txt); labor references in [`../../Install_Labor_HackOHIO.xlsx`](../../Install_Labor_HackOHIO.xlsx); secondary network layers in [`../Data2/`](../Data2/).
