"""Merge trained artifacts into artifacts/model.json, the single file the frontend reads."""
import datetime
import json
import sys

import numpy as np

import config as C
import labor


def main(labor_xlsx):
    A = C.ARTIFACTS
    outage = json.loads((A / "outage.json").read_text())
    resto = json.loads((A / "restoration.json").read_text())
    sev = json.loads((A / "severity.json").read_text())
    build = json.loads((C.PROCESSED / "build_report.json").read_text())

    sep_ratio = float(np.exp(next(t["beta"] for t in outage["terms"] if t["name"] == "event_Sep2024")))
    diag = {"observed_sep_over_feb_damage_ratio": sep_ratio,
            "severity_implied_sep_over_feb": sev["illustrative_sep"]["implied_ratio_vs_feb"]}
    diag["severity_agrees_with_events"] = bool(
        1 / 1.5 <= diag["severity_implied_sep_over_feb"] / sep_ratio <= 1.5)

    cv = outage["cv"]["models"]["nbglm"]
    prov = [
        {"item": "Damage rate by cell features (7 features)", "status": "learned",
         "how": f"Negative binomial GLM, ridge l2={outage['l2']}, grouped CV skill {cv['deviance_skill']:.2f}, "
                f"AUC {cv['auc_any_damage']:.2f}"},
        {"item": "Event level (Feb 2025 vs Sep 2024)", "status": "learned",
         "how": f"Event fixed effect: Sep 2024 damage rate is {sep_ratio:.2f}x Feb 2025"},
        {"item": "Weather → severity multiplier", "status": sev["source"],
         "how": "Daily NB model on weather" if sev["source"] == "learned" else sev["reason"]},
        {"item": "Zone exposure: expected damage = customers on nearest fuse/recloser × cell rate",
         "status": "assumption", "how": "Any damage inside a protection zone interrupts all customers behind it"},
        {"item": "P(outage) = 1 − (1 + αμ)^(−1/α)", "status": "standard",
         "how": "Negative binomial probability of at least one event, α from the fit"},
        {"item": "Uncertainty band", "status": "learned",
         "how": "80% interval from the coefficient covariance (and severity covariance) of the linear predictor"},
        {"item": "Risk band cutoffs (15 / 40 / 65%)", "status": "rule", "how": "Policy choice, not learned"},
        {"item": "Confidence label", "status": "rule", "how": "From the width of the 80% interval and the severity source"},
        {"item": "Restoration: wait for crews (by damage type)", "status": "learned",
         "how": f"Interval-censored log-normal AFT, design '{resto['selected_design']}' chosen by leave-one-day-out CV"},
        {"item": "Zero storm severity", "status": "rule",
         "how": "Gust ≤ 15 mph with no rain or snow gives severity 0 and therefore a 0-hour restoration time (nothing to repair)"},
        {"item": "Restoration: wait scaled by current storm severity", "status": "learned",
         "how": f"Wait × S^{resto['severity_scaling']['beta']:.2f} (SE {resto['severity_scaling']['se']:.2f}); "
                f"cross-validation did not select it, so treat as a weak effect"},
        {"item": "Restoration: blocked-access allowance (+2–8 h)", "status": "assumption",
         "how": "The data showed no reliable access effect; this is an operator scenario assumption"},
        {"item": "Restoration: crew work time", "status": "reference data",
         "how": "Workbook hours × indirect multiplier ÷ crew (±1); wire spans use a placeholder"},
        {"item": "Alert rules and escalation triggers", "status": "rule", "how": "Challenge assumptions, not documented utility policy"},
    ]
    model = {
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "data": build, "outage": outage, "severity": sev, "restoration": resto,
        "labor": labor.load(labor_xlsx), "bands": {"cuts": C.BAND_CUTS, "names": C.BAND_NAMES},
        "workload": build["workload"], "diagnostics": diag, "provenance": prov,
    }
    (A / "model.json").write_text(json.dumps(model, separators=(",", ":")))
    print("wrote model.json", round((A / "model.json").stat().st_size / 1024, 1), "KB;", diag)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else C.RAW_DIR / "Install_Labor_HackOHIO.xlsx")
