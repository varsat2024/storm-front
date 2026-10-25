"""Same outage / severity / restoration math as frontend/app.js (visualizer)."""
from __future__ import annotations

import math
from typing import Any

Z80 = 1.2816
TYPICAL_ZONE = 51


def _p_nb(mu: float, alpha: float) -> float:
    if alpha < 1e-8:
        return 1.0 - math.exp(-mu)
    return 1.0 - (1.0 + alpha * mu) ** (-1.0 / alpha)


def _band_of(p: float, cuts: list[float], names: list[str]) -> str:
    if p < cuts[0]:
        return names[0]
    if p < cuts[1]:
        return names[1]
    if p < cuts[2]:
        return names[2]
    return names[3]


def band_of_probability(p: float, model: dict) -> str:
    """Risk band for a probability using the cutoffs in model.json (the single source of truth for every caller)."""
    return _band_of(p, model["bands"]["cuts"], model["bands"]["names"])


def _pc(p: float) -> str:
    if p < 0.001:
        return "<0.1%"
    if p < 0.1:
        return f"{p * 100:.1f}%"
    return f"{round(p * 100)}%"


def _sev_name(s: float) -> str:
    if s < 0.05:
        return "Calm"
    if s < 0.25:
        return "Minor"
    if s < 0.6:
        return "Moderate"
    if s < 1.2:
        return "Severe"
    return "Extreme"


def _hrs(h: float) -> str:
    if h <= 0:
        return "0 h"
    if h < 36:
        return f"{max(1, round(h))} h"
    return f"{round(h / 12) / 2} days"


def _range_txt(lo: float, hi: float) -> str:
    if hi <= 0:
        return "0 hours"

    def unit(h: float) -> tuple[float, str]:
        if h < 36:
            return max(1, round(h)), "h"
        return round(h / 12) / 2, "days"

    a, au = unit(lo)
    b, bu = unit(hi)
    if au == bu:
        return f"{a}–{b} {'hours' if au == 'h' else 'days'}"
    return f"{a} hours–{b} days"


def resolve_premise_index(
    data: dict,
    *,
    premise_id: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
) -> int:
    prem = data["prem"]
    if premise_id:
        key = premise_id.strip().upper()
        for i, p in enumerate(prem):
            if p["id"].upper() == key:
                return i
        raise ValueError(f"Unknown premise id {premise_id!r}. Use an anonymized id like P-0001.")
    if latitude is None or longitude is None:
        raise ValueError("Provide premise_id or both latitude and longitude.")
    best_i, best_d = 0, float("inf")
    for i, p in enumerate(prem):
        lon, lat = p["p"]
        d = (lon - longitude) ** 2 + (lat - latitude) ** 2
        if d < best_d:
            best_d, best_i = d, i
    return best_i


def _cell_eta(f_vals: list[float], model: dict) -> dict[str, Any]:
    o = model["outage"]
    fe = o["features"]
    beta = [t["beta"] for t in o["terms"]]
    idx = [0] + [2 + i for i in range(len(fe))]
    z_clip = o["z_clip"]
    cov = o["cov"]
    z = [
        max(-z_clip, min(z_clip, (f_vals[i] - fe[i]["mean"]) / fe[i]["sd"]))
        for i in range(len(fe))
    ]
    x = [1.0] + z
    contrib = [beta[2 + i] * z[i] for i in range(len(z))]
    eta = beta[0] + sum(contrib)
    v = 0.0
    for a in range(len(x)):
        for b in range(len(x)):
            v += x[a] * x[b] * cov[idx[a]][idx[b]]
    return {"z": z, "eta": eta, "v": v, "contrib": contrib, "beta": beta}


def _sev_calc(storm: dict, model: dict) -> dict[str, Any]:
    sv = model["severity"]
    t = sv["terms"]
    d = [
        math.log(max(storm["gust"], 5) / t[0]["ref"]),
        storm["rain"] - t[1]["ref"],
        storm["snow"] - t[2]["ref"],
        storm["ante"] - t[3]["ref"],
        storm["leaf"] - t[4]["ref"],
    ]
    ls = sum(sv["coef"][i] * d[i] for i in range(len(d)))
    zr = sv["zero_rule"]
    zero = (
        storm["gust"] <= zr["gust_max"]
        and storm["rain"] <= zr["rain_max"]
        and storm["snow"] <= zr["snow_max"]
    )
    v = 0.0
    for i in range(len(d)):
        for j in range(len(d)):
            v += d[i] * d[j] * sv["cov"][i][j]
    s = 0.0 if zero else math.exp(ls)
    return {"d": d, "ls": ls, "S": s, "v": v, "zero": zero}


