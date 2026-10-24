# AI Outage Concierge: training pipeline and frontend

The Python pipeline in `pipeline/` trains the models. The frontend in `frontend/` has no risk logic of its own: it reads
`artifacts/model.json` and applies the trained coefficients in the browser, so changing the data and re-running
the pipeline changes what the site predicts and what its Algorithm tab shows.

```
raw shapefiles/DBF + topology + labor xlsx (+ weather)
        │  features.py            cells, cell×event panel, restoration table, premise topology
        ├─ train_outage.py        negative binomial GLM + grouped CV vs baselines → outage.json
        ├─ train_restoration.py   interval-censored log-normal AFT + CV model selection → restoration.json
        ├─ train_severity.py      daily weather→damage NB model, or an explicit PRIOR → severity.json
        ├─ export_model.py        merges everything + labor.py hours → artifacts/model.json
        ├─ export_frontend_data.py anonymized premises, circuits, map layers → site/data.json
        └─ build_frontend.py      inlines frontend/* + model.json + data.json → site/index.html
```

## Run

```
pip install numpy pandas scipy scikit-learn openpyxl          # no statsmodels needed
python tests/test_models.py && python tests/test_severity.py   # estimators recover simulated parameters
cd pipeline
python run_pipeline.py --zips Data1.zip Data2.zip --raw-dir ../data/raw \
    --topology ../data/raw/matched_upstream.txt --labor ../data/raw/Install_Labor_HackOHIO.xlsx \
    [--fetch-weather]
```

## Methods (industry-standard pieces)

| Stage | Method | Validation |
|---|---|---|
| Outage counts | Negative binomial (NB2) GLM, log link, offset ln(customers), ridge penalty, event fixed effect | 5-fold CV grouped by circuit; deviance skill, AUC, Brier skill, calibration; compared with an exposure-only baseline and gradient-boosted Poisson; Feb→Sep transfer test |
| P(outage) | 1 − (1 + αμ)^(−1/α), NB probability of at least one event | calibration table |
| Uncertainty | Coefficient covariance → 80% interval on the linear predictor | not independently validated |
| Restoration | Interval-censored log-normal AFT (dates are day-resolution) | leave-one-report-day-out held-out likelihood; nested designs compared, best chosen |
| Severity | Daily NB GLM on weather (when weather file present) | blocked CV by month |

The NB GLM and AFT are implemented in `nbglm.py` and `aft.py` with numpy/scipy; `tests/` checks that they recover known
parameters from simulated data.

## What is learned and what is not

* Learned: damage rate by 400 m cell features, event level, restoration time by asset type, dispersion.
* **Not learned: weather → severity.** No weather data was reachable when this was built, so `severity.json` holds an
  explicit prior and the frontend labels it. Run `python weather.py` (needs internet; **not yet run against the live
  API**) or pass `--fetch-weather`, then retrain, and the weights are fitted from daily outage counts.
* 
* Excluded: Sep 2024 repair gaps (all 23–26 days, which looks like batch close-out) from the restoration model; the 3.6%
  of Feb 2025 records never marked repaired (conditional model; heavier tail than shown).
* Structural assumptions (flagged in the UI): any damage in a protection zone interrupts the whole zone; cell-level
  dispersion applies to the zone; wire-span repair hours are a placeholder because the workbook has none.

## Privacy

`data/processed/premises.csv.gz` contains raw premise numbers and is internal. Only `site/` (re-numbered premises,
≈400 m cell centres, cell-level features) is meant to be published.
