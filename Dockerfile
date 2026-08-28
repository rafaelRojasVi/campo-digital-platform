# Campo Digital API — hosted Transelec pilot container.
#
# One Cloud Run service: FastAPI serves the JSON API (/transelec,
# /api/transelec) and the built React dashboard from the same origin (see
# apps/api/app/dashboard_static.py). See docs/platform/production-platform-v1.md
# for the target architecture and products/transelect/docs/deployment.md for
# the full deployment runbook.

# ---- Stage 1: build the Transelec dashboard's static assets -----------------
FROM node:24.19.0-slim AS dashboard-build

WORKDIR /dashboard

COPY products/transelect/dashboard/package.json products/transelect/dashboard/package-lock.json ./
RUN npm ci

COPY products/transelect/dashboard/ ./
RUN npm run build

# ---- Stage 2: Python runtime -------------------------------------------------
FROM python:3.12-slim AS runtime

# Pinned to match [tool.uv].required-version in pyproject.toml.
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/

WORKDIR /app

# Only what hatchling needs to build/install this project's local packages
# (see [tool.hatch.build.targets.wheel] in pyproject.toml), so this layer
# stays cached across pure application-code edits below.
COPY pyproject.toml uv.lock README.md ./
COPY products/lidar/src ./products/lidar/src
COPY products/transelect/src ./products/transelect/src

# --no-dev excludes lint/test/notebook tooling. "api" and "transelec" are the
# only extras this service needs at runtime (no LiDAR geometry-extra/analysis
# extras). This also installs the project itself, which is what makes
# transelec_ingestion/lidar_core/lidar_io importable without PYTHONPATH hacks.
RUN uv sync --frozen --no-dev --extra api --extra transelec

# Optional Cloud Storage backend for object_storage.py. Deliberately not a
# pinned project dependency (see apps/api/app/object_storage.py) so local
# dev/CI never need Google Cloud credentials or network access; installed
# only in this image. Re-verify this is still the current desired version
# before rebuilding.
RUN uv pip install --python /app/.venv/bin/python google-cloud-storage==2.18.2

COPY apps/api ./apps/api
COPY migrations ./migrations
COPY alembic.ini ./alembic.ini
COPY --from=dashboard-build /dashboard/dist ./products/transelect/dashboard/dist

RUN groupadd --system campo && \
    useradd --system --gid campo --home-dir /app --no-create-home campo && \
    chown -R campo:campo /app

USER campo

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PORT=8080

EXPOSE 8080

# Cloud Run injects $PORT at runtime; always bind 0.0.0.0. --no-sync skips
# uv's dependency-resolution check so startup never touches the network.
CMD ["sh", "-c", "uv run --frozen --no-sync uvicorn app.main:app --app-dir apps/api --host 0.0.0.0 --port ${PORT}"]
