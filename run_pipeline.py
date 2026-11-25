"""Run every step in order. This is what the 15-minute schedule calls.

    python run_pipeline.py            # full run: poll WAPA, rebuild, export, alerts
    python run_pipeline.py --from 3   # skip polling, rebuild from the lake

Steps 2 and 2b (polling WAPA's map, saving its rotation schedule) may fail - WAPA's map is sometimes down. That is recorded (the
dashboard shows it, and four failed runs in a row raise an alert) and the rest still
runs, so the page keeps showing the history. Any failure from step 3 on stops the run,
so bad data never reaches the dashboard.
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PY = sys.executable
STEPS = [
    (1, "Archive (VI Update's record, from Zenodo)", [PY, "pipeline/step1_archive.py"], False),
    (2, "Poll WAPA's outage map", [PY, "pipeline/step2_poll.py"], True),
    ("2b", "Save WAPA's rotation schedule", [PY, "pipeline/step2b_schedule.py"], True),
    (3, "Load DuckDB", [PY, "pipeline/step3_load.py"], False),
    (4, "dbt build (models + tests)", ["dbt", "build", "--profiles-dir", "."], False),
    (5, "Export dashboard data", [PY, "pipeline/step5_export.py"], False),
    (6, "Sync alert issues", [PY, "pipeline/step6_alerts.py"], False),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", type=int, default=1)
    args = ap.parse_args()
    if os.environ.get("TEST_FAILURE") == "true":
        print("TEST_FAILURE is set - failing on purpose to test the failure alert.")
        sys.exit(1)
    for n, label, cmd, tolerant in STEPS:
        if int(str(n).rstrip("b")) < args.start:
            continue
        print(f"\n=== Step {n}: {label} ===", flush=True)
        cwd = ROOT / "dbt" if cmd[0] == "dbt" else ROOT  # dbt finds DuckDB relative to dbt/
        result = subprocess.run(cmd, cwd=cwd, env=os.environ.copy())
        if result.returncode != 0:
            if tolerant:
                print(f"Step {n} failed - carrying on; the failure is recorded in source health.")
            else:
                print(f"Step {n} failed - stopping so bad data never reaches the dashboard.")
                sys.exit(result.returncode)
    print("\nAll steps finished.")


if __name__ == "__main__":
    main()
