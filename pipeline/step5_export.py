"""Step 5 - Export: write the small JSON file the dashboard reads.

The dashboard is a static web page with no database behind it. This step reads the
finished marts and writes everything the page needs into dashboard/data/summary.json.
"""
import json
import math
from datetime import date, datetime
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "warehouse" / "outages.duckdb"
OUT = ROOT / "dashboard" / "data" / "summary.json"


def clean(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat(timespec="minutes") if isinstance(v, datetime) else v.isoformat()
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if hasattr(v, "is_integer") and not isinstance(v, bool) and isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def rows(con, sql):
    rel = con.sql(sql)
    return [{k: clean(v) for k, v in zip(rel.columns, r)} for r in rel.fetchall()]


def one(con, sql):
    r = rows(con, sql)
    return r[0] if r else {}


def main():
    con = duckdb.connect(str(DB), read_only=True)
    meta = one(con, """
        select
            (select min(poll_ast) from staging.stg_polls where source = 'archive') as archive_start_ast,
            (select max(poll_ast) from staging.stg_polls where source = 'archive') as archive_end_ast,
            (select min(poll_ast) from staging.stg_polls where source = 'live')    as live_start_ast,
            (select max(poll_ast) from staging.stg_polls)                          as latest_poll_ast,
            (select count(*) from staging.stg_polls)                               as polls,
            (select count(*) from staging.stg_polls where source = 'live')         as live_polls,
            (select count(*) from staging.stg_sightings)                           as sightings,
            (select count(*) from marts.mart_records)                              as records,
            (select round(sum(covered_hours) / 2, 1) from marts.mart_outage_daily) as covered_hours,
            cast(now() at time zone 'UTC' as timestamp)                            as built_utc
    """)
    current = rows(con, "select * exclude (poll_utc) from marts.mart_current order by district desc")
    on_map = rows(con, """
        select record_id, district, coalesce(subdivision, 'Unplaced') as subdivision, island,
               wapa_name, max_customers_out, wapa_start_ast, round(life_hours, 1) as hours_on_map,
               cause
        from marts.mart_records where on_map_now
        order by max_customers_out desc limit 8""")
    # the newest 10 days at poll resolution (live) and WAPA's own hourly history
    recent = rows(con, """
        select poll_ast as t, out_stx as stx, out_sttj as sttj
        from intermediate.int_poll_status
        where is_usable and source = 'live'
          and poll_ast >= (select max(poll_ast) from intermediate.int_poll_status) - interval 10 day
        order by 1""")
    hourly = rows(con, """
        select hour_ast as t, customers_out as out from marts.mart_territory_hourly
        where hour_ast >= (select max(hour_ast) from marts.mart_territory_hourly) - interval 10 day
        order by 1""")
    daily = rows(con, """
        select date_ast as d, district, covered_hours as cov, customer_hours as ch, max_out as mx,
               hours_per_customer as hpc, day_over_25pct as d25, day_over_80pct as d80
        from marts.mart_outage_daily order by date_ast, district""")
    monthly = rows(con, "select * from marts.mart_outage_monthly order by month, district")
    events = rows(con, """
        select district, district_name, class, start_ast, end_ast, wall_span_hours, observed_hours_above,
               peak_out, peak_pct_district, customer_hours_wall_span, starts_by, ends_by, is_ongoing, source
        from marts.mart_outage_events order by start_ast desc""")
    totals = rows(con, """
        select d.district, r.district_name, r.reference_customers,
               round(sum(d.customer_hours)) as customer_hours,
               round(sum(d.hours_per_customer), 1) as hours_per_customer,
               round(sum(d.covered_hours), 1) as covered_hours,
               count(*) filter (where d.day_over_80pct) as days_over_80pct,
               count(*) filter (where d.day_over_25pct) as days_over_25pct,
               (select count(*) from marts.mart_outage_events e where e.district = d.district and e.class = 'districtwide_80pct') as districtwide_events,
               (select count(*) from marts.mart_outage_events e where e.district = d.district and e.class = 'major_25pct') as major_events,
               (select max(wall_span_hours) from marts.mart_outage_events e where e.district = d.district and e.class = 'major_25pct') as longest_major_hours
        from marts.mart_outage_daily d join reference.district_reference r using (district)
        group by all order by d.district desc""")
    areas = rows(con, """
        select island, subdivision, district, round(sum(customer_hours)) as customer_hours, sum(records) as records
        from marts.mart_area_customer_hours group by all order by customer_hours desc""")
    causes = rows(con, """
        select cause_code, coalesce(any_value(cause), 'No cause given') as cause, count(*) as records,
               sum(max_customers_out) as customers
        from marts.mart_records group by cause_code order by records desc""")
    gaps = rows(con, "select * from marts.mart_gaps where hours >= 0.5 order by start_ast desc")
    alerts = rows(con, "select alert_key, category, severity, title, message, observed_at from marts.mart_alerts")
    health = rows(con, "select * from staging.stg_source_health")
    checks = one(con, """
        select
          (select count(*) from staging.stg_ref_daily) as ref_days,
          (select count(*) from staging.stg_ref_daily r join marts.mart_outage_daily o using (date_ast, district)
            where abs(o.customer_hours - r.customer_hours) <= greatest(1, 0.005 * r.customer_hours)
              and abs(o.covered_hours - r.covered_hours) <= 0.01 and o.max_out = r.max_out) as days_matching,
          (select count(*) from staging.stg_ref_events) as ref_events,
          (select count(*) from staging.stg_ref_records) as ref_records,
          (select count(*) from staging.stg_ref_records r join intermediate.int_record_district o using (record_id)
            where o.district = r.district) as records_matching
    """)
    # ---------------------------------------------------------------- feeders
    feeder_share = one(con, """
        select count(*) filter (where feeder is not null) as feeder_records, count(*) as records,
               round(100.0 * sum(max_customers_out) filter (where feeder is not null) / sum(max_customers_out), 1)
                   as feeder_pct_of_customers
        from marts.mart_records""")
    scorecard = rows(con, """
        select district, feeder, island, in_listing, places, shared_places, outages, hours_out,
               median_hours, longest_hours, peak_customers, power_supply_outages, power_supply_hours,
               no_cause_outages, last_outage_ast, out_now, outages_last_30d, power_supply_vs_median
        from marts.mart_feeder_scorecard order by district desc, hours_out desc""")
    # compact rows for the calendar: [district, feeder, date, hours out, power-supply hours, outages begun]
    fdaily = [[r["district"], r["feeder"], r["date_ast"], r["hours_out"], r["power_supply_hours"] or 0, r["outages_started"]]
              for r in rows(con, "select * from marts.mart_feeder_daily order by date_ast")]
    places = [[r["district"], r["feeder"], r["place"], r["split"]]
              for r in rows(con, "select * from reference.feeder_places order by district, feeder, place")]
    schedule = rows(con, """
        select kind, district, schedule_date, window_label, window_start_ast, window_end_ast, feeder, partial, area,
               versions_of_day, start_ast, end_ast, hours, cause, start_offset_min, end_offset_min, still_on_map, outcome
        from marts.mart_schedule_check
        where coalesce(schedule_date, cast(start_ast as date)) >=
              (select max(schedule_date) from marts.mart_schedule_check) - interval 13 day
        order by coalesce(window_start_ast, start_ast), feeder""")
    schedule_meta = one(con, """
        select count(*) as versions, min(first_seen_utc) as first_saved_utc, max(last_seen_utc) as last_checked_utc,
               (select count(distinct schedule_date) from intermediate.int_schedule_final) as days,
               (select max(schedule_date) from intermediate.int_schedule_final) as latest_date
        from staging.stg_schedule_versions""")
    feeders = dict(share=feeder_share, scorecard=scorecard, daily=fdaily, places=places,
                   schedule=schedule, schedule_meta=schedule_meta)
    data = dict(meta=meta, current=current, on_map=on_map, recent=recent, hourly=hourly, daily=daily,
                monthly=monthly, events=events, totals=totals, areas=areas, causes=causes, gaps=gaps,
                alerts=alerts, health=health, checks=checks, feeders=feeders)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":"), default=str))
    print(f"  wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)")


def stamp_assets():
    """Add ?v=<content hash> to the page's CSS and JS links.

    The web host tells browsers to keep .js and .css files for 7 days. Without a version
    tag, a visitor can get the new index.html with last week's app.js, and new sections
    stay blank. The tag changes only when the file changes, so caching still works.
    """
    import hashlib, re
    dash = ROOT / "dashboard"
    page = dash / "index.html"
    html = page.read_text(encoding="utf-8")
    for name in ("styles.css", "power.css", "app.js"):
        f = dash / name
        if not f.exists():
            continue
        v = hashlib.sha256(f.read_bytes()).hexdigest()[:10]
        html = re.sub(rf'((?:href|src)="){re.escape(name)}(?:\?v=[0-9a-f]+)?"', rf'\g<1>{name}?v={v}"', html)
    if html != page.read_text(encoding="utf-8"):
        page.write_text(html, encoding="utf-8")
        print("  stamped asset versions in dashboard/index.html")


if __name__ == "__main__":
    main()
    stamp_assets()
