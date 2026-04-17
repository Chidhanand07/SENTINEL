import pandas as pd
from app.agents.schema_detector import SchemaDetector

def test_ecommerce():
    df = pd.DataFrame({
        "order_id": ["A", "B"],
        "customer_id": ["C1", "C2"],
        "order_purchase_timestamp": pd.to_datetime(["2020-01-01", "2020-01-02"]),
        "payment_value": [100.0, 200.0],
        "product_category_name": ["Toys", "Books"],
        "customer_state": ["SP", "RJ"]
    })
    
    detector = SchemaDetector()
    schema = detector.detect(df)
    assert schema.date_col == "order_purchase_timestamp"
    assert schema.revenue_col == "payment_value"
    assert schema.customer_col == "customer_id"
    assert schema.product_col == "product_category_name"
    assert schema.geo_col == "customer_state"
    
    analysis = detector.detect_available_analyses(schema, df)
    assert analysis.can_forecast is True
    assert analysis.can_segment is True
    assert analysis.can_rfm is True

def test_saas():
    df = pd.DataFrame({
        "user_uuid": ["U1", "U2"],
        "subscription_created": pd.to_datetime(["2021-01-01", "2021-02-01"]),
        "mrr_amount": [50.0, 10.0],
        "plan_type": ["Pro", "Basic"],
        "country": ["US", "CA"]
    })
    
    detector = SchemaDetector()
    schema = detector.detect(df)
    assert schema.date_col == "subscription_created"
    assert schema.revenue_col == "mrr_amount"
    assert schema.customer_col == "user_uuid"
    
def test_iot():
    df = pd.DataFrame({
        "sensor_id": [1, 2],
        "reading_time": pd.to_datetime(["2022-01-01", "2022-01-02"]),
        "temperature_celsius": [22.5, 23.1],
        "humidity_pct": [40, 45],
        "location_zone": ["A1", "A2"]
    })
    
    detector = SchemaDetector()
    schema = detector.detect(df)
    assert schema.date_col == "reading_time"
    assert schema.revenue_col is None # no revenue
    assert schema.customer_col is None # no customer
    
    analysis = detector.detect_available_analyses(schema, df)
    assert analysis.can_forecast is False
    assert analysis.can_rfm is False
    assert analysis.can_segment is False

def test_hr():
    df = pd.DataFrame({
        "employee_id": [100, 101],
        "hired_date": pd.to_datetime(["2019-01-01", "2020-01-01"]),
        "salary": [80000, 90000],
        "department": ["IT", "HR"],
        "office_city": ["NY", "SF"]
    })
    
    detector = SchemaDetector()
    schema = detector.detect(df)
    assert schema.date_col == "hired_date"
    # Salary isn't typically revenue patterns, but "salary" has no match in REVENUE_PATTERNS.
    # Therefore revenue_col should be None unless we map it.
    
def test_messy_no_headers():
    df = pd.DataFrame([
        [1, "2020-01-01", 10.5, "Foo"],
        [2, "2020-01-02", 20.0, "Bar"]
    ])
    df[1] = pd.to_datetime(df[1])
    
    detector = SchemaDetector()
    schema = detector.detect(df)
    # the columns are ints: 0, 1, 2, 3
    # since no pattern matches, it should just map numeric_cols and categorical_cols
    assert schema.date_col is None
    assert schema.revenue_col is None
    assert len(schema.numeric_cols) == 2
    assert len(schema.categorical_cols) == 2
    
def run_all():
    test_ecommerce()
    test_saas()
    test_iot()
    test_hr()
    test_messy_no_headers()
    print("All detection tests passed!")

if __name__ == "__main__":
    run_all()
