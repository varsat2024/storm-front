"use strict";
// All numbers below come from MODEL (artifacts/model.json, written by the Python pipeline) and
// DATA (site/data.json). Nothing about risk is hard-coded here except display text and the
// alert/safety rules, which are labeled as rules.
const M = MODEL, D = DATA, O = M.outage, SV = M.severity, R = M.restoration, L = M.labor, B = M.bands;
const $ = id => document.getElementById(id);
const num = id => Math.max(0, parseFloat($(id).value) || 0);
const COL = {Low: "#2e7d32", Moderate: "#c26a00", High: "#d9451f", Imminent: "#b0001a"};
const Z80 = 1.2816, TYPICAL_ZONE = 51;
const DAMAGE_SCENARIO_PRIORITY_REFERENCE_HOURS = 24;
const RESPONSE_WORKFORCE = {
  totalPeople: 1000,
  teams: {assessment: 70, line: 105, tree: 70, equipment: 35, protection: 35},
  people: {assessment: 140, line: 420, tree: 210, equipment: 105, protection: 105, support: 20},
};
const MAP_FACILITIES = [
  ["hospital", "Hospital 1", 22, -80.11, 37.392],
  ["hospital", "Hospital 2", 5, -80.032, 37.263],
  ["hospital", "Hospital 3", 8, -80.019, 37.274],
  ["hospital", "Hospital 4", 105, -79.942, 37.251],
  ["hospital", "Hospital 5", 65, -79.939, 37.266],
  ["police", "Police Station 1", 37, -79.948, 37.271],
  ["police", "Police Station 2", 18, -79.899, 37.279],
  ["police", "Police Station 3", 22, -80.057, 37.292],
  ["police", "Police Station 4", 71, -80.128, 37.277],
  ["fire", "Fire Station 1", 68, -79.917, 37.251],
  ["fire", "Fire Station 2", 44, -79.793, 37.272],
  ["fire", "Fire Station 3", 32, -79.937, 37.289],
  ["fire", "Fire Station 4", 14, -79.901, 37.295],
  ["fire", "Fire Station 5", 18, -79.899, 37.28],
  ["fire", "Fire Station 6", 34, -80.063, 37.28],
  ["fire", "Fire Station 7", 84, -79.956, 37.12],
  ["fire", "Fire Station 8", 78, -79.876, 37.418],
  ["fire", "Fire Station 9", 19, -79.953, 37.316],
  ["fire", "Fire Station 10", 22, -80.057, 37.292],
  ["fire", "Fire Station 11", 86, -80.205, 37.031],
  ["fire", "Fire Station 12", 8, -80.03, 37.289],
  ["fire", "Fire Station 13", 33, -79.92, 37.271],
  ["fire", "Fire Station 14", 30, -79.811, 37.236],
  ["fire", "Fire Station 15", 45, -79.73, 37.385],
  ["fire", "Fire Station 16", 84, -79.95, 37.202],
  ["fire", "Fire Station 17", 21, -79.811, 37.375],
  ["fire", "Fire Station 18", 31, -79.948, 37.247],
  ["fire", "Fire Station 19", 22, -80.114, 37.39],
  ["fire", "Fire Station 20", 22, -80.076, 37.372],
  ["fire", "Fire Station 21", 28, -79.969, 37.286],
  ["fire", "Fire Station 22", 53, -80.21, 37.228],
  ["fire", "Fire Station 23", 44, -79.722, 37.258],
  ["fire", "Fire Station 24", 20, -80.073, 37.201],
  ["fire", "Fire Station 25", 65, -79.946, 37.267],
  ["fire", "Fire Station 26", 85, -79.938, 37.322],
  ["fire", "Fire Station 27", 86, -80.115, 37.166],
  ["fire", "Fire Station 28", 10, -79.911, 37.238],
  ["fire", "Fire Station 29", 1, -79.964, 37.346],
  ["fire", "Fire Station 30", 86, -80.048, 37.013],
  ["fire", "Fire Station 31", 60, -79.974, 37.266],
  ["fire", "Fire Station 32", 10, -79.814, 37.106],
  ["fire", "Fire Station 33", 44, -79.719, 37.32],
  ["fire", "Fire Station 34", 54, -80.006, 37.307],
  ["fire", "Fire Station 35", 71, -80.131, 37.276],
  ["fire", "Fire Station 36", 61, -80.01, 37.229],
  ["fire", "Fire Station 37", 57, -80.01, 37.267],
];
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
function restoration(scenario = activeScenario(), premise = D.prem[$("pm").value], o = readStorm()) {
  let dir = 0;
  Object.keys(L.items).forEach(k => {
    dir += Math.max(0, parseFloat(scenario[`n_${k}`]) || 0) * L.items[k].hours;
  });
  const mult = Math.max(0, parseFloat(scenario.mu) || 0);
  const tot = dir * mult;
  const cr = Math.max(1, parseFloat(scenario.cr) || 1);
  const blocked = scenario.ac;
  const gi = R.groups.indexOf(scenario.ag);
  const mu = R.terms[0].beta + (gi >= 0 ? R.terms[1 + gi].beta : 0);
  // Weather effect: current storm severity S scales expected workload, and the AFT workload slope turns that into a time multiplier S^beta
  const SS = R.severity_scaling, S = sevCalc(o).S;
  const sevMult = S > 0 ? Math.pow(S, SS.beta) : 0, extrap = S > SS.s_max || (S > 0 && S < SS.s_min);
  const q = z => Math.exp(mu + R.sigma * z) * 24 * sevMult;
  let bLo = tot / (cr + 1) * sevMult, bHi = tot / Math.max(1, cr - 1) * sevMult;
  if (blocked && tot > 0 && sevMult > 0) { bLo += 2; bHi += 8; }
  const hist = {p10: q(-Z80), p50: q(0), p90: q(Z80)};
  const early = scenario.fl === "other" && premise.nd > 0;
  const assetMultiplier = gi >= 0 ? Math.exp(R.terms[1 + gi].beta) : 1;
  const locationMultiplier = early && hist.p50 > 0 ? hist.p10 / hist.p50 : 1;
  const scenarioLo = bLo * assetMultiplier * locationMultiplier;
  const scenarioHi = bHi * assetMultiplier * locationMultiplier;
  const lo = tot > 0 ? scenarioLo : 0;
  const hi = tot > 0 ? scenarioHi : 0;
  const estimate = tot > 0
    ? early ? Math.sqrt(scenarioLo * scenarioHi) : (scenarioLo + scenarioHi) / 2
    : 0;
  const neverPct = 100 * R.n_never_closed_excluded / (R.n + R.n_never_closed_excluded);
  return {S, sevMult, extrap, dir, mult, tot, cr, blocked, bLo, bHi, hist, early, lo, hi, estimate, assetMultiplier, locationMultiplier, hasDamage: tot > 0, neverPct};
}

