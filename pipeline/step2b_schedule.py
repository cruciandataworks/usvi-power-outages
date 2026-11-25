"""Step 2b - Save WAPA's rotation schedule, so we can compare what was planned with what happened.

When generation runs short, WAPA publishes a rotating-outage schedule: a designed PDF
(made in Canva) with two-hour windows and the feeders that will be switched off in each.
WAPA links the current one from its Alerts page and replaces the file at the same address
each time it changes, so yesterday's schedule is gone once today's is posted. The only
way to keep a history is to save a copy ourselves, which is what this step does on every run.

    1. Read WAPA's Alerts page and find the link(s) to the current schedule PDF.
    2. Download each PDF and fingerprint it (SHA-256). A file we already have is only
       marked as seen again; a new one is read.
    3. Read the PDF by position, not as plain text. Pulling the text out in reading order
       mixes the three columns together, so we take every word with its x/y position,
       find the time headers ("6 AM - 8 AM"), and give each "Feeder 7B" line to the
       column whose header it sits under.
    4. Save one row per (window, feeder) to lake/live/schedules/, plus one row per
       version of the file, with every word and its position so a version can be
       re-read later if the parser improves.
    5. If the run has a GitHub token, upload the PDF itself to a monthly GitHub release
       ("schedules-2026-11") so the original stays available. That upload is optional.

This step may fail (WAPA's site is sometimes slow); like the map poll, that is recorded in
source health and the rest of the pipeline carries on.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import pandas as pd
import pymupdf

sys.path.insert(0, str(Path(__file__).parent))
from common import LIVE, get, now_utc, record_health, upsert  # noqa: E402

SITE = "https://www.viwapa.vi"
ALERTS_PAGE = os.environ.get("WAPA_ALERTS_PAGE", f"{SITE}/news-information/advisory-details")
# used only if the Alerts page cannot be read or no longer links the schedule
FALLBACK = [f"{SITE}/docs/default-source/outage-schedule/sttstj-rotational-outage-schedule-doc.pdf"]
OUT = LIVE / "schedules"

MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST",
          "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]
WINDOW = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?", re.I)
FEEDER = re.compile(r"^Feeders?\s+0*(\d{1,2}[A-Z]?)\b(.*)$", re.I)


# ---------------------------------------------------------------------------- find
def schedule_links():
    """Every outage-schedule PDF linked from WAPA's Alerts page (today: one, for STT/STJ)."""
    html = get(ALERTS_PAGE).text
    links = re.findall(r'href="(/docs/default-source/outage-schedule/[^"]+?\.pdf)(?:\?[^"]*)?"', html, re.I)
    return sorted({SITE + l for l in links}) or FALLBACK


# ---------------------------------------------------------------------------- read
def hour24(h, m, ap):
    h = int(h) % 12 + (12 if ap.upper() == "P" else 0)
    return h * 60 + int(m or 0)


def district_of(text):
    t = re.sub(r"\s+", "", text).upper()
    if "STT/STJ" in t or "ST.THOMAS" in t:
        return "STTJ"
    if "STX" in t or "ST.CROIX" in t:
        return "STX"
    return None


def schedule_date(text):
    """The date is set in spaced capitals ("N O V E M B E R  2 5 , 2 0 2 6"), so remove
    the spaces first."""
    t = re.sub(r"\s+", "", text).upper()
    m = re.search(r"(" + "|".join(MONTHS) + r")(\d{1,2}),?(20\d\d)", t)
    return date(int(m.group(3)), MONTHS.index(m.group(1)) + 1, int(m.group(2))) if m else None


def lines_of(words):
    """Group words into lines: first into bands that share a baseline (within 4 points),
    then split each band wherever there is a wide horizontal gap, because the three
    columns of the schedule share baselines."""
    bands = []
    for w in sorted(words, key=lambda w: w[3]):
        if bands and w[3] - bands[-1][-1][3] <= 4:
            bands[-1].append(w)
        else:
            bands.append([w])
    lines = []
    for band in bands:
        band.sort(key=lambda w: w[0])
        cur = [band[0]]
        for w in band[1:]:
            if w[0] - cur[-1][2] > 20:
                lines.append(cur)
                cur = [w]
            else:
                cur.append(w)
        lines.append(cur)
    out = []
    for ws in lines:
        x0, x1 = min(w[0] for w in ws), max(w[2] for w in ws)
        out.append(dict(y=max(w[3] for w in ws), x0=x0, x1=x1, xc=(x0 + x1) / 2,
                        text=" ".join(w[4] for w in ws)))
    return sorted(out, key=lambda ln: (ln["y"], ln["x0"]))


