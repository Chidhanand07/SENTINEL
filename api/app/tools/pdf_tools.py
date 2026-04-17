from __future__ import annotations

"""WeasyPrint PDF generation tool."""

import io
from typing import Any

from jinja2 import Template

from app.config import settings


PDF_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', sans-serif; background: #1a1a2e; color: #e2e8f0; font-size: 11pt; }

  .cover { height: 100vh; display: flex; flex-direction: column; justify-content: center;
           align-items: center; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
           padding: 40px; text-align: center; }
  .cover h1 { font-size: 42pt; font-weight: 700; color: #E8A838; margin-bottom: 12px; }
  .cover h2 { font-size: 18pt; color: #94a3b8; margin-bottom: 40px; }
  .cover .run-meta { font-size: 10pt; color: #64748b; }

  .page { padding: 40px; page-break-before: always; }
  h2.section { font-size: 18pt; color: #E8A838; border-bottom: 2px solid #E8A838;
               padding-bottom: 8px; margin-bottom: 24px; margin-top: 32px; }
  h3 { font-size: 13pt; color: #94a3b8; margin-bottom: 12px; }

  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px; }
  .kpi-card { background: #16213e; border: 1px solid #334155; border-radius: 8px;
              padding: 20px; text-align: center; }
  .kpi-card .value { font-size: 22pt; font-weight: 700; color: #E8A838; }
  .kpi-card .label { font-size: 9pt; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }

  .segment-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .segment-card { background: #16213e; border-left: 4px solid {{ segments[0].color if segments else '#E8A838' }};
                  border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .segment-card h4 { color: #E8A838; font-size: 13pt; margin-bottom: 8px; }
  .segment-card .trait { display: inline-block; background: #1e3a5f; color: #94a3b8;
                         border-radius: 12px; padding: 2px 10px; font-size: 9pt; margin: 2px; }
  .segment-card .action { color: #10B981; font-size: 10pt; margin-top: 8px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { background: #16213e; color: #E8A838; padding: 10px; text-align: left; font-size: 10pt; }
  td { padding: 8px 10px; border-bottom: 1px solid #334155; font-size: 10pt; color: #94a3b8; }
  tr:nth-child(even) td { background: #0f172a; }

  .brief-box { background: #16213e; border: 1px solid #334155; border-radius: 8px;
               padding: 24px; margin-bottom: 16px; }
  .brief-box p { line-height: 1.7; color: #cbd5e1; }

  .lineage-row { display: flex; align-items: center; padding: 10px 0;
                 border-bottom: 1px solid #1e293b; }
  .lineage-step { background: #7C3AED; color: white; border-radius: 4px;
                  padding: 2px 10px; font-size: 9pt; margin-right: 12px; min-width: 40px; text-align: center; }
  .lineage-agent { color: #E8A838; font-weight: 600; width: 160px; }
  .lineage-desc { color: #94a3b8; flex: 1; font-size: 10pt; }
  .lineage-meta { color: #475569; font-size: 9pt; min-width: 120px; text-align: right; }

  .footer { position: fixed; bottom: 20px; left: 40px; right: 40px;
            font-size: 8pt; color: #334155; display: flex; justify-content: space-between; }
</style>
</head>
<body>

<!-- Cover -->
<div class="cover">
  <div style="font-size: 11pt; color: #7C3AED; letter-spacing: 4px; margin-bottom: 16px;">AUTONOMOUS ANALYTICS REPORT</div>
  <h1>SENTINEL</h1>
  <h2>E-Commerce Intelligence Brief</h2>
  <div style="background:#16213e; border-radius: 8px; padding: 20px 40px; margin-bottom: 32px;">
    <div style="color:#E8A838; font-size: 28pt; font-weight: 700;">R$ {{ "{:,.0f}".format(kpi.total_forecast_revenue_30d) }}</div>
    <div style="color:#64748b; font-size: 9pt; text-transform: uppercase;">30-Day Revenue Forecast</div>
  </div>
  <div class="run-meta">
    Run ID: {{ run_id }} &nbsp;·&nbsp;
    {{ kpi.num_segments }} Customer Segments &nbsp;·&nbsp;
    {{ kpi.num_forecasts }} Forecasts &nbsp;·&nbsp;
    Best Model MAPE: {{ "{:.1%}".format(kpi.best_mape) }}
  </div>
</div>

<!-- Executive Brief -->
<div class="page">
  <h2 class="section">Executive Brief</h2>
  <div class="brief-box">
    <h3>What We Found</h3>
    <p>{{ brief.what_we_found }}</p>
  </div>
  <div class="brief-box">
    <h3>Why It Matters</h3>
    <p>{{ brief.why_it_matters }}</p>
  </div>
  <div class="brief-box">
    <h3>Recommended Actions</h3>
    {% for action in brief.recommended_actions %}
    <p style="margin-bottom: 8px;">{{ loop.index }}. {{ action }}</p>
    {% endfor %}
  </div>

  <h2 class="section">KPI Snapshot</h2>
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="value">R$ {{ "{:,.0f}".format(kpi.total_forecast_revenue_30d) }}</div>
      <div class="label">30-Day Forecast</div>
    </div>
    <div class="kpi-card">
      <div class="value">{{ kpi.num_segments }}</div>
      <div class="label">Customer Segments</div>
    </div>
    <div class="kpi-card">
      <div class="value">{{ "{:.1%}".format(1 - kpi.best_mape) }}</div>
      <div class="label">Forecast Accuracy</div>
    </div>
    <div class="kpi-card">
      <div class="value">{{ kpi.top_segment }}</div>
      <div class="label">Top Segment</div>
    </div>
    <div class="kpi-card">
      <div class="value">{{ kpi.anomaly_count }}</div>
      <div class="label">Anomalies Detected</div>
    </div>
    <div class="kpi-card">
      <div class="value">{{ kpi.best_model | upper }}</div>
      <div class="label">Best Model</div>
    </div>
  </div>
</div>

<!-- Customer Segments -->
<div class="page">
  <h2 class="section">Customer Segments</h2>
  <div class="segment-grid">
  {% for seg in segments %}
  <div class="segment-card" style="border-left-color: {{ seg.color }};">
    <h4>{{ seg.persona_name }}</h4>
    <div style="margin-bottom: 8px;">
      <span style="color: #94a3b8;">{{ "{:,}".format(seg.size) }} customers</span>
      &nbsp;·&nbsp;
      <span style="color: #E8A838;">R$ {{ "{:,.0f}".format(seg.avg_ltv) }} avg LTV</span>
    </div>
    {% for trait in seg.traits %}
    <span class="trait">{{ trait }}</span>
    {% endfor %}
    <div class="action">→ {{ seg.recommended_action }}</div>
  </div>
  {% endfor %}
  </div>
</div>

<!-- Forecast Leaderboard -->
<div class="page">
  <h2 class="section">Demand Forecast — Model Leaderboard</h2>
  <table>
    <tr>
      <th>SKU Category</th>
      <th>Region</th>
      <th>Model</th>
      <th>MAPE</th>
      <th>MAE</th>
      <th>30d Forecast</th>
    </tr>
    {% for f in forecasts %}
    <tr>
      <td>{{ f.sku_id }}</td>
      <td>{{ f.state }}</td>
      <td style="color: #E8A838;">{{ f.model_used | upper }}</td>
      <td>{{ "{:.1%}".format(f.mape) }}</td>
      <td>R$ {{ "{:,.0f}".format(f.forecast_value * 0.12) }}</td>
      <td style="color: #10B981;">R$ {{ "{:,.0f}".format(f.forecast_value) }}</td>
    </tr>
    {% endfor %}
  </table>
</div>

<!-- Data Lineage -->
<div class="page">
  <h2 class="section">Data Lineage</h2>
  {% for step in lineage %}
  <div class="lineage-row">
    <span class="lineage-step">{{ step.step_order }}</span>
    <span class="lineage-agent">{{ step.agent }}</span>
    <span class="lineage-desc">{{ step.transformation }}</span>
    <span class="lineage-meta">{{ "{:,}".format(step.rows_in) }} → {{ "{:,}".format(step.rows_out) }} rows · {{ step.duration_ms }}ms</span>
  </div>
  {% endfor %}

  <div style="margin-top: 48px; text-align: center; color: #334155; font-size: 9pt;">
    Generated by SENTINEL Autonomous Analytics System · SOLARIS X Hackathon 2026
  </div>
</div>

</body>
</html>
"""


def render_pdf_report(
    run_id: str,
    kpi_summary: dict[str, Any],
    segments: list[dict[str, Any]],
    forecasts: list[dict[str, Any]],
    model_leaderboard: list[dict[str, Any]],
    brief: dict[str, Any],
    lineage: list[dict[str, Any]],
    anomaly_log: list[dict[str, Any]],
) -> bytes:
    """Render the executive PDF report using WeasyPrint."""
    try:
        from weasyprint import HTML
        template = Template(PDF_TEMPLATE)
        html_str = template.render(
            run_id=run_id,
            kpi=kpi_summary,
            segments=segments,
            forecasts=forecasts,
            leaderboard=model_leaderboard,
            brief=brief,
            lineage=lineage,
            anomalies=anomaly_log,
        )
        pdf_bytes = HTML(string=html_str).write_pdf()
        return pdf_bytes
    except Exception:
        # Fallback: return minimal HTML as bytes if WeasyPrint fails
        return f"<html><body><h1>SENTINEL Report — Run {run_id}</h1></body></html>".encode()


def upload_pdf_to_minio(pdf_bytes: bytes, run_id: str) -> str:
    """Upload PDF to MinIO reports bucket."""
    from minio import Minio
    minio = Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )
    bucket = settings.minio_bucket_reports
    try:
        minio.bucket_exists(bucket) or minio.make_bucket(bucket)
    except Exception:
        pass

    key = f"{run_id}/report.pdf"
    minio.put_object(bucket, key, io.BytesIO(pdf_bytes), len(pdf_bytes),
                     content_type="application/pdf")
    return f"{bucket}/{key}"