function scheduleTeamTasks(tasks, teamCount) {
  const availableAt = Array(teamCount).fill(0);
  const completions = new Map();
  const starts = new Map();
  const pending = tasks.slice().sort((a, b) =>
    a.readyAt - b.readyAt ||
    b.duration - a.duration ||
    b.priority - a.priority ||
    a.id.localeCompare(b.id),
  );

  pending.forEach(task => {
    let team = 0;
    for (let i = 1; i < availableAt.length; i++) {
      if (availableAt[i] < availableAt[team]) team = i;
    }
    const start = Math.max(availableAt[team], task.readyAt);
    const finish = start + task.duration;
    availableAt[team] = finish;
    starts.set(task.id, start);
    completions.set(task.id, finish);
  });
  return {completions, starts};
}

function splitExpectedWork(expected) {
  const units = Array(Math.floor(expected)).fill(1);
  const remainder = expected - units.length;
  if (remainder > 1e-8) units.push(remainder);
  return units;
}

function premiseFacilityCounts() {
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
  return counts;
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
    rate,
    zero: sv.zero,
  };
}

function scorePriorityPremises(o) {
  const facilitiesByPremise = premiseFacilityCounts();
  const premiseFacts = D.prem.map(premise => {
    const damageEstimate = premiseDamageEstimate(premise, o);
    const outageRisk = risk(premise, o).P;
    const scenario = premiseDamageScenarios.get(premise.id) || damageScenarioDefaults;
    const damageScenarioHours = restoration(scenario, premise, o).estimate;
    const counts = facilitiesByPremise.get(premise.id);
    const weightedFacilities = counts.hospitals * 3 + counts.police * 2 + counts.fire;
    const cellDamageHistory = PREMISE_CELL_DAMAGE.get(premise.id) || 0;
    return {premise, damageEstimate, outageRisk, damageScenarioHours, counts, weightedFacilities, cellDamageHistory};
  });
  const maxOf = selector => Math.max(1, ...premiseFacts.map(selector));
  const densityMax = maxOf(item => Math.max(0, item.premise.f[0]));
  const customerMax = maxOf(item => Math.log1p(item.premise.cn));
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
    const {premise, damageEstimate, counts} = item;
    const riskProbability = item.outageRisk;
    const densityFactor = clamp(Math.exp(premise.f[0]) / Math.max(densityReference, 1), 0.5, 2);
    const customerFactor = clamp(Math.sqrt(premise.cn / Math.max(customerReference, 1)), 0.5, 2);
    const facilityCount = counts.hospitals + counts.police + counts.fire;
    const points = {
      facilities: 28 * item.weightedFacilities / facilityWeightMax,
      risk: 16 * riskProbability,
      density: 12 * Math.max(0, premise.f[0]) / densityMax,
      customers: 8 * Math.log1p(premise.cn) / customerMax,
      history: 16 * Math.sqrt(item.cellDamageHistory) / reportMax,
      damageScenario: 20 * Math.min(
        1,
        item.damageScenarioHours / DAMAGE_SCENARIO_PRIORITY_REFERENCE_HOURS,
      ),
    };
    const propensityScore = damageEstimate.rate / damageRateMax;
    const historyScore = Math.sqrt(item.cellDamageHistory) / reportMax;
    const damageSeverityScore = damageEstimate.zero
      ? 0
      : 100 * (0.7 * propensityScore + 0.3 * historyScore);
    return {
      premise,
      circuit: premise.c + 1,
      counts,
      customers: premise.cn,
      cellDamageHistory: item.cellDamageHistory,
      damageSeverityScore,
      damageScenarioHours: item.damageScenarioHours,
      riskProbability,
      facilityCount,
      facilityAllowanceMinutes: facilityCount * 2,
      restorationFactors: {density: densityFactor, customers: customerFactor},
      points,
      score: Object.values(points).reduce((sum, value) => sum + value, 0),
      damageEstimate,
    };
  }).sort((a, b) => b.score - a.score || a.premise.id.localeCompare(b.premise.id));
}