def visible_words(page):
    """Every word a reader can actually see, with its position.

    WAPA's PDF is made from a template, and old text is sometimes left in the file
    underneath a white card that was drawn on top of it (on 25 November a stale
    "Feeder 7B" sat hidden under the 4-6 PM card). A plain text extract would read it.
    So we read the text in drawing order (seqno) and drop any span that a later, opaque
    filled shape completely covers."""
    covers = [(d["seqno"], d["rect"]) for d in page.get_drawings()
              if d.get("fill") is not None and (d.get("fill_opacity") or 0) >= 0.99]
    words = []
    for span in page.get_texttrace():
        if span.get("opacity", 1) < 0.5:
            continue
        box = pymupdf.Rect(span["bbox"])
        if any(seq > span["seqno"] and r.contains(box) for seq, r in covers):
            continue
        cur = []
        for ch in list(span["chars"]) + [(32, 0, (0, 0), (0, 0, 0, 0))]:
            if chr(ch[0]).isspace():
                if cur:
                    words.append((min(c[3][0] for c in cur), min(c[3][1] for c in cur),
                                  max(c[3][2] for c in cur), max(c[3][3] for c in cur),
                                  "".join(chr(c[0]) for c in cur)))
                cur = []
            else:
                cur.append(ch)
    return words


def parse_page(page):
    """One page = one district, one date, a row of time windows. Returns
    (district, date, [(start_min, end_min, label, feeder, partial, area)])."""
    words = visible_words(page)  # (x0, y0, x1, y1, word)
    text = " ".join(w[4] for w in words)
    lines = lines_of(words)
    headers = [ln for ln in lines if WINDOW.search(ln["text"])]
    if not headers:
        return district_of(text), schedule_date(text), []
    rows = []
    feeders = [ln for ln in lines if FEEDER.match(ln["text"])]
    for ln in feeders:
        above = [h for h in headers if h["y"] < ln["y"]]
        if not above:
            continue
        col = min(above, key=lambda h: abs(h["xc"] - ln["xc"]))  # the header it sits under
        m = WINDOW.search(col["text"])
        start = hour24(m.group(1), m.group(2), m.group(3))
        end = hour24(m.group(4), m.group(5), m.group(6))
        if end <= start:  # "10 PM - 12 AM" ends at midnight, the next day
            end += 24 * 60
        f = FEEDER.match(ln["text"])
        rest = f.group(2).strip()
        partial = bool(re.search(r"\bpartial\b", rest, re.I))
        # the area ("(Estate Thomas to Tabor & Harmony)") is on the next line(s) of the
        # same column, until the next feeder or the small print at the bottom
        nxt = [o for o in feeders if o is not ln and o["y"] > ln["y"]
               and min(headers, key=lambda h: abs(h["xc"] - o["xc"])) is col]
        stop = min([o["y"] for o in nxt] + [ln["y"] + 60])
        area = [o["text"] for o in lines if ln["y"] < o["y"] < stop and abs(o["xc"] - col["xc"]) < 110
                and not WINDOW.search(o["text"]) and not o["text"].lower().startswith(("outage", "this schedule"))]
        area_text = re.sub(r"^\(|\)$", "", " ".join(area).strip()) or None
        label = f"{m.group(1)}{':' + m.group(2) if m.group(2) else ''} {m.group(3).upper()}M - " \
                f"{m.group(4)}{':' + m.group(5) if m.group(5) else ''} {m.group(6).upper()}M"
        rows.append((start, end, label, f.group(1).upper(), partial, area_text))
    return district_of(text), schedule_date(text), rows


def read_pdf(blob):
    doc = pymupdf.open(stream=blob, filetype="pdf")
    pages, windows = [], []
    for i, page in enumerate(doc):
        district, day, rows = parse_page(page)
        pages.append(dict(page=i, district=district, date=day.isoformat() if day else None,
                          words=[[round(w[0], 1), round(w[1], 1), round(w[2], 1), round(w[3], 1), w[4]]
                                 for w in visible_words(page)]))
        for start, end, label, feeder, partial, area in rows:
            if not (district and day):
                continue
            midnight = datetime(day.year, day.month, day.day)
            windows.append(dict(page=i, district=district, schedule_date=day.isoformat(), window_label=label,
                                window_start_ast=(midnight + timedelta(minutes=start)).isoformat(),
                                window_end_ast=(midnight + timedelta(minutes=end)).isoformat(),
                                feeder=feeder, partial=partial, area=area))
    meta = doc.metadata or {}
    return pages, windows, meta


