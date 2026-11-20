"""Step 2 - Poll: read WAPA's public outage map, the same way VI Update did.

WAPA's map (outageviewer.viwapa.vi) is fed by a small public service with two endpoints
we use:

    outageSummary   one object: customers served, customers out now, WAPA's update time,
                    and WAPA's own territory-wide count for each of the last 48 hours
    outages         a list: one entry per outage record on the map right now

Each poll saves both, stamped with the time we asked (poll_utc). The schedule runs this
every 15 minutes and each run polls POLLS times, POLL_INTERVAL seconds apart (default 3
polls, 5 minutes apart), so the record keeps five-minute detail even when GitHub starts a
run late. Every attempt is logged, including failures, so a gap in the record always has
a recorded reason.

Privacy: record names are kept only when they are equipment codes, street lists are
reduced to a count, and map points are rounded to 4 decimal places (about 11 m).
"""
import os
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from common import LIVE, feeder_from_name, get, name_district, now_utc, record_health, safe_name, upsert  # noqa: E402

BASE = os.environ.get("WAPA_BASE", "http://outageviewer.viwapa.vi:7575/data")
POLLS = int(os.environ.get("POLLS", "1"))
INTERVAL = int(os.environ.get("POLL_INTERVAL", "300"))


def fetch(endpoint, log, poll_utc):
    started = time.monotonic()
    try:
        data = get(f"{BASE}/{endpoint}").json()
        log.append(dict(poll_utc=poll_utc, endpoint=endpoint, ok=True,
                        ms=int((time.monotonic() - started) * 1000), error=None))
        return data
    except Exception as e:  # noqa: BLE001 - any failure is logged, never fatal on its own
        log.append(dict(poll_utc=poll_utc, endpoint=endpoint, ok=False,
                        ms=int((time.monotonic() - started) * 1000), error=str(e)[:300]))
        print(f"  {endpoint}: FAILED - {e}")
        return None


def poll_once():
    t = now_utc()
    poll_utc = t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"
    month = t.strftime("%Y-%m")
    log = []
    summary = fetch("outageSummary", log, poll_utc)
    outages = fetch("outages", log, poll_utc)

    if summary is not None:
        polls = pd.DataFrame([dict(
            poll_utc=poll_utc,
            wapa_update_time=summary.get("updateTime"),
            customers_served=summary.get("customersServed"),
            out_territory=summary.get("customersOutNow"),
            customers_affected=summary.get("customersAffected"),
            customers_restored=summary.get("customersRestored"),
            outages_captured=outages is not None,
            active_outage_records=len(outages) if outages is not None else None,
            streets_affected=len(summary.get("streetsAffected") or []),
            source="live")])
        upsert(LIVE / "polls" / f"month={month}" / "data.parquet", polls, ["poll_utc"])
        hours = pd.DataFrame([dict(event_hour_ast=h["eventTime"], final_value=h["customers"],
                                   last_seen_poll=poll_utc) for h in summary.get("hourlyCustomersOut") or []])
        upsert(LIVE / "hourly_history" / "data.parquet", hours, ["event_hour_ast"])

    if outages is not None:
        rows = []
        for o in outages:
            name = o.get("outageName")
            pt = o.get("outagePoint") or {}
            rows.append(dict(
                poll_utc=poll_utc, record_id=o.get("outageRecID"), wapa_name=safe_name(name),
                name_district=name_district(name), feeder=feeder_from_name(name),
                lat=round(pt["lat"], 4) if pt.get("lat") is not None else None,
                lng=round(pt["lng"], 4) if pt.get("lng") is not None else None,
                customers_out_now=o.get("customersOutNow"), customers_restored=o.get("customersRestored"),
                customers_out_initially=o.get("customersOutInitially"), verified=bool(o.get("verified")),
                cause=o.get("cause"), wapa_modified_time=o.get("outageModifiedTime"),
                wapa_start_time=o.get("outageStartTime"), wapa_end_time=o.get("outageEndTime"),
                n_streets=len(o.get("streetsAffected") or []), source="live"))
        if rows:
            df = pd.DataFrame(rows)
            for c in ["customers_out_now", "customers_restored", "customers_out_initially", "n_streets"]:
                df[c] = df[c].astype("Int64")
            upsert(LIVE / "sightings" / f"month={month}" / "data.parquet", df, ["poll_utc", "record_id"])

    upsert(LIVE / "poll_log" / f"month={month}" / "data.parquet", pd.DataFrame(log), ["poll_utc", "endpoint"])
    out = summary.get("customersOutNow") if summary else "?"
    print(f"  poll {poll_utc}: summary {'ok' if summary is not None else 'FAILED'}, "
          f"{len(outages) if outages is not None else 'no'} records, {out} customers out")
    return summary is not None, outages is not None


def main():
    ok_any = False
    for i in range(POLLS):
        if i:
            time.sleep(INTERVAL)
        s_ok, o_ok = poll_once()
        ok_any = ok_any or (s_ok and o_ok)
    record_health("wapa_map", ok_any, error="" if ok_any else "no complete poll this run")
    if not ok_any:
        sys.exit(1)


if __name__ == "__main__":
    main()