function scheduleAllPremises(o, selectedPremiseId, selectedRepairEstimate) {
  const mix = [
    {name: "Wire", share: 130 / 240, asset: null, team: "line"},
    {name: "Switch", share: 53 / 240, asset: "Other", team: "protection"},
    {name: "Pole", share: 52 / 240, asset: "Pole", team: "line"},
    {name: "Equipment", share: 5 / 240, asset: "Transformer", team: "equipment"},
  ];
  const weather = sevCalc(o);
  const baseMedianHours = Number(R.baseline_days["0.5"]) * 24;
  const premises = scorePriorityPremises(o).map(priority => {
    const riskProbability = priority.riskProbability;
    const facilities = {
      hospital: priority.counts.hospitals,
      police: priority.counts.police,
      fire: priority.counts.fire,
    };
    const lowRisk = bandOf(riskProbability) === "Low";
    return {
      ...priority,
      outageRisk: riskProbability,
      lowRisk,
      damageProbability: lowRisk || weather.zero ? 0 : priority.damageEstimate.probability,
      facilities,
      modeledRepairHours: lowRisk || weather.zero ? 0 : mix.reduce((hours, type) => {
        const assetTerm = type.asset && R.terms.find(term => term.name === `asset:${type.asset}`);
        const durationPerJob = baseMedianHours * Math.exp(assetTerm ? assetTerm.beta : 0);
        return hours + priority.damageEstimate.probability * type.share * durationPerJob;
      }, 0),
      teams: {assessment: 0, detailedAssessment: 0, tree: 0, line: 0, protection: 0, equipment: 0},
      visitStart: 0,
      inspectionComplete: 0,
      inspectionDuration: lowRisk ? 0 : 0.5 + priority.damageSeverityScore / 200 +
        priority.facilityAllowanceMinutes / 60,
      repairStart: null,
      repairDuration: 0,
      visitDuration: 0,
      completion: null,
      categoryJobs: {},
    };
  });
  const maxRepairHours = Math.max(1, ...premises.map(premise => premise.modeledRepairHours));
  const activePremises = premises.filter(premise => !premise.lowRisk);
  activePremises.sort((a, b) => {
    const dispatchValue = premise =>
      0.9 * premise.modeledRepairHours / maxRepairHours +
      0.1 * premise.score / 100;
    return dispatchValue(b) - dispatchValue(a) || b.score - a.score ||
      a.premise.id.localeCompare(b.premise.id);
  });
  const lowRiskPremises = premises.filter(premise => premise.lowRisk);
  let taskSequence = 0;
  let elapsed = 0;
  const assessmentTasks = [], treeTasks = [], repairTasks = [];
  activePremises.forEach(premise => {
    premise.visitStart = elapsed;
    premise.inspectionComplete = premise.visitStart + premise.inspectionDuration;
    premise.teams.assessment = 1;
    premise.completion = premise.inspectionComplete;
    elapsed = premise.inspectionComplete;
    mix.forEach(type => {
      const expectedTypeWork = premise.damageProbability * type.share;
      premise.categoryJobs[type.name] = expectedTypeWork;
      const assetTerm = type.asset && R.terms.find(term => term.name === `asset:${type.asset}`);
      const durationPerJob = baseMedianHours * Math.exp(assetTerm ? assetTerm.beta : 0);
      const treeSupportJobs = type.team === "line" ? expectedTypeWork * 0.2 : 0;
      let treeRemaining = treeSupportJobs;
      splitExpectedWork(expectedTypeWork).forEach((unit, index) => {
        const treeWeight = Math.min(unit, treeRemaining);
        const pieces = [];
        if (treeWeight > 1e-8) pieces.push({weight: treeWeight, needsTree: true});
        if (unit - treeWeight > 1e-8) pieces.push({weight: unit - treeWeight, needsTree: false});
        treeRemaining = Math.max(0, treeRemaining - treeWeight);
        pieces.forEach(piece => {
          const id = `${premise.premise.id}|${type.name}|${index}|${taskSequence++}`;
          const weight = piece.weight;
          assessmentTasks.push({
            id,
            premise: premise.premise.id,
            duration: 0.5 * weight,
            readyAt: premise.inspectionComplete,
            priority: premise.score,
          });
          if (piece.needsTree) {
            treeTasks.push({id, premise: premise.premise.id, duration: 0.5 * weight, priority: premise.score});
          }
          repairTasks.push({
            id,
            premise: premise.premise.id,
            team: type.team,
            duration: durationPerJob * weight,
            priority: premise.score,
            needsTree: piece.needsTree,
          });
        });
      });
    });
    premise.teams.detailedAssessment = Math.min(
      Math.ceil(premise.damageProbability),
      RESPONSE_WORKFORCE.teams.assessment - 1,
    );
    const expectedLineJobs = premise.categoryJobs.Wire + premise.categoryJobs.Pole;
    premise.teams.tree = expectedLineJobs > 0
      ? Math.min(Math.ceil(expectedLineJobs * 0.2), RESPONSE_WORKFORCE.teams.tree)
      : 0;
    ["line", "equipment", "protection"].forEach(team => {
      const expectedByTeam = team === "line"
        ? expectedLineJobs
        : premise.categoryJobs[team === "protection" ? "Switch" : "Equipment"];
      premise.teams[team] = expectedByTeam > 0
        ? Math.min(Math.ceil(expectedByTeam), RESPONSE_WORKFORCE.teams[team])
        : 0;
    });
  });
  const assessedAt = scheduleTeamTasks(
    assessmentTasks,
    RESPONSE_WORKFORCE.teams.assessment - 1,
  ).completions;
  treeTasks.forEach(task => { task.readyAt = assessedAt.get(task.id) || 0; });
  const treeClearedAt = scheduleTeamTasks(treeTasks, RESPONSE_WORKFORCE.teams.tree).completions;
  ["line", "equipment", "protection"].forEach(team => {
    const jobs = repairTasks.filter(task => task.team === team).map(task => ({
      ...task,
      readyAt: task.needsTree
        ? treeClearedAt.get(task.id) || assessedAt.get(task.id) || 0
        : assessedAt.get(task.id) || 0,
    }));
    const {completions, starts} = scheduleTeamTasks(jobs, RESPONSE_WORKFORCE.teams[team]);
    jobs.forEach(job => {
      const premise = activePremises.find(item => item.premise.id === job.premise);
      const start = starts.get(job.id);
      premise.repairStart = premise.repairStart === null
        ? start
        : Math.min(premise.repairStart, start);
      premise.completion = Math.max(premise.completion, completions.get(job.id) || 0);
    });
  });
  assessedAt.forEach((finish, id) => {
    const premiseId = id.split("|")[0];
    const premise = activePremises.find(item => item.premise.id === premiseId);
    premise.completion = Math.max(premise.completion, finish);
  });
  activePremises.forEach(premise => {
    premise.repairDuration = premise.repairStart === null
      ? 0
      : premise.completion - premise.repairStart;
    premise.visitDuration = premise.completion - premise.visitStart;
  });
  const selectedPremise = activePremises.find(item => item.premise.id === selectedPremiseId);
  if (selectedPremise) {
    const repairStart = selectedRepairEstimate > 0
      ? selectedPremise.repairStart ?? selectedPremise.inspectionComplete
      : null;
    selectedPremise.repairStart = repairStart;
    selectedPremise.completion = repairStart === null
      ? selectedPremise.inspectionComplete
      : repairStart + selectedRepairEstimate;
    selectedPremise.repairDuration = selectedRepairEstimate;
    selectedPremise.visitDuration = selectedPremise.completion - selectedPremise.visitStart;
  }
  const orderedPremises = activePremises.concat(lowRiskPremises);
  const makespan = Math.max(
    0,
    ...activePremises.map(premise => premise.completion),
  );
  return {
    premises: orderedPremises,
    makespan,
    expectedDamageProbability: activePremises.reduce(
      (sum, premise) => sum + premise.damageProbability,
      0,
    ),
    noOutageCount: lowRiskPremises.length,
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
async function loadNWS() {
  const st = $("nws"), p = D.prem[$("pm").value];
  st.textContent = "Fetching current NWS conditions…";
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
    ["gust", "rain", "snow", "ante"].forEach(i => $(i).value = sliderFit(i, v[i]));
    $("leaf").checked = !!v.leaf;
    st.innerHTML = `Loaded from the National Weather Service for this area (${used}): worst of observed and next-24 h forecast gust ${f2(v.gust, 0)} mph, rain ${f2(v.rain, 2)} in, snow ${f2(v.snow, 1)} in, rain 24-72 h ago ${f2(v.ante, 2)} in. Sliders are free to change.`;
  } catch (e) {
    st.textContent = "Could not reach the National Weather Service, so the sliders keep their default values. You can still set them by hand.";
  }
  render();
}

// ---------------------------------------------------------------- setup
D.prem.forEach((p, i) => {
  const o = document.createElement("option");
  o.value = i; o.textContent = p.id + " · circuit C-" + (p.c + 1) + " · " + p.cn + " customers in cell";
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
  const schedule = scheduleAllPremises(o, p.id, rs.estimate);
  const selectedPremise = schedule.premises.find(item => item.premise.id === p.id);
  if (!selectedPremise) throw new Error(`No restoration schedule found for premise ${p.id}`);
  const activePremiseCount = schedule.premises.filter(item => !item.lowRisk).length;
  const suggestedOrder = selectedPremise.lowRisk
    ? "No visit suggested (Low risk)"
    : `Suggested visit #${schedule.premises.indexOf(selectedPremise) + 1} of ${activePremiseCount}`;
  const estimate = selectedPremise.lowRisk
    ? "No restoration expected"
    : formatScheduledDuration(selectedPremise.completion);
  $("gust_v").textContent = o.gust + " mph"; $("rain_v").textContent = f2(o.rain, 1) + " in";
  $("snow_v").textContent = f2(o.snow, 1) + " in"; $("ante_v").textContent = f2(o.ante, 1) + " in";
  $("sevline").innerHTML = `Storm severity <b>${f2(x.sv.S)}</b> × Feb 2025 (${sevName(x.sv.S)}) · ${chip(SV.source)}`;
  $("hdpill").textContent = "Model trained " + M.generated.slice(0, 10) + " · anonymized data";
  const long = rs.hi >= 24, pre = band !== "Low" || p.ls, esc = p.ls || long || band === "Imminent";
  $("kpis").innerHTML =
    `<div class="kpi"><small>Outage risk</small><div class="v" style="color:${col}">${band}</div>${bar(x.P, col)}<div class="n">${pc(x.P)} chance · 80% interval ${pc(x.Plo)}–${pc(x.Phi)} · confidence ${conf}</div></div>
<div class="kpi"><small>Your premise-specific restoration estimate</small><div class="v">${estimate}</div><div class="n">${p.id} · circuit C-${p.c + 1} · inspections and repair work are scheduled separately</div></div>
<div class="kpi"><small>Suggested visit</small><div class="v">${selectedPremise.lowRisk ? "No visit" : `#${schedule.premises.indexOf(selectedPremise) + 1}`}</div><div class="n">${selectedPremise.lowRisk ? suggestedOrder : `of ${activePremiseCount} premises · route order also reflects modeled repair workload`}</div></div>
<div class="kpi"><small>Storm severity</small><div class="v">${sevName(x.sv.S)}</div><div class="n">${f2(x.sv.S)} × the Feb 2025 storm · weather weights ${SV.source}</div></div>
<div class="kpi"><small>Alerts</small><div class="v">${pre ? "Eligible" : "Not yet"}</div><div class="n">${esc ? "Human escalation triggered" : "Standard automated alerts"}</div></div>`;
  renderRisk(p, o, x, band, col);
  renderAlgo(p, o, x, band, conf);
  renderRest(p, x, rs, estimate, schedule);
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

function renderRest(p, x, rs, estimate, schedule) {
  const H = rs.hist;
  const aft = R.terms.filter(t => t.selected && t.name.startsWith("asset:"));
  const premiseScheduleRows = schedule.premises.map((location, index) => {
    const facilityText = [
      location.facilities.hospital && `${location.facilities.hospital} hospital${location.facilities.hospital === 1 ? "" : "s"}`,
      location.facilities.police && `${location.facilities.police} police station${location.facilities.police === 1 ? "" : "s"}`,
      location.facilities.fire && `${location.facilities.fire} fire station${location.facilities.fire === 1 ? "" : "s"}`,
    ].filter(Boolean).join(", ") || "None mapped";
    const crewPlan = location.lowRisk
      ? "No visit or crews planned (Low risk)"
      : "1 inspection team; estimate is probability-weighted pending findings";
    const reason = location.lowRisk
      ? `Displayed outage risk (${pc(location.outageRisk)}) is below the Low-risk threshold of ${pc(B.cuts[0])}; assume no outage, so no restoration time is assigned.`
      : `Displayed outage risk (${pc(location.outageRisk)}) meets the estimate threshold. Damage severity score ${location.damageSeverityScore.toFixed(0)}/100 informs inspection duration. The numeric restoration estimate is a probability-weighted ballpark; inspection findings may change it.`;
    const inspectionWindow = location.lowRisk
      ? "—"
      : `${formatScheduledDuration(location.visitStart)}–${formatScheduledDuration(location.inspectionComplete)}`;
    const inspectionDuration = location.lowRisk
      ? "—"
      : formatScheduledDuration(location.inspectionDuration);
    const repairStart = location.lowRisk || location.repairStart === null
      ? "—"
      : formatScheduledDuration(location.repairStart);
    const repairWindow = location.lowRisk ? "—" : formatScheduledDuration(location.repairDuration);
    const completion = location.lowRisk
      ? "No restoration expected"
      : `<b>${formatScheduledDuration(location.completion)}</b>`;
    return `<tr${location.premise.id === p.id ? ' class="selected-premise"' : ""}><td class="r">${location.lowRisk ? "—" : index + 1}</td><td class="r"><b>${location.score.toFixed(1)}</b></td>
<td><b>${location.premise.id}</b></td><td>C-${location.circuit}</td><td>${location.customers}</td><td>${pc(location.outageRisk)}</td>
<td class="r">${location.damageSeverityScore.toFixed(0)}</td><td>${facilityText}</td><td>${crewPlan}</td>
<td>${location.lowRisk ? "—" : `${location.modeledRepairHours.toFixed(1)} probability-weighted h`}</td>
<td>${inspectionDuration}</td><td>${inspectionWindow}</td><td>${repairStart}</td><td>${repairWindow}</td><td>${completion}</td><td>${reason}</td></tr>`;
  }).join("");
  $("rest").innerHTML = `<h2>Selected-premise restoration estimate</h2><div style="font-size:28px;font-weight:700">${estimate}</div>
<div class="mu">Probability-weighted planning estimate, not a confirmed outage or repair duration. Inspection findings may change it. ${rs.early ? "Damage is beyond your nearest protective device, so crews can isolate it and restore you in an earlier step." : ""}</div>
<div class="two" style="margin-top:12px"><div><h3 style="margin-top:0">Historical completion ${chip("learned")}</h3>
<div class="mu">Interval-censored log-normal AFT on ${R.n} closed Feb 2025 repairs (design “${R.selected_design}” chosen by leave-one-day-out CV). The headline is a single planning estimate; quantiles below show historical uncertainty.</div>
<table><tr><th>Quantile (${$("ag").value})</th><th class="r">Time</th></tr><tr><td>Fast (P10)</td><td class="r">${hrs(H.p10)}</td></tr><tr><td>Typical (median)</td><td class="r">${hrs(H.p50)}</td></tr><tr><td>Slow (P90)</td><td class="r">${hrs(H.p90)}</td></tr></table></div>
<div><h3 style="margin-top:0">Bottom-up labor ${chip("reference")}</h3>
<div class="mu">Workbook hours × indirect multiplier ÷ crew.</div>
${rs.hasDamage ? `<table><tr><td>Direct repair labor</td><td class="r">${f2(rs.dir, 1)} h</td></tr><tr><td>× multiplier ${f2(rs.mult, 1)}</td><td class="r">${f2(rs.tot, 0)} labor-h</td></tr><tr><td>÷ crew of ${rs.cr} (crew size ±1)</td><td class="r">${hrs(rs.bLo)}–${hrs(rs.bHi)}</td></tr><tr><td>× storm severity ${f2(rs.S)}<sup>${f2(R.severity_scaling.beta, 2)}</sup></td><td class="r">${f2(rs.sevMult, 2)}×</td></tr><tr><td>× main damage type (${$("ag").value})</td><td class="r">${f2(rs.assetMultiplier, 2)}×</td></tr>${rs.early ? `<tr><td>× early-restoration location adjustment</td><td class="r">${f2(rs.locationMultiplier, 2)}×</td></tr>` : ""}${rs.blocked ? `<tr><td>Blocked access ${chip("assumption")}</td><td class="r">+2–8 h</td></tr>` : ""}</table>` : `<div class="mu">No damage entered, so the estimate falls back to the historical duration model.</div>`}</div></div>
<h3>How the two are combined ${chip("rule")}</h3>
<div class="mu">When the damage scenario contains repair work, its bottom-up crew-time estimate drives the premise restoration duration, adjusted for storm severity and the selected main damage type; the early-restoration location applies its own historical P10-to-median factor. The scenario estimate is no longer held at the historical median, so changing damage counts changes the estimate. If all repair-item quantities are zero (including a blank number field), no repair duration is added; the premise estimate reflects its scheduled inspection and response timing only. Historical durations remain visible as reference data.</div>
<div class="formula">${rs.early ? "early step: low = historical P10, high = historical median" : "low = max(historical P10, bottom-up low)\nhigh = max(historical P90, bottom-up high)"}</div>
<h3>What the data does and does not support</h3><ul>
<li><b>Asset type matters:</b> ${aft.map(t => `${t.name.replace("asset:", "")} ×${f2(t.tr)}`).join(", ")} the time of primary wire.</li>
<li><b>Storm-severity scaling ${chip("learned")}:</b> current storm severity ${f2(rs.S)}× → expected workload ×${f2(rs.S)} → all repair times ×${f2(rs.sevMult, 2)} (S<sup>${f2(R.severity_scaling.beta, 2)}</sup>). Fitted by the pipeline on daily workload in Feb 2025 (SE ${f2(R.severity_scaling.se, 2)}); cross-validation did <b>not</b> select that term (${sg(R.severity_scaling.cv_gain_vs_asset_only_per_record, 3)} held-out log-lik/record), so the data supports at most a weak effect.${rs.extrap ? " Current severity is outside the range seen in training, so the multiplier is an extrapolation and is not capped." : ""} The severity itself uses ${SV.source} weather weights.</li>
<li><b>Blocked access</b> was rejected by cross-validation; its +2–8 h is an operator assumption. ${chip("assumption")}</li>
<li><b>Calibrated to a Feb 2025-scale event only.</b> Sep 2024 repair gaps all fall at 23–26 days, which looks like batch close-out, so that event was excluded. Milder or harsher storms were not learned.</li>
<li><b>Heavier tail than shown:</b> ${f2(rs.neverPct, 1)}% of Feb 2025 records were never marked repaired and are excluded from this conditional model. Including them as censored raises σ from ${f2(R.sigma, 2)} to ${f2(R.sensitivity_with_censored.sigma, 2)}.</li>
<li>Dates have no clock time, so precision is about one day.</li></ul>
<div class="mu">Could move it: crew count, blocked roads, extra damage found, damage upstream.</div>
<h3>Repair-time-optimized response plan · 1,000-worker scenario</h3>
<div class="fact"><b>${schedule.noOutageCount === schedule.premises.length
    ? "No restoration expected: all premises are Low risk"
    : schedule.makespan > 0
      ? `Estimated premise schedule finish: ${formatScheduledDuration(schedule.makespan)}`
      : "No restoration schedule could be estimated from the current inputs"}</b>
<div>The plan ranks and schedules anonymized premises individually, not circuits. Premises sharing a circuit remain separate stops. The same displayed outage-risk probability and Low-risk threshold used in the outage-risk card determine whether a restoration estimate is shown: premises below the cutoff have no estimate; all others receive a numeric ballpark. A separate cell-level damage model contributes only to probability-weighted repair workload and does not determine estimate eligibility. For the selected premise, the Damage scenario inputs determine its repair duration; its estimate also includes its scheduled start and inspection time. Inspection duration rises with the damage-severity score and includes a small facility allowance; findings may change the ballpark. The table includes circuit number only as context. Facility counts are assigned to the geographically nearest premise and are approximate.</div></div>
<div class="mu">Worker pool assumption: 70 two-person assessment teams (140 people), 105 four-person line teams (420), 70 three-person tree/access teams (210), 35 three-person equipment teams (105), 35 three-person protection teams (105), and 20 shared dispatch/logistics personnel. These proportions scale the illustrative roster from the supplied research; only the two-person assessment team has a cited AEP team-size reference.</div>
<div class="mu" style="margin-top:6px">Each premise receives a 0–100 priority score. Existing factors contribute up to 80 points: mapped facilities (28), displayed outage risk (16), density (12), customer count (8), and historical damage records in its nearest mapped cell (16). The premise's own Damage scenario contributes up to 20 additional points, scaled by its scenario-based restoration estimate relative to a 24-hour reference; changing a premise's scenario can change its score and route position, shifting scheduled times for other premises. Customer count remains a separate priority factor and is never multiplied into repair-job volume. The separate 0–100 damage-severity score still uses per-customer modeled propensity and local history, not customer count. The score remains a soft guideline: probability-weighted modeled repair effort contributes 90% of the route heuristic and priority score contributes 10%. Restoration estimate calculations are unchanged.</div>
<div class="mu" style="margin-top:6px">The schedule uses the research sample mix (130 wire, 53 switch, 52 pole, 5 equipment across 240 records); switch repair time uses the model's "Other" asset category as a proxy. Repair effort is the damage probability times representative historical median repair durations; it is a ballpark, not a confirmed crew dispatch or job count. Twenty percent of wire/pole work receives 30 minutes of tree/access support. Facilities are assigned to their geographically nearest premise for this approximate plan. No travel, shift/rest, materials, switching dependencies, or confirmed damage are modeled. This is a workload-balancing heuristic, not a guaranteed global optimum.</div>
<div class="priority-table-wrap" style="margin-top:8px"><table class="priority-table circuit-schedule"><thead><tr><th class="r">Suggested order</th><th class="r">Premise priority score</th><th>Premise</th><th>Circuit</th><th class="r">Customers</th><th class="r">Displayed outage risk</th><th class="r">Damage severity (0–100)</th><th>Approximate mapped facilities</th><th>Inspection / estimate status</th><th>Probability-weighted repair effort</th><th>Inspection duration</th><th>Inspection window</th><th>Repair work begins</th><th>Repair work window</th><th>Premise restoration estimate (from response start)</th><th>Why / estimate context</th></tr></thead><tbody>${premiseScheduleRows}</tbody></table></div>`;
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
<h3>Privacy and fallback</h3><p>Premise IDs are re-numbered, the map shows only a ≈400 m cell, fire-station distance is banded, and only cell-level features reach the browser. No addresses, premise numbers, exact coordinates, crew details or sensitive-facility locations appear. Only declared flags are used. If a premise cannot be matched, the concierge should decline to estimate and point to the official outage map and phone line.</p>
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
      map.addSource("priority-facilities", {type: "geojson", data: {type: "FeatureCollection", features: MAP_FACILITIES.map(([kind, id, circuit, lon, lat]) => ({
        type: "Feature",
        properties: {kind, id, circuit},
        geometry: {type: "Point", coordinates: [lon, lat]},
      }))}});
      map.addSource("pm", {type: "geojson", data: {type: "FeatureCollection", features: []}});
      const dmgCol = ["interpolate", ["linear"], ["get", "d"], 0, "#c9ced3", 1, "#f4a6ad", 3, "#e0525e", 6, "#a50f1e"];
      map.addLayer({id: "ce", type: "fill-extrusion", source: "ce", paint: {"fill-extrusion-color": dmgCol, "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": .35}});
      map.addLayer({id: "cs", type: "fill-extrusion", source: "ce", filter: ["==", ["get", "c"], -1], paint: {"fill-extrusion-color": dmgCol, "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": .92}});
      map.addLayer({id: "la", type: "line", source: "ln", paint: {"line-color": "#9aa0a6", "line-width": 1, "line-opacity": .8}});
      map.addLayer({id: "ls", type: "line", source: "ln", filter: ["==", ["get", "c"], -1], paint: {"line-color": "#111", "line-width": 3.2}});
      map.addLayer({id: "dm", type: "circle", source: "dm", paint: {"circle-radius": 3.2, "circle-color": ["match", ["get", "e"], 0, "#d71920", 1, "#111111", "#8a8f94"], "circle-stroke-color": "#fff", "circle-stroke-width": .6}});
      map.addLayer({id: "dv", type: "circle", source: "dv", paint: {"circle-radius": 3.6, "circle-color": ["match", ["get", "t"], 0, "#1f6b3a", "#2f5fa8"], "circle-stroke-color": "#fff", "circle-stroke-width": .6}});
      map.addLayer({id: "pr", type: "circle", source: "pm", paint: {"circle-radius": 11, "circle-color": "rgba(17,17,17,0.08)", "circle-stroke-color": "#111", "circle-stroke-width": 2}});
      map.addLayer({id: "pd", type: "circle", source: "pm", paint: {"circle-radius": 4.5, "circle-color": "#111"}});
      map.addLayer({id: "priority-facilities", type: "circle", source: "priority-facilities", paint: {
        "circle-radius": 7,
        "circle-color": ["match", ["get", "kind"], "hospital", "#c2185b", "police", "#2864dc", "fire", "#e87513", "#555"],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1.5,
      }});
      map.on("click", "ce", e => { const f = e.features[0].properties, i = $("cellinfo"); i.style.display = "block"; i.textContent = f.n + " customers · " + f.d + " damage records in this ≈400 m bin"; });
      map.on("click", "priority-facilities", e => {
        const f = e.features[0].properties, info = $("cellinfo");
        info.style.display = "block";
        info.textContent = `${f.id} · nearest mapped circuit C-${f.circuit} (proximity only; connection unconfirmed)`;
      });
      map.on("mouseenter", "priority-facilities", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "priority-facilities", () => { map.getCanvas().style.cursor = ""; });
      mapReady = true; render(); focusMap();
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
function focusMap() {
  const p = D.prem[$("pm").value], b = D.circ[p.c].b;
  if (map && mapReady) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {padding: 50, duration: 1200, pitch: map.getPitch() || 58, maxZoom: 12.5});
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
  const facilityColors = {hospital: "#c2185b", police: "#2864dc", fire: "#e87513"};
  MAP_FACILITIES.forEach(([kind, , , lon, lat]) => {
    g.beginPath(); g.arc(sx(lon), sy(lat), 5, 0, 2 * Math.PI);
    g.fillStyle = facilityColors[kind]; g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.stroke();
  });
  g.strokeStyle = "#111"; g.lineWidth = 2; g.beginPath(); g.arc(sx(p.p[0]), sy(p.p[1]), 9, 0, 7); g.stroke();
  g.fillStyle = "#5f6368"; g.font = "12px sans-serif"; g.fillText("3D map unavailable in this browser; showing 2D circuit view", 10, 18);
}
$("leg").innerHTML = `<i style="background:#d71920"></i>Feb 2025 damage <i style="background:#111;margin-left:6px"></i>Sep 2024 <i style="background:#8a8f94;margin-left:6px"></i>Other<br><i style="background:#1f6b3a"></i>Recloser <i style="background:#2f5fa8;margin-left:6px"></i>Switch · bold line = your circuit, colored by risk<br><i style="background:#c2185b"></i>Hospital <i style="background:#2864dc;margin-left:6px"></i>Police station <i style="background:#e87513;margin-left:6px"></i>Fire station`;
$("b3d").onclick = () => { if (map && mapReady) map.easeTo({pitch: map.getPitch() > 10 ? 0 : 58, bearing: map.getPitch() > 10 ? 0 : -18, duration: 700}); };
$("bfit").onclick = focusMap;
$("mu").value = L.indirect_multiplier;
const damageScenarioIds = ["n_pole", "n_arm", "n_xf", "n_ins", "n_wire", "n_rec", "ag", "fl", "cr", "mu", "ac"];
const damageScenarioDefaults = {
  n_pole: "0", n_arm: "0", n_xf: "0", n_ins: "0", n_wire: "0", n_rec: "0",
  ag: $("ag").value, fl: $("fl").value, cr: $("cr").value, mu: $("mu").value, ac: $("ac").checked,
};
const premiseDamageScenarios = new Map();
const activeScenario = () => Object.fromEntries(damageScenarioIds.map(id => [
  id,
  $(id).type === "checkbox" ? $(id).checked : $(id).value,
]));
const applyScenario = scenario => damageScenarioIds.forEach(id => {
  if ($(id).type === "checkbox") $(id).checked = scenario[id];
  else $(id).value = scenario[id];
});
let activeScenarioPremiseId = D.prem[$("pm").value].id;
premiseDamageScenarios.set(activeScenarioPremiseId, activeScenario());
const persistActiveScenario = () =>
  premiseDamageScenarios.set(activeScenarioPremiseId, activeScenario());
const restorePremiseScenario = () => {
  const nextPremiseId = D.prem[$("pm").value].id;
  if (nextPremiseId === activeScenarioPremiseId) return;
  persistActiveScenario();
  activeScenarioPremiseId = nextPremiseId;
  applyScenario(premiseDamageScenarios.get(nextPremiseId) || damageScenarioDefaults);
  render();
};
damageScenarioIds.forEach(id => {
  const input = $(id);
  input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => {
    persistActiveScenario();
    render();
  });
});
document.querySelectorAll(".inp,#lv_d,#lv_v,#lv_c").forEach(e => {
  if (!damageScenarioIds.includes(e.id)) e.addEventListener("input", render);
});
$("pm").addEventListener("change", restorePremiseScenario);
showTab("over"); render(); if (!window.__NOMAP) { initMap(); loadNWS(); }
