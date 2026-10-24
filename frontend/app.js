"use strict";
// All numbers below come from MODEL (artifacts/model.json, written by the Python pipeline) and
// DATA (site/data.json). Nothing about risk is hard-coded here except display text and the
// alert/safety rules, which are labeled as rules.
const M = MODEL, D = DATA, O = M.outage, SV = M.severity, R = M.restoration, L = M.labor, B = M.bands;
const $ = id => document.getElementById(id);
const num = id => Math.max(0, parseFloat($(id).value) || 0);
const COL = {Low: "#2e7d32", Moderate: "#c26a00", High: "#d9451f", Imminent: "#b0001a"};
const Z80 = 1.2816, TYPICAL_ZONE = 51;
const NT = O.term_names, FE = O.features, NF = FE.length;
const IDX = [0].concat(FE.map((_, i) => 2 + i));
const BETA = O.terms.map(t => t.beta);
const f2 = (x, d = 2) => Number(x).toFixed(d), sg = (x, d = 2) => (x >= 0 ? "+" : "") + Number(x).toFixed(d);
const pc = p => p < 0.001 ? "<0.1%" : p < 0.1 ? (p * 100).toFixed(1) + "%" : Math.round(p * 100) + "%";
const chip = s => `<span class="chip ${String(s).split(" ")[0]}">${s}</span>`;
const pNB = (mu, a) => a < 1e-8 ? 1 - Math.exp(-mu) : 1 - Math.pow(1 + a * mu, -1 / a);
const bandOf = P => P < B.cuts[0] ? B.names[0] : P < B.cuts[1] ? B.names[1] : P < B.cuts[2] ? B.names[2] : B.names[3];

const PRESETS = {
  feb: {n: "Feb 2025-like", v: {gust: 55, rain: 2, snow: 0, ante: 2.5, leaf: 0}},
  sep: {n: "Sep 2024-like (illustrative)", v: {gust: 37, rain: 3.5, snow: 0, ante: 1.5, leaf: 1}},
  tst: {n: "Summer thunderstorm", v: {gust: 60, rain: 0.8, snow: 0, ante: 0.5, leaf: 1}},
  snw: {n: "Heavy wet snow", v: {gust: 30, rain: 0.3, snow: 8, ante: 0.5, leaf: 0}},
};
const FEAT_WHY = {
  log_n: "Denser areas have more customers sharing the same equipment, and the model finds fewer damage records per customer there.",
  oh_share: "Overhead service is exposed to trees and wind, so a higher overhead share means more damage per customer.",
  pole_age: "Association only. Older poles tend to sit in older, often denser parts of the network, so this does not mean old poles are safer.",
  tall_share: "Association only. Tall poles cluster along main lines and in particular areas, so treat this as a location signal, not a cause.",
  ln_poles_pc: "More poles per customer means more structures that can fail for each customer served, typical of rural areas.",
  ln_line_pc: "More primary line per customer means more exposed wire that trees can reach, typical of rural areas.",
  ln_dev_pc: "More fuses and reclosers per customer means more branches and equipment per customer served.",
};

// ---------------------------------------------------------------- model math
function cellEta(f) {
  const z = f.map((v, i) => Math.max(-O.z_clip, Math.min(O.z_clip, (v - FE[i].mean) / FE[i].sd)));
  const x = [1].concat(z), contrib = z.map((zi, i) => BETA[2 + i] * zi);
  const eta = BETA[0] + contrib.reduce((a, b) => a + b, 0);
  let v = 0;
  for (let a = 0; a < x.length; a++) for (let b = 0; b < x.length; b++) v += x[a] * x[b] * O.cov[IDX[a]][IDX[b]];
  return {z, eta, v, contrib};
}
function sevCalc(o) {
  const t = SV.terms;
  const d = [Math.log(Math.max(o.gust, 5) / t[0].ref), o.rain - t[1].ref, o.snow - t[2].ref, o.ante - t[3].ref, o.leaf - t[4].ref];
  let ls = 0, v = 0;
  d.forEach((di, i) => { ls += SV.coef[i] * di; d.forEach((dj, j) => v += di * dj * SV.cov[i][j]); });
  const Z = SV.zero_rule, zero = o.gust <= Z.gust_max && o.rain <= Z.rain_max && o.snow <= Z.snow_max;
  return {d, ls, S: zero ? 0 : Math.exp(ls), v, zero};
}
function risk(p, o) {
  const c = D.circ[p.c], ce = cellEta(p.f), sv = sevCalc(o);
  const zone = Math.max(1, p.nd ? Math.min(p.z, c.n) : c.n);
  const mu = zone * Math.exp(ce.eta + sv.ls), P = pNB(mu, O.alpha), sd = Math.sqrt(ce.v + sv.v);
  return {c, ce, sv, zone, mu, P, sd, Plo: pNB(mu * Math.exp(-Z80 * sd), O.alpha), Phi: pNB(mu * Math.exp(Z80 * sd), O.alpha),
          ratio: Math.exp(2 * Z80 * sd)};
}
function confidence(x) {
  let k = x.ratio < 2 ? 2 : x.ratio < 4 ? 1 : 0;
  if (SV.source === "prior") k = Math.max(0, k - 1);
  return ["Low", "Medium", "High"][k];
}
const sevName = S => S < .05 ? "Calm" : S < .25 ? "Minor" : S < .6 ? "Moderate" : S < 1.2 ? "Severe" : "Extreme";
const readStorm = () => ({gust: num("gust"), rain: num("rain"), snow: num("snow"), ante: num("ante"), leaf: $("leaf").checked ? 1 : 0});

function hrs(h) { if (h <= 0) return "0 h"; return h < 36 ? Math.max(1, Math.round(h)) + " h" : (Math.round(h / 12) / 2) + " days"; }
function unitOf(h) { return h < 36 ? [Math.max(1, Math.round(h)), "h"] : [Math.round(h / 12) / 2, "days"]; }
function rangeTxt(a, b) {
  if (b <= 0) return "0 hours";
  const A = unitOf(a), B = unitOf(b);
  return A[1] === B[1] ? `${A[0]}-${B[0]} ${A[1] === "h" ? "hours" : "days"}` : `${A[0]} hours-${B[0]} days`;
}
function restoration() {
  let dir = 0;
  Object.keys(L.items).forEach(k => dir += num("n_" + k) * L.items[k].hours);
  const mult = num("mu"), tot = dir * mult, cr = Math.max(1, num("cr")), blocked = $("ac").checked;
  const gi = R.groups.indexOf($("ag").value);
  const mu = R.terms[0].beta + (gi >= 0 ? R.terms[1 + gi].beta : 0);
  // Weather effect: current storm severity S scales expected workload, and the AFT workload slope turns that into a time multiplier S^beta
  const SS = R.severity_scaling, S = sevCalc(readStorm()).S;
  const sevMult = S > 0 ? Math.pow(S, SS.beta) : 0, extrap = S > SS.s_max || (S > 0 && S < SS.s_min);
  const q = z => Math.exp(mu + R.sigma * z) * 24 * sevMult;
  let bLo = tot / (cr + 1) * sevMult, bHi = tot / Math.max(1, cr - 1) * sevMult;
  if (blocked && tot > 0 && sevMult > 0) { bLo += 2; bHi += 8; }
  const hist = {p10: q(-Z80), p50: q(0), p90: q(Z80)};
  const early = $("fl").value === "other" && D.prem[$("pm").value].nd > 0;
  let lo, hi;
  if (early) { lo = hist.p10; hi = hist.p50; }
  else { lo = Math.max(hist.p10, bLo); hi = Math.max(hist.p90, bHi); }
  const neverPct = 100 * R.n_never_closed_excluded / (R.n + R.n_never_closed_excluded);
  return {S, sevMult, extrap, dir, mult, tot, cr, blocked, bLo, bHi, hist, early, lo, hi, hasDamage: tot > 0, neverPct};
}

