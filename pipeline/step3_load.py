"""Step 3 - Load: stack the archive and our live polls into one DuckDB warehouse.

Creates the "raw" schema that dbt reads from:

    raw.polls, raw.sightings, raw.hourly_history   archive rows + live rows, same columns
    raw.poll_log                                   every live request, including failures
    raw.point_places                               each map point -> Census county subdivision
    raw.ref_daily, raw.ref_events, raw.ref_records VI Update's own results (for dbt's checks)
    raw.source_health                              the collectors' health file

Placing points: WAPA gives each outage record a map point. We test each distinct point
against the Census Bureau's 2023 county subdivisions (Christiansted, Tutu, Cruz Bay ...)
with a point-in-polygon test. A point just off the coast (WAPA's points are sometimes in
the water) goes to the nearest subdivision if it is within 2 km, as VI Update did.
"""
import json
import math
import sys
from pathlib import Path

import duckdb
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from common import ARCHIVE, LIVE, ROOT, STATE  # noqa: E402

DB = ROOT / "warehouse" / "outages.duckdb"
NEAR_KM = 2.0


# ---------------------------------------------------------------------------- geometry
def rings(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    return [ring for poly in polys for ring in poly]  # outer rings and holes


def inside(x, y, geom):
    """Ray casting: draw a line from the point to the east and count how many polygon
    edges it crosses. An odd count means inside. Holes count too, so they work."""
    hit = False
    for ring in rings(geom):
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                hit = not hit
    return hit


def km_to_edge(x, y, geom):
    """Shortest distance from the point to the polygon's edges, in km (flat-earth
    approximation, fine over a few km at 18 degrees north)."""
    kx, ky = 111.32 * math.cos(math.radians(y)), 110.57
    best = float("inf")
    for ring in rings(geom):
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            ax, ay, bx, by = (x1 - x) * kx, (y1 - y) * ky, (x2 - x) * kx, (y2 - y) * ky
            dx, dy = bx - ax, by - ay
            t = 0 if dx == dy == 0 else max(0, min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
            best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


def place_points(points: pd.DataFrame) -> pd.DataFrame:
    gj = json.loads((ARCHIVE / "census_cousub_2023.geojson").read_text())
    areas = []
    for f in gj["features"]:
        xs = [c[0] for r in rings(f["geometry"]) for c in r]
        ys = [c[1] for r in rings(f["geometry"]) for c in r]
        areas.append((f["properties"]["NAME"], f["properties"]["NAMELSADCO"].replace(" Island", ""),
                      f["properties"]["GEOID"], f["geometry"], (min(xs), min(ys), max(xs), max(ys))))
    out = []
    for lat, lng in points.itertuples(index=False):
        hit = None
        for name, island, geoid, geom, (x0, y0, x1, y1) in areas:
            if x0 <= lng <= x1 and y0 <= lat <= y1 and inside(lng, lat, geom):
                hit = (name, island, geoid, 0.0, "inside")
                break
        if hit is None:
            d, a = min((km_to_edge(lng, lat, a[3]), a) for a in areas)
            hit = (a[0], a[1], a[2], round(d, 3), "nearest") if d <= NEAR_KM else (None, None, None, round(d, 3), "unplaced")
        out.append((lat, lng, *hit))
    return pd.DataFrame(out, columns=["lat", "lng", "subdivision", "island", "geoid", "km_outside", "placed_by"])


# ---------------------------------------------------------------------------- load
def live(dataset):
    files = list((LIVE / dataset).rglob("*.parquet"))
    return f"read_parquet('{LIVE / dataset}/**/*.parquet', hive_partitioning=0, union_by_name=1)" if files else None


def stack(con, table, archive_file, live_dataset):
    parts = [f"select * from read_parquet('{ARCHIVE / archive_file}')"]
    if live(live_dataset):
        parts.append(f"select * from {live(live_dataset)}")
    con.execute(f"create or replace table raw.{table} as " + " union all by name ".join(parts))
    print(f"  raw.{table:<16} {con.execute(f'select count(*) from raw.{table}').fetchall()[0][0]:>9,} rows")


def main():
    DB.parent.mkdir(exist_ok=True)
    con = duckdb.connect(str(DB))
    con.execute("create schema if not exists raw")
    stack(con, "polls", "polls.parquet", "polls")
    stack(con, "sightings", "sightings.parquet", "sightings")
    stack(con, "hourly_history", "hourly_history.parquet", "hourly_history")

    log = live("poll_log")
    con.execute("create or replace table raw.poll_log as " + (
        f"select * from {log}" if log else
        "select ''::varchar poll_utc, ''::varchar endpoint, true ok, 0 ms, ''::varchar error where false"))

    for t in ["ref_daily", "ref_events", "ref_records", "ref_holes"]:
        con.execute(f"create or replace table raw.{t} as select * from read_parquet('{ARCHIVE / t}.parquet')")

    pts = con.execute("select distinct lat, lng from raw.sightings where lat is not null and lng is not null").df()
    known = pd.DataFrame()
    cache = STATE / "point_places.parquet"
    if cache.exists():  # points placed on an earlier run are not tested again
        known = con.execute(f"select * from read_parquet('{cache}')").df()
        pts = pts.merge(known[["lat", "lng"]], how="left", indicator=True).query("_merge == 'left_only'")[["lat", "lng"]]
    placed = pd.concat([known, place_points(pts)], ignore_index=True) if len(pts) else known
    con.register("placed", placed)
    con.execute("create or replace table raw.point_places as select * from placed")
    STATE.mkdir(parents=True, exist_ok=True)
    con.execute(f"copy raw.point_places to '{cache}' (format parquet)")
    print(f"  raw.point_places     {len(placed):>9,} points ({len(pts):,} new)")

    hf = STATE / "health.json"
    health = json.loads(hf.read_text()) if hf.exists() else {}
    rows = [dict(source=k, **{c: v.get(c) for c in ["last_attempt", "last_success", "consecutive_failures", "last_error"]})
            for k, v in health.items()]
    hdf = pd.DataFrame(rows, columns=["source", "last_attempt", "last_success", "consecutive_failures", "last_error"]).astype(
        {"source": "string", "last_attempt": "string", "last_success": "string", "last_error": "string"})
    con.register("hdf", hdf)
    con.execute("create or replace table raw.source_health as select * from hdf")
    con.close()


if __name__ == "__main__":
    main()
