# ── SENTINEL API Dockerfile ─────────────────────────────────────────────────
# Fixes applied:
#   ARM64/Apple Silicon: g++ installed before pip (fix #4)
#   WeasyPrint: cairo + pango system libs (fix #6)
#   Build cache: requirements pinned for reproducibility

FROM python:3.11-slim

WORKDIR /app

# System dependencies — order matters: compilers first, then libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    # C/C++ compilers for ARM64 source builds (phik, numpy, etc.)
    gcc g++ \
    # WeasyPrint rendering libs
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libffi-dev \
    libgdk-pixbuf-2.0-0 \
    libxml2 \
    libxslt1.1 \
    shared-mime-info \
    # General
    curl \
    git \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Python deps — copied first for layer caching
COPY pyproject.toml .

# Install with pip — use --no-deps for dev extras to avoid resolver conflicts
RUN pip install --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -e . && \
    pip install --no-cache-dir ruff mypy pytest pytest-asyncio

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
