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

## Run the visualizer and chatbot (local demo)

You need **two processes**: static site (visualizer + chat page) and the FastAPI backend (Bedrock + `/status`).

### 1. Visualizer (frontend)

If `site/index.html` already exists (committed or built by the pipeline), serve the folder:

```powershell
cd site
python -m http.server 8080
```

Open **http://127.0.0.1:8080/index.html** — map, sliders, and model tabs. No backend required for the visualizer alone.

To rebuild after changing data or models:

```powershell
pip install numpy pandas scipy scikit-learn openpyxl
cd pipeline
python run_pipeline.py --raw-dir ../data/raw --topology ../data/raw/matched_upstream.txt --labor ../data/raw/Install_Labor_HackOHIO.xlsx
```

That refreshes `artifacts/model.json`, `site/data.json`, and `site/index.html`.

### 2. Chat API (backend)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Edit **`.env`** with AWS credentials that can call **Amazon Bedrock** in your region. Enable model access for the ID in `backend/app/config.py` (`MODEL_ID`, default Nova). For SSO/temporary creds, set `AWS_SESSION_TOKEN` too.

Optional **`MAPBOX_ACCESS_TOKEN`** (or **`MAPBOX_API_KEY`**): geocodes the Assistant address via [Mapbox Geocoding v6 forward](https://api.mapbox.com/search/geocode/v6/forward) (`geocoder: mapbox` in `/status` → `geocode`). If unset, the backend uses the free US Census geocoder.

Start the API (**must run from `backend/`**, or use `--app-dir` / `run-api.ps1` from repo root):

```powershell
cd backend
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

From the **repo root** (fixes `No module named 'app'`):

```powershell
uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
# or
.\run-api.ps1
```

Check **http://127.0.0.1:8000/health** → `{"status":"ok"}`.

Useful endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /status?customer_id=P-0001&use_nws=true` | Location status (model + grid + weather) without LLM |
| `POST /chat` | Multi-turn chat; optional `customer` block (address or id) |

Example chat body:

```json
{
  "messages": [{ "role": "user", "content": "Could I lose power if the storm is worse upstream?" }],
  "customer": {
    "address": "123 Main St, Roanoke, VA",
    "use_nws": true,
    "scan_feeder_weather": true
  }
}
```

### 3. Chat UI (browser)

With the static server still on port **8080** and the API on **8000**:

Open **http://127.0.0.1:8080/chat.html**

- Set **API base URL** to `http://127.0.0.1:8000`
- Enter **customer id** (`P-0001`, same as the visualizer dropdown) **or** a US **address** (not both)
- Keep **NWS + feeder scan** checked so the bot gets weather and upstream exposure

Link from the visualizer: pick a premise in the dropdown, then open  
`chat.html?customer=P-0042&api=http://127.0.0.1:8000`.

CORS is open for development (`backend/app/main.py`). Tighten before production.

---

## Run (training pipeline)

```
pip install numpy pandas scipy scikit-learn openpyxl          # no statsmodels needed
python tests/test_models.py && python tests/test_severity.py   # estimators recover simulated parameters
cd pipeline
python run_pipeline.py --zips ../data/raw/Data1.zip ../data/raw/Data2.zip \ 
    --raw-dir ../data/raw --topology ../data/raw/matched_upstream.txt \ 
    --labor ../data/raw/Install_Labor_HackOHIO.xlsx
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
