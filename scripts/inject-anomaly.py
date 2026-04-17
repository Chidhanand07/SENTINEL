#!/usr/bin/env python3
"""
Demo: inject a live anomaly alert to trigger the full n8n→Slack chain.
Usage: python scripts/inject-anomaly.py <run_id>
"""
import json
import sys
import urllib.request

run_id = sys.argv[1] if len(sys.argv) > 1 else "demo"

payload = {
    "run_id": run_id,
    "metric": "daily_revenue",
    "direction": "down",
    "ks_stat": 0.42,
    "p_value": 0.018,
    "diagnosis": "Revenue distribution shifted significantly downward. "
                 "Possible cause: payment gateway outage or seasonal drop. "
                 "KS-statistic 0.42 exceeds alert threshold (0.30).",
}

req = urllib.request.Request(
    "http://localhost:8000/n8n/alert",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)

try:
    with urllib.request.urlopen(req, timeout=5) as r:
        resp = json.loads(r.read())
        print(f"✓ Anomaly injected: {resp}")
        print("Watch the UI alert feed + Slack channel for the notification chain.")
except Exception as e:
    print(f"Error: {e}")
