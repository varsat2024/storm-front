"use strict";
// All numbers below come from MODEL (artifacts/model.json, written by the Python pipeline) and
// DATA (site/data.json). Nothing about risk is hard-coded here except display text and the
// alert/safety rules, which are labeled as rules.
const M = MODEL, D = DATA, O = M.outage, SV = M.severity, R = M.restoration, L = M.labor, B = M.bands;
// Repair mix by asset group (Feb 2025 ARCOS records). Used when the trained model.json predates damage_mix.
const DM = M.damage_mix || {"source": "Feb 2025 ARCOS records by asset group (n=1254)", "groups": {"Primary wire": 0.4138755980861244, "Pole": 0.21929824561403508, "Fuse bank": 0.17942583732057416, "Secondary wire": 0.07416267942583732, "Other": 0.06618819776714513, "Transformer": 0.04704944178628389}, "mapping": {"Pole": "pole", "Transformer": "xf", "Fuse bank": "rec", "Primary wire": "wire", "Secondary wire": "wire"}, "shares": {"pole": 0.23484201537147736, "arm": 0.0, "xf": 0.05038428693424423, "ins": 0.0, "rec": 0.19214346712211783, "wire": 0.5226302305721605}, "hours_per_event": 1.9010039886913002, "notes": ["fuse banks use the recloser repair hours", "Other records are spread across the mapped groups", "wire hours are a placeholder (workbook has none)"]};
const $ = id => document.getElementById(id);
const num = id => Math.max(0, parseFloat($(id).value) || 0);
// Lighter, brighter colors for the map lines (the text and bars keep the darker COL palette).
const MAP_COL = {Low: "#39ff14", Moderate: "#ffea00", High: "#ff7b00", Imminent: "#ff1e56"}, MAP_DEF = "#00e5ff";
const COL = {Low: "#2e7d32", Moderate: "#c26a00", High: "#d9451f", Imminent: "#b0001a"};
const Z80 = 1.2816, TYPICAL_ZONE = 51;
const RESPONSE_WORKFORCE = {
  totalPeople: 1000,
  teams: {assessment: 70, line: 105, tree: 70, equipment: 35, protection: 35},
  people: {assessment: 140, line: 420, tree: 210, equipment: 105, protection: 105, support: 20},
};
// Facilities more than FACILITY_MAX_KM from every circuit line are not mapped or counted.
const FACILITY_MAX_KM = 1;
const MAP_FACILITIES_ALL = [
  ["hospital", "Hospital 1", 22, -80.11, 37.39],
  ["hospital", "Hospital 2", 5, -80.03, 37.26],
  ["hospital", "Hospital 3", 8, -80.02, 37.27],
  ["hospital", "Hospital 4", 105, -79.94, 37.25],
  ["hospital", "Hospital 5", 65, -79.94, 37.27],
  ["police", "Police Station 1", 37, -79.95, 37.27],
  ["police", "Police Station 2", 18, -79.9, 37.28],
  ["police", "Police Station 3", 22, -80.06, 37.29],
  ["police", "Police Station 4", 71, -80.13, 37.28],
  ["fire", "Fire Station 1", 68, -79.92, 37.25],
  ["fire", "Fire Station 2", 44, -79.79, 37.27],
  ["fire", "Fire Station 3", 32, -79.94, 37.29],
  ["fire", "Fire Station 4", 14, -79.9, 37.3],
  ["fire", "Fire Station 5", 18, -79.9, 37.28],
  ["fire", "Fire Station 6", 34, -80.06, 37.28],
  ["fire", "Fire Station 7", 84, -79.96, 37.12],
  ["fire", "Fire Station 8", 78, -79.88, 37.42],
  ["fire", "Fire Station 9", 19, -79.95, 37.32],
  ["fire", "Fire Station 10", 22, -80.06, 37.29],
  ["fire", "Fire Station 11", 86, -80.2, 37.03],
  ["fire", "Fire Station 12", 8, -80.03, 37.29],
  ["fire", "Fire Station 13", 33, -79.92, 37.27],
  ["fire", "Fire Station 14", 30, -79.81, 37.24],
  ["fire", "Fire Station 15", 45, -79.73, 37.38],
  ["fire", "Fire Station 16", 84, -79.95, 37.2],
  ["fire", "Fire Station 17", 21, -79.81, 37.38],
  ["fire", "Fire Station 18", 31, -79.95, 37.25],
  ["fire", "Fire Station 19", 22, -80.11, 37.39],
  ["fire", "Fire Station 20", 22, -80.08, 37.37],
  ["fire", "Fire Station 21", 28, -79.97, 37.29],
  ["fire", "Fire Station 22", 53, -80.21, 37.23],
  ["fire", "Fire Station 23", 44, -79.72, 37.26],
  ["fire", "Fire Station 24", 20, -80.07, 37.2],
  ["fire", "Fire Station 25", 65, -79.95, 37.27],
  ["fire", "Fire Station 26", 85, -79.94, 37.32],
  ["fire", "Fire Station 27", 86, -80.11, 37.17],
  ["fire", "Fire Station 28", 10, -79.91, 37.24],
  ["fire", "Fire Station 29", 1, -79.96, 37.35],
  ["fire", "Fire Station 30", 86, -80.05, 37.01],
  ["fire", "Fire Station 31", 60, -79.97, 37.27],
  ["fire", "Fire Station 32", 10, -79.81, 37.11],
  ["fire", "Fire Station 33", 44, -79.72, 37.32],
  ["fire", "Fire Station 34", 54, -80.01, 37.31],
  ["fire", "Fire Station 35", 71, -80.13, 37.28],
  ["fire", "Fire Station 36", 61, -80.01, 37.23],
  ["fire", "Fire Station 37", 57, -80.01, 37.27],
];
const MAP_FACILITIES = (() => {
  const kx = Math.cos(37.2 * Math.PI / 180) * 111.32, ky = 110.57, segs = [];
  D.lines.forEach(Ls => Ls.forEach(a => { for (let j = 0; j + 3 < a.length; j += 2) segs.push([a[j] * kx, a[j + 1] * ky, a[j + 2] * kx, a[j + 3] * ky]); }));
  const dist = (px, py) => {
    let best = Infinity;
    for (const s of segs) {
      const dx = s[2] - s[0], dy = s[3] - s[1], L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / L)) : 0;
      const d = Math.hypot(s[0] + t * dx - px, s[1] + t * dy - py);
      if (d < best) best = d;
    }
    return best;
  };
  return MAP_FACILITIES_ALL.filter(f => dist(f[3] * kx, f[4] * ky) <= FACILITY_MAX_KM);
})();
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
  const zone = Math.max(1, p.nd ? Math.min(p.z, c.n) : p.cn);
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
// Damage quantities: "model" = expected damage events given an outage occurs (mu / P) times the Feb 2025 repair mix; "manual" = the card's inputs.
const dmgManual = () => $("dsrc").value === "manual";
function dmgEvents() {
  const o = readStorm(), sv = sevCalc(o);
  if (sv.S === 0) return 0;
  const x = risk(D.prem[$("pm").value], o);
  return x.P > 1e-9 ? Math.max(1, x.mu / x.P) : 1;
}
function qty(k, N) { return dmgManual() ? num("n_" + k) : (N == null ? dmgEvents() : N) * DM.shares[k]; }
function restoration() {
  let dir = 0;
  const N = dmgEvents();
  Object.keys(L.items).forEach(k => dir += qty(k, N) * L.items[k].hours);
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
  // Headline estimate: this premise's completion time in the response schedule (inspection, then repair), see scheduleAllPremises().
  const schedule = scheduleAllPremises(readStorm()), selected = schedule.premises.find(item => item.premise.id === D.prem[$("pm").value].id);
  const estimate = selected ? selected.completion : 0, lo = estimate, hi = estimate;
  const neverPct = 100 * R.n_never_closed_excluded / (R.n + R.n_never_closed_excluded);
  return {schedule, selected, N, manual: dmgManual(), S, sevMult, extrap, dir, mult, tot, cr, blocked, bLo, bHi, hist, early, lo, hi, estimate, hasDamage: tot > 0, neverPct};
}