def _risk(prem: dict, storm: dict, model: dict, data: dict) -> dict[str, Any]:
    o = model["outage"]
    c = data["circ"][prem["c"]]
    ce = _cell_eta(prem["f"], model)
    sv = _sev_calc(storm, model)
    zone = max(1, min(prem["z"], c["n"]) if prem["nd"] else c["n"])
    mu = zone * math.exp(ce["eta"] + sv["ls"])
    alpha = o["alpha"]
    p_out = _p_nb(mu, alpha)
    sd = math.sqrt(ce["v"] + sv["v"])
    p_lo = _p_nb(mu * math.exp(-Z80 * sd), alpha)
    p_hi = _p_nb(mu * math.exp(Z80 * sd), alpha)
    ratio = math.exp(2 * Z80 * sd)
    return {
        "circuit_index": prem["c"],
        "circuit_customers": c["n"],
        "ce": ce,
        "sv": sv,
        "zone": zone,
        "mu": mu,
        "P": p_out,
        "sd": sd,
        "Plo": p_lo,
        "Phi": p_hi,
        "ratio": ratio,
    }


def _confidence(x: dict, model: dict) -> str:
    ratio = x["ratio"]
    k = 2 if ratio < 2 else 1 if ratio < 4 else 0
    if model["severity"]["source"] == "prior":
        k = max(0, k - 1)
    return ["Low", "Medium", "High"][k]


def _restoration(storm: dict, scenario: dict, model: dict, data: dict, prem: dict) -> dict[str, Any]:
    r = model["restoration"]
    l = model["labor"]
    sv = _sev_calc(storm, model)
    direct = sum(scenario.get(f"n_{k}", 0) * l["items"][k]["hours"] for k in l["items"])
    mult = scenario.get("mu", l["indirect_multiplier"])
    tot = direct * mult
    cr = max(1, scenario.get("cr", 3))
    blocked = bool(scenario.get("access_blocked", False))
    asset = scenario.get("asset_group", "Pole")
    gi = r["groups"].index(asset) if asset in r["groups"] else -1
    mu_aft = r["terms"][0]["beta"] + (r["terms"][1 + gi]["beta"] if gi >= 0 else 0)
    ss = r["severity_scaling"]
    s = sv["S"]
    sev_mult = math.pow(s, ss["beta"]) if s > 0 else 0.0
    extrap = s > ss["s_max"] or (0 < s < ss["s_min"])

    def q(z: float) -> float:
        return math.exp(mu_aft + r["sigma"] * z) * 24 * sev_mult

    b_lo = tot / (cr + 1) * sev_mult
    b_hi = tot / max(1, cr - 1) * sev_mult
    if blocked and tot > 0 and sev_mult > 0:
        b_lo += 2
        b_hi += 8
    hist = {"p10": q(-Z80), "p50": q(0), "p90": q(Z80)}
    early = scenario.get("damage_location", "branch") == "other" and prem["nd"] > 0
    if early:
        lo, hi = hist["p10"], hist["p50"]
    else:
        lo = max(hist["p10"], b_lo)
        hi = max(hist["p90"], b_hi)
    never_pct = 100 * r["n_never_closed_excluded"] / (r["n"] + r["n_never_closed_excluded"])
    return {
        "S": s,
        "sevMult": sev_mult,
        "extrap": extrap,
        "direct": direct,
        "tot": tot,
        "cr": cr,
        "blocked": blocked,
        "bLo": b_lo,
        "bHi": b_hi,
        "hist": hist,
        "early": early,
        "lo": lo,
        "hi": hi,
        "hasDamage": tot > 0,
        "neverPct": never_pct,
        "range": _range_txt(lo, hi),
    }


def top_factors(x: dict, model: dict, n: int = 3) -> list[dict[str, Any]]:
    """The cell features that move this location's expected damage most versus a typical cell (from the fitted GLM)."""
    fe = model["outage"]["features"]
    contrib = x["ce"]["contrib"]
    order = sorted(range(len(contrib)), key=lambda i: abs(contrib[i]), reverse=True)[:n]
    out = []
    for i in order:
        c = contrib[i]
        if abs(c) < 0.02:      # under ~2%: not worth telling the customer
            continue
        out.append({
            "factor": fe[i]["label"],
            "direction": "raises" if c > 0 else "lowers",
            "effect_pct": round((math.exp(c) - 1) * 100),
        })
    return out


def explanation(x: dict, model: dict) -> dict[str, Any]:
    """Plain-language grounding for the assistant: main factors, what is assumed rather than learned, and limits."""
    assumed = [
        f"{r['item']}: {r['how']}"
        for r in model.get("provenance", [])
        if r.get("status") in ("prior", "assumption")
    ]
    return {
        "top_factors": top_factors(x, model),
        "assumptions": assumed,
        "limitations": [
            "This is a model estimate, not confirmed utility information.",
            "Restoration ranges are wide because past repairs varied a lot; they are not a promise.",
            "Conditions that would change the answer: actual storm track and strength, where damage really occurs, crew availability and road access.",
        ],
    }


def default_storm() -> dict[str, float | int]:
    return {"gust": 55.0, "rain": 2.0, "snow": 0.0, "ante": 2.5, "leaf": 0}


def default_scenario(model: dict) -> dict[str, Any]:
    return {
        "n_pole": 1,
        "n_arm": 1,
        "n_xf": 0,
        "n_ins": 3,
        "n_wire": 2,
        "n_rec": 0,
        "asset_group": "Pole",
        "damage_location": "branch",
        "cr": 3,
        "mu": model["labor"]["indirect_multiplier"],
        "access_blocked": False,
    }