# ---------------------------------------------------------------------------- keep the PDF
def upload_original(blob, name, month):
    """Optional: keep the original PDF as an asset on a monthly GitHub release."""
    if not (os.environ.get("GH_TOKEN") and os.environ.get("GITHUB_REPOSITORY")):
        return False
    tag = f"schedules-{month}"
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / name
        p.write_bytes(blob)
        subprocess.run(["gh", "release", "view", tag], capture_output=True).returncode == 0 or subprocess.run(
            ["gh", "release", "create", tag, "--title", f"WAPA rotation schedules, {month}",
             "--notes", "Copies of WAPA's rotating-outage schedule PDFs, saved by step 2b as they were published."],
            capture_output=True)
        r = subprocess.run(["gh", "release", "upload", tag, str(p), "--clobber"], capture_output=True, text=True)
        if r.returncode:
            print(f"  could not upload the original PDF: {r.stderr.strip()[:200]}")
        return r.returncode == 0


# ---------------------------------------------------------------------------- main
def main():
    t = now_utc()
    fetched = t.strftime("%Y-%m-%dT%H:%M:%SZ")
    month = t.strftime("%Y-%m")
    versions_file = OUT / "versions" / "data.parquet"
    known = set()
    if versions_file.exists():
        known = {r[0] for r in duckdb.sql(f"select sha256 from read_parquet('{versions_file}')").fetchall()}
    try:
        urls = schedule_links()
    except Exception as e:  # noqa: BLE001
        print(f"  Alerts page: FAILED - {e}; trying the usual address")
        urls = FALLBACK
    new_windows, errors = 0, []
    for url in urls:
        try:
            blob = get(url).content
        except Exception as e:  # noqa: BLE001
            errors.append(f"{url}: {e}")
            continue
        sha = hashlib.sha256(blob).hexdigest()
        if sha in known:  # same file as before: just note that it is still up
            seen = duckdb.sql(f"select * replace ('{fetched}' as last_seen_utc) "
                              f"from read_parquet('{versions_file}') where sha256 = '{sha}'").df()
            upsert(versions_file, seen, ["sha256"])
            print(f"  {url.rsplit('/', 1)[-1]}: unchanged ({sha[:10]})")
            continue
        try:
            pages, windows, meta = read_pdf(blob)
            parse_error = None
        except Exception as e:  # noqa: BLE001 - keep the version even if it cannot be read
            pages, windows, meta, parse_error = [], [], {}, str(e)[:300]
        districts = sorted({p["district"] for p in pages if p["district"]})
        dates = sorted({p["date"] for p in pages if p["date"]})
        name = f"{'-'.join(districts) or 'unknown'}-{dates[0] if dates else 'nodate'}-{sha[:10]}.pdf"
        saved = upload_original(blob, name, month)
        upsert(versions_file, pd.DataFrame([dict(
            sha256=sha, url=url, first_seen_utc=fetched, last_seen_utc=fetched, bytes=len(blob),
            pdf_created=meta.get("creationDate"), districts=",".join(districts), schedule_dates=",".join(dates),
            windows=len(windows), parse_error=parse_error, original_saved_as=name if saved else None,
            words_json=json.dumps(pages, separators=(",", ":")))]), ["sha256"])
        if windows:
            df = pd.DataFrame(windows)
            df.insert(0, "sha256", sha)
            df.insert(1, "first_seen_utc", fetched)
            new_windows += upsert(OUT / "windows" / f"month={month}" / "data.parquet", df,
                                  ["sha256", "page", "window_start_ast", "feeder"])
        print(f"  {url.rsplit('/', 1)[-1]}: NEW version {sha[:10]} - {', '.join(dates) or 'no date'}, "
              f"{len(windows)} feeder windows{', original saved' if saved else ''}"
              f"{', PARSE ERROR ' + parse_error if parse_error else ''}")
        if parse_error:
            errors.append(f"{url}: could not read the PDF - {parse_error}")
    ok = len(errors) < len(urls)
    record_health("wapa_schedule", ok, rows=new_windows, error="; ".join(errors))
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
