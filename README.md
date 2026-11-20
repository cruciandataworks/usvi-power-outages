# USVI Power Outages

Portfolio project 04 · [Crucian Data Works](https://cruciandataworks.com) · Roger Simon

How often does the power go out in the U.S. Virgin Islands, where, and for how long? This pipeline keeps a running record of WAPA's public outage map, tests every number and publishes a dashboard every 15 minutes.

Live dashboard: [cruciandataworks.com/projects/power-outages](https://cruciandataworks.com/projects/power-outages/)

## What it does

1. **Archive.** It downloads [The WAPA Outage Record](https://doi.org/10.5281/zenodo.24094228) (Brian Louden, VI Update, CC0) and checks its SHA-256 fingerprint. The archive holds 65,446 snapshots of WAPA's map saved every 5 minutes from 23 March to 7 November 2026. VI Update's findings are in [their report](https://zenodo.org/records/24094226).
2. **Poll.** It reads WAPA's live outage map (`outageSummary`, `outages`, `outagePolygons`) three times per run, five minutes apart, so the record continues after the archive ends.
3. **Load.** It loads the Parquet lake into DuckDB and places every outage point in a 2023 Census county subdivision.
4. **Model and test.** It rebuilds daily customer-hours, district-wide and major outages, coverage gaps and alerts with dbt. 41 data tests run every time, including four that compare the rebuild with VI Update's published tables.
5. **Export.** It writes one JSON file for the static dashboard.
6. **Alert.** It opens a GitHub issue when 25% or more of a district is out, when WAPA's map stops updating, or when the collector fails 4 runs in a row. It closes the issue when the condition clears.

## Results (first build, 20 November 2026)

| Check | Result |
|---|---|
| Daily customer-hours and peaks vs VI Update | 440 of 442 district-days identical. The 2 that differ (17–18 Apr, St. Croix) are explained in the test. |
| District-wide and major outages | 70 of 70 match to the minute |
| District of each outage record | 7,430 of 7,433 match. The other 3 are left unplaced rather than guessed. |
| Coverage gaps | All match |
| dbt | 1 seed, 22 models, 41 data tests, all passing |

Over the 218 days captured, the average St. Thomas–St. John customer was without power for about 196 hours, compared with about 31 hours on St. Croix. There were 14 district-wide outages on St. Thomas–St. John and 8 on St. Croix. WAPA gave no cause for 92% of the outages on its map.

## Privacy

Some names on WAPA's map are street addresses or people's names. Only names that match WAPA's equipment patterns (transformers, feeders, fuses, reclosers and switches) are kept. Every other name is stored as `[withheld]` before anything is written to disk. Map points are rounded to 4 decimal places, and street labels are reduced to a count.

## Run it yourself

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run_pipeline.py              # about 1 minute the first time (40 MB download), then about 10 seconds
python -m http.server 8804 -d dashboard
```

The full beginner walkthrough is in [docs/STEP_BY_STEP.md](docs/STEP_BY_STEP.md).

## Layout

```
pipeline/   step1_archive.py  step2_poll.py  step3_load.py  step5_export.py  step6_alerts.py  common.py
dbt/        staging -> intermediate -> marts, plus tests/ that check against VI Update
dashboard/  index.html  app.js  power.css  styles.css  data/summary.json
.github/workflows/refresh.yml   every 15 minutes
```

## Credits

The data comes from the Virgin Islands Water and Power Authority's public outage map. The March–November 2026 archive and its rules are by Brian Louden of VI Update, released under CC0. This is an independent analysis, not an official WAPA product.
