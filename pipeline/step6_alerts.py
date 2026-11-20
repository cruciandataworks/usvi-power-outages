"""Step 6 - Alerts: keep one GitHub issue open for every active alert.

marts.mart_alerts lists the conditions that need attention right now. Each has a stable
key (for example "outage:STX" or "collector:wapa_map"). This step compares that
list with the open GitHub issues labelled "outage-alert":

  new alert, no issue        -> open an issue (GitHub emails the assignee)
  alert still active         -> leave it, or comment if its title changed (major -> district-wide)
  issue open, alert gone     -> comment "cleared" and close it

Because each key maps to exactly one issue, an alert that lasts for weeks produces one
email, not one every 15 minutes. Without GH_TOKEN (on your own computer) it only prints
what it would do - a "dry run".
"""
import os
import re
from pathlib import Path

import duckdb
import requests

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "warehouse" / "outages.duckdb"
API = "https://api.github.com"
LABEL = "outage-alert"
TOKEN = os.environ.get("GH_TOKEN")
REPO = os.environ.get("GITHUB_REPOSITORY", "cruciandataworks/usvi-power-outages")
ASSIGNEE = os.environ.get("ALERT_ASSIGNEE") or "OrlandoSpears"
DASHBOARD = "https://cruciandataworks.com/projects/power-outages/"
KEY = re.compile(r"^\[([^\]]+)\]")


def gh(method, path, **kw):
    r = requests.request(method, f"{API}{path}", timeout=30, headers={
        "Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json"}, **kw)
    r.raise_for_status()
    return r.json() if r.content else None


def body(a):
    return (f"{a['message']}\n\n"
            f"- Category: {a['category']}\n- Severity: {a['severity']}\n"
            f"- Observed: {a['observed_at']}\n\n"
            f"Dashboard: {DASHBOARD}\n\n"
            "This issue was opened by the power-outages pipeline and will close itself "
            "when the condition clears.")


def main():
    con = duckdb.connect(str(DB), read_only=True)
    rel = con.sql("select alert_key, category, severity, title, message, "
                  "strftime(observed_at, '%Y-%m-%d %H:%M UTC') as observed_at from marts.mart_alerts")
    alerts = {r[0]: dict(zip(rel.columns, r)) for r in rel.fetchall()}
    print(f"  {len(alerts)} active alert(s): {', '.join(alerts) or 'none'}")

    if not TOKEN:
        print("  GH_TOKEN not set - dry run, no issues changed")
        return
    try:
        gh("POST", f"/repos/{REPO}/labels", json={"name": LABEL, "color": "C8553D",
                                                   "description": "Opened by the power-outages pipeline"})
    except requests.HTTPError:
        pass  # label already exists
    open_issues = {}
    for i in gh("GET", f"/repos/{REPO}/issues", params={"labels": LABEL, "state": "open", "per_page": 100}):
        m = KEY.match(i["title"])
        if m:
            open_issues[m.group(1)] = i

    for key, a in alerts.items():
        title = f"[{key}] {a['title']}"
        issue = open_issues.get(key)
        if issue is None:
            new = gh("POST", f"/repos/{REPO}/issues", json={
                "title": title, "body": body(a), "labels": [LABEL, a["category"]], "assignees": [ASSIGNEE]})
            print(f"  opened #{new['number']} {title}")
        elif issue["title"] != title:
            gh("PATCH", f"/repos/{REPO}/issues/{issue['number']}", json={"title": title})
            gh("POST", f"/repos/{REPO}/issues/{issue['number']}/comments", json={"body": f"Update: {a['message']}"})
            print(f"  updated #{issue['number']} {title}")
    for key, issue in open_issues.items():
        if key not in alerts:
            gh("POST", f"/repos/{REPO}/issues/{issue['number']}/comments",
               json={"body": "Cleared: the latest poll is back below the threshold. Closing."})
            gh("PATCH", f"/repos/{REPO}/issues/{issue['number']}", json={"state": "closed", "state_reason": "completed"})
            print(f"  closed #{issue['number']} {key}")


if __name__ == "__main__":
    main()