def compute_status(
    model: dict,
    data: dict,
    premise_index: int,
    storm: dict | None = None,
    scenario: dict | None = None,
) -> dict[str, Any]:
    storm = {**default_storm(), **(storm or {})}
    storm["leaf"] = 1 if storm.get("leaf") else 0
    scenario = {**default_scenario(model), **(scenario or {})}
    prem = data["prem"][premise_index]
    x = _risk(prem, storm, model, data)
    band = _band_of(x["P"], model["bands"]["cuts"], model["bands"]["names"])
    conf = _confidence(x, model)
    rs = _restoration(storm, scenario, model, data, prem)
    long_est = rs["hi"] >= 24
    pre_alert = band != "Low" or prem["ls"]
    esc = prem["ls"] or long_est or band == "Imminent"
    return {
        "premise_id": prem["id"],
        "circuit_label": f"C-{prem['c'] + 1}",
        "customers_in_cell": prem["cn"],
        "approx_location": {"longitude": prem["p"][0], "latitude": prem["p"][1]},
        "life_support_declared": bool(prem["ls"]),
        "storm": {
            "gust_mph": storm["gust"],
            "rain_24h_in": storm["rain"],
            "snow_24h_in": storm["snow"],
            "rain_prior_3d_in": storm["ante"],
            "trees_in_leaf": bool(storm["leaf"]),
            "severity_multiplier": x["sv"]["S"],
            "severity_label": _sev_name(x["sv"]["S"]),
        },
        "outage_risk": {
            "band": band,
            "probability": x["P"],
            "probability_display": _pc(x["P"]),
            "interval_80pct": {"low": x["Plo"], "high": x["Phi"], "display": f"{_pc(x['Plo'])}–{_pc(x['Phi'])}"},
            "confidence": conf,
            "protection_zone_customers": x["zone"],
        },
        "restoration": {
            "estimate_range": rs["range"],
            "estimate_hours": {"low": rs["lo"], "high": rs["hi"]},
            "typical_median_hours": rs["hist"]["p50"],
            "early_isolation_step": rs["early"],
            "scenario_has_damage": rs["hasDamage"],
        },
        "alerts": {
            "pre_storm_eligible": bool(pre_alert),
            "human_escalation": bool(esc),
            "escalation_reasons": [
                r
                for r, ok in [
                    ("life_support", prem["ls"]),
                    ("estimate_over_24h", long_est),
                    ("imminent_risk", band == "Imminent"),
                ]
                if ok
            ],
        },
        "explanation": explanation(x, model),
        "reliability": {
            "severity_weights": model["severity"]["source"],
            "confidence": conf,
            "caveat": (
                "Storm-severity weights are engineering assumptions, not learned from outage data, so treat the "
                "storm-dependent numbers as scenario estimates."
                if model["severity"]["source"] == "prior" else
                "Storm-severity weights were fitted to outage data."
            ),
        },
        "model_generated": model.get("generated"),
        "severity_weights_source": model["severity"]["source"],
    }


def format_status_for_llm(status: dict) -> str:
    o = status["outage_risk"]
    st = status["storm"]
    al = status["alerts"]
    return (
        "Visualizer model snapshot (not a confirmed utility outage report):\n"
        f"- Premise: {status['premise_id']} on circuit {status['circuit_label']} "
        f"(≈400 m cell, {status['customers_in_cell']} customers in cell)\n"
        f"- Outage risk: {o['band']} ({o['probability_display']} chance, confidence {o['confidence']}, "
        f"80% interval {o['interval_80pct']['display']})\n"
        f"- Storm severity: {st['severity_label']} ({st['severity_multiplier']:.2f}× Feb 2025 reference)\n"
        f"- Restoration estimate (model): {status['restoration']['estimate_range']} after crews can safely start\n"
        f"- Pre-storm alerts eligible: {'yes' if al['pre_storm_eligible'] else 'no'}; "
        f"human escalation: {'yes' if al['human_escalation'] else 'no'}\n"
        f"- Life-support flag on account: {'yes' if status['life_support_declared'] else 'no'}\n"
        + _explanation_lines(status)
    )


def _explanation_lines(status: dict) -> str:
    ex = status.get("explanation") or {}
    rel = status.get("reliability") or {}
    lines = []
    factors = ex.get("top_factors") or []
    if factors:
        lines.append("- Main factors for this location: " + "; ".join(
            f"{f['factor']} {f['direction']} expected damage by about {abs(f['effect_pct'])}% versus a typical cell" for f in factors))
    if ex.get("assumptions"):
        lines.append("- Assumptions (not learned from data; say so when relevant): " + " | ".join(ex["assumptions"]))
    if rel:
        lines.append(f"- Reliability: severity weights are '{rel.get('severity_weights')}'. {rel.get('caveat', '')}")
    if ex.get("limitations"):
        lines.append("- Limits: " + " ".join(ex["limitations"]))
    return "\n".join(lines)
