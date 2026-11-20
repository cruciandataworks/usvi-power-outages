"""Shared helpers: HTTP with retries, the Parquet "lake", the privacy rules for WAPA's
record names, and the source-health log.

The lake has two halves:

    lake/archive/   VI Update's published record, 23 March - 7 November 2026. Rebuilt from
                    the Zenodo data package whenever it is missing (step 1). Never edited.
    lake/live/      Our own polls of WAPA's outage map, from 20 November 2026 on (step 2).
                    Split by month, so each poll only rewrites the current month's files.

Both halves use the same columns, so the warehouse can stack them into one history.
"""
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
LAKE = Path(os.environ.get("LAKE_DIR", ROOT / "lake"))
ARCHIVE = LAKE / "archive"
LIVE = LAKE / "live"
STATE = LAKE / "_state"
HEADERS = {"User-Agent": "CrucianDataWorks-portfolio/1.0 (hello@cruciandataworks.com)"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------- HTTP
def get(url, tries=3, timeout=45, pause=0.5):
    """GET with retries after a failure (waits 5 then 15 seconds). WAPA's map is a small
    server, so we ask for each endpoint once per poll and back off when it struggles."""
    last = None
    for attempt in range(tries):
        time.sleep(pause)
        try:
            r = requests.get(url, headers=HEADERS, timeout=timeout)
            if r.status_code >= 500 or r.status_code == 429:
                raise requests.HTTPError(f"HTTP {r.status_code}")
            if r.status_code >= 400:
                raise LookupError(f"HTTP {r.status_code}: {r.text[:200]}")
            return r
        except (requests.RequestException, requests.HTTPError) as e:
            last = e
            if attempt < tries - 1:
                time.sleep(5 * 3 ** attempt)
    raise RuntimeError(f"failed after {tries} attempts: {last}")


# ---------------------------------------------------------------------------- privacy
# WAPA's map names each outage record. Most names are equipment codes - a transformer
# (T-C-00318: T = transformer, C = St. Croix) or a feeder (Feeder 07C) - but some are
# free text, and VI Update found names that act as customer identifiers. We keep a name
# only when it matches an equipment pattern; anything else is stored as "[withheld]".
# Street labels can carry people's names, so we keep only how many there were.
SAFE_NAME = re.compile(
    r"(T-[TCJ]-\d+[A-Z]?(_\d+)?"            # transformer, by island
    r"|(STX |STT )?Feeder [0-9A-Z]{1,4}"     # whole or part feeder
    r"|(STX|STT)_?\d+(_\d+)?"                # district-prefixed device number
    r"|FUS[TCJ]-\d+[A-Z]?"                    # fuse
    r"|(TSW|ISW|REC|RECC|UGS)-[0-9A-Z-]+"    # switches and reclosers
    r"|OCD\d+)",                             # over-current device
    re.I)
FEEDER = re.compile(r"^(?:STX |STT )?Feeder 0*([0-9]{1,2}[A-Z]?)\b", re.I)
WITHHELD = "[withheld]"


def name_district(name):
    """District rule 1 (VI Update, rules/districts.md): the name's prefix names the grid.
    Worked out before the name is masked, so masking never loses the district."""
    if not isinstance(name, str):
        return None
    if name.startswith(("T-C-", "STX")):
        return "STX"
    if name.startswith(("T-T-", "T-J-")):
        return "STTJ"
    return None


def feeder_from_name(name):
    m = FEEDER.match(name) if isinstance(name, str) else None
    return m.group(1).upper() if m else None


def safe_name(name):
    if not isinstance(name, str) or not name:
        return None
    if name.startswith("[") and name.endswith("]"):  # already masked by VI Update
        return WITHHELD
    return name if SAFE_NAME.fullmatch(name.strip()) else WITHHELD


# ---------------------------------------------------------------------------- lake
def upsert(path: Path, df: pd.DataFrame, keys: list) -> int:
    """Merge new rows into one Parquet file. A row whose keys already exist is replaced
    by the newer copy, so repeating a poll never creates duplicates. Returns new rows."""
    if df.empty:
        return 0
    df = df.drop_duplicates(subset=keys, keep="last").copy()
    for c in df.columns:  # a text column that is empty in this batch must still be text
        if df[c].dtype == object and df[c].isna().all():
            df[c] = df[c].astype("string")
    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.register("new_rows", df)
    if path.exists():
        before = con.execute(f"select count(*) from read_parquet('{path}')").fetchall()[0][0]
        query = f"""
            select * exclude (src, rn) from (
                select *, row_number() over (partition by {', '.join(keys)} order by src desc) rn
                from (select *, 1 as src from new_rows
                      union all by name select *, 0 as src from read_parquet('{path}'))
            ) where rn = 1 order by {', '.join(keys)}"""
    else:
        before = 0
        query = f"select * from new_rows order by {', '.join(keys)}"
    # write beside the old file, then swap: a crash can never leave half a file behind
    tmp = path.with_suffix(".tmp")
    con.execute(f"copy ({query}) to '{tmp}' (format parquet, compression zstd)")
    after = con.execute(f"select count(*) from read_parquet('{tmp}')").fetchall()[0][0]
    os.replace(tmp, path)
    return after - before


def record_health(source: str, ok: bool, rows: int = 0, error: str = "", detail: str = ""):
    """One line per source: when it last worked, how many tries in a row failed, and the
    last error. The dashboard and the alerts read this file."""
    STATE.mkdir(parents=True, exist_ok=True)
    f = STATE / "health.json"
    health = json.loads(f.read_text()) if f.exists() else {}
    h = health.get(source, {"consecutive_failures": 0})
    h["last_attempt"] = now_utc().replace(microsecond=0).isoformat()
    if ok:
        h.update(last_success=h["last_attempt"], consecutive_failures=0, last_rows=rows,
                 last_error="", detail=detail)
    else:
        h["consecutive_failures"] = h.get("consecutive_failures", 0) + 1
        h["last_error"] = error[:300]
    health[source] = h
    f.write_text(json.dumps(health, indent=2, sort_keys=True))
