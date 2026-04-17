#!/usr/bin/env python3
"""
Download the Olist dataset and seed a demo run.
Run: python scripts/seed.py
Requires: kaggle CLI configured with API token.
"""
import os
import subprocess
import sys
import uuid

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
OLIST_DIR = os.path.join(UPLOAD_DIR, "olist-demo")


def download_olist():
    os.makedirs(OLIST_DIR, exist_ok=True)
    print("Downloading Olist dataset from Kaggle...")
    try:
        subprocess.run(
            ["kaggle", "datasets", "download", "-d", "olistbr/brazilian-ecommerce",
             "--unzip", "-p", OLIST_DIR],
            check=True,
        )
        print(f"✓ Dataset downloaded to {OLIST_DIR}")
    except FileNotFoundError:
        print("kaggle CLI not found. Downloading sample data instead...")
        _create_sample_data()
    except subprocess.CalledProcessError:
        print("Kaggle download failed (no token?). Creating sample data...")
        _create_sample_data()


def _create_sample_data():
    """Create minimal sample CSVs for demo purposes."""
    import csv
    import random
    from datetime import datetime, timedelta

    os.makedirs(OLIST_DIR, exist_ok=True)

    customers = [(str(uuid.uuid4()), str(uuid.uuid4()), s)
                 for s in ["SP", "RJ", "MG", "RS", "PR", "BA", "SC"] * 200]

    products = [(str(uuid.uuid4()), cat) for cat in
                ["Bed Bath Table", "Beauty Health", "Electronics", "Fashion",
                 "Sports Leisure", "Furniture", "Toys", "Books"] * 50]

    orders = []
    items = []
    payments = []

    start = datetime(2017, 1, 1)
    for i in range(5000):
        oid = str(uuid.uuid4())
        cust = random.choice(customers)
        d = start + timedelta(days=random.randint(0, 730))
        orders.append([oid, cust[0], "delivered", d.isoformat()])

        product = random.choice(products)
        price = round(random.lognormal(4, 1), 2)
        items.append([oid, str(uuid.uuid4()), product[0], 1, price, 12.5])
        payments.append([oid, 1, "credit_card", 1, round(price + 12.5, 2)])

    def write_csv(name, header, rows):
        path = os.path.join(OLIST_DIR, name)
        with open(path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(header)
            w.writerows(rows)
        print(f"  ✓ {name} ({len(rows)} rows)")

    write_csv("olist_customers_dataset.csv",
              ["customer_id", "customer_unique_id", "customer_state"], customers)
    write_csv("olist_products_dataset.csv",
              ["product_id", "product_category_name"], products)
    write_csv("olist_orders_dataset.csv",
              ["order_id", "customer_id", "order_status", "order_purchase_timestamp"], orders)
    write_csv("olist_order_items_dataset.csv",
              ["order_id", "order_item_id", "product_id", "seller_id", "price", "freight_value"], items)
    write_csv("olist_order_payments_dataset.csv",
              ["order_id", "payment_sequential", "payment_type", "payment_installments", "payment_value"],
              payments)
    write_csv("olist_order_reviews_dataset.csv",
              ["review_id", "order_id", "review_score"],
              [(str(uuid.uuid4()), o[0], random.randint(1, 5)) for o in orders])

    print(f"✓ Sample dataset created at {OLIST_DIR}")


def trigger_demo_run():
    import urllib.request
    import json

    run_id = f"demo-{uuid.uuid4().hex[:8]}"
    print(f"\nTriggering demo run: {run_id}")

    try:
        data = json.dumps({
            "run_id": run_id,
            "dataset_path": OLIST_DIR,
        }).encode()
        req = urllib.request.Request(
            "http://localhost:8000/run/start",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            resp = json.loads(r.read())
            print(f"✓ Run started: {resp}")
            print(f"\n→ Dashboard: http://localhost:3000/run/{run_id}")
    except Exception as e:
        print(f"Could not reach API: {e}")
        print(f"Start the stack first: docker compose up -d")


if __name__ == "__main__":
    download_olist()
    if "--no-run" not in sys.argv:
        trigger_demo_run()
