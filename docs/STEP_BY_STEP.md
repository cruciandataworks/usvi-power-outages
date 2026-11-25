# USVI Power Outages: Step-by-Step Guide

Portfolio project 04 · Crucian Data Works · Roger Simon

This guide walks through the project in the order it was built. Each step covers the goal, why it is done that way, the command to run and what you should see. Work through it from top to bottom and you will be able to rebuild the project yourself and explain every decision in an interview or a client meeting.

Sources:
- The [WAPA outage map](https://www.viwapa.vi/), the original source.
- [The WAPA Outage Record](https://doi.org/10.5281/zenodo.24094228) by Brian Louden of VI Update (CC0).
- [VI Update's report](https://zenodo.org/records/24094226) on that record (CC BY 4.0).

This project is an independent analysis, not an official WAPA product.

---

## The big picture

Projects 01 to 03 each pulled history from agencies that keep their own archives. WAPA does not keep one. Its outage map shows only what is out right now, plus 48 hours of hourly totals. Once an outage is fixed, it is gone from the map. If nobody saves the map, the record is lost.

VI Update saved it every 5 minutes for seven and a half months and published the result as open data. This project does three things with that record:

1. **Rebuilds VI Update's numbers from the raw snapshots** with tested SQL, and proves the rebuild matches their published tables. This is the kind of check a client would want before trusting a dashboard.
2. **Continues the record** by polling WAPA's map itself every 5 minutes.
3. **Watches it**: a GitHub issue opens when a district loses power or the map stops updating.
4. **Goes feeder by feeder** (added 25 November 2026): which neighborhoods are on which feeder, how often each feeder goes out, whether rotations are shared fairly, and whether WAPA kept to its published schedule. See Step 4b.

```
Zenodo (VI Update archive) ─► 1 archive ─┐
WAPA outage map (live) ──────► 2 poll ────┤
WAPA schedule PDF ───────────► 2b save ───┼─► Parquet lake ─► 3 load DuckDB ─► 4 dbt models + tests
                                          │   (+ Census map)                           │
                                          │            dashboard ◄─ 5 export JSON ◄────┤
                                          │        GitHub issues ◄─ 6 sync alerts ◄────┘
```

### Final results (first full build, 20 November 2026)

| Measure | Result |
|---|---|
| Map snapshots (polls) | 65,446 from the archive, plus our own from 20 November |
| Outage sightings (one outage seen in one snapshot) | 530,018 |
| Distinct outage records | 7,433 in the archive |
| Names withheld for privacy | 71,229 sightings |
| Distinct map points placed on the Census map | 3,385 (15 too far offshore to place) |
| dbt | 1 seed, 22 models, 41 data tests, all passing |
| Daily table vs VI Update | 440 of 442 district-days identical |
| District-wide and major outages vs VI Update | 70 of 70 identical to the minute |

What the data shows:

- **Hours without power.** Over 218 days, the average St. Thomas–St. John customer was without power for about 196 hours. On St. Croix it was about 31 hours.
- **District-wide outages.** There were 14 on St. Thomas–St. John and 8 on St. Croix.
- **Longest major outage.** It began on St. Thomas–St. John on 21 October and lasted 65.8 hours. October alone cost the average St. Thomas–St. John customer 75 hours.
- **Causes.** WAPA gave no cause for 92% of the outages on its map.

---

## Step 0: Set up your machine

You need Python 3.12 or newer. Then run:

```bash
cd 04-usvi-power-outages
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # requests, duckdb, pandas, dbt-core, dbt-duckdb
```

There is no pyarrow in the requirements. DuckDB reads and writes Parquet by itself, which keeps the install small.

### Project layout

```
pipeline/
  common.py          shared helpers: lake paths, HTTP with retries, privacy filter, upsert
  step1_archive.py   download + verify VI Update's archive, write it to the lake
  step2_poll.py      poll WAPA's live map
  step2b_schedule.py save every version of WAPA's rotation schedule PDF
  step3_load.py      load the lake into DuckDB, place map points in Census areas
  step5_export.py    write dashboard/data/summary.json
  step6_alerts.py    open / update / close GitHub issues
dbt/
  seeds/             district_reference.csv (customers per district), feeder_places.csv (WAPA's Feeder Listing)
  models/staging     one clean view per raw table
  models/intermediate  the rules: which district, which polls count, midnight splits
  models/marts       the tables the dashboard uses
  tests/             checks against VI Update's published tables
lake/                Parquet files (not in git)
warehouse/           outages.duckdb (not in git, rebuilt every run)
dashboard/           the static web page
run_pipeline.py      runs steps 1-6 in order
```

Step 4 is `dbt build`, which has no Python file. That is why the numbering jumps from step3 to step5.

---

## Step 1: Download and verify the archive

**Goal:** get VI Update's record into the lake exactly as published.

```bash
python pipeline/step1_archive.py
```

What happens:

1. **Download.** It downloads `wapa-outage-record-v1.0.zip` (about 40 MB) from Zenodo and keeps a copy in `lake/_download/`.
2. **Verify.** It computes the file's SHA-256 fingerprint and stops if the result is not `b7b9b674…6ea036db`. A fingerprint is a short code that changes completely if even one byte of the file changes. Checking it proves you have the exact file the author published.
3. **Write to the lake.** It reads the CSVs inside the zip and writes them to `lake/archive/` as Parquet:
   - **polls**: one row per snapshot, with WAPA's own "last updated" time and totals;
   - **sightings**: one row per outage per snapshot;
   - **hourly_history**: WAPA's 48-hour series, as saved over time;
   - **ref_daily, ref_events, ref_records, ref_holes**: VI Update's published answers. They are kept so they can be checked against later.
4. **Census map.** It also saves the 2023 Census county-subdivision boundaries (`census_cousub_2023.geojson`).
5. **Done marker.** It writes `_package.json`. The next run sees this marker and skips the whole step in under a second.

### Key idea: privacy before storage

Each outage on WAPA's map has a name. Most names are equipment IDs such as `T-C-12345` (a transformer on St. Croix) or `Feeder 7B`. Some are street addresses or people's names. `common.py` keeps a name only if it matches one of WAPA's equipment patterns:

- transformers: `T-C-`, `T-T-`, `T-J-`;
- feeders: `Feeder`, `STX_`, `STT_`;
- other equipment: fuses, switches, reclosers and similar.

Every other name is replaced with `[withheld]` before anything is written. Map points are rounded to 4 decimal places (about 11 m), and street labels are reduced to a count.

This is an allow-list: everything is withheld unless it matches a known-safe pattern. A block-list of "bad words" would always miss something.

You should see 71,229 of 530,018 sightings withheld.

---

## Step 2: Poll WAPA's live map

**Goal:** continue the record after VI Update's capture ended on 7 November.

```bash
python pipeline/step2_poll.py                      # one poll
POLLS=3 POLL_INTERVAL=300 python pipeline/step2_poll.py   # three polls, 5 minutes apart
```

WAPA's map is a web page backed by three JSON addresses on `http://outageviewer.viwapa.vi:7575/data/`:

| Address | What it holds |
|---|---|
| `outageSummary` | customers served, customers out, last update time, 48-hour hourly history |
| `outages` | every outage on the map right now: name, customers out, start time, cause, point |
| `outagePolygons` | the shapes drawn on the map (only the count is used) |

Each poll writes month-partitioned Parquet files under `lake/live/`:

- **polls/**: one row per snapshot;
- **sightings/**: one row per outage per snapshot;
- **poll_log/**: every attempt, including failures.

It also updates `lake/live/hourly_history/` and records the collector's health in `lake/_state/`.

### Key idea: polling is allowed to fail

WAPA's map sometimes goes down. On 24 October the archive has a 7.4-hour hole. VI Update's notes say 88 polls failed and that WAPA said its website and phone reporting were down, as reported by The V.I. Consortium. If step 2 fails, `run_pipeline.py` still runs the other steps, so the dashboard keeps showing the history. The failure is counted, and after 4 failed runs in a row, an alert issue opens.

---

## Step 3: Load into DuckDB and place outages on the map

```bash
python pipeline/step3_load.py
```

1. **Load.** It loads the archive and live Parquet files into `warehouse/outages.duckdb`, in a schema called `raw`.
2. **Place.** It works out which Census county subdivision each map point falls inside. The test is point-in-polygon: draw a line from the point and count how many times it crosses the boundary. An odd number of crossings means the point is inside. Points just offshore go to the nearest area within 2 km. 15 points are farther out than that and stay unplaced.
3. **Cache.** The results are stored in `lake/_state/point_places.parquet`, so each point is only placed once.

The placing code is written in plain Python with no GIS library. It is about 40 lines, so you can read every step of it.

---

## Step 4: Model and test with dbt

```bash
cd dbt
dbt build --profiles-dir .
```

`dbt build` loads the seed, builds every model and runs every test in dependency order. You should see `PASS=64 WARN=0 ERROR=0`.

### The rules come from VI Update

VI Update published its rules as plain-English files (`rules/*.md` in the package). This project uses them unchanged, as dbt variables in `dbt_project.yml`. Keeping the same rules means the results can be compared number for number.

| Rule | Value | Meaning |
|---|---|---|
| `interval_cap_min` | 15 | one snapshot stands for at most 15 minutes |
| `stale_after_min` | 30 | if WAPA's "last updated" is this far behind, the snapshot is stale and not counted |
| `missing_after_min` | 12 | more than this between snapshots is a gap |
| `dip_merge_min` | 30 | two outage runs merge across a dip shorter than this |

### The layers

- **staging**: one view per raw table. It renames columns, converts times to UTC and AST (Atlantic Standard Time, UTC−4 all year) and drops nothing.
- **intermediate**:
  - `int_record_district` decides which grid each outage belongs to (see key idea 1).
  - `int_poll_status` marks each snapshot as usable or not, adds up customers out in each district and works out how many minutes the snapshot stands for.
  - `int_poll_district` splits a snapshot's minutes at midnight, so each day gets the right share.
- **marts**: the tables the dashboard reads.

| Mart | What it holds |
|---|---|
| `mart_outage_daily` | customer-hours, peak and covered hours per district per day |
| `mart_outage_monthly` | the same, per month, plus hours per customer |
| `mart_outage_events` | district-wide (80%+) and major (25%+) outages |
| `mart_records` | one row per outage record, with its place and cause |
| `mart_area_customer_hours` | customer-hours by Census subdivision |
| `mart_gaps` | missing and stale stretches, with VI Update's note on why, where it has one |
| `mart_territory_hourly` | WAPA's own 48-hour series |
| `mart_current` | the newest snapshot, by district |
| `mart_alerts` | conditions that need a human right now |

### Key idea 1: two grids, one map

WAPA runs two separate power grids:

- **St. Croix**: 25,142 customers;
- **St. Thomas–St. John–Water Island**: 30,557 customers.

The map mixes both. Each record is placed by the first rule that applies:

1. **The name's prefix.** `T-C-` means St. Croix; `T-T-` and `T-J-` mean St. Thomas–St. John.
2. **The latitude.** Points south of 17.9° N are on St. Croix, and points north of 18.2° N are on St. Thomas–St. John.
3. **The island of the Census area** the point falls in.

VI Update's third rule used street labels. Those are not kept here for privacy, so the Census areas take their place. For 3 records the two methods disagree, and those 3 are left unplaced rather than guessed.

### Key idea 2: customer-hours

One customer without power for one hour is one customer-hour. For each usable snapshot:

```
customer-hours = customers out × minutes until the next snapshot (at most 15) ÷ 60
```

Dividing by the district's customers gives "hours without power per customer". This is close to SAIDI, the outage measure utilities report to regulators.

The 15-minute cap matters. Without it, a 7-hour gap with 20,000 customers out would add 140,000 customer-hours nobody saw. With the cap, gaps count as missing data, not as power.

### Key idea 3: events

A major outage is a run of usable snapshots with at least 25% of a district's customers out. A district-wide outage needs 80%. Three rules decide where a run starts and stops:

- A run breaks at an unusable snapshot or a gap of more than 15 minutes.
- Two runs merge across a dip below the threshold that lasts less than 30 minutes. One outage that flickers is still one outage.
- The `starts_by` and `ends_by` columns say whether the start and end were actually seen (`observed_rise` / `observed_drop`) or fell in a gap (`gap`). The dashboard marks gap starts.

This is a "gaps and islands" problem, a classic SQL pattern. `lag()` flags each place a new run starts, and a running `sum()` of those flags gives every run its own number.

### Key idea 4: testing against someone else's answers

Most dbt tests check shape: no nulls, no duplicates. The four tests below check the actual numbers against VI Update's published tables:

| Test | Compares |
|---|---|
| `assert_daily_matches_vi_update` | customer-hours (within 0.5%), covered hours and peak, every district-day |
| `assert_events_match_vi_update` | start, end and peak of all 70 district-wide and major outages |
| `assert_districts_match_vi_update` | the district of all 7,433 records |
| `assert_gaps_match_vi_update` | every missing stretch |

Any failure means a rule was misread. Each one found real issues while building:

- **Last snapshot.** The last snapshot of the archive had to stand for 0 minutes, not 15.
- **Empty fields.** Empty cause fields had to stay empty instead of becoming "unknown".
- **Two captures.** The archive and the live polls are separate captures, so time is never carried across the 13 days between them.

Two district-days still differ: 17 and 18 April on St. Croix, caused by the 3 offshore records. The test explains this and is set to warn above 2 differences and fail above 5.

### Key idea 5: alerts as a table

`mart_alerts` has one row per condition that needs attention, each with a stable key:

| Key | Fires when |
|---|---|
| `outage:STX` or `outage:STTJ` | 25% or more of the district is out |
| `stale:wapa_feed` | WAPA's map has not updated for 60 minutes |
| `collector:wapa_map` | 4 polls in a row have failed |

Outage alerts only fire on a live snapshot from the last 3 hours, so rebuilding old data never raises one.

---

## Step 4b: Feeder by feeder

**Goal:** answer the questions people actually ask during rotating outages. Which feeder am I on? Is my feeder going out more than others? Did WAPA keep to its schedule?

### What a feeder is

A feeder is one power line leaving a substation. It serves a fixed set of neighborhoods. When WAPA does not have enough generation, it switches whole feeders off in turns. That is a rotating outage, also called load shedding. WAPA's map names these outages after the feeder ("Feeder 07C", "STX Feeder 09B"), and it labels the cause code `000` "Power supply".

Two facts make feeders worth a chapter:

- **Few outages, most of the pain.** Only 785 of the 7,676 outages on the map were whole feeders. But they account for about 73% of the customers affected, because one feeder can cover thousands of homes.
- **Every customer on a feeder lives the same outage.** If Feeder 7C was out for 208 hours, so was each customer on it. That makes feeder hours a fair way to compare neighborhoods.

### The hand-typed seed: `dbt/seeds/feeder_places.csv`

WAPA publishes a [Feeder Listing](https://www.viwapa.vi/customer-service/feeder-listing) as two PDFs, one for [St. Thomas–St. John](https://www.viwapa.vi/docs/default-source/default-document-library/feeder_listings---stj-stt.pdf?sfvrsn=74ec8718_24) and one for [St. Croix](https://www.viwapa.vi/docs/default-source/default-document-library/stx-feeder-listing.pdf?sfvrsn=4e2b4688_32), dated June 2024. They are tables of place names, and the layout does not survive automatic text extraction, so they were typed in by hand. The result is 527 rows: `district, feeder, island, place, split`.

- `split` is `whole` for most places. It is `two_feeders` or `three_feeders` when WAPA lists the same place under more than one feeder (a large estate can be split), and `off_grid` for the three places WAPA marks as not normally connected.
- A seed is a small CSV that dbt loads as a table (`reference.feeder_places`). It is the right tool for a list that changes rarely and that a person maintains.
- **Caveat:** WAPA lists major locations only, and it has moved some neighborhoods to other feeders since 2024, as [The V.I. Consortium reported](https://viconsortium.com/vi-community_center/virgin-islands-wapa-reports-all-st--thomas-st--john-feeders-restored-after-days-of-blackouts-and-unit-27-repairs). A lookup result is "likely", not certain.

### Step 2b: save WAPA's rotation schedule

```bash
python pipeline/step2b_schedule.py
```

WAPA posts its St. Thomas–St. John rotation schedule as a PDF linked from the [Alerts page](https://www.viwapa.vi/news-information/advisory-details). The catch: it [replaces the file at the same address](https://www.viwapa.vi/docs/default-source/outage-schedule/sttstj-rotational-outage-schedule-doc.pdf?sfvrsn=2c938249_428) each time the schedule changes, and old version numbers in the address return the new file. So there is no history to download. The only way to check schedules later is to save every version while it is up. This step does that:

1. **Find the PDF.** It reads the Alerts page and collects links under `/docs/default-source/outage-schedule/`. If the page changes, it falls back to the known address.
2. **Fingerprint it.** It downloads the PDF and takes its SHA-256. If the fingerprint is new, this is a new version. The PDF itself is attached to a monthly GitHub release (`schedules-2026-11`), so the original is kept.
3. **Read only the text you can see.** This is the subtle part. The 25 November PDF had an old "Feeder 7B" label still in the file, hidden under the white card for the 4–6 PM window. A plain text extractor reads it, and the schedule would be wrong. `visible_words()` uses PyMuPDF to replay the page in drawing order. Any word that is later covered by an opaque filled shape is dropped, the same way your eyes never see it.
4. **Rebuild the layout.** `lines_of()` groups words into lines by height on the page, then splits a line wherever there is a gap wider than 20 points. Each time window ("6 AM - 8 AM") is a column header, and each feeder is assigned to the nearest header above it. Lines that say "partial" are marked `partial`.
5. **Write two tables.** `lake/live/schedules/versions/` has one row per PDF version, including every visible word, so the reading can be redone later. `lake/live/schedules/windows/month=YYYY-MM/` has one row per window and feeder.

On 25 November this produced 40 scheduled feeder-windows across 9 time windows, which matched the PDF image exactly. Like step 2, step 2b is allowed to fail. If it fails 8 runs in a row, `mart_alerts` raises a low-level notice.

St. Croix has no schedule file. Its rotations appear in WAPA press releases and in the news, for example the [24 November schedule in the Freedom City Times](https://www.freedomcitytimes.com/post/untitled-7839d7f6), so St. Croix is not checked yet.

### The feeder models

| Model | One row per | What it does |
|---|---|---|
| `int_schedule_final` | district, day, window, feeder | keeps only the latest schedule version for each day, since WAPA often revises a day's plan |
| `mart_feeder_outages` | feeder outage | start = WAPA's start time, end = the last poll that still showed it. A record that claimed to start before our record began (one 7C outage says 17 February) is counted from the first poll, so it cannot add hours nobody saw. `is_power_supply` = cause code `000`. |
| `mart_feeder_daily` | feeder and day | splits each outage's hours across the days it spans, so an outage from 8 PM to 8 AM counts 4 hours on one day and 8 on the next |
| `mart_feeder_scorecard` | feeder | outages, hours out, median length, peak customers out, power-supply hours, last outage, out now, and `power_supply_vs_median`: that feeder's power-supply hours divided by the median feeder's in the same district |
| `mart_schedule_check` | scheduled feeder-window, plus unexplained power-supply outages | compares the schedule with the map (rules below) |

### The matching rules

A scheduled feeder matches an outage of the same feeder that overlaps the window, allowing 30 minutes on either side. WAPA says restoration may run up to 20 minutes late, so that is the allowance at the end. If several outages match, the one that started closest to the window wins.

| Outcome | Meaning |
|---|---|
| As scheduled | started within 30 minutes of the window and cleared within 20 minutes after it |
| Ran long | started on time but was still on the map more than 20 minutes after the window |
| Started early / late | an outage overlapped the window but began more than 30 minutes away from it |
| Still out | the matched outage is still on the map |
| Not seen | no whole-feeder outage appeared. WAPA notes that "not all feeders listed may be affected", and a partial cut shows on the map under a switch code, not the feeder. |
| Upcoming | the window has not ended yet |
| Not recorded | we were not polling at the time |
| Not on the schedule | a power-supply outage of a feeder on a scheduled day that no window explains |

### What you see on the dashboard

- **Facts:** feeders tracked, the 73% share, the worst feeder and the number of power-supply outages.
- **Which feeder am I on?** Type a place. The search ignores accents, capitals and apostrophes, and treats "Est." as "Estate". It shows the feeder or feeders, any split note, that feeder's record and its windows on the latest schedule.
- **Rotation schedule vs the map:** one row per scheduled feeder-window with its outcome, and a day picker once more than one day has been saved.
- **Feeder scorecard:** sortable by any column. Places marked * are split between feeders.
- **Rotation calendar:** feeders down the side, days across. Coral means power-supply hours that day, teal means other or no cause, and darker means longer. Hatched days were not recorded.
- **Is the rotation shared fairly?** Power-supply hours per feeder with the district median as a dashed line. Coral bars are 1.5 times the median or more. On St. Thomas–St. John, 7C carried about 3.4 times the typical feeder.

### Caveats to say out loud

- Most feeder outages on the map list no cause, so some rotations are counted as "other". The power-supply totals are a floor.
- A rotation that cut only part of a feeder appears under a switch name, not the feeder.
- "Hours out" ends when the map cleared the outage, which is not always the minute power came back.
- The neighborhood list is from 2024 and lists major places only.
- Schedule checks start on 25 November 2026, the first day the pipeline saved the PDF.

---

## Step 5: Export for the dashboard

```bash
python pipeline/step5_export.py
python -m http.server 8804 -d dashboard     # open http://localhost:8804
```

The dashboard is a static page with no database behind it. This step writes everything it needs to `dashboard/data/summary.json` (about 185 KB). That includes:

- right now: customers out by district, and the largest outages on the map;
- WAPA's 48-hour history and our recent polls;
- the daily, monthly and event tables;
- totals by area and by cause;
- gaps, alerts and collector health;
- the match counts against VI Update;
- `feeders`: the scorecard, the daily feeder hours (as compact arrays to keep the file small), the place list and the last 14 days of schedule checks.

---

## Step 6: Alert issues on GitHub

```bash
python pipeline/step6_alerts.py      # needs GH_TOKEN; without it, it only prints what it would do
```

For every row in `mart_alerts`, the script makes sure exactly one open GitHub issue exists, labelled `outage-alert`:

- **New condition**: it opens an issue and assigns it to `ALERT_ASSIGNEE` (default `OrlandoSpears`).
- **Condition still active**: it leaves the issue alone, or adds a comment if the level changed (for example, from major to district-wide).
- **Condition gone**: it comments and closes the issue.

This step is the same as Project 3's step 7, pointed at a different database and label.

---

## Step 7: Run everything with one command

```bash
python run_pipeline.py            # all steps, including 2b
python run_pipeline.py --from 3   # skip download and polling, rebuild from the lake
```

`run_pipeline.py` runs steps 1–6 in order. Only steps 2 and 2b are allowed to fail. If anything from step 3 on fails, the run stops, so a broken build never replaces good data on the website. Set `TEST_FAILURE=true` to fail on purpose and test the failure alert.

---

## Step 8: Schedule it every 15 minutes

`.github/workflows/refresh.yml` runs the pipeline every 15 minutes on GitHub's servers. Each run polls WAPA three times, 5 minutes apart. That keeps VI Update's 5-minute rhythm.

The data lives in two places between runs:

| Data | Where | Why |
|---|---|---|
| `lake/archive` (VI Update's record, 3 MB) | Actions cache | It never changes. If the cache is lost, step 1 rebuilds it from Zenodo. |
| `lake/live` and `lake/_state` (our polls) | a release called `lake` | It is the only copy of our own polls, so it is uploaded after every run. |

The workflow also:

- **Commits once a day.** It commits `summary.json` once a day, because GitHub pauses schedules in repositories with no commits for 60 days.
- **Uploads the dashboard.** It sends the dashboard to Hostinger over FTP once the FTP secrets are set.
- **Reports failures.** It opens a `refresh-failure` issue if a run fails.
- **Has a backup for the scheduler.** The schedule runs at minutes 7, 22, 37 and 52, because GitHub delays or drops scheduled runs most often on the quarter hour. GitHub can also take a long time to start firing schedules in a new repository. So each run that was not started by the schedule waits until 15 minutes after it began and then starts the next one itself (`chained=true`). It first checks whether any newer run has started in the meantime (a scheduled run, a manual run or another chain); if one has, it stops. That keeps only one chain going, and once the schedule fires, the chain ends on its own. Set the repository variable `CHAIN_RUNS` to `false` to turn the backup off.

### Why the repository must be public

Each run takes about 12 minutes, because it waits 5 minutes between polls. At 96 runs a day, that is over 1,000 minutes a day. GitHub's free plan includes 2,000 minutes a month for private repositories, which would run out in about two days. Public repositories have unlimited minutes, so the schedule stays switched off until the repository is public.

### Setup checklist in GitHub

1. **Make the repository public**, then turn the schedule on: Actions > Power outages refresh > Enable workflow.
2. **Add the FTP secrets** in Settings > Secrets and variables > Actions: `FTP_SERVER`, `FTP_USERNAME` and `FTP_PASSWORD`. Use the same values as Project 3.
3. **Check the variable** `FTP_SERVER_DIR` = `/public_html/projects/power-outages/` (already set).
4. **Optionally, add the variable** `ALERT_ASSIGNEE` for whoever should get the alert issues.

---

## Talking about this project

Lines you can use in an interview or a client meeting:

- **What the source keeps.** "WAPA's map only shows the present. I combined an open archive with my own collector so the record keeps going, and I store nothing that could identify a household."
- **Proving the rebuild.** "I didn't just rebuild VI Update's numbers. I wrote tests that compare my output with theirs on every run: 440 of 442 days and all 70 major outages match exactly. The two days that differ are explained in the test itself."
- **Gaps.** "Missing data counts as missing, not as power. Every gap is listed on the page, and no snapshot stands for more than 15 minutes."
- **Alerts.** "Alerts are just a table. One GitHub issue per condition opens and closes itself, so an outage creates one notification, not one every 15 minutes."

For a client, the same pattern fits any system that only shows its current state: a booking engine, a point-of-sale system, a sensor dashboard. Save it on a schedule, test it against known numbers and alert when it goes quiet.

---

## Publishing to cruciandataworks.com

The workflow uploads `dashboard/` to `/public_html/projects/power-outages/` on every run once the FTP secrets exist. The homepage card for Project 04 links to `https://cruciandataworks.com/projects/power-outages/`.
