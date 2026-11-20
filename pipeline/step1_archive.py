"""Step 1 - Archive: load VI Update's published record of WAPA's outage map.

From 23 March to 7 November 2026, VI Update (Brian Louden, St. Croix) saved WAPA's public
outage map every five minutes and published it as a data package on Zenodo, dedicated to
the public domain (CC0 1.0): https://doi.org/10.5281/zenodo.24094228

This step downloads that package once, checks its SHA-256 fingerprint against the one
published with it, and turns the tables we need into Parquet under lake/archive/. If the
files are already there it does nothing, so normal runs skip it in a second.

We also keep four of VI Update's own computed tables as a reference: the warehouse
rebuilds the same numbers from the raw polls, and dbt tests check that they agree.
"""
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

import duckdb
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from common import ARCHIVE, LAKE, feeder_from_name, get, name_district, record_health, safe_name  # noqa: E402

URL = "https://zenodo.org/api/records/24094228/files/wapa-outage-record-v1.0.zip/content"
SHA256 = "b7b9b67470c1572b48fef7bddeac3ee82d29f671e5807c110493b6669ea036db"  # published on the record
PREFIX = "wapa-outage-record-v1.0/"
DONE = ARCHIVE / "_package.json"
INT_COLS = ["customers_served", "out_territory", "customers_affected", "customers_restored",
            "customers_out_now", "customers_out_initially"]


def read_csv(z, name):
    return pd.read_csv(io.BytesIO(z.read(PREFIX + name)), dtype=str, keep_default_na=False,
                       na_values=[""], encoding="utf-8")


def to_int(df, cols):
    for c in cols:
        if c in df:
            df[c] = pd.to_numeric(df[c]).astype("Int64")
    return df


def write(df, name):
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.register("df", df)
    con.execute(f"copy df to '{ARCHIVE / name}.parquet' (format parquet, compression zstd)")
    print(f"  {name:<18} {len(df):>9,} rows")


def main():
    if DONE.exists() and json.loads(DONE.read_text()).get("sha256") == SHA256:
        print("  archive already in the lake - nothing to do")
        return
    cache = LAKE / "_download" / "wapa-outage-record-v1.0.zip"
    if not cache.exists():
        print("  downloading the data package from Zenodo (41 MB)")
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(get(URL, timeout=300).content)
    digest = hashlib.sha256(cache.read_bytes()).hexdigest()
    if digest != SHA256:
        cache.unlink()
        raise SystemExit(f"SHA-256 mismatch: got {digest}, expected {SHA256}. Not loading it.")
    print("  SHA-256 matches the published fingerprint")
    z = zipfile.ZipFile(cache)

    # polls: one row per five-minute capture of WAPA's summary
    polls = read_csv(z, "as-filed/polls.csv")
    status = read_csv(z, "labeled/poll_status.csv")
    # a poll whose outage records were not saved has blank district totals (a PARTIAL poll)
    status["outages_captured"] = status["out_stx"].notna()
    polls = polls.merge(status[["poll_utc", "outages_captured", "active_outage_records", "streets_affected"]],
                        on="poll_utc", how="left")
    polls = to_int(polls.drop(columns=["poll_ast"]), INT_COLS + ["active_outage_records", "streets_affected"])
    polls["source"] = "archive"
    write(polls, "polls")

    # sightings: one row per outage record per poll
    s = read_csv(z, "as-filed/sightings.csv")
    names = s["wapa_name"].dropna().unique()
    s["name_district"] = s["wapa_name"].map({n: name_district(n) for n in names})
    s["feeder"] = s["wapa_name"].map({n: feeder_from_name(n) for n in names})
    s["wapa_name"] = s["wapa_name"].map({n: safe_name(n) for n in names})
    s["lat"] = pd.to_numeric(s["lat"]).round(4)
    s["lng"] = pd.to_numeric(s["lng"]).round(4)
    s["verified"] = s["verified"] == "1"
    s = to_int(s, INT_COLS)
    s["n_streets"] = pd.array([pd.NA] * len(s), dtype="Int64")  # street lists are not kept (privacy)
    s["source"] = "archive"
    write(s[["poll_utc", "record_id", "wapa_name", "name_district", "feeder", "lat", "lng",
             "customers_out_now", "customers_restored", "customers_out_initially", "verified", "cause",
             "wapa_modified_time", "wapa_start_time", "wapa_end_time", "n_streets", "source"]], "sightings")

    # WAPA's own 48-hour territory history, as VI Update kept it (first and final value per hour)
    h = read_csv(z, "labeled/hourly_history.csv")
    h = to_int(h, ["first_value", "final_value"])
    write(h[["event_hour_ast", "first_value", "final_value"]], "hourly_history")

    # VI Update's own results, kept only so dbt can check our rebuild against them
    write(read_csv(z, "labeled/daily.csv").drop(columns=["rule"]), "ref_daily")
    write(read_csv(z, "labeled/events.csv").drop(columns=["rule"]), "ref_events")
    write(read_csv(z, "labeled/records.csv")[["record_id", "district"]], "ref_records")
    write(read_csv(z, "labeled/holes.csv").drop(columns=["rule"]), "ref_holes")

    # Census 2023 county subdivisions, for placing outages in areas
    (ARCHIVE / "census_cousub_2023.geojson").write_bytes(z.read(PREFIX + "as-filed/census/cb_2023_78_cousub_500k.json"))

    DONE.write_text(json.dumps({"sha256": SHA256, "doi": "10.5281/zenodo.24094228", "version": "1.0"}, indent=2))
    record_health("archive", True, len(s), detail="VI Update package v1.0")


if __name__ == "__main__":
    main()