// Priority-dispatch list scheduling: whenever a team frees up, it takes the ready task of the highest-priority premise (lowest rank).
// If nothing is ready yet it waits for the next task to become ready. `initial` lets a pool continue from earlier work.
function scheduleTeamTasks(tasks, teamCount, initial) {
  // Same dispatch rule as before, but O(n log n): a heap of free teams, tasks sorted by readyAt, and a heap of ready tasks.
  const avail = initial ? initial.slice() : Array(teamCount).fill(0);
  const teams = new Heap((a, b) => avail[a] - avail[b] || a - b);
  avail.forEach((_, i) => teams.push(i));
  const byReady = tasks.slice().sort((a, b) => a.readyAt - b.readyAt);
  const ready = new Heap((a, b) => a.rank - b.rank || b.duration - a.duration || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const completions = new Map(), starts = new Map();
  let next = 0;
  for (let done = 0; done < byReady.length; done++) {
    const team = teams.pop();
    let t = avail[team];
    if (!ready.size && next < byReady.length && byReady[next].readyAt > t) t = byReady[next].readyAt;   // nothing ready: wait for the next task
    while (next < byReady.length && byReady[next].readyAt <= t + 1e-9) ready.push(byReady[next++]);
    const task = ready.pop();
    const start = Math.max(t, task.readyAt), finish = start + task.duration;
    avail[team] = finish;
    teams.push(team);
    starts.set(task.id, start);
    completions.set(task.id, finish);
  }
  return {completions, starts, availableAt: avail};
}

function Heap(cmp) {   // cmp(a, b) < 0 when a should come out first
  const a = [], less = (x, y) => cmp(x, y) < 0;
  Object.defineProperty(this, "size", {get: () => a.length});
  this.push = v => {
    let i = a.push(v) - 1;
    while (i > 0) { const q = (i - 1) >> 1; if (!less(a[i], a[q])) break; [a[i], a[q]] = [a[q], a[i]]; i = q; }
  };
  this.pop = () => {
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  };
}

function splitExpectedWork(expected) {
  const units = Array(Math.floor(expected)).fill(1);
  const remainder = expected - units.length;
  if (remainder > 1e-8) units.push(remainder);
  return units;
}

let FAC_CACHE = null;
function premiseFacilityCounts() {
  if (FAC_CACHE) return FAC_CACHE;
  const counts = new Map(D.prem.map(premise => [
    premise.id,
    {hospitals: 0, police: 0, fire: 0},
  ]));
  MAP_FACILITIES.forEach(([kind, , , lon, lat]) => {
    const nearest = D.prem.reduce((best, premise) => {
      const dx = (premise.p[0] - lon) * Math.cos(lat * Math.PI / 180);
      const dy = premise.p[1] - lat;
      const distance = dx * dx + dy * dy;
      return distance < best.distance ? {premise, distance} : best;
    }, {premise: D.prem[0], distance: Infinity}).premise;
    const entry = counts.get(nearest.id);
    if (kind === "hospital") entry.hospitals++;
    else if (kind === "police") entry.police++;
    else if (kind === "fire") entry.fire++;
  });
  return (FAC_CACHE = counts);
}

const PREMISE_CELL_DAMAGE = new Map(D.prem.map(premise => {
  const [lon, lat] = premise.p;
  const cell = D.cells.reduce((nearest, current) => {
    const dx = current[0] - lon, dy = current[1] - lat;
    const distance = dx * dx + dy * dy;
    return distance < nearest.distance ? {cell: current, distance} : nearest;
  }, {cell: null, distance: Infinity}).cell;
  return [premise.id, cell ? cell[3] : 0];
}));

function premiseDamageEstimate(premise, o) {
  const sv = sevCalc(o);
  const eta = cellEta(premise.f).eta;
  const rate = sv.zero ? 0 : Math.exp(eta + sv.ls);
  const expectedRecords = premise.cn * rate;
  return {
    probability: sv.zero ? 0 : pNB(expectedRecords, O.alpha),
    expectedRecords: sv.zero ? 0 : expectedRecords,   // expected number of damage records; unlike the probability, it keeps growing with storm severity
    rate,
    zero: sv.zero,
  };
}

function scorePriorityPremises(o, opts) {
  const forceModel = !!(opts && opts.forceModel), W = PRIORITY_WEIGHTS, zeroStorm = sevCalc(o).zero;
  const facilitiesByPremise = premiseFacilityCounts();
  const premiseFacts = D.prem.map(premise => {
    const damageEstimate = premiseDamageEstimate(premise, o);
    const scenario = scenarioFor(premise.id, forceModel);
    const work = workFor(damageEstimate, scenario, zeroStorm);
    const damageHours = work.reduce((a, w) => a + w.count * L.items[w.item].hours, 0);
    const outageRisk = risk(premise, o).P;
    const counts = facilitiesByPremise.get(premise.id);
    const weightedFacilities = counts.hospitals * 3 + counts.police * 2 + counts.fire;
    const cellDamageHistory = PREMISE_CELL_DAMAGE.get(premise.id) || 0;
    return {premise, damageEstimate, scenario, work, damageHours, outageRisk, counts, weightedFacilities, cellDamageHistory};
  });
  const maxOf = selector => Math.max(1, ...premiseFacts.map(selector));
  const densityMax = maxOf(item => Math.max(0, item.premise.f[0]));
  const circuitCustomers = premise => D.circ[premise.c].n;
  const customerMax = maxOf(item => Math.log1p(circuitCustomers(item.premise)));
  const reportMax = maxOf(item => Math.sqrt(item.cellDamageHistory));
  const damageRateMax = maxOf(item => item.damageEstimate.rate);
  const facilityWeightMax = maxOf(item => item.weightedFacilities);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const median = values => {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const densityReference = median(premiseFacts.map(item => Math.exp(item.premise.f[0])));
  const customerReference = median(premiseFacts.map(item => item.premise.cn));

  return premiseFacts.map(item => {
    const {premise, damageEstimate, counts, scenario, work, damageHours} = item;
    const riskProbability = item.outageRisk;
    const densityFactor = clamp(Math.exp(premise.f[0]) / Math.max(densityReference, 1), 0.5, 2);
    const customerFactor = clamp(Math.sqrt(premise.cn / Math.max(customerReference, 1)), 0.5, 2);
    const facilityCount = counts.hospitals + counts.police + counts.fire;
    const damageFraction = 1 - Math.exp(-damageHours / DAMAGE_REF_HOURS);
    // Each term is first scaled to 0-1 ("norm"), lifted onto FACTOR_FLOOR-1, then raised to its weight; the score is their product.
    const norm = {
      facilities: item.weightedFacilities / facilityWeightMax,
      risk: riskProbability,
      density: Math.max(0, premise.f[0]) / densityMax,
      customers: Math.log1p(circuitCustomers(premise)) / customerMax,
      history: Math.sqrt(item.cellDamageHistory) / reportMax,
      damage: damageFraction,
    };
    const mult = {};
    Object.keys(norm).forEach(k => { mult[k] = Math.pow(FACTOR_FLOOR + (1 - FACTOR_FLOOR) * Math.min(1, Math.max(0, norm[k])), W[k]); });
    const propensityScore = damageEstimate.rate / damageRateMax;
    const historyScore = Math.sqrt(item.cellDamageHistory) / reportMax;
    // Model-predicted premises keep the rate/history blend; premises with a manual scenario use their entered damage.
    const damageSeverityScore = scenario.src === "manual"
      ? 100 * damageFraction
      : damageEstimate.zero ? 0 : 100 * (0.7 * propensityScore + 0.3 * historyScore);
    const score = 100 * Object.values(mult).reduce((prod, value) => prod * value, 1);
    return {
      premise,
      circuit: premise.c + 1,
      counts,
      customers: circuitCustomers(premise),
      cellDamageHistory: item.cellDamageHistory,
      damageSeverityScore,
      riskProbability,
      facilityCount,
      facilityAllowanceMinutes: facilityCount * 2,
      restorationFactors: {density: densityFactor, customers: customerFactor},
      norm,
      mult,
      score,
      level: levelOf(score),
      scenario,
      custom: !forceModel && premise.id in SCEN,
      work,
      damageHours,
      damageEstimate,
    };
  }).sort((a, b) => b.score - a.score || a.premise.id.localeCompare(b.premise.id));
}

// Repair mix from the pipeline (Feb 2025 ARCOS records by asset group), folded into the four crew types.
const REPAIR_MIX = (() => {
  const g = DM.groups, v = k => g[k] || 0;
  const raw = [
    {name: "Wire", share: v("Primary wire") + v("Secondary wire"), item: "wire", team: "line"},
    {name: "Switch", share: v("Fuse bank") + v("Other"), item: "rec", team: "protection"},   // fuse banks use the recloser hours; "Other" joins them
    {name: "Pole", share: v("Pole"), item: "pole", team: "line"},
    {name: "Equipment", share: v("Transformer"), item: "xf", team: "equipment"},
  ];
  const tot = raw.reduce((a, t) => a + t.share, 0) || 1;
  return raw.map(t => ({...t, share: t.share / tot}));
})();
// Field delays (explicit, editable assumptions; none of these are fitted to data). All times in hours.
const DELAYS = {
  travelPerJob: 0.75,            // drive, access and set-up per repair job (scaled by the job's expected weight)
  travelPerInspection: 0.5,      // drive and access per site inspection
  materials: {Wire: 1, Switch: 2, Pole: 2.5, Equipment: 2.5},   // staging / pulling materials before a repair can start
  accessBlocked: 5,              // extra hours before repairs can start when access is blocked (middle of the 2-8 h operator assumption)
  switchingStep: 1,              // hours after the inspection to isolate a fault beyond the nearest fuse/recloser and restore by switching
  workHoursPerDay: 16,           // crews work 16 h, then rest 8 h (shift/rest limits), on a shared 24 h clock
};
// The schedule runs in productive crew hours; this converts to wall-clock time by inserting the rest periods.
function toWallClock(work) {
  const d = DELAYS.workHoursPerDay;
  return Math.floor(work / d + 1e-12) * 24 + (work % d);
}
// Work time of one repair job = workbook labor hours x indirect multiplier / people on the team.
function jobHours(type) {
  const W = RESPONSE_WORKFORCE, size = W.people[type.team] / W.teams[type.team];
  return L.items[type.item].hours * Math.max(1, num("mu")) / size;
}

// ---------------------------------------------------------------- per-premise damage scenarios
// Every premise has its own damage scenario; the sidebar card edits the premise selected in the dropdown.
// A scenario is either "model" (expected damage from the outage model for the current storm) or "manual" (entered quantities).
const ITEM_META = {
  pole: {name: "Pole", team: "line", mat: "Pole", label: "pole"},
  arm: {name: "Crossarm", team: "line", mat: "Pole", label: "crossarm"},
  ins: {name: "Insulator set", team: "line", mat: "Wire", label: "insulator set"},
  wire: {name: "Wire span", team: "line", mat: "Wire", label: "wire span"},
  xf: {name: "Transformer", team: "equipment", mat: "Equipment", label: "transformer"},
  rec: {name: "Recloser/fuse", team: "protection", mat: "Switch", label: "recloser/fuse"},
};
const SCEN = {};   // premise id -> scenario (only premises that differ from the default are stored)
let SCEN_VER = 0;
const SCEN_FIELDS = ["dsrc", "n_pole", "n_arm", "n_xf", "n_ins", "n_wire", "n_rec", "ag", "fl", "ac"];
const defaultScenario = () => ({src: "model", n: {pole: 1, arm: 1, xf: 0, ins: 3, wire: 2, rec: 0}, ag: "Pole", fl: "branch", ac: false});
const scenarioFor = (id, forceModel) => forceModel ? defaultScenario() : (SCEN[id] || defaultScenario());
function readScenarioInputs() {
  const n = {};
  Object.keys(ITEM_META).forEach(k => n[k] = num("n_" + k));
  return {src: $("dsrc").value, n, ag: $("ag").value, fl: $("fl").value, ac: $("ac").checked};
}
const sameScenario = (a, b) => a.src === b.src && a.ag === b.ag && a.fl === b.fl && a.ac === b.ac &&
  (a.src === "model" || Object.keys(ITEM_META).every(k => a.n[k] === b.n[k]));
function storeScenario(id, s) {
  if (sameScenario(s, defaultScenario())) delete SCEN[id]; else SCEN[id] = s;
  SCEN_VER++;
}
function loadScenarioIntoInputs(id) {
  const s = scenarioFor(id);
  $("dsrc").value = s.src; $("ag").value = s.ag; $("fl").value = s.fl; $("ac").checked = s.ac;
  if (s.src === "manual") Object.keys(ITEM_META).forEach(k => $("n_" + k).value = s.n[k]);
}
function workFor(damageEstimate, scen, zeroStorm) {
  if (scen.src === "manual") {
    return Object.keys(ITEM_META).map(k => ({item: k, ...ITEM_META[k], count: Math.max(0, +scen.n[k] || 0)})).filter(w => w.count > 1e-9);
  }
  const jobs = zeroStorm ? 0 : damageEstimate.expectedRecords;
  return REPAIR_MIX.map(t => ({item: t.item, name: t.name, team: t.team, mat: t.name, count: jobs * t.share})).filter(w => w.count > 1e-9);
}
function scenarioText(scen, work) {
  if (scen.src === "manual") {
    const parts = Object.keys(ITEM_META).filter(k => (+scen.n[k] || 0) > 0).map(k => `${f2(+scen.n[k], +scen.n[k] % 1 ? 1 : 0)} ${ITEM_META[k].label}${+scen.n[k] === 1 ? "" : "s"}`);
    return "manual: " + (parts.join(", ") || "no damage");
  }
  const jobs = work.reduce((a, w) => a + w.count, 0);
  return jobs > 0 ? `model: ${f2(jobs, 2)} expected repairs` : "model: no storm, no damage";
}

// ---------------------------------------------------------------- priority score and levels
// Six terms are MULTIPLIED: score = 100 x product of (FACTOR_FLOOR + (1 - FACTOR_FLOOR) x term)^weight, a weighted geometric mean.
// The weights are exponents that sum to 1 and are a policy choice (not learned); the damage-scenario term makes the score
// respond to the scenario entered for the premise. The floor keeps one zero term (for example no nearby hospital) from zeroing the score.
const PRIORITY_WEIGHTS = {facilities: 0.15, risk: 0.30, density: 0.10, customers: 0.10, history: 0.10, damage: 0.25};
const FACTOR_FLOOR = 0.1;
const WORK_EXPONENT = 0.15;   // how strongly a short job is favoured in the dispatch index; 0 would be pure score order
const PRIORITY_TERMS = [
  ["facilities", "Emergency services nearby"], ["risk", "Outage risk"], ["density", "Customer density"],
  ["customers", "Customers on circuit"], ["history", "Past damage nearby"], ["damage", "Damage scenario"],
];
const LEVELS = [{name: "Critical", min: 38}, {name: "High", min: 31}, {name: "Medium", min: 25}, {name: "Low", min: -Infinity}];
const LEVEL_COL = {Critical: "#b0001a", High: "#d9451f", Medium: "#c26a00", Low: "#2e7d32"};
const levelOf = s => LEVELS.find(l => s >= l.min).name;
const levelChip = n => `<span class="lvl" style="background:${LEVEL_COL[n]}">${n}</span>`;
// Direct labor hours of an average repair event under the Feb 2025 repair mix; the damage term saturates at about three such events.
const HOURS_PER_EVENT = REPAIR_MIX.reduce((a, t) => a + t.share * L.items[t.item].hours, 0);
const DAMAGE_REF_HOURS = 3 * HOURS_PER_EVENT;

// Crews: the 1,000-worker roster is scaled by the "Crews deployed" slider. The default is an assumption, chosen so that crews are
// scarce enough for the dispatch order to matter (at 100% the schedule is never resource-limited, so order changes nothing).
const DEFAULT_CREW_SCALE = 0.1;
const crewScale = () => Math.max(0.02, Math.min(1, (parseFloat($("cw").value) || DEFAULT_CREW_SCALE * 100) / 100));
function teamCounts(scale) {
  const t = {};
  Object.keys(RESPONSE_WORKFORCE.teams).forEach(k => t[k] = Math.max(1, Math.round(RESPONSE_WORKFORCE.teams[k] * scale)));
  return t;
}

let SCHED_KEY = "", SCHED_VAL = null;
// Unmodeled latency (hours before the response is fully under way: storm still active, safe-to-work wait, dispatch, mobilization,
// outage reporting). It is calibrated once per labor multiplier at the DEFAULT crew level and the all-model scenarios, so that the
// job-weighted median completion at the reference storm (Feb 2025, severity 1) is no earlier than the trained AFT baseline median,
// then scaled to other storms by the same learned severity slope (S^beta). It does not depend on the sliders or scenarios you change,
// so more crews or a different scenario move the estimate. Zero severity still gives zero.
let LAG_KEY = "", LAG_VAL = {lag0: 0, med: 0, target: 0};
function referenceStorm() {
  const t = SV.terms;
  return {gust: t[0].ref, rain: t[1].ref, snow: t[2].ref, ante: t[3].ref, leaf: t[4].ref};
}
function latencyCalibration() {
  const key = String(num("mu"));
  if (key === LAG_KEY) return LAG_VAL;
  const sc = scheduleAllPremisesRaw(referenceStorm(), 0, {scale: DEFAULT_CREW_SCALE, forceModel: true});
  const act = sc.premises.filter(q => !q.idle).sort((a, b) => a.completion - b.completion);
  const total = act.reduce((a, q) => a + q.expectedJobs, 0);
  let acc = 0, med = 0;
  for (const q of act) { acc += q.expectedJobs; if (acc >= total / 2) { med = q.completion; break; } }
  const target = Math.exp(R.terms[0].beta) * 24;   // trained AFT baseline median at severity 1 (hours)
  LAG_KEY = key; LAG_VAL = {lag0: Math.max(0, target - med), med, target};
  return LAG_VAL;
}
function scheduleAllPremises(o) {
  const key = JSON.stringify(o) + "|" + num("mu") + "|" + crewScale() + "|" + SCEN_VER;
  if (key === SCHED_KEY) return SCHED_VAL;
  const S = sevCalc(o).S, lag = S > 0 ? latencyCalibration().lag0 * Math.pow(S, R.severity_scaling.beta) : 0;
  SCHED_VAL = scheduleAllPremisesRaw(o, lag); SCHED_KEY = key;
  SCHED_VAL.latencyHours = lag;
  return SCHED_VAL;
}

// Priority-weighted dispatch (the restoration scheduling algorithm):
//  1. Score every premise 0-100 and give it a level (Critical / High / Medium / Low).
//  2. Zone inheritance: premises behind the same protection device are repaired together, so each takes the highest score in its zone.
//  3. Dispatch order = descending dispatch index = score x (1 + total work hours)^-WORK_EXPONENT, then id. Higher scores go first in general;
//     a premise with much less work gets a mild boost, so order is soft, not strict.
//  4. Work flows through limited crew pools: assessment -> tree/access clearing -> repair. Whenever a crew frees up it takes the ready
//     task of the highest-ranked premise (work-conserving; nothing waits for a lower-priority premise).
//  5. Step restoration: damage beyond a premise's nearest fuse/recloser lets that premise be restored right after switching.
function scheduleAllPremisesRaw(o, lag, opts) {
  const scale = opts && opts.scale != null ? opts.scale : crewScale(), T = teamCounts(scale);
  const premises = scorePriorityPremises(o, opts).map(priority => {
    const work = priority.work, idle = work.length === 0, jobs = work.reduce((a, w) => a + w.count, 0);
    const manual = priority.scenario.src === "manual";
    const inspectionDuration = idle ? 0 : DELAYS.travelPerInspection + 0.5 + priority.damageSeverityScore / 200 + priority.facilityAllowanceMinutes / 60;
    const assessmentDuration = idle ? 0 : inspectionDuration + 0.5 * jobs;   // site inspection, then detailed assessment by the same team
    const repairHours = work.reduce((a, w) => a + w.count * jobHours(w), 0);
    return {
      ...priority,
      outageRisk: priority.riskProbability,
      idle,
      lowRisk: idle,
      damageProbability: idle ? 0 : manual ? 1 : priority.damageEstimate.probability,
      expectedJobs: jobs,
      facilities: {hospital: priority.counts.hospitals, police: priority.counts.police, fire: priority.counts.fire},
      modeledRepairHours: repairHours,
      inspectionDuration, assessmentDuration,
      workHours: assessmentDuration + repairHours + jobs * DELAYS.travelPerJob,
      stepRestored: !idle && priority.scenario.fl === "other" && priority.premise.nd > 0,
      accessBlocked: !idle && !!priority.scenario.ac,
      teams: {assessment: 0, detailedAssessment: 0, tree: 0, line: 0, protection: 0, equipment: 0},
      visitStart: 0, inspectionComplete: 0, assessmentComplete: 0, rank: 0, dispatchScore: priority.score, dispatchLevel: priority.level, zoneInherited: false,
      repairStart: null, repairComplete: 0, repairDuration: 0, visitDuration: 0, completion: null, categoryJobs: {},
    };
  });
  const active = premises.filter(q => !q.idle), idlePremises = premises.filter(q => q.idle);
  // Steps 2-3: zone inheritance, then the dispatch order.
  const zoneBest = new Map(), zoneOf = q => `${q.premise.c}|${q.premise.ch}|${q.premise.z}`;
  active.forEach(q => zoneBest.set(zoneOf(q), Math.max(zoneBest.get(zoneOf(q)) || 0, q.score)));
  active.forEach(q => { q.dispatchScore = zoneBest.get(zoneOf(q)); q.dispatchLevel = levelOf(q.dispatchScore); q.zoneInherited = q.dispatchScore > q.score + 1e-9; });
  const lvl = name => LEVELS.findIndex(l => l.name === name);
  active.forEach(q => { q.dispatchIndex = q.dispatchScore * Math.pow(1 + q.workHours, -WORK_EXPONENT); });
  active.sort((a, b) => b.dispatchIndex - a.dispatchIndex || a.premise.id.localeCompare(b.premise.id));
  active.forEach((q, i) => { q.rank = i; });
  // Step 4a: assessment pool (inspection, then detailed assessment, by one team per premise).
  const assess = scheduleTeamTasks(active.map(q => ({id: q.premise.id, rank: q.rank, readyAt: 0, duration: q.assessmentDuration})), T.assessment);
  active.forEach(q => {
    q.visitStart = assess.starts.get(q.premise.id);
    q.inspectionComplete = q.visitStart + q.inspectionDuration;
    q.assessmentComplete = assess.completions.get(q.premise.id);
    q.teams.assessment = 1;
    q.completion = q.assessmentComplete; q.repairComplete = q.assessmentComplete;
  });
  // Step 4b: tree/access clearing and repair tasks (fractional expected work becomes proportionally shorter tasks).
  let seq = 0;
  const treeTasks = [], repairTasks = [];
  active.forEach(q => {
    q.work.forEach(w => {
      q.categoryJobs[w.name] = (q.categoryJobs[w.name] || 0) + w.count;
      const perJob = jobHours(w);
      let treeRemaining = w.team === "line" ? w.count * 0.2 : 0;
      splitExpectedWork(w.count).forEach(unit => {
        const treeWeight = Math.min(unit, treeRemaining), pieces = [];
        if (treeWeight > 1e-8) pieces.push({weight: treeWeight, needsTree: true});
        if (unit - treeWeight > 1e-8) pieces.push({weight: unit - treeWeight, needsTree: false});
        treeRemaining = Math.max(0, treeRemaining - treeWeight);
        pieces.forEach(piece => {
          const id = `${q.premise.id}|${w.item}|${seq++}`;
          if (piece.needsTree) treeTasks.push({id, premise: q.premise.id, rank: q.rank, readyAt: q.assessmentComplete, duration: 0.5 * piece.weight});
          repairTasks.push({id, premise: q.premise.id, rank: q.rank, team: w.team, needsTree: piece.needsTree, base: q.assessmentComplete,
            duration: (perJob + DELAYS.travelPerJob) * piece.weight,
            delay: (DELAYS.materials[w.mat] || 0) * Math.min(1, piece.weight) + (q.accessBlocked ? DELAYS.accessBlocked : 0)});
        });
      });
    });
    q.teams.detailedAssessment = Math.min(Math.ceil(q.expectedJobs), T.assessment);
    const lineJobs = q.work.filter(w => w.team === "line").reduce((a, w) => a + w.count, 0);
    q.teams.tree = lineJobs > 0 ? Math.min(Math.ceil(lineJobs * 0.2), T.tree) : 0;
    ["line", "equipment", "protection"].forEach(team => {
      const mine = q.work.filter(w => w.team === team).reduce((a, w) => a + w.count, 0);
      q.teams[team] = mine > 0 ? Math.min(Math.ceil(mine), T[team]) : 0;
    });
  });
  const treeCleared = scheduleTeamTasks(treeTasks, T.tree).completions;
  const byId = new Map(active.map(q => [q.premise.id, q]));
  ["line", "equipment", "protection"].forEach(team => {
    const jobs = repairTasks.filter(t => t.team === team).map(t => ({...t, readyAt: (t.needsTree ? treeCleared.get(t.id) || t.base : t.base) + t.delay}));
    const {completions, starts} = scheduleTeamTasks(jobs, T[team]);
    jobs.forEach(job => {
      const q = byId.get(job.premise), start = starts.get(job.id), done = completions.get(job.id) || 0;
      q.repairStart = q.repairStart === null ? start : Math.min(q.repairStart, start);
      q.repairComplete = Math.max(q.repairComplete, done);
      q.completion = Math.max(q.completion, done);
    });
  });
  // Step 5: step restoration (service returns after switching; the repair of the damage beyond the fuse still runs and uses crews).
  active.forEach(q => { if (q.stepRestored) q.completion = q.inspectionComplete + DELAYS.switchingStep; });
  // Convert productive crew hours to wall-clock time (rest periods between shifts) and add the latency.
  active.forEach(q => {
    ["visitStart", "inspectionComplete", "assessmentComplete", "completion", "repairComplete"].forEach(k => { q[k] = toWallClock(q[k]) + lag; });
    if (q.repairStart !== null) q.repairStart = toWallClock(q.repairStart) + lag;
    q.repairDuration = q.repairStart === null ? 0 : q.repairComplete - q.repairStart;
    q.visitDuration = q.completion - q.visitStart;
  });
  return {
    premises: active.concat(idlePremises),
    makespan: Math.max(0, ...active.map(q => q.completion)),
    expectedDamageProbability: active.reduce((sum, q) => sum + q.damageProbability, 0),
    expectedDamageRecords: active.reduce((sum, q) => sum + q.expectedJobs, 0),
    noOutageCount: idlePremises.length,
    idleCount: idlePremises.length,
    crewScale: scale, teams: T,
  };
}

function formatScheduledDuration(hours) {
  if (hours <= 0) return "0 min";
  const minutes = Math.max(5, Math.round(hours * 12) * 5);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ---------------------------------------------------------------- NWS (api.weather.gov) live conditions
// Only the ~400 m cell centre of the selected premise, rounded to 2 decimals (~1 km), is sent to the NWS.
const NWS = "https://api.weather.gov";
const MM_IN = 1 / 25.4, KMH_MPH = 0.621371;
function isoDurH(d) { const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?)?/.exec(d) || []; return (+m[1] || 0) * 24 + (+m[2] || 0) || 1; }
function gridSeries(prop) {
  return ((prop && prop.values) || []).filter(v => v.value != null).map(v => {
    const [t, d] = v.validTime.split("/"), a = Date.parse(t);
    return {a, b: a + isoDurH(d) * 3600e3, v: v.value};
  });
}
function overlap(x, a, b) { return Math.max(0, Math.min(x.b, b) - Math.max(x.a, a)) / (x.b - x.a); }
const sliderFit = (id, v) => { const e = $(id), st = +e.step || 1; return Math.min(+e.max, Math.max(+e.min, Math.round(v / st) * st)); };
async function getJson(u) { const r = await fetch(u, {headers: {Accept: "application/geo+json"}}); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }
const nwsCache = {};   // "lat,lon" -> {t, v, used}; reused for 10 minutes
let nwsTok = 0;
let nwsOk = false;
function applyNWS(c) {
  nwsOk = true;
  const v = c.v;
  ["gust", "rain", "snow", "ante"].forEach(i => $(i).value = sliderFit(i, v[i]));
  $("leaf").checked = !!v.leaf;
  $("nws").textContent = "Default values for each premise come from National Weather Service data for the location.";
}
async function loadNWS() {
  const st = $("nws"), p = D.prem[$("pm").value], tok = ++nwsTok;
  const key = p.p[1].toFixed(2) + "," + p.p[0].toFixed(2), hit = nwsCache[key];
  if (hit && Date.now() - hit.t < 6e5) { applyNWS({...hit, cached: true}); render(); return; }
  st.textContent = "Fetching current NWS conditions for this premise...";
  try {
    const lat = p.p[1].toFixed(2), lon = p.p[0].toFixed(2), now = Date.now();
    const pt = (await getJson(`${NWS}/points/${lat},${lon}`)).properties;
    const grid = getJson(pt.forecastGridData);
    const stn = getJson(pt.observationStations).then(j => j.features.slice(0, 3).map(f => f.properties.stationIdentifier));
    const g = (await grid).properties;
    let gust = 0, rainF = 0, snowF = 0;
    gridSeries(g.windGust).forEach(x => { if (overlap(x, now, now + 864e5) > 0) gust = Math.max(gust, x.v * KMH_MPH); });
    gridSeries(g.quantitativePrecipitation).forEach(x => rainF += x.v * MM_IN * overlap(x, now, now + 864e5));
    gridSeries(g.snowfallAmount).forEach(x => snowF += x.v * MM_IN * overlap(x, now, now + 864e5));
    // Observations from the nearest station that reports: trailing 72 h
    let rain24 = 0, rain3d = 0, obsGust = 0, used = "forecast only";
    for (const id of await stn) {
      try {
        const o = await getJson(`${NWS}/stations/${id}/observations?start=${new Date(now - 72 * 3600e3).toISOString()}&limit=300`);
        const hours = {};
        o.features.forEach(f => {
          const q = f.properties, t = Date.parse(q.timestamp), w = q.windGust && q.windGust.value;
          if (w != null && now - t < 864e5) obsGust = Math.max(obsGust, /m_s/.test(q.windGust.unitCode) ? w * 2.23694 : w * KMH_MPH);
          const pr = q.precipitationLastHour && q.precipitationLastHour.value;
          if (pr != null) hours[Math.floor(t / 3600e3)] = pr;
        });
        const hk = Object.keys(hours);
        if (hk.length) {
          hk.forEach(h => { const age = now - h * 3600e3; if (age < 864e5) rain24 += hours[h] * MM_IN; else rain3d += hours[h] * MM_IN; });
          used = "station " + id; break;
        }
      } catch (e) {}
    }
    const v = {gust: Math.max(gust, obsGust), rain: Math.max(rain24, rainF), snow: snowF, ante: rain3d, leaf: (new Date().getMonth() >= 4 && new Date().getMonth() <= 9) ? 1 : 0};
    if (tok !== nwsTok) return;   // a newer premise selection superseded this request
    nwsCache[key] = {t: Date.now(), v, used};
    applyNWS(nwsCache[key]);
  } catch (e) {
    if (tok !== nwsTok) return;
    nwsOk = false;
    st.textContent = "Could not reach the National Weather Service, so the sliders keep their default values. You can still set them by hand.";
  }
  render();
}

// ---------------------------------------------------------------- setup
D.prem.forEach((p, i) => {
  const o = document.createElement("option");
  o.value = i; o.textContent = p.id + " · circuit C-" + (p.c + 1) + " · " + D.circ[p.c].n.toLocaleString() + " customers on circuit";
  $("pm").appendChild(o);
});
R.groups.length && ["Primary wire"].concat(R.groups).forEach(g => {
  const o = document.createElement("option"); o.value = g; o.textContent = g; $("ag").appendChild(o);
});
$("ag").value = "Pole";
{ const b = document.createElement("button"); b.textContent = "Current NWS conditions"; b.onclick = loadNWS; $("presets").appendChild(b); }
Object.keys(PRESETS).forEach(k => {
  const b = document.createElement("button"); b.textContent = PRESETS[k].n; b.dataset.k = k;
  b.onclick = () => {
    const v = PRESETS[k].v;
    ["gust", "rain", "snow", "ante"].forEach(i => $(i).value = v[i]);
    $("leaf").checked = !!v.leaf; render();
  };
  $("presets").appendChild(b);
});
const TABS = [["over", "Overview"], ["risk", "Risk drivers"], ["algo", "Algorithm"], ["rest", "Restoration", [["restp", "Priority"], ["restm", "Methods"]]], ["prep", "Prepare"], ["msg", "Alerts & messages"], ["meth", "Model & validation"], ["ast", "Assistant"]];
const LEAF_TABS = TABS.flatMap(([k, , kids]) => kids ? kids.map(c => c[0]) : [k]);
let tab = "over", mt = 0, lastPm = null;
function closeTabMenus() {
  document.querySelectorAll(".tabmenu").forEach(m => { m.hidden = true; m.previousElementSibling.setAttribute("aria-expanded", "false"); });
}
function showTab(t) {
  tab = t;
  closeTabMenus();
  LEAF_TABS.forEach(k => $("t_" + k).hidden = k !== t);
  document.querySelectorAll("#tabs > button, #tabs > .tabgrp > button").forEach(b => {
    const kids = b.dataset.kids ? b.dataset.kids.split(",") : null;
    b.setAttribute("aria-selected", kids ? kids.includes(t) : b.dataset.tab === t);
  });
  document.querySelectorAll(".tabmenu button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === t ? "true" : "false"));
  if (t === "over" && map) setTimeout(() => map.resize(), 30);
}
TABS.forEach(([k, n, kids]) => {
  const b = document.createElement("button"); b.setAttribute("role", "tab"); b.dataset.tab = k;
  if (!kids) { b.textContent = n; b.onclick = () => showTab(k); $("tabs").appendChild(b); return; }
  const g = document.createElement("div"); g.className = "tabgrp";
  b.textContent = n + " ▾"; b.dataset.kids = kids.map(c => c[0]).join(",");
  b.setAttribute("aria-haspopup", "menu"); b.setAttribute("aria-expanded", "false");
  const m = document.createElement("div"); m.className = "tabmenu"; m.setAttribute("role", "menu"); m.hidden = true;
  kids.forEach(([ck, cn]) => {
    const mb = document.createElement("button"); mb.textContent = cn; mb.dataset.tab = ck; mb.setAttribute("role", "menuitem");
    mb.onclick = e => { e.stopPropagation(); showTab(ck); };
    m.appendChild(mb);
  });
  b.onclick = e => {
    e.stopPropagation();
    const open = m.hidden; closeTabMenus(); m.hidden = !open; b.setAttribute("aria-expanded", String(open));
    if (open) m.firstChild.focus();
  };
  g.append(b, m); $("tabs").appendChild(g);
});
document.addEventListener("click", closeTabMenus);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeTabMenus(); });

// Scenario editing: the sidebar card edits the premise selected in the dropdown. These listeners are registered before the
// page-wide "render on input" listener, so the stored scenario is up to date when render() runs.
let scenPm = null;
SCEN_FIELDS.forEach(id => $(id).addEventListener("input", () => { if (scenPm !== null) storeScenario(D.prem[scenPm].id, readScenarioInputs()); }));
$("sc_all").onclick = () => { const cur = readScenarioInputs(); D.prem.forEach(q => storeScenario(q.id, JSON.parse(JSON.stringify(cur)))); render(); };
$("sc_reset").onclick = () => { const id = D.prem[$("pm").value].id; delete SCEN[id]; SCEN_VER++; loadScenarioIntoInputs(id); render(); };
$("sc_clear").onclick = () => { Object.keys(SCEN).forEach(k => delete SCEN[k]); SCEN_VER++; loadScenarioIntoInputs(D.prem[$("pm").value].id); render(); };
const bar = (P, c) => `<div class="bar"><i style="width:${Math.round(P * 100)}%;background:${c}"></i></div>`;

// ---------------------------------------------------------------- render
// Slider track fill: empty at the minimum, full at the maximum.
function syncRanges() {
  document.querySelectorAll('input[type=range]').forEach(e => {
    const lo = +e.min || 0, hi = +e.max || 100;
    e.style.setProperty("--p", (100 * (Math.max(lo, Math.min(hi, +e.value)) - lo) / (hi - lo)) + "%");
  });
}
function render() {
  syncRanges();
  if (scenPm !== $("pm").value) { scenPm = $("pm").value; loadScenarioIntoInputs(D.prem[scenPm].id); }
  const o = readStorm(), p = D.prem[$("pm").value], x = risk(p, o), band = bandOf(x.P), col = COL[band];
  const rs = restoration(), conf = confidence(x);
  const schedule = scheduleAllPremises(o);
  const selectedPremise = schedule.premises.find(item => item.premise.id === p.id);
  if (!selectedPremise) throw new Error(`No restoration schedule found for premise ${p.id}`);
  const estimate = formatScheduledDuration(selectedPremise.completion);
  { const tc = teamCounts(crewScale()); $("cw_v").textContent = Math.round(crewScale() * 100) + "%"; $("scen_for").textContent = p.id; const nc = Object.keys(SCEN).length;
    $("sc_count").textContent = (nc ? nc + " of " + D.prem.length + " premises have a custom scenario." : "No premise has a custom scenario yet.") + " " + tc.assessment + " assessment, " + tc.line + " line, " + tc.equipment + " equipment, " + tc.protection + " protection teams deployed."; }
  $("gust_v").textContent = o.gust + " mph"; $("rain_v").textContent = f2(o.rain, 1) + " in";
  $("snow_v").textContent = f2(o.snow, 1) + " in"; $("ante_v").textContent = f2(o.ante, 1) + " in";
  $("sevline").innerHTML = `Storm severity <b>${f2(x.sv.S)}</b> × Feb 2025 (${sevName(x.sv.S)}) · ${chip(SV.source)}`;
  $("hdpill").textContent = "Model trained " + M.generated.slice(0, 10) + " · anonymized data";
  Object.keys(L.items).forEach(k => { const e = $("n_" + k); e.disabled = !rs.manual; if (!rs.manual) e.value = f2(DM.shares[k] * rs.N, 1); });
  const long = rs.hi >= 24, pre = band !== "Low" || p.ls, esc = p.ls || long || band === "Imminent";
  $("kpis").innerHTML =
    `<div class="kpi"><small>Outage risk</small><div class="v" style="color:${col}">${band}</div>${bar(x.P, col)}<div class="n">${pc(x.P)} chance<br>80% interval ${pc(x.Plo)}–${pc(x.Phi)}</div></div>
<div class="kpi"><small>Your premise-specific restoration estimate</small><div class="v">${estimate}</div><div class="n">${p.id} · circuit C-${p.c + 1} · inspection then repair, scheduled with the other premises · model estimate</div></div>
<div class="kpi"><small>Storm severity</small><div class="v">${sevName(x.sv.S)}</div><div class="n">${f2(x.sv.S)} × the Feb 2025 storm · weather weights ${SV.source}</div></div>
<div class="kpi"><small>Alerts</small><div class="v">${pre ? "Eligible" : "Not yet"}</div><div class="n">${esc ? "Human escalation triggered" : "Standard automated alerts"}</div></div>`;
  renderRisk(p, o, x, band, col);
  renderAlgo(p, o, x, band, conf);
  renderRestPriority(p, schedule, estimate);
  renderRestMethods(p, x, rs, schedule);
  renderPrep(p, band, long, pre, esc, rs);
  renderMsgs(o, band, estimate, rs, p);
  renderMeth();
  if (mapReady) updateMap(x, p, o, col); else if (fb) drawFb();
  if (lastPm !== $("pm").value) { lastPm = $("pm").value; focusMap(); }
}

function renderRisk(p, o, x, band, col) {
  const sumC = x.ce.contrib.reduce((a, b) => a + b, 0);
  const m0 = TYPICAL_ZONE * Math.exp(BETA[0]), m1 = m0 * Math.exp(sumC), m2 = m1 * x.sv.S, m3 = x.mu;
  const ST = [["Typical cell, Feb 2025-like storm", `typical zone of ${TYPICAL_ZONE} customers`, 1, m0],
    ["Your location’s features", "from the trained model, see below", Math.exp(sumC), m1],
    ["Your storm conditions", `severity ${f2(x.sv.S)} × Feb 2025`, x.sv.S, m2],
    ["Your protection zone", `${x.zone} customers vs ${TYPICAL_ZONE} typical`, x.zone / TYPICAL_ZONE, m3]];
  $("build").innerHTML = ST.map((s, i) => `<div class="bars"><div><b>${s[0]}</b><div class="mu">${s[1]}</div></div><div class="track"><i style="left:0;width:${Math.round(pNB(s[3], O.alpha) * 100)}%;background:${i === 3 ? col : "#d71920"};opacity:${i === 3 ? 1 : .45}"></i></div><div style="text-align:right;font-weight:700">${i ? "×" + f2(s[2]) + " · " : ""}${pc(pNB(s[3], O.alpha))}</div></div>`).join("");
  $("featbars").innerHTML = FE.map((f, i) => {
    const c = x.ce.contrib[i], w = Math.min(50, Math.abs(c) * 45);
    return `<div class="bars"><div>${f.label}</div><div class="track"><div class="mid"></div><i style="${c >= 0 ? "left:50%" : "right:50%"};width:${w}%;background:${c >= 0 ? "#d71920" : "#2e7d32"}"></i></div><b style="text-align:right">×${f2(Math.exp(c))}</b></div>`;
  }).join("");
  const V = [["Gust +10 mph", {gust: o.gust + 10}], ["Gust −10 mph", {gust: Math.max(15, o.gust - 10)}], ["Rain +1 in", {rain: o.rain + 1}],
    ["Snow +4 in", {snow: o.snow + 4}], ["Previous 3-day rain +1 in", {ante: o.ante + 1}], [o.leaf ? "Trees bare" : "Trees in leaf", {leaf: o.leaf ? 0 : 1}]];
  $("sens").innerHTML = V.map(([n, ch]) => {
    const d = (risk(p, {...o, ...ch}).P - x.P) * 100, w = Math.min(50, Math.abs(d) * 1.2);
    return `<div class="bars"><span>${n}</span><div class="track"><div class="mid"></div><i style="${d >= 0 ? "left:50%" : "right:50%"};width:${w}%;background:${d >= 0 ? "#d71920" : "#2e7d32"}"></i></div><b style="text-align:right">${sg(d, 1)}</b></div>`;
  }).join("");
  $("expl").innerHTML = `<table><tr><th>Feature of your cell</th><th class="r">Your value</th><th class="r">Typical</th><th class="r">Rate ratio per +1 SD (95% CI)</th><th>Reading</th></tr>` +
    FE.map((f, i) => { const t = O.terms[2 + i];
      return `<tr><td><b>${f.label}</b><div class="mu">${f.desc}</div></td><td class="r">${f2(p.f[i])}</td><td class="r">${f2(f.mean)}</td><td class="r">${f2(t.rr)} (${f2(t.rr_lo)}–${f2(t.rr_hi)})</td><td>${FEAT_WHY[f.key]}</td></tr>`; }).join("") +
    `</table><div class="mu" style="margin-top:8px">These are statistical associations in two storms, not proven causes. Weather inputs enter through the storm-severity multiplier.</div>`;
  $("reasons").innerHTML = (() => {
    const rows = FE.map((f, i) => [f.label, x.ce.contrib[i]]).concat([["Storm conditions", x.sv.ls], ["Protection zone size", Math.log(x.zone / TYPICAL_ZONE)]])
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
    return `<ul>${rows.map(r => `<li><b>${r[0]}</b> ${r[1] > .05 ? "raises" : r[1] < -.05 ? "lowers" : "barely changes"} your risk (×${f2(Math.exp(r[1]))} vs typical).</li>`).join("")}</ul><div class="mu">Open “Algorithm” to see every step with your numbers.</div>`;
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
<div class="mu">Negative binomial GLM with log link and ridge penalty λ=${O.l2}, fit on ${O.n_rows.toLocaleString()} cell×event rows with ${O.n_damage.toLocaleString()} damage records.</div></div></div>
<div class="step"><div class="no">3</div><div><h3 style="margin-top:0">Storm severity multiplier ${chip(SV.source)}</h3>
<table><tr><th>Input</th><th class="r">Your value</th><th class="r">Feb 2025 ref</th><th class="r">Δ</th><th class="r">Coefficient</th><th class="r">Δ·coef</th></tr>${sevRows}</table>
<div class="formula">log S = Σ coefₖ·Δₖ = <b>${sg(x.sv.ls, 3)}</b>      S = exp(log S) = <b>${f2(x.sv.S, 3)}</b></div>
<div class="${covNote ? "warn" : "fact"}">${covNote ? "<b>These weather weights are not learned.</b> " + SV.reason : "Weather weights learned from daily outage counts (" + SV.n_days + " days), blocked CV deviance skill " + f2(SV.cv_deviance_skill) + "."}</div></div></div>
<div class="step"><div class="no">4</div><div><h3 style="margin-top:0">Customers behind your nearest protective device ${chip("assumption")}</h3>
<div class="formula">zone = <b>${x.zone}</b> customers ${p.nd ? "(" + p.ch + ")" : "(no fuse or recloser upstream, so the whole circuit)"}
expected damage records μ = zone × exp(η) × S = ${x.zone} × ${f2(Math.exp(x.ce.eta), 4)} × ${f2(x.sv.S, 3)} = <b>${f2(x.mu, 3)}</b></div>
<div class="mu">Assumes any damage inside the zone interrupts every customer behind it, and that cell-level dispersion applies to the zone (this likely overstates how much clustering a large zone has, so probabilities for large zones may run low).</div></div></div>
<div class="step"><div class="no">5</div><div><h3 style="margin-top:0">Probability of an outage ${chip("standard")}</h3>
<div class="formula">P(at least one) = 1 − (1 + α·μ)^(−1/α), with fitted α = <b>${f2(O.alpha, 2)}</b>
P = 1 − (1 + ${f2(O.alpha, 2)}×${f2(x.mu, 3)})^(−${f2(1 / O.alpha, 3)}) = <b>${pc(x.P)}</b></div></div></div>
<div class="step"><div class="no">6</div><div><h3 style="margin-top:0">Uncertainty ${chip("learned")}</h3>
<div class="formula">Var(η) from the coefficient covariance = ${f2(x.ce.v, 4)}      Var(log S) = ${f2(x.sv.v, 4)}
sd(log μ) = √(${f2(x.ce.v, 4)} + ${f2(x.sv.v, 4)}) = <b>${f2(x.sd, 3)}</b>
80% interval: μ × exp(±${Z80}·sd) → P from <b>${pc(x.Plo)}</b> to <b>${pc(x.Phi)}</b></div>
<div class="mu">This captures coefficient uncertainty only, not model-structure error. The cross-validated checks in “Model &amp; validation” cover the rest.</div></div></div>
<div class="step"><div class="no">7</div><div><h3 style="margin-top:0">Risk band and confidence ${chip("rule")}</h3>
<div class="formula">bands: Low &lt; ${B.cuts[0] * 100}% ≤ Moderate &lt; ${B.cuts[1] * 100}% ≤ High &lt; ${B.cuts[2] * 100}% ≤ Imminent
P = ${pc(x.P)} → <b>${band}</b>
interval width ratio = P-scale exp(2·${Z80}·sd) = ${f2(x.ratio, 2)}×   → ${x.ratio < 2 ? "High" : x.ratio < 4 ? "Medium" : "Low"}${SV.source === "prior" ? ", lowered one step because the weather weights are a prior" : ""}
confidence = <b>${conf}</b></div></div></div>`;
}

// ---------------------------------------------------------------- Restoration > Priority
function renderRestPriority(p, schedule, estimate) {
  const sel = schedule.premises.find(q => q.premise.id === p.id);
  const W = PRIORITY_WEIGHTS;
  const list = schedule.premises.slice().sort((a, b) => lvlIndex(a.level) - lvlIndex(b.level) || b.score - a.score || a.premise.id.localeCompare(b.premise.id));
  const order = new Map(list.map((q, i) => [q.premise.id, i + 1]));
  const detail = {
    facilities: q => `${q.counts.hospitals} hospital · ${q.counts.police} police · ${q.counts.fire} fire`,
    risk: q => `${pc(q.riskProbability)} outage chance`,
    density: q => `ln density ${f2(q.premise.f[0], 1)}`,
    customers: q => `${q.customers.toLocaleString()} on its circuit`,
    history: q => `${q.cellDamageHistory} past records`,
    damage: q => `${scenarioText(q.scenario, q.work)} · ${f2(q.damageHours, 1)} labor h`,
  };
  const rows = list.map(q => {
    const cells = PRIORITY_TERMS.map(([k]) => `<td class="fcell"><b>&times;${q.mult[k].toFixed(2)}</b><span class="mu"> (weight ${W[k].toFixed(2)})</span><div class="fbar"><i style="width:${Math.min(100, 100 * q.norm[k]).toFixed(0)}%"></i></div><div class="mu">${detail[k](q)}</div></td>`).join("");
    const notes = [
      q.custom ? "custom damage scenario" : "",
      q.zoneInherited ? `dispatched as ${q.dispatchLevel} (shares a protection zone with a score of ${q.dispatchScore.toFixed(1)})` : "",
      q.stepRestored ? "step restoration: restored right after switching" : "",
      q.accessBlocked ? "blocked access adds a clearing delay" : "",
      q.idle ? "no damage to repair" : "",
    ].filter(Boolean).join("; ") || "-";
    return `<tr data-i="${D.prem.indexOf(q.premise)}"${q.premise.id === p.id ? ' class="selected-premise"' : ""}>
<td class="r">${order.get(q.premise.id)}</td><td><b>${q.premise.id}</b><div class="mu">C-${q.circuit}</div></td><td>${levelChip(q.level)}</td><td class="r"><b>${q.score.toFixed(1)}</b></td>${cells}
<td class="r">${q.idle ? "-" : q.rank + 1}</td><td class="r"><b>${q.idle ? "-" : formatScheduledDuration(q.completion)}</b></td><td class="mu">${notes}</td></tr>`;
  }).join("");
  const nCustom = Object.keys(SCEN).length;
  const counts = LEVELS.map(l => `${levelChip(l.name)} ${schedule.premises.filter(q => q.level === l.name).length}`).join(" &nbsp; ");
  $("restp").innerHTML = `<h2>Restoration priority</h2>
<div class="mu">Selected premise <b>${p.id}</b> · priority ${levelChip(sel.level)} (score ${sel.score.toFixed(1)}) · dispatch position ${sel.idle ? "-" : "#" + (sel.rank + 1) + " of " + (schedule.premises.length - schedule.idleCount)}</div>
<div style="font-size:28px;font-weight:700">${estimate}</div>
<div class="mu">Restoration estimate: this premise's completion time in the priority-driven crew schedule, measured from the start of the response. A probability-weighted planning estimate, not a confirmed outage or repair duration; inspection findings may change it. Edit the premise's damage scenario in the sidebar and both its priority and its estimate update.</div>
<div class="fact"><b>${schedule.idleCount === schedule.premises.length ? "Nothing to schedule: no storm and no entered damage" : `Whole schedule finishes after ${formatScheduledDuration(schedule.makespan)}`}</b> · crews deployed ${Math.round(schedule.crewScale * 100)}% of the pool (${schedule.teams.assessment} assessment, ${schedule.teams.line} line, ${schedule.teams.equipment} equipment, ${schedule.teams.protection} protection teams) · ${nCustom} premise${nCustom === 1 ? "" : "s"} with a custom damage scenario</div>
<h3>All premises, highest priority first</h3>
<div class="mu">Levels by score: ${LEVELS.slice(0, -1).map(l => `${l.name} ${l.min} or more`).join(", ")}, otherwise Low. ${counts}. The score is the product of the factor multipliers. Each factor cell shows its multiplier (1.00 is the most it can be, and the lowest is ${Math.pow(FACTOR_FLOOR, 0.1).toFixed(2)} to ${Math.pow(FACTOR_FLOOR, 0.3).toFixed(2)} depending on weight), a bar for how high the factor is on its own 0-1 scale, and the value behind it. Click a row to select that premise (and edit its damage scenario in the sidebar). How the score and the schedule work is in Restoration &gt; Methods.</div>
<div class="priority-table-wrap" style="margin-top:8px"><table class="priority-table"><thead><tr><th class="r">#</th><th>Premise</th><th>Level</th><th class="r">Score (0-100)</th>${PRIORITY_TERMS.map(([k, n]) => `<th>${n}</th>`).join("")}<th class="r">Dispatch order</th><th class="r">Restoration estimate</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $("restp").querySelectorAll("tr[data-i]").forEach(tr => { tr.onclick = () => { $("pm").value = tr.dataset.i; render(); }; });
}
const lvlIndex = name => LEVELS.findIndex(l => l.name === name);

// ---------------------------------------------------------------- Restoration > Methods
function renderRestMethods(p, x, rs, schedule) {
  const H = rs.hist, W = PRIORITY_WEIGHTS, lc = latencyCalibration();
  const aft = R.terms.filter(t => t.selected && t.name.startsWith("asset:"));
  const T = teamCounts(DEFAULT_CREW_SCALE);
  $("restm").innerHTML = `<h2>How the restoration estimate is produced</h2>
<div class="mu">The estimate for a premise is its completion time in a crew schedule that serves higher-priority premises first. Four steps: a damage scenario turns into a work list, the work list helps set a priority score, the score sets the dispatch order, and limited crews work through the list in that order. Everything here is a planning model with explicit assumptions, not confirmed utility information.</div>
<h3>1. Damage scenario → work list ${chip("assumption")}</h3>
<div class="mu">Every premise has its own damage scenario, edited in the sidebar for the premise selected at the top (use "Apply to all premises" to copy it). A scenario is either <b>predicted by the model</b>, meaning the expected number of damage records for the premise's area under the current storm (it keeps growing with storm severity) split by the Feb 2025 repair mix (${REPAIR_MIX.map(t => `${t.name} ${Math.round(100 * t.share)}%`).join(", ")}), or <b>entered manually</b> as counts of poles, crossarms, transformers, insulator sets, wire spans and reclosers. Fractions are allowed: they are expected values, so 0.4 of a repair becomes a proportionally shorter task. A premise with no damage and no storm has nothing to schedule. "Blocked access" and "damage beyond my nearest fuse/recloser" are also part of the scenario (steps 4 and 5). "Main damage type" only selects the historical reference curve shown below.</div>
<h3>2. Priority score ${chip("rule")}</h3>
<div class="mu">Six terms are multiplied into a 0-100 score (a weighted geometric mean), so a premise needs to be strong on several factors at once to rank high, and a very weak factor pulls the score down instead of being made up for by another. The weights are a policy choice, not learned from data, and the damage-scenario term is the one that responds to the scenario you enter.</div>
<div class="formula">priority = 100 x  m(facilities)^${W.facilities} x m(risk)^${W.risk} x m(density)^${W.density} x m(customers)^${W.customers} x m(history)^${W.history} x m(damage)^${W.damage}
m(t)       = ${FACTOR_FLOOR} + ${f2(1 - FACTOR_FLOOR, 1)} x t     (t is each term below on a 0-1 scale; the floor keeps one zero term from zeroing the score)
facilities t = W / W_max,  W = 3 x hospitals + 2 x police + 1 x fire stations (each assigned to its nearest premise)
risk       t = P(outage),  the same probability as the Overview card (changes with the weather sliders)
density    t = max(0, ln customer density of the premise's 400 m cell) / its maximum over all premises
customers  t = ln(1 + customers on the premise's circuit) / its maximum over all premises
history    t = sqrt(historical damage records in the nearest cell) / its maximum over all premises
damage     t = 1 - exp(-H / ${f2(DAMAGE_REF_HOURS, 1)})   H = direct labor hours of the premise's work list
             (${f2(DAMAGE_REF_HOURS, 1)} h is about three average repair events, so the term saturates for very heavy damage)
The weights are exponents that sum to 1: a larger exponent means that factor moves the score more. Outage risk is largest, then damage scenario, then emergency services.</div>
<div class="mu">Levels: ${LEVELS.slice(0, -1).map(l => `<b>${l.name}</b> at ${l.min} or more`).join(", ")}, otherwise <b>Low</b>. Facilities more than ${FACILITY_MAX_KM} km from every circuit line are ignored. The density and history terms use the premise's own ≈400 m cell; the customers term uses its whole circuit. The earlier versions of this score added their terms (first five, then six) instead of multiplying them.</div>
<h3>3. Dispatch algorithm: priority-weighted soft order, zone inheritance ${chip("rule")}</h3>
<div class="formula">1. level(i)  = level of score(i)
2. zone(i)   = premises behind the same protection device (same circuit, device path and zone size)
   dispatch score(i) = highest score in zone(i)         // a repair on shared equipment restores everyone behind it
3. index(i)  = dispatch score(i) x (1 + total work hours(i)) ^ -${WORK_EXPONENT}
   order     = sort by index, highest first, then id
4. each crew pool is work-conserving: whenever a crew frees up it takes the READY task of the best-ranked premise
5. flow: assessment -> tree/access clearing (20% of line work) -> materials wait -> repair</div>
<div class="mu">The order is soft: a higher score usually goes first, but the index gives a modest boost to premises with less work, because finishing quick jobs early restores customers sooner and keeps the average wait down. With the exponent of ${WORK_EXPONENT}, a premise scoring 10% less is overtaken by one with ${f2(Math.pow(1 / 0.9, 1 / WORK_EXPONENT), 1)}x less work, and one scoring half as much only by one with about ${f2(Math.pow(2, 1 / WORK_EXPONENT), 0)}x less work, so small score gaps can be reordered but large gaps stay put. Set the exponent to 0 for strict score order. Earlier versions used strict priority classes, and before that points per hour of work (Smith's rule), which could put a quick Low premise ahead of a long Critical one.</div>
<div class="mu"><b>Zone inheritance also changes the dispatch order.</b> Premises behind the same protection device are fixed together, so each one is ranked using the highest score in its zone, not its own. A low-scoring premise can therefore be dispatched well ahead of where its own score would put it, because a higher-priority premise shares its zone; the Priority table's Notes column says "dispatched as ..." when this happens. This is the main reason the Dispatch order column can differ from the Score order. Zone inheritance changes only the order of dispatch: the premise's own score and level are unchanged.</div>
<h3>4. Crews, time and delays ${chip("assumption")}</h3>
<div class="mu">The roster is the illustrative 1,000-worker pool (${RESPONSE_WORKFORCE.teams.assessment} two-person assessment teams, ${RESPONSE_WORKFORCE.teams.line} four-person line teams, ${RESPONSE_WORKFORCE.teams.tree} three-person tree/access teams, ${RESPONSE_WORKFORCE.teams.equipment} equipment teams, ${RESPONSE_WORKFORCE.teams.protection} protection teams, 20 shared dispatch personnel). The sidebar slider <b>Crews deployed</b> sets what share of that pool serves these premises; it is currently ${Math.round(schedule.crewScale * 100)}% (${schedule.teams.assessment} assessment, ${schedule.teams.line} line, ${schedule.teams.equipment} equipment, ${schedule.teams.protection} protection teams). The default of ${Math.round(DEFAULT_CREW_SCALE * 100)}% is an assumption chosen so crews are scarce enough for the dispatch order to matter: the 164 demo premises stand in for the many other premises competing for the same crews. At 100% the schedule is never short of crews and priority has almost no effect on any estimate. Crew pools are not shared between types.</div>
<div class="mu" style="margin-top:6px">One repair takes the workbook labor hours for that equipment times the indirect multiplier (${f2(num("mu"), 1)}) divided by the people on the team (${REPAIR_MIX.map(t => `${t.name} ${f2(jobHours(t), 1)} h`).join(", ")}), plus ${DELAYS.travelPerJob} h travel. Each site inspection takes ${DELAYS.travelPerInspection} h of travel plus 0.5 h, more for heavier damage, plus 2 min per nearby emergency facility; a detailed assessment adds 0.5 h per expected repair. Materials wait: ${Object.entries(DELAYS.materials).map(([k, v]) => `${k.toLowerCase()} ${v} h`).join(", ")}. Crews work ${DELAYS.workHoursPerDay} h and rest ${24 - DELAYS.workHoursPerDay} h. Fuse banks use the recloser hours, and wire spans use a placeholder because the workbook has no conductor data.</div>
<h3>5. Step restoration and blocked access ${chip("assumption")}</h3>
<div class="mu"><b>Damage beyond my nearest fuse/recloser</b> (for a premise that has one upstream): after the inspection finds the fault, crews isolate it by switching, so this premise is restored ${DELAYS.switchingStep} h after its inspection. The repair of the damage itself still runs and still uses crews. <b>Blocked access</b> adds ${DELAYS.accessBlocked} h before that premise's repairs can start (the middle of the 2-8 h operator assumption; cross-validation rejected it as a learned effect).</div>
<h3>6. Unmodeled latency ${chip("learned")}</h3>
<div class="mu">The schedule starts when crews are ready. Real restorations also wait for the storm to pass, for safe-to-work conditions, dispatch and mobilization. That is one added delay, calibrated once (independent of your sliders and scenarios) so that, at the Feb 2025 reference storm and the default crew level, the job-weighted median completion is no earlier than the trained historical baseline median (${f2(lc.target, 1)} h; the schedule alone gives ${f2(lc.med, 1)} h), giving ${f2(lc.lag0, 1)} h at severity 1. It scales with the same learned severity slope as the historical model (this storm: ${f2(schedule.latencyHours || 0, 1)} h). Zero severity gives zero.</div>
<h3>Reference: historical and bottom-up estimates, not used in the headline</h3>
<div class="two"><div><h3 style="margin-top:0">Historical completion ${chip("learned")}</h3>
<div class="mu">Interval-censored log-normal AFT on ${R.n} closed Feb 2025 repairs (design "${R.selected_design}" chosen by leave-one-day-out CV). The schedule no longer uses these times: they include waiting in the Feb 2025 queue, which the schedule models explicitly.</div>
<table><tr><th>Quantile (${$("ag").value})</th><th class="r">Time</th></tr><tr><td>Fast (P10)</td><td class="r">${hrs(H.p10)}</td></tr><tr><td>Typical (median)</td><td class="r">${hrs(H.p50)}</td></tr><tr><td>Slow (P90)</td><td class="r">${hrs(H.p90)}</td></tr></table>
<div class="mu">Scaled here by the storm-severity factor ${f2(rs.sevMult, 2)} (severity ${f2(rs.S)}x Feb 2025, raised to the fitted power ${f2(R.severity_scaling.beta, 2)}).</div></div>
<div><h3 style="margin-top:0">Bottom-up labor ${chip("reference")}</h3>
<div class="mu">Workbook hours x indirect multiplier / crew.${rs.manual ? "" : ` Quantities are predicted by the model (${f2(rs.N, 2)} damage events given an outage).`}</div>
${rs.hasDamage ? `<table><tr><td>Direct repair labor</td><td class="r">${f2(rs.dir, 1)} h</td></tr><tr><td>x multiplier ${f2(rs.mult, 1)}</td><td class="r">${f2(rs.tot, 0)} labor-h</td></tr><tr><td>/ crew of ${rs.cr} (crew size ±1)</td><td class="r">${hrs(rs.bLo)}-${hrs(rs.bHi)}</td></tr>${rs.hasDamage ? `<tr><td>x storm severity ${f2(rs.S)}<sup>${f2(R.severity_scaling.beta, 2)}</sup> = ${f2(rs.sevMult, 2)}</td><td class="r"></td></tr>` : ""}${rs.blocked ? `<tr><td>Blocked access ${chip("assumption")}</td><td class="r">+2-8 h</td></tr>` : ""}</table>` : `<div class="mu">No damage entered, so only the historical range is shown.</div>`}</div></div>
<h3>What the data does and does not support</h3><ul>
<li><b>Asset type matters:</b> ${aft.map(t => `${t.name.replace("asset:", "")} x${f2(t.tr)}`).join(", ")} the historical time of primary wire. The schedule uses workbook labor hours per equipment type instead.</li>
<li><b>Storm-severity scaling ${chip("learned")}:</b> current storm severity ${f2(rs.S)}x → expected workload x${f2(rs.S)} → all repair times x${f2(rs.sevMult, 2)} (S<sup>${f2(R.severity_scaling.beta, 2)}</sup>). Fitted by the pipeline on daily workload in Feb 2025 (SE ${f2(R.severity_scaling.se, 2)}); cross-validation did <b>not</b> select that term (${sg(R.severity_scaling.cv_gain_vs_asset_only_per_record, 3)} held-out log-lik/record), so the data supports at most a weak effect.${rs.extrap ? " Current severity is outside the range seen in training, so the multiplier is an extrapolation and is not capped." : ""} The severity itself uses ${SV.source} weather weights.</li>
<li><b>Blocked access</b> was rejected by cross-validation; its +2-8 h is an operator assumption. ${chip("assumption")}</li>
<li><b>Calibrated to a Feb 2025-scale event only.</b> Sep 2024 repair gaps all fall at 23-26 days, which looks like batch close-out, so that event was excluded.</li>
<li><b>Heavier tail than shown:</b> ${f2(rs.neverPct, 1)}% of Feb 2025 records were never marked repaired and are excluded from this conditional model.</li>
<li>Dates have no clock time, so historical precision is about one day.</li></ul>
`;
}

function renderPrep(p, band, long, pre, esc, rs) {
  const pr = ["Charge phones and power banks, and keep flashlights where you can find them.", "Fill water containers and set aside shelf-stable food."];
  if (band !== "Low") pr.push("Know where your breaker panel and manual garage-door release are.");
  if (long) pr.push("Keep fridge and freezer doors closed. Plan where you could stay if it runs past a day.", "Have a week of essential medications on hand.");
  if (p.ls) pr.push("<b>You have told us someone relies on life-support equipment.</b> Make sure backup power or a backup location is ready now and talk to your equipment provider. In a production system this would also route you to a person (not built in this demo).");
  $("prep").innerHTML = `<h2>Prepare and stay safe</h2><div class="safe"><b>Safety, read first:</b> Treat every downed line as live and stay 30+ feet away. Call 911 for danger to life, then your utility. Never run a generator indoors or in a garage.</div><ul>${pr.map(i => "<li>" + i + "</li>").join("")}</ul>${p.fk > 3 ? `<div class="mu">Nearest fire station is ${p.fk >= 10 ? "10+" : "about " + p.fk} km away, so plan for slower emergency response.</div>` : ""}<div class="mu" style="margin-top:8px">Guidance ${chip("rule")}: tied to the risk band and whether the estimate exceeds 24 hours.</div>`;
  $("alert").innerHTML = `<div class="fact"><b>${pre ? "Qualifies" : "Does not yet qualify"}</b> for pre-storm alerts${pre ? "" : " (risk is Low)"}. Outage, estimate-update and restoration alerts apply once enrolled (assumed in this demo).</div>
<ul><li>Timing: 48 h and 24 h before the storm, then within minutes of a confirmed outage.</li><li>Channel: text first, email second${p.ls ? ", plus a phone call from a person" : ""}.</li><li>Send an update when the estimate changes by more than 25%.</li><li>Escalate to a human if: life-support flag, estimate over 24 h, or risk Imminent.</li></ul>${esc ? `<div class="safe"><b>Escalation triggered:</b> ${p.ls ? "declared life-support customer" : long ? "long estimate" : "imminent risk"}.</div>` : ""}<div class="mu">Rules ${chip("rule")} are challenge assumptions, not documented utility policy.</div>`;
}

function renderMsgs(o, band, estimate, rs, p) {
  const lsn = p.ls ? "\nIf anyone at home relies on medical equipment, please start your backup plan now or call us for help." : "";
  const M2 = {"Pre-storm": `Storm alert: winds up to ${o.gust} mph are expected in your area. Chance of an outage: ${band.toLowerCase()}. Charge devices and gather water and food now.${lsn}\nStay 30+ feet from any downed line and call 911.`,
    "Outage confirmed": `We know your power is out. Crews will begin once it is safe. Early estimate: ${estimate} after work starts. This is an estimate, not a promise.${lsn}\nNever use a generator indoors.`,
    "Estimate updated": `Update: our estimate changed to ${estimate}. Reason: ${rs.early ? "crews can isolate the damage and restore you in an earlier step" : "new damage or crew availability"}. We will update you again if it changes.`,
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
<li>${d.panel_rows.toLocaleString()} cell×event rows (${d.panel_positive_rows} with damage). ${d.arcos_no_customer_cell} damage records fell in cells with no customers and were excluded.</li>
<li>${d.premises_with_topology.toLocaleString()} premises with topology; ${d.premises_without_protective_device.toLocaleString()} have no protective device upstream.</li></ul>
<h3>Outage model coefficients ${chip("learned")}</h3>
<table><tr><th>Term</th><th class="r">β</th><th class="r">SE</th><th class="r">Rate ratio</th><th class="r">95% CI</th></tr>${O.terms.map(t => `<tr><td>${t.name}</td><td class="r">${sg(t.beta, 3)}</td><td class="r">${f2(t.se, 3)}</td><td class="r">${f2(t.rr)}</td><td class="r">${f2(t.rr_lo)}–${f2(t.rr_hi)}</td></tr>`).join("")}</table>
<div class="mu">Features are standardized, so rate ratios are per +1 SD. Dispersion α=${f2(O.alpha, 2)} (strong clustering: damage arrives in bursts).</div>
<h3>Cross-validation (${O.cv.folds}-fold, grouped by circuit)</h3>
<div class="two"><div><table><tr><th>Model</th><th class="r">Deviance skill</th><th class="r">AUC</th><th class="r">Brier skill</th><th class="r">Circuit ρ</th></tr>${r("Exposure only (baseline)", cv.exposure_only)}${r("Negative binomial GLM (used)", cv.nbglm)}${r("Gradient-boosted Poisson", cv.gbm_poisson)}</table>
<div class="mu">Predictions are rescaled per event so this compares <i>where</i> damage lands, not how much occurs. Skill is relative to the exposure-only baseline. Ridge penalty was picked on the same folds, so scores are mildly optimistic.</div></div>
<div>${calibSvg(O.cv.calibration)}<div class="mu">Calibration: points near the dashed line mean predicted chances match what happened.</div></div></div>
<div class="${T.auc_any_damage < T.auc_baseline ? "warn" : "fact"}" style="margin-top:8px"><b>Transfer test (train on Feb 2025, predict Sep 2024):</b> deviance skill ${f2(T.deviance_skill, 3)}, AUC ${f2(T.auc_any_damage, 3)} vs ${f2(T.auc_baseline, 3)} for the baseline. The spatial pattern carries over only weakly, consistent with storm path dominating.</div>
<h3>Restoration model selection (leave-one-report-day-out)</h3>
<table><tr><th>Design</th><th class="r">Held-out log-lik gain / record</th><th class="r">P10–P90 coverage (target 80%)</th></tr>${Object.keys(rc).map(k => `<tr><td>${k}${k === R.cv.selected ? " " + chip("learned") + " selected" : ""}</td><td class="r">${sg(rc[k].gain_vs_null_per_record, 4)}</td><td class="r">${pc(rc[k].coverage_p10_p90)}</td></tr>`).join("")}</table>
<h3>Severity weights ${chip(SV.source)}</h3>
<div class="${dg.severity_agrees_with_events ? "fact" : "warn"}">${SV.source === "prior" ? "No weather data reached the pipeline, so these weights are assumptions. " : ""}Illustrative Sep-2024-like weather implies severity ${f2(dg.severity_implied_sep_over_feb, 2)}× Feb 2025; the observed damage ratio between the events is ${f2(dg.observed_sep_over_feb_damage_ratio, 2)}×. ${dg.severity_agrees_with_events ? "These agree within 1.5×." : "They disagree by more than 1.5×, and the weather values for Sep 2024 are my guesses, so treat the severity scale as uncalibrated until weather data is fetched (weather.py) and the model is retrained."}</div>
<h3>Privacy and fallback</h3><p>Premise IDs are re-numbered and the map shows only a ≈400 m cell. Premises in cells with fewer than 20 customers are left out of the published data so a flag cannot point at one household. Distances to fire stations and hospitals are rounded to 0.5 km. Hospitals, police and fire stations are not drawn on the map; their locations (rounded to about 1 km and labelled generically) are used only inside the crew-priority score. Only cell-level features reach the browser. No addresses, premise numbers, exact coordinates, crew details or exact facility locations appear. Only declared flags are used. If a location is outside the served area or cannot be matched, the concierge declines to estimate and points to the official outage map and phone line.</p>
<h3>Retrain with new data</h3><div class="formula">python pipeline/run_pipeline.py --raw-dir data/raw --topology data/raw/matched_upstream.txt \\
    --labor data/raw/Install_Labor_HackOHIO.xlsx [--fetch-weather]</div>`;
}

// ---------------------------------------------------------------- map
let map = null, mapReady = false, fb = false;
const cb = a => { const r = []; for (let i = 0; i < a.length; i += 2) r.push([a[i], a[i + 1]]); return r; };
const CS = D.cell_size, LON = CS[0], LAT = CS[1];
// Basemaps that need no API key. Check each provider's terms before production use.
const BASE_INFO = {
  img: {n: "Satellite (USGS)", a: "Imagery: U.S. Geological Survey, The National Map", t: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"], z: 16},
  topo: {n: "Topographic (USGS)", a: "Map data: U.S. Geological Survey, The National Map", t: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"], z: 16}
};
const BASE_SRC = {};
Object.keys(BASE_INFO).forEach(k => { BASE_SRC["base_" + k] = {type: "raster", tileSize: 256, maxzoom: BASE_INFO[k].z, tiles: BASE_INFO[k].t}; });
function setBase() {
  const v = $("basemap").value;
  Object.keys(BASE_INFO).forEach(k => map.setLayoutProperty("base_" + k, "visibility", k === v ? "visible" : "none"));
  $("baseattr").textContent = BASE_INFO[v] ? BASE_INFO[v].a : "";
}
function initMap() {
  if (typeof maplibregl === "undefined") return fallback();
  try {
    map = new maplibregl.Map({container: "map", style: {version: 8, sources: BASE_SRC,
      layers: [{id: "bg", type: "background", paint: {"background-color": "#eceff1"}}].concat(Object.keys(BASE_SRC).map(k => ({id: k, type: "raster", source: k, layout: {visibility: "none"}})))},
      center: [-79.95, 37.24], zoom: 9.3, pitch: 58, bearing: -18, maxPitch: 78, attributionControl: false});
    map.on("load", () => {
      map.addSource("ln", {type: "geojson", data: {type: "FeatureCollection", features: D.lines.map((Ls, i) => ({type: "Feature", properties: {c: i}, geometry: {type: "MultiLineString", coordinates: Ls.map(cb)}}))}});
      map.addSource("ce", {type: "geojson", data: {type: "FeatureCollection", features: D.cells.map(c => ({type: "Feature", properties: {n: c[2], d: c[3], c: c[4], h: c[2] * 3}, geometry: {type: "Polygon", coordinates: [[[c[0], c[1]], [c[0] + LON, c[1]], [c[0] + LON, c[1] + LAT], [c[0], c[1] + LAT], [c[0], c[1]]]]}}))}});
      map.addSource("dm", {type: "geojson", data: {type: "FeatureCollection", features: D.dmg.map(d => ({type: "Feature", properties: {e: d[2]}, geometry: {type: "Point", coordinates: [d[0], d[1]]}}))}});
      map.addSource("dv", {type: "geojson", data: {type: "FeatureCollection", features: D.dev.map(d => ({type: "Feature", properties: {t: d[2]}, geometry: {type: "Point", coordinates: [d[0], d[1]]}}))}});
      map.addSource("pm", {type: "geojson", data: {type: "FeatureCollection", features: []}});
      map.addSource("pa", {type: "geojson", data: {type: "FeatureCollection", features: D.prem.map((q, i) => ({type: "Feature", properties: {i}, geometry: {type: "Point", coordinates: q.p}}))}});
      const dmgCol = ["interpolate", ["linear"], ["get", "d"], 0, "#c9ced3", 1, "#f4a6ad", 3, "#e0525e", 6, "#a50f1e"];
      map.addLayer({id: "ce", type: "fill-extrusion", source: "ce", paint: {"fill-extrusion-color": dmgCol, "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": .35}});
      map.addLayer({id: "cs", type: "fill-extrusion", source: "ce", filter: ["==", ["get", "c"], -1], paint: {"fill-extrusion-color": dmgCol, "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": .92}});
      map.addLayer({id: "la", type: "line", source: "ln", paint: {"line-color": MAP_DEF, "line-width": 1.8, "line-opacity": 1}});
      map.addLayer({id: "lg", type: "line", source: "ln", filter: ["==", ["get", "c"], -1], paint: {"line-color": "#39ff14", "line-width": 11, "line-opacity": .35, "line-blur": 5}});
      map.addLayer({id: "ls", type: "line", source: "ln", filter: ["==", ["get", "c"], -1], paint: {"line-color": "#39ff14", "line-width": 4}});
      map.addLayer({id: "dm", type: "circle", source: "dm", paint: {"circle-radius": 3.2, "circle-color": ["match", ["get", "e"], 0, "#d71920", 1, "#111111", "#8a8f94"], "circle-stroke-color": "#fff", "circle-stroke-width": .6}});
      map.addLayer({id: "dv", type: "circle", source: "dv", paint: {"circle-radius": 3.6, "circle-color": ["match", ["get", "t"], 0, "#1f6b3a", "#2f5fa8"], "circle-stroke-color": "#fff", "circle-stroke-width": .6}});
      map.addLayer({id: "pa", type: "circle", source: "pa", paint: {"circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": "#5f6368", "circle-stroke-width": 1.5}});
      map.addLayer({id: "pr", type: "circle", source: "pm", paint: {"circle-radius": 11, "circle-color": "rgba(17,17,17,0.08)", "circle-stroke-color": "#111", "circle-stroke-width": 2}});
      map.addLayer({id: "pd", type: "circle", source: "pm", paint: {"circle-radius": 4.5, "circle-color": "#111"}});
      map.on("click", "ce", e => { const f = e.features[0].properties, i = $("cellinfo"); i.style.display = "block"; i.textContent = f.n + " customers · " + f.d + " damage records in this ≈400 m bin"; });
      map.on("click", e => {   // MapLibre does not fire click after a drag; pick the premise nearest the click on screen
        const near = [];
        D.prem.forEach((q, i) => { const pt = map.project(q.p), d = Math.hypot(pt.x - e.point.x, pt.y - e.point.y); if (d <= 12) near.push([d, i]); });
        if (!near.length) return;
        const m = Math.min(...near.map(n => n[0]));
        selectPremise(pickNext(near.filter(n => n[0] < m + 1.5).map(n => n[1])));
      });   // MapLibre does not fire click after a drag
      map.on("mouseenter", "pa", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "pa", () => { map.getCanvas().style.cursor = ""; });
      mapReady = true; render(); focusMap();
    });
    map.on("error", () => {});
    setTimeout(() => { if (!mapReady) fallback(); }, 9000);
  } catch (e) { fallback(); }
}
function updateMap(x, p, o, col) {
  map.setFilter("cs", ["==", ["get", "c"], p.c]); map.setFilter("ls", ["==", ["get", "c"], p.c]); map.setFilter("lg", ["==", ["get", "c"], p.c]);
  const mc = MAP_COL[bandOf(x.P)];
  map.setPaintProperty("ls", "line-color", mc); map.setPaintProperty("lg", "line-color", mc); map.setPaintProperty("pd", "circle-color", mc); map.setPaintProperty("pr", "circle-stroke-color", mc);
  const m = ["match", ["get", "c"]];
  D.circ.forEach((c, i) => { const P = pNB(TYPICAL_ZONE * Math.exp(cellEta(c.f).eta + x.sv.ls), O.alpha); m.push(i, MAP_COL[bandOf(P)]); });
  m.push(MAP_DEF); map.setPaintProperty("la", "line-color", m);
  map.getSource("pm").setData({type: "FeatureCollection", features: [{type: "Feature", properties: {}, geometry: {type: "Point", coordinates: p.p}}]});
  setBase();
  updatePriorityLayer(o);
  map.setLayoutProperty("dm", "visibility", $("lv_d").checked ? "visible" : "none");
  map.setLayoutProperty("dv", "visibility", $("lv_v").checked ? "visible" : "none");
  const v = $("lv_c").checked ? "visible" : "none"; map.setLayoutProperty("ce", "visibility", v); map.setLayoutProperty("cs", "visibility", v);
}
// Premises in the same ~400 m cell share one dot: repeated clicks cycle through them.
function pickNext(c) { c.sort((a, b) => a - b); const cur = +$("pm").value, k = c.indexOf(cur); return k < 0 ? c[0] : c[(k + 1) % c.length]; }
function selectPremise(i) {
  if (String(i) === $("pm").value) return;
  $("pm").value = String(i);
  $("pm").dispatchEvent(new Event("change"));
  render();
}
// Map statistic "Service Priority": premise dots (and circuit lines) go green -> red by the same 0-100 priority score on a fixed scale (0 = green, 50 or more = red) used in Restoration &gt; Priority.
const PRIO_RED = 50;   // fixed scale: a score of 0 is always green and a score of 50 or more is always red
const PRIO_RAMP = [0, "#1a9850", 0.25, "#a6d96a", 0.5, "#ffd54f", 0.75, "#f46d43", 1, "#d7191c"];
function updatePriorityLayer(o) {
  const on = $("lv_p").checked;
  if (!on) {
    map.setPaintProperty("pa", "circle-color", "#ffffff"); map.setPaintProperty("pa", "circle-radius", 5); map.setPaintProperty("pa", "circle-stroke-color", "#5f6368");
    $("prio_leg").style.display = "none";
    return;
  }
  const prem = scheduleAllPremises(o).premises;
  const byIdx = new Map(D.prem.map((q, i) => [q.id, i]));
  const scores = new Array(D.prem.length).fill(0), circMax = {};
  prem.forEach(q => { const i = byIdx.get(q.premise.id); scores[i] = q.score; circMax[q.premise.c] = Math.max(circMax[q.premise.c] || 0, q.score); });
  const top = PRIO_RED;
  const ramp = ["interpolate", ["linear"], ["/", ["get", "s"], top]].concat(PRIO_RAMP);
  map.getSource("pa").setData({type: "FeatureCollection", features: D.prem.map((q, i) => ({type: "Feature", properties: {i, s: scores[i]}, geometry: {type: "Point", coordinates: q.p}}))});
  map.setPaintProperty("pa", "circle-color", ramp); map.setPaintProperty("pa", "circle-radius", 6.5); map.setPaintProperty("pa", "circle-stroke-color", "#ffffff");
  const lm = ["match", ["get", "c"]];
  const colorAt = t => { const stops = [[0, [26, 152, 80]], [.25, [166, 217, 106]], [.5, [255, 213, 79]], [.75, [244, 109, 67]], [1, [215, 25, 28]]]; t = Math.max(0, Math.min(1, t)); let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++; const [a, ca] = stops[k], [b, cb] = stops[k + 1], u = (t - a) / (b - a); return "rgb(" + ca.map((v, j) => Math.round(v + (cb[j] - v) * u)).join(",") + ")"; };
  Object.keys(circMax).forEach(c => lm.push(+c, colorAt(circMax[c] / top)));
  lm.push("#90ee90");   // circuits with no premise: light green
   map.setPaintProperty("la", "line-color", lm);
  $("prio_leg").style.display = "block";
  $("prio_leg").innerHTML = `<b>Service Priority</b> (0-100)<div style="height:8px;margin:3px 0;border-radius:3px;background:linear-gradient(to right,#1a9850,#a6d96a,#ffd54f,#f46d43,#d7191c)"></div><div style="display:flex;justify-content:space-between"><span>0 (green)</span><span>${PRIO_RED}+ (red)</span></div>`;
}
function focusMap() {
  const p = D.prem[$("pm").value], b = D.circ[p.c].b;
  if (map && mapReady) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {padding: 50, duration: 1200, pitch: map.getPitch() || 58, maxZoom: 12.5});
}
function fallback() {
  if (fb || mapReady) return; fb = true;
  const m = $("map"); m.innerHTML = "";
  const c = document.createElement("canvas"); c.width = 900; c.height = 480; c.style.cssText = "width:100%;height:100%"; m.appendChild(c); drawFb();
  let down = null;
  c.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; });
  c.addEventListener("pointerup", e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const R0 = c.getBoundingClientRect(), x = (e.clientX - R0.left) / R0.width * c.width, y = (e.clientY - R0.top) / R0.height * c.height;
    const X = [-80.26, -79.64], Y = [36.99, 37.49];
    const near = [];
    D.prem.forEach((q, i) => { const d = Math.hypot((q.p[0] - X[0]) / (X[1] - X[0]) * c.width - x, c.height - (q.p[1] - Y[0]) / (Y[1] - Y[0]) * c.height - y); if (d < 8) near.push([d, i]); });
    if (near.length) { const m = Math.min(...near.map(n => n[0])); selectPremise(pickNext(near.filter(n => n[0] < m + 1).map(n => n[1]))); }
  });
}
function drawFb() {
  const c = $("map").querySelector("canvas"); if (!c) return;
  const g = c.getContext("2d"), p = D.prem[$("pm").value], X = [-80.26, -79.64], Y = [36.99, 37.49];
  const sx = l => (l - X[0]) / (X[1] - X[0]) * c.width, sy = l => c.height - (l - Y[0]) / (Y[1] - Y[0]) * c.height;
  g.fillStyle = "#eceff1"; g.fillRect(0, 0, c.width, c.height);
  D.lines.forEach((Ls, i) => { g.strokeStyle = i === p.c ? COL[bandOf(risk(p, readStorm()).P)] : "#b3b8bd"; g.lineWidth = i === p.c ? 2.2 : .7; Ls.forEach(a => { g.beginPath(); for (let j = 0; j < a.length; j += 2) j ? g.lineTo(sx(a[j]), sy(a[j + 1])) : g.moveTo(sx(a[0]), sy(a[1])); g.stroke(); }); });
  D.dmg.forEach(d => { g.fillStyle = ["#d71920", "#111", "#8a8f94"][d[2]]; g.fillRect(sx(d[0]) - 1.5, sy(d[1]) - 1.5, 3, 3); });
  g.strokeStyle = "#111"; g.lineWidth = 2; g.beginPath(); g.arc(sx(p.p[0]), sy(p.p[1]), 9, 0, 7); g.stroke();
  g.fillStyle = "#5f6368"; g.font = "12px sans-serif"; g.fillText("3D map unavailable in this browser; showing 2D circuit view", 10, 18);
}
$("leg").innerHTML = `<i style="background:#d71920"></i>Feb 2025 damage <i style="background:#111;margin-left:6px"></i>Sep 2024 <i style="background:#8a8f94;margin-left:6px"></i>Other<br><i style="background:#1f6b3a"></i>Recloser <i style="background:#2f5fa8;margin-left:6px"></i>Switch · bold line = your circuit, colored by risk`;
$("b3d").onclick = () => { if (map && mapReady) map.easeTo({pitch: map.getPitch() > 10 ? 0 : 58, bearing: map.getPitch() > 10 ? 0 : -18, duration: 700}); };
$("bfit").onclick = focusMap;
$("pm").addEventListener("change", () => { if (!window.__NOMAP) loadNWS(); });
document.querySelectorAll(".inp,#pm,#lv_d,#lv_v,#lv_c,#lv_p,#basemap").forEach(e => e.addEventListener("input", render));
$("mu").value = L.indirect_multiplier;

// ---------------------------------------------------------------- Assistant · FastAPI /chat + /status
const CHAT_API_DEFAULT = "http://127.0.0.1:8000";
const chatHistory = [];
const chatApiBase = () => ($("chat_api").value || CHAT_API_DEFAULT).replace(/\/$/, "");


// ---- Address validation (format checks before anything is sent; the server geocoder then confirms the address exists)
const US_STATES = {AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming"};
function validateAddress(raw) {
  const a = String(raw || "").replace(/\s+/g, " ").trim();
  if (!a) return {ok: false, error: "Enter your street address, for example 123 Main St, Roanoke, VA 24011."};
  if (a.length < 8) return {ok: false, error: "That address is too short. Include the street number, street name, city and state."};
  if (a.length > 150) return {ok: false, error: "That address is too long (150 characters at most)."};
  if (/[^A-Za-z0-9 ,.#'\/&-]/.test(a)) return {ok: false, error: "The address has unsupported characters. Use letters, numbers, spaces and , . # ' - / & only."};
  if (!/^\d+[A-Za-z]?(-\d+)?\s+[A-Za-z0-9]/.test(a)) return {ok: false, error: "Start with the street number, for example 123 Main St, Roanoke, VA."};
  const body = a.replace(/^\d+[A-Za-z]?(-\d+)?\s+/, "");
  if (!/[A-Za-z]{2,}/.test(body)) return {ok: false, error: "Add the street name after the number, for example 123 Main St."};
  const zip = /(?:^|[\s,])(\d{5})(?:-(\d{4}))?\s*$/.exec(a);
  if (/\d{5,}/.test(body) && !zip) return {ok: false, error: "The ZIP code must be 5 digits (or ZIP+4 like 24011-1234), at the end of the address."};
  if (!zip && /(?:^|[\s,])\d{1,4}(?:-\d+)?$/.test(a.replace(/^\d+[A-Za-z]?(-\d+)?\s+/, "")) && /,/.test(a)) return {ok: false, error: "The ZIP code must be 5 digits (or ZIP+4 like 24011-1234)."};
  const stripped = a.replace(/(?:^|[\s,])\d{5}(?:-\d{4})?\s*$/, "").replace(/\./g, "").trim();
  const parts = stripped.split(",").map(s => s.trim()).filter(Boolean);
  const tail = parts[parts.length - 1] || "", low = tail.toLowerCase();
  const lastTok = (tail.split(/\s+/).pop() || "");
  let state = /^[A-Za-z]{2}$/.test(lastTok) && US_STATES[lastTok.toUpperCase()] ? lastTok.toUpperCase() : null;
  let stateWords = state ? 1 : 0;
  if (!state) {
    const k = Object.keys(US_STATES).find(c => low === US_STATES[c] || low.endsWith(" " + US_STATES[c]));
    if (k) { state = k; stateWords = US_STATES[k].split(" ").length; }
  }
  if (!state && !zip) {
    if (/^[A-Za-z]{2}$/.test(lastTok) && parts.length >= 2) return {ok: false, error: `"${lastTok}" is not a US state abbreviation. Use a two-letter code such as VA.`};
    return {ok: false, error: "Add the city and state (or a ZIP code), for example 123 Main St, Roanoke, VA."};
  }
  if (!zip) {
    const wordsBefore = stripped.split(/[\s,]+/).filter(Boolean).length - stateWords;
    if ((parts.length < 2 && wordsBefore < 4) || (parts.length >= 2 && !parts.slice(0, -1).length)) return {ok: false, error: "Add the street and the city before the state, for example 123 Main St, Roanoke, VA."};
  }
  return {ok: true, address: a, state, zip: zip ? zip[1] : null};
}
function showAddrError(msg) {
  $("addr_err").textContent = msg || "";
  $("chat_addr").classList.toggle("invalid", !!msg);
  $("chat_addr").setAttribute("aria-invalid", msg ? "true" : "false");
}
// Service area of this demo: the extent of the mapped premises plus a margin.
function inServiceArea(g) {
  const lon = Number(g && (g.longitude ?? g.lon)), lat = Number(g && (g.latitude ?? g.lat));
  if (!isFinite(lon) || !isFinite(lat)) return true;   // no coordinates returned: nothing to check
  const xs = D.prem.map(q => q.p[0]), ys = D.prem.map(q => q.p[1]), pad = 0.25;
  return lon >= Math.min(...xs) - pad && lon <= Math.max(...xs) + pad && lat >= Math.min(...ys) - pad && lat <= Math.max(...ys) + pad;
}
function friendlyAddrError(msg) {
  if (/no geocode match|geocode/i.test(msg)) return "We couldn't find that address. Check the street number, street name, city, state and ZIP, then try again.";
  if (/outside|not served|no premise/i.test(msg)) return "That address is outside the area this demo covers.";
  return msg;
}
function chatCustomerFromUi() {
  const v = validateAddress($("chat_addr").value);
  if (!v.ok) { const e = new Error(v.error); e.addr = true; throw e; }
  const address = v.address;
  const o = readStorm();
  return {
    address,
    use_nws: true,
    scan_feeder_weather: true,
    storm: {gust: o.gust, rain: o.rain, snow: o.snow, ante: o.ante, leaf: !!o.leaf},
    scenario: {
      n_pole: num("n_pole"), n_arm: num("n_arm"), n_xf: num("n_xf"), n_ins: num("n_ins"),
      n_wire: num("n_wire"), n_rec: num("n_rec"), asset_group: $("ag").value,
      damage_location: $("fl").value, cr: num("cr"), mu: num("mu"), access_blocked: $("ac").checked,
    },
  };
}

// Minimal, safe Markdown -> HTML for assistant replies (HTML is escaped first; only http(s)/mailto links are allowed).
function mdToHtml(src) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = t => {
    const codes = [];
    t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
    t = esc(t);
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    t = t.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => "<strong>" + (a || b) + "</strong>");
    t = t.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>");
    t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    return t.replace(/\u0000(\d+)\u0000/g, (_, i) => "<code>" + esc(codes[+i]) + "</code>");
  };
  const lines = String(src).replace(/\r\n?/g, "\n").split("\n"), out = [];
  let i = 0;
  const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || "");
  const cells = l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (/^\s*```/.test(l)) {
      const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>"); continue;
    }
    if (!l.trim()) { i++; continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { const n = Math.min(6, m[1].length + 2); out.push(`<h${n}>${inline(m[2])}</h${n}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
    if (/^\s*>/.test(l)) {
      const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push("<blockquote>" + inline(buf.join(" ")) + "</blockquote>"); continue;
    }
    if (l.includes("|") && isTableSep(lines[i + 1])) {
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push("<table><thead><tr>" + head.map(c => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
        rows.map(r => "<tr>" + r.map(c => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table>"); continue;
    }
    if ((m = /^(\s*)([-*+]|\d+[.)])\s+/.exec(l))) {
      const ordered = /\d/.test(m[2]), items = [];
      while (i < lines.length && (m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]))) {
        let t = m[3]; i++;
        while (i < lines.length && lines[i].trim() && !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) && /^\s{2,}\S/.test(lines[i])) t += " " + lines[i++].trim();
        items.push(`<li>${inline(t)}</li>`);
      }
      out.push((ordered ? "<ol>" : "<ul>") + items.join("") + (ordered ? "</ol>" : "</ul>")); continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i]) && !(lines[i].includes("|") && isTableSep(lines[i + 1]))) buf.push(lines[i++]);
    if (!buf.length) { buf.push(lines[i++]); }
    out.push("<p>" + buf.map(inline).join("<br>") + "</p>");
  }
  return out.join("");
}

function chatAdd(who, text) {
  const d = document.createElement("div");
  d.className = "chat-bubble " + (who === "you" ? "you" : "bot");
  if (who === "you") d.textContent = text; else { d.classList.add("md"); d.innerHTML = mdToHtml(text); }
  $("chat").appendChild(d);
  $("chat").scrollTop = $("chat").scrollHeight;
}

async function fetchLocationStatus(customer) {
  const r = await fetch(chatApiBase() + "/status", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({address: customer.address, use_nws: customer.use_nws, scan_feeder_weather: customer.scan_feeder_weather,
      storm: customer.storm, scenario: customer.scenario}),
  });
  const data = await r.json();
  if (!r.ok) {
    const e = new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail) || r.statusText);
    if ([400, 404, 422].includes(r.status)) e.addr = true;   // the server could not geocode / match this address
    throw e;
  }
  console.log("[location status] pulled for address:", customer.address, data);
  if (data.geocode) console.log("[geocode]", data.geocode);
  return data;
}

async function askAssistant(msg) {
  $("chat_status").textContent = "Loading location and asking the assistant…";
  $("q_send").disabled = true;
  chatAdd("you", msg);
  chatHistory.push({role: "user", content: msg});
  try {
    const customer = chatCustomerFromUi();
    const located = await fetchLocationStatus(customer);
    if (!inServiceArea(located && located.geocode)) { const e = new Error("That address is outside the area this demo covers (the Roanoke, VA area)."); e.addr = true; throw e; }
    const r = await fetch(chatApiBase() + "/chat", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({messages: chatHistory, customer}),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail) || r.statusText);
    if (data.visualizer_status) console.log("[location status] attached to chat reply:", data.visualizer_status);
    const reply = data.reply || "(no reply text)";
    chatHistory.push({role: "assistant", content: reply});
    chatAdd("bot", reply);
    $("chat_status").textContent = data.abstained ? "No estimate: this location is outside the area the demo covers."
      : data.fallback ? "The AI service is unavailable, so this is a built-in summary of the model results."
      : data.visualizer_status
      ? `Matched ${data.visualizer_status.customer_id || data.visualizer_status.premise_id} · risk ${data.visualizer_status.outage_risk?.band}`
      : "";
  } catch (e) {
    chatHistory.pop();
    if (e.addr) { const m = friendlyAddrError(e.message); showAddrError(m); chatAdd("bot", m); }
    else chatAdd("bot", "The assistant is unavailable right now, so I can't answer in chat. The risk, restoration and preparation panels on this page still work. For confirmed outage information use your utility's official outage map or the outage phone number on your bill. If anyone is in danger, call 911.");
    $("chat_status").textContent = "";
    console.error("[assistant]", e);
  } finally {
    $("q_send").disabled = false;
  }
}

$("q_send").onclick = () => {
  const v = $("q").value.trim();
  if (!v) return;
  const a = validateAddress($("chat_addr").value);
  if (!a.ok) { showAddrError(a.error); $("chat_addr").focus(); return; }   // nothing is sent until the address passes
  showAddrError("");
  $("q").value = "";
  askAssistant(v);
};
$("chat_addr").addEventListener("input", () => { if ($("addr_err").textContent) showAddrError(""); });
$("chat_addr").addEventListener("blur", () => { if ($("chat_addr").value.trim()) { const a = validateAddress($("chat_addr").value); showAddrError(a.ok ? "" : a.error); } });
$("q").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("q_send").click(); } });
{
  const q = new URLSearchParams(location.search);
  if (q.get("api")) $("chat_api").value = q.get("api");
}


// ---- Email alert sign-up: POST /alerts/subscribe on the Stormfront API (the address is geocoded and matched to a premise server-side).
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/;
function alertMsg(text, ok) { const s = $("al_status"); s.textContent = text || ""; s.style.color = ok ? "#1f6b3a" : ""; }
$("al_btn").onclick = async () => {
  const email = $("al_email").value.trim(), a = validateAddress($("al_addr").value);
  $("al_email").classList.remove("invalid"); $("al_addr").classList.remove("invalid");
  if (!EMAIL_RE.test(email) || email.length > 254) { $("al_email").classList.add("invalid"); alertMsg("Enter a valid email address, for example you@example.com."); $("al_email").focus(); return; }
  if (!a.ok) { $("al_addr").classList.add("invalid"); alertMsg(a.error); $("al_addr").focus(); return; }
  $("al_btn").disabled = true; alertMsg("Sending...", true);
  try {
    const r = await fetch(chatApiBase() + "/alerts/subscribe", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({email, address: a.address})});
    let msg = "";
    try { const j = await r.json(); msg = typeof j.message === "string" ? j.message : (typeof j.detail === "string" ? j.detail : ""); } catch (e) {}
    if (!r.ok) { if (r.status === 404 || r.status === 422) $("al_addr").classList.add("invalid"); alertMsg(msg || "Could not sign you up. Please check the details and try again."); }
    else alertMsg(msg || "Done. Check your inbox for the confirmation link.", true);
  } catch (e) { alertMsg("Could not reach the Stormfront API. Make sure it is running (python -m uvicorn app.main:app from the backend folder)."); }
  finally { $("al_btn").disabled = false; }
};
$("al_email").addEventListener("input", () => { $("al_email").classList.remove("invalid"); alertMsg(""); });
$("al_addr").addEventListener("input", () => { $("al_addr").classList.remove("invalid"); alertMsg(""); });
showTab("over"); render(); if (!window.__NOMAP) { initMap(); loadNWS(); }