function scorePriorityCircuits(o) {
  const maxOf = selector => Math.max(1, ...D.circ.map(selector));
  const densityMax = maxOf(c => Math.max(0, c.f[0]));
  const customerMax = maxOf(c => Math.log1p(c.n));
  const reportMax = maxOf(c => Math.log1p(c.feb + c.sep + c.oth));
  const facilityWeightMax = Math.max(
    1,
    ...facilityCountsByCircuit.map(c => c.hospitals * 3 + c.police * 2 + c.fire),
  );
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const median = values => {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const riskReference = median(D.circ.map((circuit, i) =>
    risk({c: i, f: circuit.f, nd: 1, z: TYPICAL_ZONE}, o).P,
  ));
  const densityReference = median(D.circ.map(circuit => Math.exp(circuit.f[0])));
  const customerReference = median(D.circ.map(circuit => circuit.n));
  const stormSeverity = sevCalc(o).S;
  const severityMultiplier = stormSeverity > 0
    ? Math.pow(stormSeverity, R.severity_scaling.beta)
    : 123 / 228.5;
  const crews = Math.max(1, Math.round(num("cr")));
  const crewOptions = [...new Set([1, 2, 4, crews])].sort((a, b) => a - b);

  return D.circ.map((circuit, i) => {
    const counts = facilityCountsByCircuit[i];
    const riskProbability = risk({c: i, f: circuit.f, nd: 1, z: TYPICAL_ZONE}, o).P;
    const riskFactor = clamp(riskProbability / Math.max(riskReference, 0.001), 0.5, 2);
    const densityFactor = clamp(Math.exp(circuit.f[0]) / Math.max(densityReference, 1), 0.5, 2);
    const customerFactor = clamp(Math.sqrt(circuit.n / Math.max(customerReference, 1)), 0.5, 2);
    const circuitFactor = 0.4 * riskFactor + 0.3 * densityFactor + 0.3 * customerFactor;
    const facilityCount = counts.hospitals + counts.police + counts.fire;
    const facilityAllowanceMinutes = facilityCount * 2;
    const typicalStormMinutes = 228.5 * severityMultiplier;
    const crewDurations = crewOptions.map(crewCount => ({
      crews: crewCount,
      minutes: typicalStormMinutes * circuitFactor / Math.sqrt(crewCount) + facilityAllowanceMinutes,
    }));
    const restorationMinutes = crewDurations.find(duration => duration.crews === crews).minutes;
    const weightedFacilities = counts.hospitals * 3 + counts.police * 2 + counts.fire;
    const points = {
      facilities: 35 * weightedFacilities / facilityWeightMax,
      risk: 20 * riskProbability,
      density: 15 * Math.max(0, circuit.f[0]) / densityMax,
      customers: 10 * Math.log1p(circuit.n) / customerMax,
      history: 20 * Math.log1p(circuit.feb + circuit.sep + circuit.oth) / reportMax,
    };
    return {
      circuit: i + 1,
      counts,
      customers: circuit.n,
      reportedDamage: circuit.feb + circuit.sep + circuit.oth,
      riskProbability,
      restorationMinutes,
      crewDurations,
      restorationFactors: {
        risk: riskFactor,
        density: densityFactor,
        customers: customerFactor,
        combinedCircuit: circuitFactor,
        stormSeverity: severityMultiplier,
        facilityCount,
        facilityAllowanceMinutes,
        crews,
        typicalStormMinutes,
      },
      points,
      score: Object.values(points).reduce((sum, value) => sum + value, 0),
    };
  }).sort((a, b) => b.score - a.score || a.circuit - b.circuit);
}

function formatDurationMinutes(minutes) {
  const rounded = Math.max(5, Math.round(minutes / 5) * 5);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60), remainder = rounded % 60;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

// ---------------------------------------------------------------- setup
const facilityCountsByCircuit = Array.from({length: D.circ.length}, (_, i) => {
  const circuit = i + 1;
  return {
    hospitals: (D.hospitals || []).filter(f => f.c === circuit).length,
    police: (D.police_stations || []).filter(f => f.c === circuit).length,
    fire: (D.fire_stations || []).filter(f => f.c === circuit).length,
  };
});
D.prem.forEach((p, i) => {
  const o = document.createElement("option");
  const facilities = facilityCountsByCircuit[p.c] || {hospitals: 0, police: 0, fire: 0};
  o.value = i;
  const countLabel = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
  const included = [
    facilities.hospitals && countLabel(facilities.hospitals, "hospital", "hospitals"),
    facilities.police && countLabel(facilities.police, "police station", "police stations"),
    facilities.fire && countLabel(facilities.fire, "fire station", "fire stations"),
  ].filter(Boolean);
  o.textContent = `${p.id} · circuit C-${p.c + 1} · ${p.cn} customers in cell${included.length ? ` · includes ${included.join(", ")}` : ""}`;
  $("pm").appendChild(o);
});
R.groups.length && ["Primary wire"].concat(R.groups).forEach(g => {
  const o = document.createElement("option"); o.value = g; o.textContent = g; $("ag").appendChild(o);
});
$("ag").value = "Pole";
Object.keys(PRESETS).forEach(k => {
  const b = document.createElement("button"); b.textContent = PRESETS[k].n; b.dataset.k = k;
  b.onclick = () => {
    const v = PRESETS[k].v;
    ["gust", "rain", "snow", "ante"].forEach(i => $(i).value = v[i]);
    $("leaf").checked = !!v.leaf; render();
  };
  $("presets").appendChild(b);
});
const TABS = [["over", "Overview"], ["risk", "Risk drivers"], ["algo", "Algorithm"], ["rest", "Restoration"], ["prep", "Prepare"], ["msg", "Alerts & messages"], ["meth", "Model & validation"]];
let tab = "over", mt = 0, lastPm = null;
function showTab(t) {
  tab = t;
  TABS.forEach(([k]) => $("t_" + k).hidden = k !== t);
  [...$("tabs").children].forEach((b, i) => b.setAttribute("aria-selected", TABS[i][0] === t));
  if (t === "over" && map) setTimeout(() => map.resize(), 30);
}
TABS.forEach(([k, n]) => {
  const b = document.createElement("button"); b.textContent = n; b.setAttribute("role", "tab");
  b.onclick = () => showTab(k); $("tabs").appendChild(b);
});
const bar = (P, c) => `<div class="bar"><i style="width:${Math.round(P * 100)}%;background:${c}"></i></div>`;

// ---------------------------------------------------------------- render
function render() {
  const o = readStorm(), p = D.prem[$("pm").value], x = risk(p, o), band = bandOf(x.P), col = COL[band];
  const rs = restoration(), conf = confidence(x);
  $("gust_v").textContent = o.gust + " mph"; $("rain_v").textContent = f2(o.rain, 1) + " in";
  $("snow_v").textContent = f2(o.snow, 1) + " in"; $("ante_v").textContent = f2(o.ante, 1) + " in";
  $("sevline").innerHTML = `Storm severity <b>${f2(x.sv.S)}</b> x Feb 2025 (${sevName(x.sv.S)}) · ${chip(SV.source)}`;
  $("hdpill").textContent = "Model trained " + M.generated.slice(0, 10) + " · anonymized data";
  const long = rs.hi >= 24, pre = band !== "Low" || p.ls, esc = p.ls || long || band === "Imminent";
  const range = rangeTxt(rs.lo, rs.hi);
  $("kpis").innerHTML =
    `<div class="kpi"><small>Outage risk</small><div class="v" style="color:${col}">${band}</div>${bar(x.P, col)}<div class="n">${pc(x.P)} chance · 80% interval ${pc(x.Plo)}-${pc(x.Phi)} · confidence ${conf}</div></div>
<div class="kpi"><small>Restoration estimate</small><div class="v">${range}</div><div class="n">after crews can safely start · typical (median) ${hrs(rs.hist.p50)} · scales with storm severity · model estimate</div></div>
<div class="kpi"><small>Storm severity</small><div class="v">${sevName(x.sv.S)}</div><div class="n">${f2(x.sv.S)} x the Feb 2025 storm · weather weights ${SV.source}</div></div>
<div class="kpi"><small>Alerts</small><div class="v">${pre ? "Eligible" : "Not yet"}</div><div class="n">${esc ? "Human escalation triggered" : "Standard automated alerts"}</div></div>`;
  renderRisk(p, o, x, band, col);
  renderAlgo(p, o, x, band, conf);
  renderRest(p, x, rs, range);
  renderPrep(p, band, long, pre, esc, rs);
  renderMsgs(o, band, range, rs, p);
  renderMeth();
  if (mapReady) updateMap(x, p, o, col); else if (fb) drawFb();
  if (lastPm !== $("pm").value) { lastPm = $("pm").value; focusMap(); }
}

function renderRisk(p, o, x, band, col) {
  const sumC = x.ce.contrib.reduce((a, b) => a + b, 0);
  const m0 = TYPICAL_ZONE * Math.exp(BETA[0]), m1 = m0 * Math.exp(sumC), m2 = m1 * x.sv.S, m3 = x.mu;
  const ST = [["Typical cell, Feb 2025-like storm", `typical zone of ${TYPICAL_ZONE} customers`, 1, m0],
    ["Your location’s features", "from the trained model, see below", Math.exp(sumC), m1],
    ["Your storm conditions", `severity ${f2(x.sv.S)} x Feb 2025`, x.sv.S, m2],
    ["Your protection zone", `${x.zone} customers vs ${TYPICAL_ZONE} typical`, x.zone / TYPICAL_ZONE, m3]];
  $("build").innerHTML = ST.map((s, i) => `<div class="bars"><div><b>${s[0]}</b><div class="mu">${s[1]}</div></div><div class="track"><i style="left:0;width:${Math.round(pNB(s[3], O.alpha) * 100)}%;background:${i === 3 ? col : "#d71920"};opacity:${i === 3 ? 1 : .45}"></i></div><div style="text-align:right;font-weight:700">${i ? "x" + f2(s[2]) + " · " : ""}${pc(pNB(s[3], O.alpha))}</div></div>`).join("");
  $("featbars").innerHTML = FE.map((f, i) => {
    const c = x.ce.contrib[i], w = Math.min(50, Math.abs(c) * 45);
    return `<div class="bars"><div>${f.label}</div><div class="track"><div class="mid"></div><i style="${c >= 0 ? "left:50%" : "right:50%"};width:${w}%;background:${c >= 0 ? "#d71920" : "#2e7d32"}"></i></div><b style="text-align:right">x${f2(Math.exp(c))}</b></div>`;
  }).join("");
  const V = [["Gust +10 mph", {gust: o.gust + 10}], ["Gust −10 mph", {gust: Math.max(15, o.gust - 10)}], ["Rain +1 in", {rain: o.rain + 1}],
    ["Snow +4 in", {snow: o.snow + 4}], ["Previous 3-day rain +1 in", {ante: o.ante + 1}], [o.leaf ? "Trees bare" : "Trees in leaf", {leaf: o.leaf ? 0 : 1}]];
  $("sens").innerHTML = V.map(([n, ch]) => {
    const d = (risk(p, {...o, ...ch}).P - x.P) * 100, w = Math.min(50, Math.abs(d) * 1.2);
    return `<div class="bars"><span>${n}</span><div class="track"><div class="mid"></div><i style="${d >= 0 ? "left:50%" : "right:50%"};width:${w}%;background:${d >= 0 ? "#d71920" : "#2e7d32"}"></i></div><b style="text-align:right">${sg(d, 1)}</b></div>`;
  }).join("");
  $("expl").innerHTML = `<table><tr><th>Feature of your cell</th><th class="r">Your value</th><th class="r">Typical</th><th class="r">Rate ratio per +1 SD (95% CI)</th><th>Reading</th></tr>` +
    FE.map((f, i) => { const t = O.terms[2 + i];
      return `<tr><td><b>${f.label}</b><div class="mu">${f.desc}</div></td><td class="r">${f2(p.f[i])}</td><td class="r">${f2(f.mean)}</td><td class="r">${f2(t.rr)} (${f2(t.rr_lo)}-${f2(t.rr_hi)})</td><td>${FEAT_WHY[f.key]}</td></tr>`; }).join("") +
    `</table><div class="mu" style="margin-top:8px">These are statistical associations in two storms, not proven causes. Weather inputs enter through the storm-severity multiplier.</div>`;
  $("reasons").innerHTML = (() => {
    const rows = FE.map((f, i) => [f.label, x.ce.contrib[i]]).concat([["Storm conditions", x.sv.ls], ["Protection zone size", Math.log(x.zone / TYPICAL_ZONE)]])
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
    return `<ul>${rows.map(r => `<li><b>${r[0]}</b> ${r[1] > .05 ? "raises" : r[1] < -.05 ? "lowers" : "barely changes"} your risk (x${f2(Math.exp(r[1]))} vs typical).</li>`).join("")}</ul><div class="mu">Open “Algorithm” to see every step with your numbers.</div>`;
  })();
}

function renderAlgo(p, o, x, band, conf) {
  const t = SV.terms, covNote = SV.source === "prior";
  const featRows = FE.map((f, i) => `<tr><td>${f.label}</td><td class="r">${f2(p.f[i])}</td><td class="r">${f2(f.mean)}</td><td class="r">${f2(f.sd)}</td><td class="r">${sg(x.ce.z[i])}</td><td class="r">${sg(BETA[2 + i], 3)}</td><td class="r">${sg(x.ce.contrib[i], 3)}</td></tr>`).join("");
  const sevRows = t.map((tt, i) => `<tr><td>${tt.label}</td><td class="r">${i === 0 ? o.gust : [o.rain, o.snow, o.ante, o.leaf][i - 1]}</td><td class="r">${tt.ref}</td><td class="r">${sg(x.sv.d[i], 3)}${i === 0 ? " (ln ratio)" : ""}</td><td class="r">${sg(SV.coef[i], 3)}</td><td class="r">${sg(SV.coef[i] * x.sv.d[i], 3)}</td></tr>`).join("");
  const sumC = x.ce.contrib.reduce((a, b) => a + b, 0);
  $("algo").innerHTML = `<h2>Algorithm for ${p.id}</h2>
<div class="mu" style="margin-bottom:6px">Every number below is computed live from <code>model.json</code>, produced by the Python training pipeline. Labels show where each piece comes from: ${chip("learned")} fit to data, ${chip("prior")} an assumption, ${chip("standard")} a textbook formula, ${chip("rule")} a policy choice.</div>
<div class="step"><div class="no">1</div><div><h3 style="margin-top:0">Describe your 400 m cell ${chip("learned")}</h3>
<div class="mu">Seven features computed from customer, pole, line and device layers, standardized with the training mean and SD (clipped at ±${O.z_clip}).</div>
<table><tr><th>Feature</th><th class="r">Value</th><th class="r">Mean</th><th class="r">SD</th><th class="r">z</th><th class="r">β</th><th class="r">β·z</th></tr>${featRows}</table></div></div>
<div class="step"><div class="no">2</div><div><h3 style="margin-top:0">Damage rate per customer ${chip("learned")}</h3>
<div class="formula">η = β₀ + Σ βᵢ·zᵢ = <b>${sg(BETA[0], 3)}</b> ${sg(sumC, 3)} = <b>${sg(x.ce.eta, 3)}</b>
rate per customer = exp(η) = <b>${f2(Math.exp(x.ce.eta) * 1000, 2)}</b> damage records per 1,000 customers in a Feb 2025-like storm</div>
<div class="mu">Negative binomial GLM with log link and ridge penalty λ=${O.l2}, fit on ${O.n_rows.toLocaleString()} cellxevent rows with ${O.n_damage.toLocaleString()} damage records.</div></div></div>
<div class="step"><div class="no">3</div><div><h3 style="margin-top:0">Storm severity multiplier ${chip(SV.source)}</h3>
<table><tr><th>Input</th><th class="r">Your value</th><th class="r">Feb 2025 ref</th><th class="r">Δ</th><th class="r">Coefficient</th><th class="r">Δ·coef</th></tr>${sevRows}</table>
<div class="formula">log S = Σ coefₖ·Δₖ = <b>${sg(x.sv.ls, 3)}</b>      S = exp(log S) = <b>${f2(x.sv.S, 3)}</b></div>
<div class="${covNote ? "warn" : "fact"}">${covNote ? "<b>These weather weights are not learned.</b> " + SV.reason : "Weather weights learned from daily outage counts (" + SV.n_days + " days), blocked CV deviance skill " + f2(SV.cv_deviance_skill) + "."}</div></div></div>
<div class="step"><div class="no">4</div><div><h3 style="margin-top:0">Customers behind your nearest protective device ${chip("assumption")}</h3>
<div class="formula">zone = <b>${x.zone}</b> customers ${p.nd ? "(" + p.ch + ")" : "(no fuse or recloser upstream, so the whole circuit)"}
expected damage records μ = zone x exp(η) x S = ${x.zone} x ${f2(Math.exp(x.ce.eta), 4)} x ${f2(x.sv.S, 3)} = <b>${f2(x.mu, 3)}</b></div>
<div class="mu">Assumes any damage inside the zone interrupts every customer behind it, and that cell-level dispersion applies to the zone (this likely overstates how much clustering a large zone has, so probabilities for large zones may run low).</div></div></div>
<div class="step"><div class="no">5</div><div><h3 style="margin-top:0">Probability of an outage ${chip("standard")}</h3>
<div class="formula">P(at least one) = 1 − (1 + α·μ)^(−1/α), with fitted α = <b>${f2(O.alpha, 2)}</b>
P = 1 − (1 + ${f2(O.alpha, 2)}x${f2(x.mu, 3)})^(−${f2(1 / O.alpha, 3)}) = <b>${pc(x.P)}</b></div></div></div>
<div class="step"><div class="no">6</div><div><h3 style="margin-top:0">Uncertainty ${chip("learned")}</h3>
<div class="formula">Var(η) from the coefficient covariance = ${f2(x.ce.v, 4)}      Var(log S) = ${f2(x.sv.v, 4)}
sd(log μ) = √(${f2(x.ce.v, 4)} + ${f2(x.sv.v, 4)}) = <b>${f2(x.sd, 3)}</b>
80% interval: μ x exp(±${Z80}·sd) → P from <b>${pc(x.Plo)}</b> to <b>${pc(x.Phi)}</b></div>
<div class="mu">This captures coefficient uncertainty only, not model-structure error. The cross-validated checks in “Model &amp; validation” cover the rest.</div></div></div>
<div class="step"><div class="no">7</div><div><h3 style="margin-top:0">Risk band and confidence ${chip("rule")}</h3>
<div class="formula">bands: Low &lt; ${B.cuts[0] * 100}% ≤ Moderate &lt; ${B.cuts[1] * 100}% ≤ High &lt; ${B.cuts[2] * 100}% ≤ Imminent
P = ${pc(x.P)} → <b>${band}</b>
interval width ratio = P-scale exp(2·${Z80}·sd) = ${f2(x.ratio, 2)}x   → ${x.ratio < 2 ? "High" : x.ratio < 4 ? "Medium" : "Low"}${SV.source === "prior" ? ", lowered one step because the weather weights are a prior" : ""}
confidence = <b>${conf}</b></div></div></div>`;
}

function renderRest(p, x, rs, range) {
  const H = rs.hist;
  const aft = R.terms.filter(t => t.selected && t.name.startsWith("asset:"));
  const priorities = scorePriorityCircuits(readStorm());
  const scorePart = (value, max) => `${value.toFixed(1)}/${max}`;
  const priorityRows = priorities.map((circuit, index) => {
    const parts = circuit.points;
    const factors = circuit.restorationFactors;
    const durationList = circuit.crewDurations.map(({crews, minutes}) =>
      `<div><b>${crews} crew${crews === 1 ? "" : "s"}${crews === factors.crews ? " (selected)" : ""}:</b> ${formatDurationMinutes(minutes)}</div>`,
    ).join("");
    const facilities = [
      circuit.counts.hospitals && `${circuit.counts.hospitals} hospital${circuit.counts.hospitals === 1 ? "" : "s"}`,
      circuit.counts.police && `${circuit.counts.police} police station${circuit.counts.police === 1 ? "" : "s"}`,
      circuit.counts.fire && `${circuit.counts.fire} fire station${circuit.counts.fire === 1 ? "" : "s"}`,
    ].filter(Boolean);
    const explanation = `Storm base ${formatDurationMinutes(factors.typicalStormMinutes)} × circuit factor ${factors.combinedCircuit.toFixed(2)} (risk ${factors.risk.toFixed(2)}, density ${factors.density.toFixed(2)}, customers ${factors.customers.toFixed(2)}) ÷ √crews; ${factors.facilityCount} mapped facilities add ${factors.facilityAllowanceMinutes} min.`;
    return `<tr><td class="r">${index + 1}</td><td class="r"><b>${circuit.score.toFixed(1)}</b></td><td>C-${circuit.circuit}</td><td>${facilities.length ? facilities.join(", ") : "None mapped"}</td>
<td class="r">${circuit.customers.toLocaleString()}</td><td class="r">${pc(circuit.riskProbability)}</td><td class="r">${circuit.reportedDamage}</td>
<td class="duration-cell">${durationList}</td><td>${explanation}</td>
<td>Facilities ${scorePart(parts.facilities, 35)} · risk ${scorePart(parts.risk, 20)} · density ${scorePart(parts.density, 15)} · customers ${scorePart(parts.customers, 10)} · historical reports ${scorePart(parts.history, 20)}</td></tr>`;
  }).join("");
  $("rest").innerHTML = `<h2>Restoration estimate</h2><div style="font-size:28px;font-weight:700">${range}</div>
<div class="mu">after crews can safely start. Model estimate, not a promise. ${rs.early ? "Damage is beyond your nearest protective device, so crews can isolate it and restore you in an earlier step (rule: between the fast and median historical repair)." : ""}</div>
<div class="two" style="margin-top:12px"><div><h3 style="margin-top:0">Historical completion ${chip("learned")}</h3>
<div class="mu">Interval-censored log-normal AFT on ${R.n} closed Feb 2025 repairs (design “${R.selected_design}” chosen by leave-one-day-out CV).</div>
<table><tr><th>Quantile (${$("ag").value})</th><th class="r">Time</th></tr><tr><td>Fast (P10)</td><td class="r">${hrs(H.p10)}</td></tr><tr><td>Typical (median)</td><td class="r">${hrs(H.p50)}</td></tr><tr><td>Slow (P90)</td><td class="r">${hrs(H.p90)}</td></tr></table></div>
<div><h3 style="margin-top:0">Bottom-up labor ${chip("reference")}</h3>
<div class="mu">Workbook hours x indirect multiplier ÷ crew.</div>
${rs.hasDamage ? `<table><tr><td>Direct repair labor</td><td class="r">${f2(rs.dir, 1)} h</td></tr><tr><td>x multiplier ${f2(rs.mult, 1)}</td><td class="r">${f2(rs.tot, 0)} labor-h</td></tr><tr><td>÷ crew of ${rs.cr} (crew size ±1)</td><td class="r">${hrs(rs.bLo)}-${hrs(rs.bHi)}</td></tr>${rs.hasDamage ? `<tr><td>x storm severity ${f2(rs.S)}<sup>${f2(R.severity_scaling.beta, 2)}</sup> = ${f2(rs.sevMult, 2)}</td><td class="r"></td></tr>` : ""}${rs.blocked ? `<tr><td>Blocked access ${chip("assumption")}</td><td class="r">+2-8 h</td></tr>` : ""}</table>` : `<div class="mu">No damage entered, so only the historical range is shown.</div>`}</div></div>
<h3>Circuit priority ranking · illustrative score</h3>
<div class="fact"><b>Circuit-level planning aid.</b> Each circuit receives one 0–100 score and is ranked once. The ranking does not change the household restoration estimate above.</div>
<div class="mu">Score weights: mapped priority facilities (35 points, weighted by type: hospital 3, police 2, fire 1), modeled outage risk for a typical 51-customer protection zone (20), customer density proxy (15; circuit-average log customers per 400 m cell), historical circuit damage reports (20), and circuit customer count (10). Non-risk quantities are normalized to the highest circuit in this dataset. These are illustrative planning weights, not utility policy. All ${priorities.length} circuits are ranked, including circuits with no mapped facilities.</div>
<div class="mu" style="margin:6px 0">Facility counts use approximate nearest-line assignments, not confirmed electrical connections. Historical report counts are not live outage reports. The durations below are illustrative circuit-level planning estimates, not observed repair times or utility dispatch forecasts.</div>
<div class="priority-table-wrap" style="margin-top:8px"><table class="priority-table"><thead><tr><th class="r">Rank</th><th class="r">Score</th><th>Circuit</th><th>Mapped priority facilities</th><th class="r">Customers</th><th class="r">Typical-zone risk</th><th class="r">Historical reports</th><th>Estimated restoration time by crew count</th><th>Why this estimate</th><th>Score contribution (points/max)</th></tr></thead><tbody>${priorityRows}</tbody></table></div>
<div class="fact" style="margin-top:12px"><b>How the circuit-level duration estimate is formed</b>
<div>Start with a storm-adjusted statewide benchmark, then scale by circuit risk, customer density, customer count, crew count, and a small facility allowance. Formula: <b>duration = storm base × (0.40 × relative risk + 0.30 × relative density + 0.30 × relative customer count) ÷ √crews + 2 minutes per mapped facility.</b> Relative risk, density, and customer-count factors are compared with the median circuit and bounded from 0.5× to 2× so one outlier cannot dominate.</div>
<div class="mu" style="margin-top:6px">The storm base uses the EIA Virginia CAIDI references below (123 minutes without major events; 228.5 minutes including major events) and the model's severity scaling (power ${f2(R.severity_scaling.beta, 3)}; selected by cross-validation: ${R.severity_scaling.selected_by_cv ? "yes" : "no"}). When storm severity is zero it uses 123 minutes; at severity 1 it uses 228.5 minutes. Facility time is a small 2-minute-per-mapped-site assumption. Dividing by the square root of crew count is also an assumption; staffing productivity data is unavailable.</div>
<b>Published duration references—not circuit-specific promises</b>
<ul><li><a href="https://www.eia.gov/electricity/annual/html/epa_11_03.html" target="_blank" rel="noopener noreferrer">EIA 2025 Virginia reliability metrics</a>: average interruption restoration duration (CAIDI) was <b>123 minutes (2 h 3 min) without major events</b> and <b>228.5 minutes (3 h 49 min) with major events included</b>. These annual, statewide averages are a reference—not an event-specific range or a duration for each circuit.</li>
<li><a href="https://www.appalachianpower.com/company/news/view?releaseID=12161" target="_blank" rel="noopener noreferrer">Appalachian Power, August 2026 back-to-back severe storms</a>: about 79,000 customers restored across 1,500+ outage locations; the company said the overwhelming majority were restored “within hours,” but did not give an exact completion time.</li>
<li><a href="https://www.appalachianpower.com/company/news/view?releaseID=12256" target="_blank" rel="noopener noreferrer">Appalachian Power, Winter Storm Fern (January 2026)</a>: 76,306 outages, 185 poles and 91 transformers damaged, and about 3,000 field workers; the release does not state a full-restoration duration, so no extreme-event time is invented here.</li></ul>
CAIDI measures customer interruption duration, not hands-on crew repair time. Circuit risk is a modeled probability, not a confirmed outage or repair queue.</div>
<h3>How the two are combined ${chip("rule")}</h3>
<div class="mu">Both are multiplied by the storm-severity factor ${f2(rs.sevMult, 2)} (severity ${f2(rs.S)}x Feb 2025, raised to the learned power).</div>
<div class="formula">${rs.early ? "early step: low = historical P10, high = historical median" : "low = max(historical P10, bottom-up low)\nhigh = max(historical P90, bottom-up high)"}</div>
<h3>What the data does and does not support</h3><ul>
<li><b>Asset type matters:</b> ${aft.map(t => `${t.name.replace("asset:", "")} x${f2(t.tr)}`).join(", ")} the time of primary wire.</li>
<li><b>Storm-severity scaling ${chip("learned")}:</b> current storm severity ${f2(rs.S)}x → expected workload x${f2(rs.S)} → all repair times x${f2(rs.sevMult, 2)} (S<sup>${f2(R.severity_scaling.beta, 2)}</sup>). Fitted by the pipeline on daily workload in Feb 2025 (SE ${f2(R.severity_scaling.se, 2)}); cross-validation did <b>not</b> select that term (${sg(R.severity_scaling.cv_gain_vs_asset_only_per_record, 3)} held-out log-lik/record), so the data supports at most a weak effect.${rs.extrap ? " Current severity is outside the range seen in training, so the multiplier is an extrapolation and is not capped." : ""} The severity itself uses ${SV.source} weather weights.</li>
<li><b>Blocked access</b> was rejected by cross-validation; its +2-8 h is an operator assumption. ${chip("assumption")}</li>
<li><b>Calibrated to a Feb 2025-scale event only.</b> Sep 2024 repair gaps all fall at 23-26 days, which looks like batch close-out, so that event was excluded. Milder or harsher storms were not learned.</li>
<li><b>Heavier tail than shown:</b> ${f2(rs.neverPct, 1)}% of Feb 2025 records were never marked repaired and are excluded from this conditional model. Including them as censored raises σ from ${f2(R.sigma, 2)} to ${f2(R.sensitivity_with_censored.sigma, 2)}.</li>
<li>Dates have no clock time, so precision is about one day.</li></ul>
<div class="mu">Could move it: crew count, blocked roads, extra damage found, damage upstream.</div>`;
}

function renderPrep(p, band, long, pre, esc, rs) {
  const pr = ["Charge phones and power banks, and keep flashlights where you can find them.", "Fill water containers and set aside shelf-stable food."];
  if (band !== "Low") pr.push("Know where your breaker panel and manual garage-door release are.");
  if (long) pr.push("Keep fridge and freezer doors closed. Plan where you could stay if it runs past a day.", "Have a week of essential medications on hand.");
  if (p.ls) pr.push("<b>You have told us someone relies on life-support equipment.</b> Make sure backup power or a backup location is ready now and talk to your equipment provider. We will route you to a person.");
  $("prep").innerHTML = `<h2>Prepare and stay safe</h2><div class="safe"><b>Safety, read first:</b> Treat every downed line as live and stay 30+ feet away. Call 911 for danger to life, then your utility. Never run a generator indoors or in a garage.</div><ul>${pr.map(i => "<li>" + i + "</li>").join("")}</ul>${p.fk > 3 ? `<div class="mu">Nearest fire station is ${p.fk >= 10 ? "10+" : "about " + p.fk} km away, so plan for slower emergency response.</div>` : ""}<div class="mu" style="margin-top:8px">Guidance ${chip("rule")}: tied to the risk band and whether the estimate exceeds 24 hours.</div>`;
  $("alert").innerHTML = `<div class="fact"><b>${pre ? "Qualifies" : "Does not yet qualify"}</b> for pre-storm alerts${pre ? "" : " (risk is Low)"}. Outage, estimate-update and restoration alerts apply once enrolled (assumed in this demo).</div>
<ul><li>Timing: 48 h and 24 h before the storm, then within minutes of a confirmed outage.</li><li>Channel: text first, email second${p.ls ? ", plus a phone call from a person" : ""}.</li><li>Send an update when the estimate changes by more than 25%.</li><li>Escalate to a human if: life-support flag, estimate over 24 h, or risk Imminent.</li></ul>${esc ? `<div class="safe"><b>Escalation triggered:</b> ${p.ls ? "declared life-support customer" : long ? "long estimate" : "imminent risk"}.</div>` : ""}<div class="mu">Rules ${chip("rule")} are challenge assumptions, not documented utility policy.</div>`;
}

function renderMsgs(o, band, range, rs, p) {
  const lsn = p.ls ? "\nIf anyone at home relies on medical equipment, please start your backup plan now or call us for help." : "";
  const M2 = {"Pre-storm": `Storm alert: winds up to ${o.gust} mph are expected in your area. Chance of an outage: ${band.toLowerCase()}. Charge devices and gather water and food now.${lsn}\nStay 30+ feet from any downed line and call 911.`,
    "Outage confirmed": `We know your power is out. Crews will begin once it is safe. Early estimate: ${range} after work starts. This is an estimate, not a promise.${lsn}\nNever use a generator indoors.`,
    "Estimate updated": `Update: our estimate changed to ${range}. Reason: ${rs.early ? "crews can isolate the damage and restore you in an earlier step" : "new damage or crew availability"}. We will update you again if it changes.`,
    "Restored": "Your power is back. If it flickers or goes out again, please report it. Stay clear of any lines still down."};
  const keys = Object.keys(M2); $("mtabs").innerHTML = "";
  keys.forEach((k, i) => {
    const b = document.createElement("button"); b.textContent = k; if (i === mt) b.className = "on";
    b.onclick = () => { mt = i; render(); }; $("mtabs").appendChild(b);
  });
  $("msg").textContent = M2[keys[mt]];
}

function calibSvg(cal) {
  const mx = Math.max(0.25, ...cal.map(c => Math.max(c.pred, c.obs))) * 1.05, S = 240, pad = 34, sc = v => pad + v / mx * (S - pad - 8), sy = v => S - sc(v) + pad - 8;
  const pts = cal.map(c => `<circle cx="${sc(c.pred)}" cy="${sy(c.obs)}" r="5" fill="#d71920" opacity=".85"><title>predicted ${pc(c.pred)}, observed ${pc(c.obs)}, n=${c.n}</title></circle>`).join("");
  return `<svg viewBox="0 0 ${S} ${S}" width="100%" style="max-width:300px" role="img" aria-label="Calibration: predicted versus observed share of cells with damage"><line x1="${sc(0)}" y1="${sy(0)}" x2="${sc(mx)}" y2="${sy(mx)}" stroke="#999" stroke-dasharray="4 3"/><line x1="${pad}" y1="${sy(0)}" x2="${S - 6}" y2="${sy(0)}" stroke="#555"/><line x1="${pad}" y1="${sy(0)}" x2="${pad}" y2="8" stroke="#555"/>${pts}<text x="${S / 2}" y="${S - 2}" font-size="10" text-anchor="middle" fill="#555">predicted chance of any damage</text><text x="10" y="${S / 2}" font-size="10" text-anchor="middle" fill="#555" transform="rotate(-90 10 ${S / 2})">observed share</text></svg>`;
}
function renderMeth() {
  const cv = O.cv.models, T = O.cv.transfer_feb_to_sep, d = M.data, dg = M.diagnostics, rc = R.cv.candidates;
  const r = (n, m) => `<tr><td>${n}</td><td class="r">${f2(m.deviance_skill, 3)}</td><td class="r">${f2(m.auc_any_damage, 3)}</td><td class="r">${f2(m.brier_skill, 3)}</td><td class="r">${f2(m.spearman_circuit_event, 2)}</td></tr>`;
  $("why").innerHTML = `<h2>Model, validation and limits</h2>
<div class="warn"><b>Confirmed utility facts: none.</b> This demo has no live outage feed. Everything labeled an estimate is model output.</div>
<h3>Where every heuristic comes from</h3>
<table><tr><th>Piece</th><th>Status</th><th>How</th></tr>${M.provenance.map(r => `<tr><td>${r.item}</td><td>${chip(r.status)}</td><td>${r.how}</td></tr>`).join("")}</table>
<h3>Training data</h3><ul><li>${d.arcos_records.toLocaleString()} ARCOS damage records; ${d.arcos_by_event.Feb2025} in Feb 2025, ${d.arcos_by_event.Sep2024} in Sep 2024, ${d.arcos_by_event.Other} outside those events.</li>
<li>${d.panel_rows.toLocaleString()} cellxevent rows (${d.panel_positive_rows} with damage). ${d.arcos_no_customer_cell} damage records fell in cells with no customers and were excluded.</li>
<li>${d.premises_with_topology.toLocaleString()} premises with topology; ${d.premises_without_protective_device.toLocaleString()} have no protective device upstream.</li></ul>
<h3>Outage model coefficients ${chip("learned")}</h3>
<table><tr><th>Term</th><th class="r">β</th><th class="r">SE</th><th class="r">Rate ratio</th><th class="r">95% CI</th></tr>${O.terms.map(t => `<tr><td>${t.name}</td><td class="r">${sg(t.beta, 3)}</td><td class="r">${f2(t.se, 3)}</td><td class="r">${f2(t.rr)}</td><td class="r">${f2(t.rr_lo)}-${f2(t.rr_hi)}</td></tr>`).join("")}</table>
<div class="mu">Features are standardized, so rate ratios are per +1 SD. Dispersion α=${f2(O.alpha, 2)} (strong clustering: damage arrives in bursts).</div>
<h3>Cross-validation (${O.cv.folds}-fold, grouped by circuit)</h3>
<div class="two"><div><table><tr><th>Model</th><th class="r">Deviance skill</th><th class="r">AUC</th><th class="r">Brier skill</th><th class="r">Circuit ρ</th></tr>${r("Exposure only (baseline)", cv.exposure_only)}${r("Negative binomial GLM (used)", cv.nbglm)}${r("Gradient-boosted Poisson", cv.gbm_poisson)}</table>
<div class="mu">Predictions are rescaled per event so this compares <i>where</i> damage lands, not how much occurs. Skill is relative to the exposure-only baseline. Ridge penalty was picked on the same folds, so scores are mildly optimistic.</div></div>
<div>${calibSvg(O.cv.calibration)}<div class="mu">Calibration: points near the dashed line mean predicted chances match what happened.</div></div></div>
<div class="${T.auc_any_damage < T.auc_baseline ? "warn" : "fact"}" style="margin-top:8px"><b>Transfer test (train on Feb 2025, predict Sep 2024):</b> deviance skill ${f2(T.deviance_skill, 3)}, AUC ${f2(T.auc_any_damage, 3)} vs ${f2(T.auc_baseline, 3)} for the baseline. The spatial pattern carries over only weakly, consistent with storm path dominating.</div>
<h3>Restoration model selection (leave-one-report-day-out)</h3>
<table><tr><th>Design</th><th class="r">Held-out log-lik gain / record</th><th class="r">P10-P90 coverage (target 80%)</th></tr>${Object.keys(rc).map(k => `<tr><td>${k}${k === R.cv.selected ? " " + chip("learned") + " selected" : ""}</td><td class="r">${sg(rc[k].gain_vs_null_per_record, 4)}</td><td class="r">${pc(rc[k].coverage_p10_p90)}</td></tr>`).join("")}</table>
<h3>Severity weights ${chip(SV.source)}</h3>
<div class="${dg.severity_agrees_with_events ? "fact" : "warn"}">${SV.source === "prior" ? "No weather data reached the pipeline, so these weights are assumptions. " : ""}Illustrative Sep-2024-like weather implies severity ${f2(dg.severity_implied_sep_over_feb, 2)}x Feb 2025; the observed damage ratio between the events is ${f2(dg.observed_sep_over_feb_damage_ratio, 2)}x. ${dg.severity_agrees_with_events ? "These agree within 1.5x." : "They disagree by more than 1.5x, and the weather values for Sep 2024 are my guesses, so treat the severity scale as uncalibrated until weather data is fetched (weather.py) and the model is retrained."}</div>
<h3>Privacy and fallback</h3><p>Premise IDs are re-numbered, the map shows only a ≈400 m cell, fire-station distance is banded, and only cell-level customer features reach the browser. Hospital, police, and fire-station markers use generic numbered labels and coarsened reference coordinates; facility names do not appear. Only declared flags are used. If a premise cannot be matched, the concierge should decline to estimate and point to the official outage map and phone line.</p>
<h3>Retrain with new data</h3><div class="formula">python pipeline/run_pipeline.py --raw-dir data/raw --topology data/raw/matched_upstream.txt \\
    --labor data/raw/Install_Labor_HackOHIO.xlsx [--fetch-weather]</div>`;
}

// ---------------------------------------------------------------- map
let map = null, mapReady = false, fb = false;
const cb = a => { const r = []; for (let i = 0; i < a.length; i += 2) r.push([a[i], a[i + 1]]); return r; };
const CS = D.cell_size, LON = CS[0], LAT = CS[1];
function initMap() {
  if (typeof maplibregl === "undefined") return fallback();
  try {
    map = new maplibregl.Map({container: "map", style: {version: 8, sources: {}, layers: [{id: "bg", type: "background", paint: {"background-color": "#eceff1"}}]},
      center: [-79.95, 37.24], zoom: 9.3, pitch: 58, bearing: -18, maxPitch: 78, attributionControl: false});
    map.on("load", () => {
      map.addSource("ln", {type: "geojson", data: {type: "FeatureCollection", features: D.lines.map((Ls, i) => ({type: "Feature", properties: {c: i}, geometry: {type: "MultiLineString", coordinates: Ls.map(cb)}}))}});
      map.addSource("ce", {type: "geojson", data: {type: "FeatureCollection", features: D.cells.map(c => ({type: "Feature", properties: {n: c[2], d: c[3], c: c[4], h: c[2] * 3}, geometry: {type: "Polygon", coordinates: [[[c[0], c[1]], [c[0] + LON, c[1]], [c[0] + LON, c[1] + LAT], [c[0], c[1] + LAT], [c[0], c[1]]]]}}))}});
      map.addSource("dm", {type: "geojson", data: {type: "FeatureCollection", features: D.dmg.map(d => ({type: "Feature", properties: {e: d[2]}, geometry: {type: "Point", coordinates: [d[0], d[1]]}}))}});
      map.addSource("dv", {type: "geojson", data: {type: "FeatureCollection", features: D.dev.map(d => ({type: "Feature", properties: {t: d[2]}, geometry: {type: "Point", coordinates: [d[0], d[1]]}}))}});
      const facilityFeatures = (items, kind) => (items || []).map(f => ({type: "Feature", properties: {id: f.id, c: f.c, distance_m: f.distance_m, kind}, geometry: {type: "Point", coordinates: f.p}}));
      map.addSource("priority-facilities", {type: "geojson", data: {type: "FeatureCollection", features: [
        ...facilityFeatures(D.hospitals, "hospital"),
        ...facilityFeatures(D.police_stations, "police"),
        ...facilityFeatures(D.fire_stations, "fire"),
      ]}});
      map.addSource("pm", {type: "geojson", data: {type: "FeatureCollection", features: []}});
      const dmgCol = ["interpolate", ["linear"], ["get", "d"], 0, "#c9ced3", 1, "#f4a6ad", 3, "#e0525e", 6, "#a50f1e"];
      map.addLayer({id: "ce", type: "fill-extrusion", source: "ce", paint: {"fill-extrusion-color": dmgCol, "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": .35}});
      map.addLayer({id: "cs", type: "fill-extrusion", source: "ce", filter: ["==", ["get", "c"], -1], paint: {"fill-extrusion-color": dmgCol, "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": .92}});
      map.addLayer({id: "la", type: "line", source: "ln", paint: {"line-color": "#9aa0a6", "line-width": 1, "line-opacity": .8}});
      map.addLayer({id: "ls", type: "line", source: "ln", filter: ["==", ["get", "c"], -1], paint: {"line-color": "#111", "line-width": 3.2}});
      map.addLayer({id: "dm", type: "circle", source: "dm", paint: {"circle-radius": 3.2, "circle-color": ["match", ["get", "e"], 0, "#d71920", 1, "#111111", "#8a8f94"], "circle-stroke-color": "#fff", "circle-stroke-width": .6}});
      map.addLayer({id: "dv", type: "circle", source: "dv", paint: {"circle-radius": 3.6, "circle-color": ["match", ["get", "t"], 0, "#1f6b3a", "#2f5fa8"], "circle-stroke-color": "#fff", "circle-stroke-width": .6}});
      map.addLayer({id: "priority-facilities", type: "circle", source: "priority-facilities", paint: {
        "circle-radius": 7,
        "circle-color": ["match", ["get", "kind"], "hospital", "#c2185b", "police", "#2864dc", "fire", "#e87513", "#555"],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1.5,
      }});
      map.addLayer({id: "pr", type: "circle", source: "pm", paint: {"circle-radius": 11, "circle-color": "rgba(17,17,17,0.08)", "circle-stroke-color": "#111", "circle-stroke-width": 2}});
      map.addLayer({id: "pd", type: "circle", source: "pm", paint: {"circle-radius": 4.5, "circle-color": "#111"}});
      map.on("click", "ce", e => { const f = e.features[0].properties, i = $("cellinfo"); i.style.display = "block"; i.textContent = f.n + " customers · " + f.d + " damage records in this ≈400 m bin"; });
      map.on("click", "priority-facilities", e => { const f = e.features[0].properties, i = $("cellinfo"); i.style.display = "block"; i.textContent = f.id + " · nearest mapped circuit C-" + f.c + " (" + f.distance_m + " m; proximity only, connection unconfirmed)"; });
      map.on("mouseenter", "priority-facilities", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "priority-facilities", () => { map.getCanvas().style.cursor = ""; });
      mapReady = true; render(); focusMap(true);
    });
    map.on("error", () => {});
    setTimeout(() => { if (!mapReady) fallback(); }, 9000);
  } catch (e) { fallback(); }
}
function updateMap(x, p, o, col) {
  map.setFilter("cs", ["==", ["get", "c"], p.c]); map.setFilter("ls", ["==", ["get", "c"], p.c]);
  map.setPaintProperty("ls", "line-color", col); map.setPaintProperty("pd", "circle-color", col); map.setPaintProperty("pr", "circle-stroke-color", col);
  const m = ["match", ["get", "c"]];
  D.circ.forEach((c, i) => { const P = pNB(TYPICAL_ZONE * Math.exp(cellEta(c.f).eta + x.sv.ls), O.alpha); m.push(i, COL[bandOf(P)]); });
  m.push("#9aa0a6"); map.setPaintProperty("la", "line-color", m);
  map.getSource("pm").setData({type: "FeatureCollection", features: [{type: "Feature", properties: {}, geometry: {type: "Point", coordinates: p.p}}]});
  map.setLayoutProperty("dm", "visibility", $("lv_d").checked ? "visible" : "none");
  map.setLayoutProperty("dv", "visibility", $("lv_v").checked ? "visible" : "none");
  const v = $("lv_c").checked ? "visible" : "none"; map.setLayoutProperty("ce", "visibility", v); map.setLayoutProperty("cs", "visibility", v);
}
function focusMap(includeFacilities = false) {
  const p = D.prem[$("pm").value], b = D.circ[p.c].b;
  if (map && mapReady) {
    let west = b[0], south = b[1], east = b[2], north = b[3];
    if (includeFacilities) [...(D.hospitals || []), ...(D.police_stations || []), ...(D.fire_stations || [])].forEach(f => {
      west = Math.min(west, f.p[0]); south = Math.min(south, f.p[1]);
      east = Math.max(east, f.p[0]); north = Math.max(north, f.p[1]);
    });
    map.fitBounds([[west, south], [east, north]], {padding: 50, duration: 1200, pitch: map.getPitch() || 58, maxZoom: 12.5});
  }
}
function fallback() {
  if (fb || mapReady) return; fb = true;
  const m = $("map"); m.innerHTML = "";
  const c = document.createElement("canvas"); c.width = 900; c.height = 480; c.style.cssText = "width:100%;height:100%"; m.appendChild(c); drawFb();
}
function drawFb() {
  const c = $("map").querySelector("canvas"); if (!c) return;
  const g = c.getContext("2d"), p = D.prem[$("pm").value], X = [-80.26, -79.64], Y = [36.99, 37.49];
  const sx = l => (l - X[0]) / (X[1] - X[0]) * c.width, sy = l => c.height - (l - Y[0]) / (Y[1] - Y[0]) * c.height;
  g.fillStyle = "#eceff1"; g.fillRect(0, 0, c.width, c.height);
  D.lines.forEach((Ls, i) => { g.strokeStyle = i === p.c ? COL[bandOf(risk(p, readStorm()).P)] : "#b3b8bd"; g.lineWidth = i === p.c ? 2.2 : .7; Ls.forEach(a => { g.beginPath(); for (let j = 0; j < a.length; j += 2) j ? g.lineTo(sx(a[j]), sy(a[j + 1])) : g.moveTo(sx(a[0]), sy(a[1])); g.stroke(); }); });
  D.dmg.forEach(d => { g.fillStyle = ["#d71920", "#111", "#8a8f94"][d[2]]; g.fillRect(sx(d[0]) - 1.5, sy(d[1]) - 1.5, 3, 3); });
  const facilities = [
    ...(D.hospitals || []).map(f => [f, "#c2185b"]),
    ...(D.police_stations || []).map(f => [f, "#2864dc"]),
    ...(D.fire_stations || []).map(f => [f, "#e87513"]),
  ];
  facilities.forEach(([f, color]) => { g.beginPath(); g.arc(sx(f.p[0]), sy(f.p[1]), 6, 0, Math.PI * 2); g.fillStyle = color; g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.stroke(); });
  g.strokeStyle = "#111"; g.lineWidth = 2; g.beginPath(); g.arc(sx(p.p[0]), sy(p.p[1]), 9, 0, 7); g.stroke();
  g.fillStyle = "#5f6368"; g.font = "12px sans-serif"; g.fillText("3D map unavailable in this browser; showing 2D circuit view", 10, 18);
}
$("leg").innerHTML = `<i style="background:#d71920"></i>Feb 2025 damage <i style="background:#111;margin-left:6px"></i>Sep 2024 <i style="background:#8a8f94;margin-left:6px"></i>Other<br><i style="background:#1f6b3a"></i>Recloser <i style="background:#2f5fa8;margin-left:6px"></i>Switch<br><i style="background:#c2185b"></i>Hospital <i style="background:#2864dc;margin-left:6px"></i>Police station <i style="background:#e87513;margin-left:6px"></i>Fire station · bold line = your circuit, colored by risk`;
$("b3d").onclick = () => { if (map && mapReady) map.easeTo({pitch: map.getPitch() > 10 ? 0 : 58, bearing: map.getPitch() > 10 ? 0 : -18, duration: 700}); };
$("bfit").onclick = focusMap;
document.querySelectorAll(".inp,#pm,#lv_d,#lv_v,#lv_c").forEach(e => e.addEventListener("input", render));
$("mu").value = L.indirect_multiplier;
showTab("over"); render(); if (!window.__NOMAP) initMap();
