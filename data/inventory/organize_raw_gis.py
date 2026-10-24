"""Move flat Data1/Data2 shapefile bundles into challenge-aligned subfolders."""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "raw"

DATA1: dict[str, str] = {
    "arcos_prod_damage_09_28_Clip": "arcos_damage",
    "Customer_Clip": "circuit_gis/customers",
    "Pole_Clip": "circuit_gis/poles",
    "Primary_ExportFeatures": "circuit_gis/primary",
    "Fuse_Bank_Clip": "circuit_gis/fuse_banks",
    "Ambulance_Servi_Pairwis_Clip": "priority_locations/ambulance",
    "Fire_Stations_E_Pairwis_Clip": "priority_locations/fire_stations",
    "Hospitals_Medic_Pairwis_Clip": "priority_locations/hospitals",
}

DATA2: dict[str, str] = {
    "Secondary_ExportFeatures": "circuit_gis/secondary",
    "Transformer_Clip": "circuit_gis/transformers",
    "Switch_Clip": "circuit_gis/switches",
    "Recloser_Bank_Clip": "circuit_gis/reclosers",
}


def _move_bundle(data_dir: Path, base_name: str, rel_dir: str) -> None:
    dest_dir = data_dir / rel_dir
    dest_dir.mkdir(parents=True, exist_ok=True)
    for path in data_dir.iterdir():
        if not path.is_file():
            continue
        name = path.name
        if name == f"{base_name}.shp.xml" or name.startswith(f"{base_name}."):
            shutil.move(str(path), str(dest_dir / name))


def organize(data_dir: Path, mapping: dict[str, str]) -> None:
    for base_name, rel_dir in mapping.items():
        _move_bundle(data_dir, base_name, rel_dir)


def main() -> None:
    organize(ROOT / "Data1", DATA1)
    organize(ROOT / "Data2", DATA2)
    print("Organized GIS layers under raw/Data1 and raw/Data2")


if __name__ == "__main__":
    main()
