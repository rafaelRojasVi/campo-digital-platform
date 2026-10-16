# Rodales management reports — Stage 1 (data, API, export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store, validate, review and export Rodales management reports
(informes de manejo) through `/api/forestry/reports`, without touching the
published base.

**Architecture:** A migration adds three `forestry` tables. A pure module
(`forestry_report_geometry`) applies the geometry rules with Shapely (same
GEOS engine as PostGIS) so it is unit-testable; a persistence module
(`forestry_reports`) loads source polygons, applies the rules, and keeps
status, revision and notes consistent; a pure export module writes SHP ZIP,
GeoPackage and CSV; a router exposes it all with the platform's session,
CSRF and role checks.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy Core (`text()`), Alembic,
PostGIS 17, Shapely 2, pyshp 3, sqlite3 (stdlib), pytest.

**Spec:** `docs/superpowers/specs/2026-10-16-rodales-informes-de-manejo-design.md`

Stage 2 (screens: JSTS geometry, undo stack, bandeja, editor, review) gets
its own plan once this API exists, so it is written against real responses.

## Global Constraints

- Reports never change the published base (`forestry.publication_state` is read, never written).
- Base CRS: EPSG:32718 (WGS 84 / UTM 18S); geometry stored as `geometry(MultiPolygon, 32718)`.
- Report types: `cosecha`, `manejo`, `reforestacion`, `plantacion`, `otro`. Month: text `YYYY-MM`.
- Statuses: `borrador`, `enviado`, `aprobado`, `cambios_solicitados`, `archivado`; editable only in `borrador` and `cambios_solicitados`.
- Report name: 1–120 characters after trimming; unique among non-archived reports, case-insensitive.
- Change-request note: required, at most 2,000 characters.
- Geometry tolerances: coverage and overlap 0.01 m²; minimum piece 1 m²; at most 500 features per report.
- `sup_ha` = area / 10,000 (metres, EPSG:32718), recomputed only for changed features; `editada` = `wb` on changed features (fits the master's 2-character field; chosen by the user 2026-10-16).
- Export columns: the 14 base fields (in base order; `CodUso_202` widened to 25) then `EN_INFORME`, `INFORME`, `TIPO`, `FECHA`, `ESTADO`, `OID_ORIGEN`. `.prj` = `EXPECTED_PRJ_WKT`; `.cpg` = `UTF-8`. CSV: UTF-8 with BOM, comma, CRLF (same as the dashboard's CSV).
- Client-facing messages are Spanish; codes and docs are English.
- Never store or export email addresses; audit metadata carries ids, counts and codes only (never note text).
- No real client data in tests: synthetic shapefiles only (`forestry_family_fixtures`).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings against the spec (made while planning; the spec's intent stands)

1. **Identity is `source_feature_ordinal`, not OBJECTID.** `forestry.source_feature` is unique on `(shapefile_snapshot_id, feature_ordinal)`; OBJECTID may repeat (the ingestion keeps duplicate-OBJECTID evidence). OBJECTID is still exported, from the copied attributes.
2. **No `split_group` column.** All features naming one source polygon must together cover it; that one rule covers a whole polygon, a split and nested splits, and "a piece was removed" becomes a coverage failure.
3. **Attributes are one JSONB column** keyed by the source contract's lineage names (the same keys as `forestry.source_feature.source_attributes`), instead of 14 columns.
4. **Geometry rules run in Shapely** (GEOS, as PostGIS) on the server, before the insert; the server stays authoritative and the rules are unit-tested without a database.
5. **Save route is `PUT /api/forestry/reports/features`** (report id in the body): the body-limit middleware matches exact paths, and an exact path also gets the "no live session, no body read" protection uploads have.
6. **New `Action.APPROVE`, admin only.** Operators already hold `PUBLISH`, so approval cannot reuse it.
7. **Every transition carries the `revision` the client saw**, so «Aprobar» always refers to what was reviewed.
8. **A feature may omit its geometry** to mean "an untouched copy of the source polygon" (how «Pegar» works); `GET /reports/{id}/source-polygons` serves source polygons in UTM for the editor to split.
9. **Widths are checked in UTF-8 bytes** (DBF widths are bytes); `INFORME` is 254 bytes wide. **`editada` is `wb`, not `web`** (user decision 2026-10-16): the master field is 2 wide, so `web` would become `we` in ArcMap.
10. **`GET /reports/{id}` also returns `sources`** (the base polygons the report refers to) for the review overlay and change list.

## Review Focus

- Untouched polygons sent back with float noise (±1e-9 m) must stay "untouched" (no area change, `editada` unchanged) — Task 3 test `test_float_noise_keeps_a_polygon_untouched`.
- A report started on base A and saved after base B was published must still validate against A and return a `base_outdated` warning — Task 5 test `test_saving_after_a_newer_publish_warns_and_uses_the_report_base`.
- Approving a report that changed after it was opened must be refused (`stale_revision`) — Task 5 test `test_approve_with_an_old_revision_is_refused`.
- Accented text near a field width must be refused, never silently truncated in the export — Task 3 `test_width_counts_utf8_bytes`, Task 4 `test_export_never_truncates` (pyshp `PossibleDataLoss` as error).
- A viewer requesting a draft by id (detail or export) must get `404`, not `403` or the data — Task 6 `test_viewer_cannot_see_or_export_a_draft`.

## File Structure

| File | Responsibility |
|---|---|
| Create `migrations/versions/0014_establish_forestry_reports.py` | tables `forestry.report`, `report_note`, `report_feature` |
| Modify `apps/api/app/access.py` | `Action.APPROVE` (admin only) |
| Create `apps/api/app/forestry_report_geometry.py` | pure geometry and attribute rules |
| Create `apps/api/app/forestry_report_export.py` | pure SHP ZIP / GeoPackage / CSV writers |
| Create `apps/api/app/forestry_reports.py` | persistence and lifecycle |
| Create `apps/api/app/routers/forestry_reports.py` | HTTP |
| Modify `apps/api/app/main.py` | include router; body limit for the save route |
| Modify `pyproject.toml`, `uv.lock` | `pyshp` in the `api` extra |
| Create `apps/api/integration_tests/forestry_report_fixtures.py` | synthetic base + users for integration tests |
| Tests | `apps/api/tests/test_forestry_report_geometry.py`, `test_forestry_report_export.py`; `apps/api/integration_tests/test_forestry_report_schema.py`, `test_forestry_reports.py`, `test_forestry_reports_router.py`; `apps/api/tests/test_access.py`, `test_migration_graph.py` |
| Modify `scripts/consola/index.html` | Spanish labels for the new audit events |
| Create `products/forestry/docs/management-reports-v1.md` | technical record |

## Commands used throughout

- Unit tests (no database env): `uv run --extra api --extra transelec pytest -q apps/api/tests/<file>`
- Integration tests (worktree without `.env`): `POSTGRES_PASSWORD=x make db-test-reset` once, then `POSTGRES_PASSWORD=x uv run --extra api --extra transelec pytest -q apps/api/integration_tests/<file>`. If `make db-test-reset` reports the test database env vars, run `POSTGRES_PASSWORD=x make persistence-check` once instead (it migrates and runs the suite).
- Lint/types: `uv run ruff check apps/api scripts tests && uv run ruff format --check apps/api && uv run mypy apps/api/app`

---

### Task 1: Migration 0014 — report tables

**Files:**
- Create: `migrations/versions/0014_establish_forestry_reports.py`
- Create: `apps/api/integration_tests/forestry_report_fixtures.py`
- Create: `apps/api/integration_tests/test_forestry_report_schema.py`
- Modify: `apps/api/tests/test_migration_graph.py` (the `0013 ... single head` test)

**Interfaces:**
- Produces: tables `forestry.report(id, name, report_type, report_month, status, base_snapshot_id, revision, created_by_app_user_id, created_at, updated_at, submitted_at, decided_at, decided_by_app_user_id)`, `forestry.report_note(id, report_id, kind, body, author_app_user_id, created_at)`, `forestry.report_feature(id, report_id, position, source_feature_ordinal, in_report, geometry_changed, attributes JSONB, geometry MultiPolygon 32718)`; partial unique index `uq_report_active_name`.
- Produces (fixtures): `seed_published_base(connection, source_root) -> int`, `seed_user(connection, name) -> int`, `square_geojson(x0, y0, width, height) -> dict[str, object]`, `BASE_ROWS`, `BASE_GEOMETRIES`, `BOWTIE_100`.

- [ ] **Step 1: Update the migration-graph test (failing)**

In `apps/api/tests/test_migration_graph.py`, replace the test `test_migration_0013_extends_0012_as_the_single_head` with:

```python
def test_migration_0013_extends_0012() -> None:
    """0013 (platform security events) extends 0012 directly."""

    root = Path(__file__).resolve().parents[3]
    revisions = _load_all_migrations(root)

    assert "0013" in revisions, "Expected migration 0013 to be present."
    down_revision, _ = revisions["0013"]
    assert down_revision == "0012"


def test_migration_0014_extends_0013_as_the_single_head() -> None:
    """0014 (Rodales management reports) extends 0013 directly."""

    root = Path(__file__).resolve().parents[3]
    revisions = _load_all_migrations(root)

    assert "0014" in revisions, "Expected migration 0014 to be present."
    down_revision, _ = revisions["0014"]
    assert down_revision == "0013"

    down_revisions = {down for down, _ in revisions.values() if down is not None}
    heads = set(revisions) - down_revisions
    assert heads == {"0014"}
```

- [ ] **Step 2: Run it to see it fail**

Run: `uv run --extra api --extra transelec pytest -q apps/api/tests/test_migration_graph.py`
Expected: FAIL in `test_migration_0014_extends_0013_as_the_single_head` ("Expected migration 0014 to be present.").

- [ ] **Step 3: Write the shared integration fixtures**

Create `apps/api/integration_tests/forestry_report_fixtures.py`:

```python
"""A synthetic Rodales base for management-report tests.

Three 100 m squares (ordinals 1-3, rodales 17, 18, 19) and one invalid
bowtie (ordinal 4, rodal 20), ingested and published. No client data.
"""

from __future__ import annotations

from pathlib import Path

from app.access_repository import resolve_or_create_app_user
from app.forestry_publication import publish_initial_if_unpublished
from sqlalchemy import Connection
from test_forestry_ingestion import build_zip, ingest

from forestry_family_fixtures import source_row, square_ring

BOWTIE_100 = [(600.0, 0.0), (700.0, 100.0), (600.0, 100.0), (700.0, 0.0), (600.0, 0.0)]

BASE_ROWS = [
    source_row(objectid=11, n_rodal="17", sup_ha=1.0, cod_uso="Pi06"),
    source_row(objectid=12, n_rodal="18", sup_ha=1.0),
    source_row(objectid=13, n_rodal="19", sup_ha=1.0),
    source_row(objectid=14, n_rodal="20", sup_ha=1.0),
]
BASE_GEOMETRIES = [
    [square_ring(0.0, 0.0, 100.0)],
    [square_ring(200.0, 0.0, 100.0)],
    [square_ring(400.0, 0.0, 100.0)],
    [BOWTIE_100],
]


def seed_published_base(connection: Connection, source_root: Path, *, zip_name: str = "base.zip") -> int:
    """Ingest the synthetic base; publish it if nothing is published. Returns its snapshot id."""

    relative = build_zip(source_root, BASE_ROWS, geometries=BASE_GEOMETRIES, zip_name=zip_name)
    snapshot_id = ingest(connection, source_root, relative).shapefile_snapshot_id
    publish_initial_if_unpublished(connection, shapefile_snapshot_id=snapshot_id)
    return snapshot_id


def seed_user(connection: Connection, name: str) -> int:
    """A platform user without grants (grants are added by the caller when needed)."""

    return resolve_or_create_app_user(
        connection,
        identity_kind="google",
        identity_key=f"sub-{name}",
        display_name=name,
        email=f"{name}@campodigital.cl",
    ).id


def square_geojson(x0: float, y0: float, width: float, height: float) -> dict[str, object]:
    """A GeoJSON Polygon rectangle in EPSG:32718 metres."""

    return {
        "type": "Polygon",
        "coordinates": [
            [[x0, y0], [x0, y0 + height], [x0 + width, y0 + height], [x0 + width, y0], [x0, y0]]
        ],
    }
```

- [ ] **Step 4: Write the failing schema test**

Create `apps/api/integration_tests/test_forestry_report_schema.py`:

```python
"""Migration 0014: Rodales management-report tables and their constraints."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import Connection, text
from sqlalchemy.exc import IntegrityError

from forestry_report_fixtures import seed_published_base, seed_user


def _insert_report(
    connection: Connection, *, snapshot_id: int, user_id: int, name: str, month: str = "2027-01",
    status: str = "borrador",
) -> int:
    return connection.execute(
        text(
            """
            INSERT INTO forestry.report
                (name, report_type, report_month, status, base_snapshot_id, created_by_app_user_id)
            VALUES (:name, 'cosecha', :month, :status, :snapshot_id, :user_id)
            RETURNING id
            """
        ),
        {"name": name, "month": month, "status": status, "snapshot_id": snapshot_id, "user_id": user_id},
    ).scalar_one()


@pytest.fixture
def seeded(integration_connection: Connection, tmp_path: Path) -> tuple[int, int]:
    snapshot_id = seed_published_base(integration_connection, tmp_path)
    user_id = seed_user(integration_connection, "operadora")
    return snapshot_id, user_id


def test_report_tables_exist(integration_connection: Connection) -> None:
    tables = set(
        integration_connection.execute(
            text(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'forestry'"
            )
        ).scalars()
    )
    assert {"report", "report_note", "report_feature"} <= tables
    geometry_type = integration_connection.execute(
        text(
            "SELECT type, srid FROM geometry_columns "
            "WHERE f_table_schema = 'forestry' AND f_table_name = 'report_feature'"
        )
    ).one()
    assert (geometry_type.type, geometry_type.srid) == ("MULTIPOLYGON", 32718)


def test_new_report_starts_as_a_draft_at_revision_one(
    integration_connection: Connection, seeded: tuple[int, int]
) -> None:
    snapshot_id, user_id = seeded
    report_id = _insert_report(integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="A")
    row = integration_connection.execute(
        text("SELECT status, revision FROM forestry.report WHERE id = :id"), {"id": report_id}
    ).one()
    assert (row.status, row.revision) == ("borrador", 1)


@pytest.mark.parametrize("month", ["2027-13", "2027-1", "27-01", "enero"])
def test_bad_month_is_rejected(
    integration_connection: Connection, seeded: tuple[int, int], month: str
) -> None:
    snapshot_id, user_id = seeded
    with pytest.raises(IntegrityError), integration_connection.begin_nested():
        _insert_report(
            integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="M", month=month
        )


def test_active_names_are_unique_ignoring_case_but_archived_ones_free_the_name(
    integration_connection: Connection, seeded: tuple[int, int]
) -> None:
    snapshot_id, user_id = seeded
    _insert_report(
        integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="Cosecha", status="archivado"
    )
    _insert_report(integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="Cosecha")
    with pytest.raises(IntegrityError), integration_connection.begin_nested():
        _insert_report(integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="COSECHA")


def test_change_request_note_needs_text(
    integration_connection: Connection, seeded: tuple[int, int]
) -> None:
    snapshot_id, user_id = seeded
    report_id = _insert_report(integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="N")
    with pytest.raises(IntegrityError), integration_connection.begin_nested():
        integration_connection.execute(
            text(
                "INSERT INTO forestry.report_note (report_id, kind, body, author_app_user_id) "
                "VALUES (:report_id, 'cambios_solicitados', '   ', :user_id)"
            ),
            {"report_id": report_id, "user_id": user_id},
        )


def test_deleting_a_report_deletes_its_features_and_notes(
    integration_connection: Connection, seeded: tuple[int, int]
) -> None:
    snapshot_id, user_id = seeded
    report_id = _insert_report(integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="D")
    integration_connection.execute(
        text(
            """
            INSERT INTO forestry.report_feature
                (report_id, position, source_feature_ordinal, in_report, geometry_changed, attributes, geometry)
            VALUES (:report_id, 1, 1, true, false, '{}'::jsonb,
                    ST_Multi(ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 32718)))
            """
        ),
        {"report_id": report_id},
    )
    integration_connection.execute(
        text(
            "INSERT INTO forestry.report_note (report_id, kind, body, author_app_user_id) "
            "VALUES (:report_id, 'aprobado', '', :user_id)"
        ),
        {"report_id": report_id, "user_id": user_id},
    )
    integration_connection.execute(text("DELETE FROM forestry.report WHERE id = :id"), {"id": report_id})
    remaining = integration_connection.execute(
        text(
            "SELECT (SELECT count(*) FROM forestry.report_feature WHERE report_id = :id) "
            "+ (SELECT count(*) FROM forestry.report_note WHERE report_id = :id)"
        ),
        {"id": report_id},
    ).scalar_one()
    assert remaining == 0
```

- [ ] **Step 5: Write the migration**

Create `migrations/versions/0014_establish_forestry_reports.py`:

```python
"""Establish Rodales management reports (informes de manejo).

Revision ID: 0014
Revises: 0013

A management report is a named, reviewable set of polygon copies taken from
one published Forestry base snapshot (spec
``docs/superpowers/specs/2026-10-16-rodales-informes-de-manejo-design.md``).
It never changes what the dashboard serves.

Expand-only:

- ``forestry.report``: header, status, the base snapshot it started from,
  and an optimistic-lock ``revision`` bumped on every change.
- ``forestry.report_note``: append-only review notes; a change request
  always has text.
- ``forestry.report_feature``: the report's own copies. ``attributes`` uses
  the source contract's lineage keys (as ``source_feature.source_attributes``);
  ``source_feature_ordinal`` names the polygon in the report's base.

Nothing existing is altered, so the previous application revision keeps
working against this schema.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REPORT_TYPES = ("cosecha", "manejo", "reforestacion", "plantacion", "otro")
REPORT_STATUSES = ("borrador", "enviado", "aprobado", "cambios_solicitados", "archivado")
NOTE_KINDS = ("cambios_solicitados", "aprobado")


def _one_of(column: str, values: Sequence[str]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _timestamp(name: str, *, nullable: bool = False) -> sa.Column[object]:
    if nullable:
        return sa.Column(name, sa.DateTime(timezone=True), nullable=True)
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=sa.text("CURRENT_TIMESTAMP"),
        nullable=False,
    )


def upgrade() -> None:
    """Create the report, note and feature tables."""

    op.create_table(
        "report",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("report_type", sa.Text(), nullable=False),
        sa.Column("report_month", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'borrador'"), nullable=False),
        sa.Column("base_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_by_app_user_id", sa.BigInteger(), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        _timestamp("submitted_at", nullable=True),
        _timestamp("decided_at", nullable=True),
        sa.Column("decided_by_app_user_id", sa.BigInteger(), nullable=True),
        sa.CheckConstraint(
            "btrim(name) <> '' AND char_length(name) <= 120", name="ck_report_name"
        ),
        sa.CheckConstraint(_one_of("report_type", REPORT_TYPES), name="ck_report_type"),
        sa.CheckConstraint(
            "report_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'", name="ck_report_month"
        ),
        sa.CheckConstraint(_one_of("status", REPORT_STATUSES), name="ck_report_status"),
        sa.CheckConstraint("revision >= 1", name="ck_report_revision_positive"),
        sa.ForeignKeyConstraint(
            ["base_snapshot_id"],
            ["forestry.shapefile_snapshot.id"],
            name="fk_report_base_snapshot_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_app_user_id"],
            ["platform.app_user.id"],
            name="fk_report_created_by_app_user_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["decided_by_app_user_id"],
            ["platform.app_user.id"],
            name="fk_report_decided_by_app_user_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_report"),
        schema="forestry",
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_report_active_name ON forestry.report (lower(name)) "
        "WHERE status <> 'archivado'"
    )
    op.create_index("ix_report_status", "report", ["status"], schema="forestry")

    op.create_table(
        "report_note",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("report_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("author_app_user_id", sa.BigInteger(), nullable=False),
        _timestamp("created_at"),
        sa.CheckConstraint(_one_of("kind", NOTE_KINDS), name="ck_report_note_kind"),
        sa.CheckConstraint("char_length(body) <= 2000", name="ck_report_note_body_length"),
        sa.CheckConstraint(
            "kind <> 'cambios_solicitados' OR btrim(body) <> ''",
            name="ck_report_note_change_request_has_text",
        ),
        sa.ForeignKeyConstraint(
            ["report_id"], ["forestry.report.id"], name="fk_report_note_report_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["author_app_user_id"],
            ["platform.app_user.id"],
            name="fk_report_note_author_app_user_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_report_note"),
        schema="forestry",
    )
    op.create_index("ix_report_note_report_id", "report_note", ["report_id"], schema="forestry")

    op.create_table(
        "report_feature",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("report_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("source_feature_ordinal", sa.Integer(), nullable=False),
        sa.Column("in_report", sa.Boolean(), nullable=False),
        sa.Column("geometry_changed", sa.Boolean(), nullable=False),
        sa.Column("attributes", postgresql.JSONB(), nullable=False),
        sa.CheckConstraint("position >= 1", name="ck_report_feature_position_positive"),
        sa.CheckConstraint(
            "source_feature_ordinal >= 1", name="ck_report_feature_source_ordinal_positive"
        ),
        sa.ForeignKeyConstraint(
            ["report_id"],
            ["forestry.report.id"],
            name="fk_report_feature_report_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_report_feature"),
        sa.UniqueConstraint("report_id", "position", name="uq_report_feature_report_position"),
        schema="forestry",
    )
    op.execute(
        "ALTER TABLE forestry.report_feature "
        "ADD COLUMN geometry geometry(MultiPolygon, 32718) NOT NULL"
    )


def downgrade() -> None:
    """Drop the report tables (the base snapshots are untouched)."""

    op.drop_table("report_feature", schema="forestry")
    op.drop_table("report_note", schema="forestry")
    op.drop_table("report", schema="forestry")
```

- [ ] **Step 6: Run the graph test and the schema test**

Run: `uv run --extra api --extra transelec pytest -q apps/api/tests/test_migration_graph.py`
Expected: PASS.
Run: `POSTGRES_PASSWORD=x make migration-check` then `POSTGRES_PASSWORD=x uv run --extra api --extra transelec pytest -q apps/api/integration_tests/test_forestry_report_schema.py`
Expected: migration-check upgrades and downgrades cleanly; 9 passed (the month test is parametrized ×4).

- [ ] **Step 7: Commit**

```bash
git add migrations/versions/0014_establish_forestry_reports.py apps/api/tests/test_migration_graph.py \
  apps/api/integration_tests/forestry_report_fixtures.py apps/api/integration_tests/test_forestry_report_schema.py
git commit -m "feat(rodales): tables for management reports (migration 0014)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `Action.APPROVE` (admin only)

**Files:**
- Modify: `apps/api/app/access.py` (enum `Action`, `_ALLOWED`)
- Modify: `apps/api/tests/test_access.py` (`MATRIX`)

**Interfaces:**
- Produces: `Action.APPROVE` (`"approve"`); `can(Role.ADMIN, Action.APPROVE) is True`, operator and viewer `False`.

- [ ] **Step 1: Add the matrix rows (failing)**

In `apps/api/tests/test_access.py`, add to `MATRIX` after each role's `MANAGE_ACCESS` row:

```python
    (Role.ADMIN, Action.APPROVE): True,
```
```python
    (Role.OPERATOR, Action.APPROVE): False,
```
```python
    (Role.VIEWER, Action.APPROVE): False,
```

- [ ] **Step 2: Run to see it fail**

Run: `uv run --extra api --extra transelec pytest -q apps/api/tests/test_access.py`
Expected: FAIL with `AttributeError: APPROVE`.

- [ ] **Step 3: Add the action**

In `apps/api/app/access.py`, after `EDIT = "edit"` add:

```python
    # Approving a Rodales management report, or sending it back with a note.
    # Admin only: operators prepare reports (EDIT) and already hold PUBLISH,
    # so approval needs its own action.
    APPROVE = "approve"
```

and in `_ALLOWED` add `(Role.ADMIN, Action.APPROVE),` after `(Role.ADMIN, Action.MANAGE_ACCESS),`.

- [ ] **Step 4: Run the access tests and check nothing else enumerates actions**

Run: `uv run --extra api --extra transelec pytest -q apps/api/tests/test_access.py`
Expected: PASS.
Run: `grep -rn "Action.MANAGE_ACCESS\|for action in Action" apps/api/app products/*/src` and confirm no exhaustive mapping needs the new member (only `can()` and route dependencies use actions).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/access.py apps/api/tests/test_access.py
git commit -m "feat(access): APPROVE action for management reports (admin only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Geometry and attribute rules (pure)

**Files:**
- Create: `apps/api/app/forestry_report_geometry.py`
- Test: `apps/api/tests/test_forestry_report_geometry.py`

**Interfaces:**
- Produces:
  - `MAX_FEATURES = 500`, `EDITADA_WEB = "wb"`, `EDITABLE_ATTRIBUTE_WIDTHS: dict[str, int]`
  - `class ReportValidationError(ValueError)` with `.code: str`, `.message: str`, `.source_feature_ordinal: int | None`
  - `@dataclass ReportWarning(code: str, message: str, source_feature_ordinal: int | None)`
  - `@dataclass SourcePolygon(feature_ordinal: int, attributes: Mapping[str, Any], geometry: BaseGeometry, is_valid: bool)`
  - `@dataclass FeatureInput(source_feature_ordinal: int, in_report: bool, attributes: Mapping[str, Any], geometry: Mapping[str, Any] | None)` — `geometry=None` means "untouched copy of the source"
  - `@dataclass ResolvedFeature(position: int, source_feature_ordinal: int, in_report: bool, geometry_changed: bool, attributes: dict[str, Any], geometry: MultiPolygon)`
  - `@dataclass Resolution(features: list[ResolvedFeature], warnings: list[ReportWarning])`
  - `resolve_features(inputs: Sequence[FeatureInput], sources: Mapping[int, SourcePolygon]) -> Resolution`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_forestry_report_geometry.py`:

```python
"""Geometry and attribute rules for Rodales management reports (pure, no database)."""

from __future__ import annotations

from typing import Any

import pytest
import shapely
from app.forestry_report_geometry import (
    EDITADA_WEB,
    MAX_FEATURES,
    FeatureInput,
    ReportValidationError,
    SourcePolygon,
    resolve_features,
)
from shapely.geometry import LineString, MultiPolygon, Polygon, box, mapping

SQUARE = box(0.0, 0.0, 100.0, 100.0)  # 1 ha
BOWTIE = Polygon([(0.0, 0.0), (100.0, 100.0), (0.0, 100.0), (100.0, 0.0), (0.0, 0.0)])


def source(ordinal: int = 1, geometry: Polygon = SQUARE, *, is_valid: bool = True) -> SourcePolygon:
    attributes: dict[str, Any] = {
        "objectid": 10 + ordinal,
        "n_rodal": "17",
        "n_rodal_te": None,
        "sup_ha": 1.0,
        "editada": None,
        "cod_uso": "Pi06",
        "shape_area": 10_000.0,
        "shape_leng": 400.0,
    }
    return SourcePolygon(ordinal, attributes, MultiPolygon([geometry]), is_valid)


def feature(
    ordinal: int, geometry: Polygon | None, *, in_report: bool = False, **attributes: Any
) -> FeatureInput:
    return FeatureInput(ordinal, in_report, attributes, None if geometry is None else mapping(geometry))


def code_of(inputs: list[FeatureInput], sources: dict[int, SourcePolygon]) -> str:
    with pytest.raises(ReportValidationError) as raised:
        resolve_features(inputs, sources)
    return raised.value.code


def test_empty_report_is_valid() -> None:
    assert resolve_features([], {}).features == []


def test_pasted_polygon_without_geometry_is_an_untouched_copy() -> None:
    result = resolve_features([feature(1, None, in_report=True)], {1: source()})
    [only] = result.features
    assert only.geometry_changed is False
    assert only.attributes["sup_ha"] == 1.0
    assert only.attributes["editada"] is None
    assert only.in_report is True
    assert shapely.equals(only.geometry, SQUARE)


def test_float_noise_keeps_a_polygon_untouched() -> None:
    noisy = Polygon([(x + 1e-9, y - 1e-9) for x, y in SQUARE.exterior.coords])
    [only] = resolve_features([feature(1, noisy)], {1: source()}).features
    assert only.geometry_changed is False
    assert only.attributes["sup_ha"] == 1.0


def test_split_in_two_recomputes_area_and_marks_editada() -> None:
    left, right = box(0, 0, 60, 100), box(60, 0, 100, 100)
    result = resolve_features(
        [feature(1, left, in_report=True, n_rodal="17-1"), feature(1, right)], {1: source()}
    )
    first, second = result.features
    assert (first.geometry_changed, second.geometry_changed) == (True, True)
    assert first.attributes["sup_ha"] == pytest.approx(0.6)
    assert second.attributes["sup_ha"] == pytest.approx(0.4)
    assert first.attributes["shape_area"] == pytest.approx(6_000.0)
    assert first.attributes["shape_leng"] == pytest.approx(320.0)
    assert first.attributes["n_rodal"] == "17-1"
    assert second.attributes["n_rodal"] == "17"
    assert first.attributes["editada"] == EDITADA_WEB == second.attributes["editada"]
    assert [f.position for f in result.features] == [1, 2]


def test_nested_split_is_checked_against_the_root() -> None:
    pieces = [box(0, 0, 50, 100), box(50, 0, 100, 50), box(50, 50, 100, 100)]
    result = resolve_features([feature(1, piece) for piece in pieces], {1: source()})
    assert len(result.features) == 3


def test_missing_piece_is_refused() -> None:
    assert code_of([feature(1, box(0, 0, 60, 100))], {1: source()}) == "split_coverage"


def test_pasted_twice_is_an_overlap() -> None:
    assert code_of([feature(1, None), feature(1, None)], {1: source()}) == "overlap"


def test_overlapping_pieces_are_refused() -> None:
    pieces = [box(0, 0, 60, 100), box(40, 0, 100, 100)]
    assert code_of([feature(1, piece) for piece in pieces], {1: source()}) == "overlap"


def test_two_sources_touching_along_an_edge_do_not_overlap() -> None:
    sources = {1: source(1), 2: source(2, box(100, 0, 200, 100))}
    assert len(resolve_features([feature(1, None), feature(2, None)], sources).features) == 2


def test_piece_under_one_square_metre_is_refused() -> None:
    sliver = box(0, 0, 0.5, 1)
    rest = SQUARE.difference(sliver)
    assert code_of([feature(1, sliver), feature(1, rest)], {1: source()}) == "piece_too_small"


def test_split_of_a_polygon_with_a_hole() -> None:
    holed = Polygon(SQUARE.exterior.coords, [box(40, 40, 60, 60).exterior.coords])
    left = holed.intersection(box(0, 0, 50, 100))
    right = holed.intersection(box(50, 0, 100, 100))
    result = resolve_features([feature(1, left), feature(1, right)], {1: source(1, holed)})
    assert sum(f.attributes["sup_ha"] for f in result.features) == pytest.approx(0.96)


def test_invalid_source_may_be_carried_untouched_with_a_warning() -> None:
    result = resolve_features([feature(1, None)], {1: source(1, BOWTIE, is_valid=False)})
    assert result.features[0].geometry_changed is False
    assert [w.code for w in result.warnings] == ["invalid_source_carried"]
    assert result.warnings[0].source_feature_ordinal == 1


def test_invalid_source_cannot_be_split() -> None:
    halves = [box(0, 0, 50, 100), box(50, 0, 100, 100)]
    sources = {1: source(1, BOWTIE, is_valid=False)}
    assert code_of([feature(1, half) for half in halves], sources) == "source_invalid_split"


def test_unknown_source_is_refused() -> None:
    with pytest.raises(ReportValidationError) as raised:
        resolve_features([feature(7, None)], {1: source()})
    assert raised.value.code == "unknown_source"
    assert raised.value.source_feature_ordinal == 7


def test_non_editable_attribute_is_refused() -> None:
    assert code_of([feature(1, None, sup_ha="9")], {1: source()}) == "attribute_not_editable"


def test_attribute_must_be_text() -> None:
    assert code_of([feature(1, None, n_rodal=17)], {1: source()}) == "attribute_not_text"


def test_attribute_longer_than_its_field_is_refused() -> None:
    assert code_of([feature(1, None, n_rodal="12345678901")], {1: source()}) == "attribute_too_long"


def test_width_counts_utf8_bytes() -> None:
    # n_rodal_te is 3 bytes wide: "ñ" is 2 bytes, "ññ" is 4.
    resolve_features([feature(1, None, n_rodal_te="ñ")], {1: source()})
    assert code_of([feature(1, None, n_rodal_te="ññ")], {1: source()}) == "attribute_too_long"


def test_blank_attribute_becomes_none() -> None:
    [only] = resolve_features([feature(1, None, cod_uso="  ")], {1: source()}).features
    assert only.attributes["cod_uso"] is None


def test_attribute_only_change_marks_editada_without_changing_area() -> None:
    [only] = resolve_features([feature(1, None, cod_uso="Eg03")], {1: source()}).features
    assert only.geometry_changed is False
    assert only.attributes["cod_uso"] == "Eg03"
    assert only.attributes["editada"] == EDITADA_WEB
    assert only.attributes["sup_ha"] == 1.0


def test_unchanged_attribute_value_does_not_mark_editada() -> None:
    [only] = resolve_features([feature(1, None, cod_uso="Pi06")], {1: source()}).features
    assert only.attributes["editada"] is None


def test_line_geometry_is_unreadable() -> None:
    line = FeatureInput(1, False, {}, mapping(LineString([(0, 0), (1, 1)])))
    assert code_of([line], {1: source()}) == "geometry_unreadable"


def test_garbage_geometry_is_unreadable() -> None:
    garbage = FeatureInput(1, False, {}, {"type": "Polygon", "coordinates": "nope"})
    assert code_of([garbage], {1: source()}) == "geometry_unreadable"


def test_too_many_features_is_refused_first() -> None:
    inputs = [feature(999, None) for _ in range(MAX_FEATURES + 1)]
    assert code_of(inputs, {}) == "too_many_features"


def test_messages_are_spanish() -> None:
    with pytest.raises(ReportValidationError) as raised:
        resolve_features([feature(1, box(0, 0, 60, 100))], {1: source()})
    assert "rodal" in raised.value.message
```

- [ ] **Step 2: Run to see them fail**

Run: `uv run --extra api --extra transelec pytest -q apps/api/tests/test_forestry_report_geometry.py`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.forestry_report_geometry'`.

- [ ] **Step 3: Implement the module**

Create `apps/api/app/forestry_report_geometry.py`:

```python
"""Geometry and attribute rules for a Rodales management report (pure).

The editor sends the features of a report; this module decides whether they
may be stored and fills in what the server owns (areas, ``editada``). It
never touches the database: the caller loads the report's source polygons
from its base snapshot (``app.forestry_reports``).

Rules (spec ``docs/superpowers/specs/2026-10-16-rodales-informes-de-manejo-design.md``):

- every feature names a polygon of the report's base snapshot by ordinal;
- the features naming one source polygon, together, cover exactly that
  polygon: one untouched copy, or the pieces of a split, however nested;
- a source polygon invalid in the base may be carried untouched (with a
  warning) but not split;
- changed pieces are valid and at least 1 m²; no two features overlap;
- only the editable attributes may change, as text within their DBF width
  (counted in UTF-8 bytes, as the DBF stores them).

Shapely runs GEOS, the same engine as PostGIS, in EPSG:32718 metres.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import shapely
import shapely.errors
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

MAX_FEATURES = 500
MIN_PIECE_AREA_M2 = 1.0
COVERAGE_TOLERANCE_M2 = 0.01
OVERLAP_TOLERANCE_M2 = 0.01
# Coordinates come back from the browser as JSON numbers; a polygon within
# this distance of its source, vertex by vertex, is the untouched source.
UNTOUCHED_TOLERANCE_M = 1e-6
EDITADA_WEB = "wb"

# What the editor may change, with each field's DBF width in bytes.
# ``cod_uso_2026`` is 10 wide in the base; the export widens it to 25 so
# codes are no longer cut (``RaCoRo01P*``).
EDITABLE_ATTRIBUTE_WIDTHS: dict[str, int] = {
    "n_rodal": 10,
    "n_rodal_te": 3,
    "cod_uso": 25,
    "uso_2024": 50,
    "desc_uso": 50,
    "uso_2026": 50,
    "cod_uso_2026": 25,
}

MESSAGES: dict[str, str] = {
    "too_many_features": f"Un informe puede tener hasta {MAX_FEATURES} polígonos.",
    "unknown_source": "Un polígono no corresponde a la base del informe. Recargue el informe.",
    "attribute_not_editable": "Ese dato no se puede cambiar desde la web.",
    "attribute_not_text": "Los datos de un polígono deben ser texto.",
    "attribute_too_long": "Un dato es demasiado largo para su campo del shapefile.",
    "geometry_unreadable": "No se pudo leer la forma de un polígono.",
    "geometry_invalid": "Una de las partes quedó con una forma inválida. Ajuste la línea de corte.",
    "source_invalid_split": (
        "Esta geometría tiene un error en la base original; corríjanla en ArcMap."
    ),
    "piece_too_small": "Una de las partes es demasiado pequeña (menos de 1 m²). Ajuste la línea.",
    "split_coverage": (
        "Las partes de un rodal dividido no cubren el rodal original. Deshaga el último corte."
    ),
    "overlap": "Dos polígonos del informe se superponen.",
}
WARNING_MESSAGES: dict[str, str] = {
    "invalid_source_carried": (
        "Este polígono tiene un error de geometría en la base original: se puede incluir, "
        "pero no dividir."
    ),
}

_READ_ERRORS = (AttributeError, KeyError, TypeError, ValueError, shapely.errors.ShapelyError)


class ReportValidationError(ValueError):
    """The features cannot be stored; ``code`` is stable, ``message`` is Spanish."""

    def __init__(self, code: str, *, source_feature_ordinal: int | None = None) -> None:
        super().__init__(MESSAGES[code])
        self.code = code
        self.message = MESSAGES[code]
        self.source_feature_ordinal = source_feature_ordinal


@dataclass(frozen=True, slots=True)
class ReportWarning:
    """Stored anyway, but worth telling the user."""

    code: str
    message: str
    source_feature_ordinal: int | None = None


@dataclass(frozen=True, slots=True)
class SourcePolygon:
    """One polygon of the report's base snapshot."""

    feature_ordinal: int
    attributes: Mapping[str, Any]
    geometry: BaseGeometry
    is_valid: bool


@dataclass(frozen=True, slots=True)
class FeatureInput:
    """One feature as the editor sends it. ``geometry`` None: untouched copy."""

    source_feature_ordinal: int
    in_report: bool
    attributes: Mapping[str, Any]
    geometry: Mapping[str, Any] | None


@dataclass(frozen=True, slots=True)
class ResolvedFeature:
    """One feature ready to store."""

    position: int
    source_feature_ordinal: int
    in_report: bool
    geometry_changed: bool
    attributes: dict[str, Any]
    geometry: MultiPolygon


@dataclass(frozen=True, slots=True)
class Resolution:
    features: list[ResolvedFeature]
    warnings: list[ReportWarning]


def resolve_features(
    inputs: Sequence[FeatureInput], sources: Mapping[int, SourcePolygon]
) -> Resolution:
    """Check ``inputs`` against their ``sources``; raise ``ReportValidationError`` or resolve."""

    if len(inputs) > MAX_FEATURES:
        raise ReportValidationError("too_many_features")

    parsed: list[tuple[FeatureInput, MultiPolygon, dict[str, str | None]]] = []
    for item in inputs:
        ordinal = item.source_feature_ordinal
        source = sources.get(ordinal)
        if source is None:
            raise ReportValidationError("unknown_source", source_feature_ordinal=ordinal)
        overrides = _clean_attributes(item.attributes, ordinal)
        if item.geometry is None:
            geometry = _to_multipolygon(source.geometry)
        else:
            geometry = _read_geometry(item.geometry, ordinal)
        parsed.append((item, geometry, overrides))

    pieces_by_source: dict[int, list[MultiPolygon]] = defaultdict(list)
    for item, geometry, _ in parsed:
        pieces_by_source[item.source_feature_ordinal].append(geometry)

    changed_sources: set[int] = set()
    warnings: list[ReportWarning] = []
    for ordinal, pieces in pieces_by_source.items():
        source = sources[ordinal]
        if len(pieces) == 1 and _same_shape(pieces[0], source.geometry):
            if not source.is_valid:
                warnings.append(
                    ReportWarning(
                        "invalid_source_carried",
                        WARNING_MESSAGES["invalid_source_carried"],
                        ordinal,
                    )
                )
            continue
        if all(_same_shape(piece, source.geometry) for piece in pieces):
            # The same polygon pasted more than once: the overlap check says so.
            continue
        if not source.is_valid:
            raise ReportValidationError("source_invalid_split", source_feature_ordinal=ordinal)
        for piece in pieces:
            if not piece.is_valid:
                raise ReportValidationError("geometry_invalid", source_feature_ordinal=ordinal)
            if piece.area < MIN_PIECE_AREA_M2:
                raise ReportValidationError("piece_too_small", source_feature_ordinal=ordinal)
        union = shapely.union_all(pieces)
        if shapely.symmetric_difference(union, source.geometry).area > COVERAGE_TOLERANCE_M2:
            raise ReportValidationError("split_coverage", source_feature_ordinal=ordinal)
        changed_sources.add(ordinal)

    resolved: list[ResolvedFeature] = []
    for position, (item, geometry, overrides) in enumerate(parsed, start=1):
        ordinal = item.source_feature_ordinal
        source = sources[ordinal]
        changed = ordinal in changed_sources
        stored = geometry if changed else _to_multipolygon(source.geometry)
        attributes = dict(source.attributes)
        attributes.update(overrides)
        attributes_changed = any(
            attributes.get(key) != source.attributes.get(key) for key in overrides
        )
        if changed:
            area = float(stored.area)
            attributes["sup_ha"] = area / 10_000
            attributes["shape_area"] = area
            attributes["shape_leng"] = float(stored.length)
        if changed or attributes_changed:
            attributes["editada"] = EDITADA_WEB
        resolved.append(
            ResolvedFeature(position, ordinal, item.in_report, changed, attributes, stored)
        )

    _reject_overlaps(resolved)
    return Resolution(resolved, warnings)


def _clean_attributes(raw: Mapping[str, Any], ordinal: int) -> dict[str, str | None]:
    cleaned: dict[str, str | None] = {}
    for key, value in raw.items():
        width = EDITABLE_ATTRIBUTE_WIDTHS.get(key)
        if width is None:
            raise ReportValidationError("attribute_not_editable", source_feature_ordinal=ordinal)
        if value is not None and not isinstance(value, str):
            raise ReportValidationError("attribute_not_text", source_feature_ordinal=ordinal)
        text = (value or "").strip()
        if len(text.encode("utf-8")) > width:
            raise ReportValidationError("attribute_too_long", source_feature_ordinal=ordinal)
        cleaned[key] = text or None
    return cleaned


def _read_geometry(raw: Mapping[str, Any], ordinal: int) -> MultiPolygon:
    try:
        geometry = shape(raw)
    except _READ_ERRORS as error:
        raise ReportValidationError(
            "geometry_unreadable", source_feature_ordinal=ordinal
        ) from error
    if isinstance(geometry, Polygon):
        geometry = MultiPolygon([geometry])
    if (
        not isinstance(geometry, MultiPolygon)
        or geometry.is_empty
        or not all(math.isfinite(value) for value in geometry.bounds)
    ):
        raise ReportValidationError("geometry_unreadable", source_feature_ordinal=ordinal)
    return geometry


def _to_multipolygon(geometry: BaseGeometry) -> MultiPolygon:
    if isinstance(geometry, MultiPolygon):
        return geometry
    if isinstance(geometry, Polygon):
        return MultiPolygon([geometry])
    raise TypeError(f"Source geometry is {geometry.geom_type}, not a polygon.")


def _same_shape(candidate: BaseGeometry, source: BaseGeometry) -> bool:
    return bool(
        shapely.equals_exact(
            shapely.normalize(candidate),
            shapely.normalize(_to_multipolygon(source)),
            tolerance=UNTOUCHED_TOLERANCE_M,
        )
    )


def _reject_overlaps(features: Sequence[ResolvedFeature]) -> None:
    if len(features) < 2:
        return
    # An untouched source may be invalid (a bowtie); measure overlaps on
    # repaired copies so GEOS does not refuse the intersection.
    geometries = [shapely.make_valid(feature.geometry) for feature in features]
    tree = STRtree(geometries)
    left, right = tree.query(geometries, predicate="intersects")
    for i, j in zip(left.tolist(), right.tolist(), strict=True):
        if i >= j:
            continue
        if shapely.intersection(geometries[i], geometries[j]).area > OVERLAP_TOLERANCE_M2:
            raise ReportValidationError(
                "overlap", source_feature_ordinal=features[j].source_feature_ordinal
            )
```

- [ ] **Step 4: Run the tests**

Run: `uv run --extra api --extra transelec pytest -q apps/api/tests/test_forestry_report_geometry.py`
Expected: 25 passed.

- [ ] **Step 5: Lint and types**

Run: `uv run ruff check apps/api/app/forestry_report_geometry.py apps/api/tests/test_forestry_report_geometry.py && uv run ruff format --check apps/api && uv run mypy apps/api/app/forestry_report_geometry.py`
Expected: clean (run `uv run ruff format` on the two files first if the format check lists them).

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/forestry_report_geometry.py apps/api/tests/test_forestry_report_geometry.py
git commit -m "feat(rodales): geometry rules for management reports

Coverage against the source polygon (whole, split or nested), invalid
source carried but never split, 1 m² minimum piece, no overlaps, editable
attributes within their DBF width in UTF-8 bytes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Export writers (SHP ZIP, GeoPackage, CSV)

**Files:**
- Modify: `pyproject.toml` (the `api` optional dependency list) and `uv.lock`
- Create: `apps/api/app/forestry_report_export.py`
- Test: `apps/api/tests/test_forestry_report_export.py`

**Interfaces:**
- Consumes: `EXPECTED_PRJ_WKT` from `forestry_ingestion.shapefile_contract`.
- Produces:
  - `ExportFormat = Literal["shp", "gpkg", "csv"]`
  - `@dataclass ExportField(name: str, dbf_type: Literal["C", "N", "F"], size: int, decimals: int)`, `EXPORT_FIELDS: tuple[ExportField, ...]`
  - `@dataclass ExportReport(name: str, report_type: str, report_month: str, status: str)`
  - `@dataclass ExportRow(attributes: Mapping[str, Any], geometry: MultiPolygon, in_report: bool, geometry_changed: bool)`
  - `row_values(report: ExportReport, row: ExportRow) -> list[object]`
  - `report_slug(name: str) -> str`
  - `write_shapefile_zip(report, rows) -> bytes`, `write_geopackage(report, rows) -> bytes`, `write_csv(report, rows) -> bytes`
  - `export_report(fmt: ExportFormat, report: ExportReport, rows: Sequence[ExportRow]) -> tuple[bytes, str, str]` (content, media type, filename)

- [ ] **Step 1: Add the dependency**

Run: `uv add --optional api "pyshp>=3.0"`
Expected: `pyproject.toml`'s `api` list gains `"pyshp>=3.0"` and `uv.lock` updates.

- [ ] **Step 2: Write the failing tests**

Create `apps/api/tests/test_forestry_report_export.py`:

```python
"""Export writers for Rodales management reports: write, then read back."""

from __future__ import annotations

import csv
import io
import sqlite3
import struct
import tempfile
import warnings
import zipfile
from pathlib import Path

import pytest
import shapefile
import shapely
from app.forestry_report_export import (
    EXPORT_FIELDS,
    ExportReport,
    ExportRow,
    export_report,
    report_slug,
    write_csv,
    write_geopackage,
    write_shapefile_zip,
)
from forestry_ingestion.shapefile_contract import EXPECTED_PRJ_WKT
from shapely.geometry import MultiPolygon, Polygon, box, shape

REPORT = ExportReport("Cosecha pino enero 2027", "cosecha", "2027-01", "aprobado")
HOLED = Polygon(box(0, 0, 100, 100).exterior.coords, [box(40, 40, 60, 60).exterior.coords])
TWO_PARTS = MultiPolygon([box(200, 0, 260, 100), box(300, 0, 340, 100)])
LONG_CODE = "RaCoRo01Pi Rn Eg97 Pi99xy"  # 25 characters, cut to 10 in the base


def attrs(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "objectid": 11,
        "nom_predio": "Ñuble Alto",
        "n_rodal": "17",
        "sup_ha": 1.0,
        "cod_uso": "Pi06",
        "editada": None,
        "uso_2024": "PLANTACION",
        "desc_uso": "Descripción",
        "cod_predial": "PU1",
        "n_rodal_te": None,
        "uso_2026": "PLANTACION",
        "cod_uso_2026": LONG_CODE,
        "shape_leng": 400.0,
        "shape_area": 10_000.0,
    }
    values.update(overrides)
    return values


ROWS = [
    ExportRow(attrs(n_rodal="17-1", editada="wb", sup_ha=0.96), MultiPolygon([HOLED]), True, True),
    ExportRow(attrs(objectid=12, n_rodal="18"), TWO_PARTS, False, False),
]


def read_zip(content: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        return {Path(name).suffix: archive.read(name) for name in archive.namelist()}


def test_slug_is_ascii_and_never_empty() -> None:
    assert report_slug("Cosecha pino enero 2027") == "Cosecha_pino_enero_2027"
    assert report_slug("Reforestación Ñuble") == "Reforestacion_Nuble"
    assert report_slug("¡¡!!") == "informe"


def test_shapefile_zip_members_projection_and_encoding() -> None:
    members = read_zip(write_shapefile_zip(REPORT, ROWS))
    assert set(members) == {".shp", ".shx", ".dbf", ".prj", ".cpg"}
    assert members[".prj"].decode("utf-8") == EXPECTED_PRJ_WKT
    assert members[".cpg"] == b"UTF-8"
    with zipfile.ZipFile(io.BytesIO(write_shapefile_zip(REPORT, ROWS))) as archive:
        assert {Path(n).stem for n in archive.namelist()} == {"Cosecha_pino_enero_2027"}


def test_shapefile_fields_values_and_geometry_round_trip() -> None:
    members = read_zip(write_shapefile_zip(REPORT, ROWS))
    reader = shapefile.Reader(
        shp=io.BytesIO(members[".shp"]),
        shx=io.BytesIO(members[".shx"]),
        dbf=io.BytesIO(members[".dbf"]),
        encoding="utf-8",
    )
    fields = [(f.name, str(f.field_type.value), f.size, f.decimal) for f in reader.fields[1:]]
    assert fields == [(f.name, f.dbf_type, f.size, f.decimals) for f in EXPORT_FIELDS]

    first, second = (record.as_dict() for record in reader.records())
    assert first["OBJECTID"] == 0  # a new piece has no OBJECTID of its own
    assert first["OID_ORIGEN"] == 11
    assert second["OBJECTID"] == 12
    assert first["N_Rodal"] == "17-1"
    assert first["Nom_Predio"] == "Ñuble Alto"
    assert first["CodUso_202"] == LONG_CODE
    assert first["Editada"] == "wb"
    assert (first["EN_INFORME"], second["EN_INFORME"]) == ("si", "no")
    assert first["INFORME"] == "Cosecha pino enero 2027"
    assert (first["TIPO"], first["FECHA"], first["ESTADO"]) == ("Cosecha", "2027-01", "Aprobado")
    assert first["Sup_ha"] == pytest.approx(0.96)

    assert shapely.equals(shape(reader.shape(0).__geo_interface__), HOLED)
    assert shapely.equals(shape(reader.shape(1).__geo_interface__), TWO_PARTS)


def test_export_never_truncates() -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        write_shapefile_zip(REPORT, ROWS)


def test_empty_report_exports_in_every_format() -> None:
    for fmt in ("shp", "gpkg", "csv"):
        content, _, _ = export_report(fmt, REPORT, [])
        assert content


def test_geopackage_layer_srs_and_geometry() -> None:
    content = write_geopackage(REPORT, ROWS)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "x.gpkg"
        path.write_bytes(content)
        connection = sqlite3.connect(path)
        try:
            assert connection.execute("PRAGMA application_id").fetchone()[0] == 0x47504B47
            column = connection.execute(
                "SELECT table_name, column_name, geometry_type_name, srs_id "
                "FROM gpkg_geometry_columns"
            ).fetchone()
            assert column == ("Cosecha_pino_enero_2027", "geom", "MULTIPOLYGON", 32718)
            organization = connection.execute(
                "SELECT organization, organization_coordsys_id FROM gpkg_spatial_ref_sys "
                "WHERE srs_id = 32718"
            ).fetchone()
            assert organization == ("EPSG", 32718)
            blob, rodal, code = connection.execute(
                'SELECT geom, "N_Rodal", "CodUso_202" FROM "Cosecha_pino_enero_2027" ORDER BY fid'
            ).fetchone()
        finally:
            connection.close()
    assert blob[:2] == b"GP"
    assert struct.unpack("<i", blob[4:8])[0] == 32718
    assert shapely.equals(shapely.from_wkb(blob[40:]), MultiPolygon([HOLED]))
    assert (rodal, code) == ("17-1", LONG_CODE)


def test_csv_has_bom_header_and_blank_nulls() -> None:
    content = write_csv(REPORT, ROWS)
    assert content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))
    assert rows[0] == [f.name for f in EXPORT_FIELDS]
    assert len(rows) == 3
    header = rows[0]
    assert rows[1][header.index("N_Rodal_te")] == ""
    assert rows[1][header.index("EN_INFORME")] == "si"
    assert content.count(b"\r\n") == 3


def test_export_report_names_files_and_media_types() -> None:
    assert export_report("shp", REPORT, ROWS)[1:] == (
        "application/zip",
        "Cosecha_pino_enero_2027.zip",
    )
    assert export_report("gpkg", REPORT, ROWS)[1:] == (
        "application/geopackage+sqlite3",
        "Cosecha_pino_enero_2027.gpkg",
    )
    assert export_report("csv", REPORT, ROWS)[1:] == (
        "text/csv; charset=utf-8",
        "Cosecha_pino_enero_2027.csv",
    )


def test_no_email_addresses_in_any_export() -> None:
    # Geometry bytes may contain 0x40 ("@"), so look for the domain instead.
    for fmt in ("shp", "gpkg", "csv"):
        assert b"campodigital.cl" not in export_report(fmt, REPORT, ROWS)[0]
```

- [ ] **Step 3: Run to see them fail**

Run: `uv run --extra api --extra transelec pytest -q apps/api/tests/test_forestry_report_export.py`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.forestry_report_export'`.

- [ ] **Step 4: Implement the writers**

Create `apps/api/app/forestry_report_export.py`:

```python
"""Write a Rodales management report as a shapefile ZIP, a GeoPackage or a CSV.

Pure: the router passes the report header and its rows. Columns are the 14
base fields in the base's order (``CodUso_202`` widened from 10 to 25 so
codes are not cut) followed by the report fields. ``OBJECTID`` is 0 for changed pieces, which have no OBJECTID
of their own; ``OID_ORIGEN`` names the master polygon each row comes from.

The shapefile carries the base's exact ``.prj`` and a ``UTF-8`` ``.cpg``
(ArcMap 10.8 reads it, so accents survive). The GeoPackage is written with
the standard library (GeoPackage 1.3 core tables, EPSG:32718). The CSV is
UTF-8 with BOM, comma separated, CRLF, like the dashboard's CSV.
"""

from __future__ import annotations

import csv
import io
import re
import sqlite3
import struct
import tempfile
import unicodedata
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import shapefile
import shapely
from forestry_ingestion.shapefile_contract import EXPECTED_PRJ_WKT
from shapely.geometry import MultiPolygon
from shapely.geometry.polygon import orient

ExportFormat = Literal["shp", "gpkg", "csv"]


@dataclass(frozen=True, slots=True)
class ExportField:
    name: str
    dbf_type: Literal["C", "N", "F"]
    size: int
    decimals: int


EXPORT_FIELDS: tuple[ExportField, ...] = (
    ExportField("OBJECTID", "N", 10, 0),
    ExportField("Nom_Predio", "C", 50, 0),
    ExportField("N_Rodal", "C", 10, 0),
    ExportField("Sup_ha", "F", 19, 11),
    ExportField("Cod_Uso", "C", 25, 0),
    ExportField("Editada", "C", 2, 0),
    ExportField("Uso2024", "C", 50, 0),
    ExportField("DescUso", "C", 50, 0),
    ExportField("Cod_Predia", "C", 10, 0),
    ExportField("N_Rodal_te", "C", 3, 0),
    ExportField("Uso2026", "C", 50, 0),
    ExportField("CodUso_202", "C", 25, 0),
    ExportField("Shape_Leng", "F", 19, 11),
    ExportField("Shape_Area", "F", 19, 11),
    ExportField("EN_INFORME", "C", 2, 0),
    ExportField("INFORME", "C", 254, 0),
    ExportField("TIPO", "C", 15, 0),
    ExportField("FECHA", "C", 7, 0),
    ExportField("ESTADO", "C", 20, 0),
    ExportField("OID_ORIGEN", "N", 10, 0),
)
# Lineage keys of the 14 base fields, in EXPORT_FIELDS order.
_BASE_KEYS = (
    "objectid",
    "nom_predio",
    "n_rodal",
    "sup_ha",
    "cod_uso",
    "editada",
    "uso_2024",
    "desc_uso",
    "cod_predial",
    "n_rodal_te",
    "uso_2026",
    "cod_uso_2026",
    "shape_leng",
    "shape_area",
)
TYPE_LABELS = {
    "cosecha": "Cosecha",
    "manejo": "Manejo",
    "reforestacion": "Reforestación",
    "plantacion": "Plantación",
    "otro": "Otro",
}
STATUS_LABELS = {
    "borrador": "Borrador",
    "enviado": "Enviado",
    "aprobado": "Aprobado",
    "cambios_solicitados": "Cambios solicitados",
    "archivado": "Archivado",
}

_SRS_ID = 32718
_GPKG_APPLICATION_ID = 0x47504B47  # "GPKG"
_GPKG_USER_VERSION = 10300  # GeoPackage 1.3
_SQL_TYPES = {"C": "TEXT", "N": "INTEGER", "F": "REAL"}
_WGS84_WKT = (
    'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,'
    'AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,'
    'AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,'
    'AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]'
)
_GPKG_CORE_TABLES = """
CREATE TABLE gpkg_spatial_ref_sys (
    srs_name TEXT NOT NULL,
    srs_id INTEGER PRIMARY KEY,
    organization TEXT NOT NULL,
    organization_coordsys_id INTEGER NOT NULL,
    definition TEXT NOT NULL,
    description TEXT
);
CREATE TABLE gpkg_contents (
    table_name TEXT NOT NULL PRIMARY KEY,
    data_type TEXT NOT NULL,
    identifier TEXT UNIQUE,
    description TEXT DEFAULT '',
    last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
    srs_id INTEGER,
    CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id)
);
CREATE TABLE gpkg_geometry_columns (
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    geometry_type_name TEXT NOT NULL,
    srs_id INTEGER NOT NULL,
    z TINYINT NOT NULL,
    m TINYINT NOT NULL,
    CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
    CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents (table_name),
    CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id)
);
"""


@dataclass(frozen=True, slots=True)
class ExportReport:
    name: str
    report_type: str
    report_month: str
    status: str


@dataclass(frozen=True, slots=True)
class ExportRow:
    attributes: Mapping[str, Any]
    geometry: MultiPolygon
    in_report: bool
    geometry_changed: bool


def row_values(report: ExportReport, row: ExportRow) -> list[object]:
    """One row's values in ``EXPORT_FIELDS`` order."""

    base: list[object] = [row.attributes.get(key) for key in _BASE_KEYS]
    source_objectid = row.attributes.get("objectid")
    if row.geometry_changed:
        base[0] = 0
    return [
        *base,
        "si" if row.in_report else "no",
        report.name,
        TYPE_LABELS[report.report_type],
        report.report_month,
        STATUS_LABELS[report.status],
        source_objectid,
    ]


def report_slug(name: str) -> str:
    """ASCII file and layer name: letters, digits and underscores."""

    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^A-Za-z0-9]+", "_", ascii_name).strip("_")
    return slug[:80] or "informe"


def write_shapefile_zip(report: ExportReport, rows: Sequence[ExportRow]) -> bytes:
    shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
    writer = shapefile.Writer(
        shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON, encoding="utf-8"
    )
    for field in EXPORT_FIELDS:
        writer.field(field.name, field.dbf_type, field.size, field.decimals)
    for row in rows:
        writer.record(*row_values(report, row))
        writer.poly(_shapefile_parts(row.geometry))
    writer.close()

    slug = report_slug(report.name)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{slug}.shp", shp.getvalue())
        archive.writestr(f"{slug}.shx", shx.getvalue())
        archive.writestr(f"{slug}.dbf", dbf.getvalue())
        archive.writestr(f"{slug}.prj", EXPECTED_PRJ_WKT)
        archive.writestr(f"{slug}.cpg", "UTF-8")
    return buffer.getvalue()


def write_geopackage(report: ExportReport, rows: Sequence[ExportRow]) -> bytes:
    layer = report_slug(report.name)  # letters, digits, underscores: safe in SQL quotes
    columns = ", ".join(f'"{f.name}" {_SQL_TYPES[f.dbf_type]}' for f in EXPORT_FIELDS)
    names = ", ".join(f'"{f.name}"' for f in EXPORT_FIELDS)
    placeholders = ", ".join("?" for _ in range(len(EXPORT_FIELDS) + 1))
    if rows:
        bounds: tuple[float | None, ...] = tuple(
            shapely.total_bounds([row.geometry for row in rows]).tolist()
        )
    else:
        bounds = (None, None, None, None)

    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "report.gpkg"
        connection = sqlite3.connect(path)
        try:
            connection.execute(f"PRAGMA application_id = {_GPKG_APPLICATION_ID}")
            connection.execute(f"PRAGMA user_version = {_GPKG_USER_VERSION}")
            connection.executescript(_GPKG_CORE_TABLES)
            connection.executemany(
                "INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)",
                [
                    ("Undefined cartesian SRS", -1, "NONE", -1, "undefined", "undefined cartesian"),
                    ("Undefined geographic SRS", 0, "NONE", 0, "undefined", "undefined geographic"),
                    ("WGS 84 geodetic", 4326, "EPSG", 4326, _WGS84_WKT, "WGS 84"),
                    ("WGS 84 / UTM zone 18S", _SRS_ID, "EPSG", _SRS_ID, EXPECTED_PRJ_WKT, "Rodales"),
                ],
            )
            connection.execute(
                f'CREATE TABLE "{layer}" '
                f"(fid INTEGER PRIMARY KEY AUTOINCREMENT, geom MULTIPOLYGON, {columns})"
            )
            connection.execute(
                "INSERT INTO gpkg_contents "
                "(table_name, data_type, identifier, min_x, min_y, max_x, max_y, srs_id) "
                "VALUES (?, 'features', ?, ?, ?, ?, ?, ?)",
                (layer, report.name, *bounds, _SRS_ID),
            )
            connection.execute(
                "INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'MULTIPOLYGON', ?, 0, 0)",
                (layer, _SRS_ID),
            )
            connection.executemany(
                f'INSERT INTO "{layer}" (geom, {names}) VALUES ({placeholders})',
                [(_gpkg_blob(row.geometry), *row_values(report, row)) for row in rows],
            )
            connection.commit()
        finally:
            connection.close()
        return path.read_bytes()


def write_csv(report: ExportReport, rows: Sequence[ExportRow]) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow([field.name for field in EXPORT_FIELDS])
    for row in rows:
        writer.writerow(["" if value is None else value for value in row_values(report, row)])
    return buffer.getvalue().encode("utf-8-sig")


def export_report(
    fmt: ExportFormat, report: ExportReport, rows: Sequence[ExportRow]
) -> tuple[bytes, str, str]:
    """Content, media type and download file name for ``fmt``."""

    slug = report_slug(report.name)
    if fmt == "shp":
        return write_shapefile_zip(report, rows), "application/zip", f"{slug}.zip"
    if fmt == "gpkg":
        return write_geopackage(report, rows), "application/geopackage+sqlite3", f"{slug}.gpkg"
    return write_csv(report, rows), "text/csv; charset=utf-8", f"{slug}.csv"


def _shapefile_parts(geometry: MultiPolygon) -> list[list[list[float]]]:
    """Rings for pyshp: exterior clockwise, holes counter-clockwise (shapefile rule)."""

    parts: list[list[list[float]]] = []
    for polygon in geometry.geoms:
        oriented = orient(polygon, sign=-1.0)
        parts.append([[x, y] for x, y in oriented.exterior.coords])
        parts.extend([[x, y] for x, y in ring.coords] for ring in oriented.interiors)
    return parts


def _gpkg_blob(geometry: MultiPolygon) -> bytes:
    """GeoPackage binary: header (little endian, XY envelope) + WKB."""

    min_x, min_y, max_x, max_y = geometry.bounds
    header = (
        b"GP"
        + bytes([0, 0b0000_0011])
        + struct.pack("<i", _SRS_ID)
        + struct.pack("<4d", min_x, max_x, min_y, max_y)
    )
    return header + shapely.to_wkb(geometry, byte_order=1)
```

- [ ] **Step 5: Run the tests**

Run: `uv run --extra api --extra transelec pytest -q apps/api/tests/test_forestry_report_export.py`
Expected: 10 passed. If `test_shapefile_fields_values_and_geometry_round_trip` fails on the `field_type` comparison, print `reader.fields` once and compare with `str(f.field_type)` or `f.field_type.name` instead (pyshp 3 exposes a `FieldType` enum); do not change `EXPORT_FIELDS`.

- [ ] **Step 6: Lint, types, dependency audit**

Run: `uv run ruff check apps/api && uv run ruff format --check apps/api && uv run mypy apps/api/app/forestry_report_export.py && make dependency-audit`
Expected: clean. If mypy reports `shapefile` has no stubs, add `[[tool.mypy.overrides]] module = ["shapefile"] ignore_missing_imports = true` next to the existing overrides in `pyproject.toml`.

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml uv.lock apps/api/app/forestry_report_export.py apps/api/tests/test_forestry_report_export.py
git commit -m "feat(rodales): export management reports as SHP, GeoPackage and CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Persistence and lifecycle

**Files:**
- Create: `apps/api/app/forestry_reports.py`
- Test: `apps/api/integration_tests/test_forestry_reports.py`

**Interfaces:**
- Consumes: `read_published_snapshot_id(connection) -> int | None` (`app.forestry_publication`); `FeatureInput`, `ReportWarning`, `SourcePolygon`, `resolve_features`, `ReportValidationError` (Task 3).
- Produces:
  - `ReportType`, `ReportStatus`, `TransitionAction = Literal["submit", "approve", "request_changes", "archive"]`, `EDITABLE_STATUSES`
  - `class ReportError(RuntimeError)` with `.code`, `.message`; codes `not_found`, `no_published_base`, `name_taken`, `invalid_name`, `invalid_month`, `not_editable`, `stale_revision`, `invalid_transition`, `nothing_marked`, `note_required`, `note_too_long`, `cannot_delete`
  - `@dataclass Report(id, name, report_type, report_month, status, base_snapshot_id, revision, created_by_app_user_id, created_by_display_name, created_at, updated_at, submitted_at, decided_at, decided_by_display_name, feature_count, managed_feature_count, managed_area_ha)`
  - `@dataclass StoredFeature(position, source_feature_ordinal, in_report, geometry_changed, attributes, geometry: MultiPolygon)`
  - `@dataclass ReportNote(kind, body, author_display_name, created_at)`
  - `@dataclass SaveOutcome(revision: int, feature_count: int, warnings: list[ReportWarning])`
  - `create_report(connection, *, name, report_type, report_month, actor_app_user_id) -> int`
  - `list_reports(connection, *, statuses: Collection[str] | None = None) -> list[Report]`
  - `get_report(connection, report_id) -> Report | None`
  - `list_report_features(connection, report_id) -> list[StoredFeature]`
  - `list_report_sources(connection, report_id) -> list[SourcePolygon]`
  - `load_source_polygons(connection, *, snapshot_id, ordinals: Collection[int]) -> dict[int, SourcePolygon]`
  - `list_report_notes(connection, report_id) -> list[ReportNote]`
  - `save_report_features(connection, *, report_id, expected_revision, inputs: Sequence[FeatureInput]) -> SaveOutcome`
  - `update_report_header(connection, *, report_id, expected_revision, name=None, report_type=None, report_month=None) -> int`
  - `transition_report(connection, *, report_id, action: TransitionAction, expected_revision, actor_app_user_id, note: str | None = None) -> ReportStatus`
  - `duplicate_report(connection, *, report_id, actor_app_user_id) -> int`
  - `delete_report(connection, *, report_id) -> None`

- [ ] **Step 1: Write the failing integration tests**

Create `apps/api/integration_tests/test_forestry_reports.py`:

```python
"""Rodales management reports: storage and lifecycle over PostGIS (synthetic base)."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.forestry_publication import activate_snapshot
from app.forestry_report_geometry import FeatureInput, ReportValidationError
from app.forestry_reports import (
    ReportError,
    create_report,
    delete_report,
    duplicate_report,
    get_report,
    list_report_features,
    list_report_notes,
    list_report_sources,
    list_reports,
    load_source_polygons,
    save_report_features,
    transition_report,
    update_report_header,
)
from sqlalchemy import Connection, text

from test_forestry_ingestion import build_zip, ingest

from forestry_report_fixtures import (
    BASE_GEOMETRIES,
    BASE_ROWS,
    seed_published_base,
    seed_user,
    square_geojson,
)


@pytest.fixture
def ctx(integration_connection: Connection, tmp_path: Path) -> dict[str, int]:
    integration_connection.execute(
        text("UPDATE forestry.publication_state SET published_snapshot_id = NULL")
    )
    snapshot_id = seed_published_base(integration_connection, tmp_path)
    return {
        "snapshot": snapshot_id,
        "operator": seed_user(integration_connection, "operadora"),
        "admin": seed_user(integration_connection, "admin"),
    }


def new_report(connection: Connection, ctx: dict[str, int], name: str = "Cosecha 2027") -> int:
    return create_report(
        connection,
        name=name,
        report_type="cosecha",
        report_month="2027-01",
        actor_app_user_id=ctx["operator"],
    )


def split_rodal_17() -> list[FeatureInput]:
    return [
        FeatureInput(1, True, {"n_rodal": "17-1"}, square_geojson(0, 0, 60, 100)),
        FeatureInput(1, False, {}, square_geojson(60, 0, 40, 100)),
        FeatureInput(2, False, {}, None),
    ]


def code(error: pytest.ExceptionInfo[ReportError]) -> str:
    return error.value.code


def test_create_starts_a_draft_on_the_published_base(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    report = get_report(integration_connection, report_id)
    assert report is not None
    assert (report.status, report.revision, report.base_snapshot_id) == (
        "borrador",
        1,
        ctx["snapshot"],
    )
    assert report.created_by_display_name == "operadora"
    assert (report.feature_count, report.managed_area_ha) == (0, 0.0)


def test_create_needs_a_published_base(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    integration_connection.execute(
        text("UPDATE forestry.publication_state SET published_snapshot_id = NULL")
    )
    with pytest.raises(ReportError) as raised:
        new_report(integration_connection, ctx)
    assert code(raised) == "no_published_base"


@pytest.mark.parametrize(("name", "expected"), [("   ", "invalid_name"), ("x" * 121, "invalid_name")])
def test_create_checks_the_name(
    integration_connection: Connection, ctx: dict[str, int], name: str, expected: str
) -> None:
    with pytest.raises(ReportError) as raised:
        new_report(integration_connection, ctx, name)
    assert code(raised) == expected


def test_create_refuses_a_bad_month(integration_connection: Connection, ctx: dict[str, int]) -> None:
    with pytest.raises(ReportError) as raised:
        create_report(
            integration_connection,
            name="X",
            report_type="cosecha",
            report_month="2027-13",
            actor_app_user_id=ctx["operator"],
        )
    assert code(raised) == "invalid_month"


def test_active_name_must_be_free(integration_connection: Connection, ctx: dict[str, int]) -> None:
    new_report(integration_connection, ctx, "Cosecha")
    with pytest.raises(ReportError) as raised:
        new_report(integration_connection, ctx, "  cosecha ")
    assert code(raised) == "name_taken"


def test_save_stores_pieces_and_bumps_the_revision(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    outcome = save_report_features(
        integration_connection, report_id=report_id, expected_revision=1, inputs=split_rodal_17()
    )
    assert (outcome.revision, outcome.feature_count) == (2, 3)
    features = list_report_features(integration_connection, report_id)
    assert [f.attributes["n_rodal"] for f in features] == ["17-1", "17", "18"]
    assert [f.geometry_changed for f in features] == [True, True, False]
    assert features[0].attributes["sup_ha"] == pytest.approx(0.6)
    assert features[0].attributes["objectid"] == 11
    report = get_report(integration_connection, report_id)
    assert report is not None
    assert (report.managed_feature_count, report.managed_area_ha) == (1, pytest.approx(0.6))
    sources = list_report_sources(integration_connection, report_id)
    assert sorted(s.feature_ordinal for s in sources) == [1, 2]


def test_save_replaces_the_previous_feature_set(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    save_report_features(
        integration_connection, report_id=report_id, expected_revision=1, inputs=split_rodal_17()
    )
    save_report_features(
        integration_connection,
        report_id=report_id,
        expected_revision=2,
        inputs=[FeatureInput(3, True, {}, None)],
    )
    assert [f.source_feature_ordinal for f in list_report_features(integration_connection, report_id)] == [3]


def test_save_with_an_old_revision_is_refused(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    save_report_features(integration_connection, report_id=report_id, expected_revision=1, inputs=[])
    with pytest.raises(ReportError) as raised:
        save_report_features(
            integration_connection, report_id=report_id, expected_revision=1, inputs=[]
        )
    assert code(raised) == "stale_revision"


def test_geometry_rules_apply_on_save(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    with pytest.raises(ReportValidationError) as raised:
        save_report_features(
            integration_connection,
            report_id=report_id,
            expected_revision=1,
            inputs=[FeatureInput(1, True, {}, square_geojson(0, 0, 60, 100))],
        )
    assert raised.value.code == "split_coverage"
    assert list_report_features(integration_connection, report_id) == []


def test_invalid_base_polygon_is_carried_with_a_warning(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    outcome = save_report_features(
        integration_connection,
        report_id=report_id,
        expected_revision=1,
        inputs=[FeatureInput(4, True, {}, None)],
    )
    assert [w.code for w in outcome.warnings] == ["invalid_source_carried"]


def test_polygon_in_another_active_report_warns(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    first = new_report(integration_connection, ctx, "Cosecha")
    second = new_report(integration_connection, ctx, "Reforestación")
    save_report_features(
        integration_connection, report_id=first, expected_revision=1, inputs=[FeatureInput(2, True, {}, None)]
    )
    outcome = save_report_features(
        integration_connection, report_id=second, expected_revision=1, inputs=[FeatureInput(2, True, {}, None)]
    )
    assert [(w.code, w.source_feature_ordinal) for w in outcome.warnings] == [("also_in_other_report", 2)]
    assert "«Cosecha»" in outcome.warnings[0].message


def test_saving_after_a_newer_publish_warns_and_uses_the_report_base(
    integration_connection: Connection, ctx: dict[str, int], tmp_path: Path
) -> None:
    report_id = new_report(integration_connection, ctx)
    newer_rows = [dict(row, uso_2026="CLASE B") for row in BASE_ROWS]
    relative = build_zip(tmp_path, newer_rows, geometries=BASE_GEOMETRIES, zip_name="newer.zip")
    newer = ingest(integration_connection, tmp_path, relative).shapefile_snapshot_id
    assert newer != ctx["snapshot"]
    activate_snapshot(
        integration_connection,
        shapefile_snapshot_id=newer,
        actor_app_user_id=ctx["admin"],
        event_type="publish",
        expected_published_snapshot_id=ctx["snapshot"],
    )
    outcome = save_report_features(
        integration_connection, report_id=report_id, expected_revision=1, inputs=split_rodal_17()
    )
    assert "base_outdated" in [w.code for w in outcome.warnings]
    assert len(list_report_features(integration_connection, report_id)) == 3


def test_full_review_cycle_with_notes(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    save_report_features(
        integration_connection, report_id=report_id, expected_revision=1, inputs=split_rodal_17()
    )
    assert transition_report(
        integration_connection, report_id=report_id, action="submit", expected_revision=2,
        actor_app_user_id=ctx["operator"],
    ) == "enviado"
    assert transition_report(
        integration_connection, report_id=report_id, action="request_changes", expected_revision=3,
        actor_app_user_id=ctx["admin"], note="  Saca el rodal 18.  ",
    ) == "cambios_solicitados"
    save_report_features(
        integration_connection, report_id=report_id, expected_revision=4, inputs=split_rodal_17()[:2]
    )
    transition_report(
        integration_connection, report_id=report_id, action="submit", expected_revision=5,
        actor_app_user_id=ctx["operator"],
    )
    assert transition_report(
        integration_connection, report_id=report_id, action="approve", expected_revision=6,
        actor_app_user_id=ctx["admin"],
    ) == "aprobado"
    report = get_report(integration_connection, report_id)
    assert report is not None
    assert (report.status, report.revision, report.decided_by_display_name) == ("aprobado", 7, "admin")
    assert report.submitted_at is not None and report.decided_at is not None
    notes = list_report_notes(integration_connection, report_id)
    assert [(n.kind, n.body, n.author_display_name) for n in notes] == [
        ("cambios_solicitados", "Saca el rodal 18.", "admin")
    ]


def test_submit_needs_a_marked_polygon(integration_connection: Connection, ctx: dict[str, int]) -> None:
    report_id = new_report(integration_connection, ctx)
    save_report_features(
        integration_connection, report_id=report_id, expected_revision=1,
        inputs=[FeatureInput(2, False, {}, None)],
    )
    with pytest.raises(ReportError) as raised:
        transition_report(
            integration_connection, report_id=report_id, action="submit", expected_revision=2,
            actor_app_user_id=ctx["operator"],
        )
    assert code(raised) == "nothing_marked"


def test_request_changes_needs_a_note(integration_connection: Connection, ctx: dict[str, int]) -> None:
    report_id = submitted_report(integration_connection, ctx)
    for note, expected in ((None, "note_required"), ("   ", "note_required"), ("x" * 2001, "note_too_long")):
        with pytest.raises(ReportError) as raised:
            transition_report(
                integration_connection, report_id=report_id, action="request_changes",
                expected_revision=3, actor_app_user_id=ctx["admin"], note=note,
            )
        assert code(raised) == expected


def test_approve_with_an_old_revision_is_refused(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = submitted_report(integration_connection, ctx)
    with pytest.raises(ReportError) as raised:
        transition_report(
            integration_connection, report_id=report_id, action="approve", expected_revision=2,
            actor_app_user_id=ctx["admin"],
        )
    assert code(raised) == "stale_revision"


def test_approved_report_is_frozen(integration_connection: Connection, ctx: dict[str, int]) -> None:
    report_id = submitted_report(integration_connection, ctx)
    transition_report(
        integration_connection, report_id=report_id, action="approve", expected_revision=3,
        actor_app_user_id=ctx["admin"],
    )
    with pytest.raises(ReportError) as raised:
        save_report_features(integration_connection, report_id=report_id, expected_revision=4, inputs=[])
    assert code(raised) == "not_editable"
    with pytest.raises(ReportError) as raised:
        transition_report(
            integration_connection, report_id=report_id, action="submit", expected_revision=4,
            actor_app_user_id=ctx["operator"],
        )
    assert code(raised) == "invalid_transition"


def test_duplicate_copies_features_into_a_new_draft(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = submitted_report(integration_connection, ctx)
    copy_id = duplicate_report(integration_connection, report_id=report_id, actor_app_user_id=ctx["operator"])
    second_copy = duplicate_report(integration_connection, report_id=report_id, actor_app_user_id=ctx["operator"])
    copy = get_report(integration_connection, copy_id)
    assert copy is not None
    assert (copy.name, copy.status, copy.revision) == ("Cosecha 2027 (copia)", "borrador", 1)
    assert get_report(integration_connection, second_copy).name == "Cosecha 2027 (copia 2)"  # type: ignore[union-attr]
    assert len(list_report_features(integration_connection, copy_id)) == 3


def test_header_update_checks_revision_and_name(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    new_report(integration_connection, ctx, "Otro")
    revision = update_report_header(
        integration_connection, report_id=report_id, expected_revision=1,
        name="Raleo", report_type="manejo", report_month="2026-12",
    )
    report = get_report(integration_connection, report_id)
    assert report is not None
    assert (revision, report.name, report.report_type, report.report_month) == (2, "Raleo", "manejo", "2026-12")
    with pytest.raises(ReportError) as raised:
        update_report_header(integration_connection, report_id=report_id, expected_revision=2, name="otro")
    assert code(raised) == "name_taken"


def test_delete_only_never_submitted_drafts(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    draft = new_report(integration_connection, ctx, "Borrador")
    delete_report(integration_connection, report_id=draft)
    assert get_report(integration_connection, draft) is None
    submitted = submitted_report(integration_connection, ctx)
    with pytest.raises(ReportError) as raised:
        delete_report(integration_connection, report_id=submitted)
    assert code(raised) == "cannot_delete"


def test_list_orders_submitted_first_and_filters(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    draft = new_report(integration_connection, ctx, "Borrador")
    submitted = submitted_report(integration_connection, ctx)
    assert [r.id for r in list_reports(integration_connection)][:1] == [submitted]
    assert [r.id for r in list_reports(integration_connection, statuses=["borrador"])] == [draft]


def test_source_polygons_come_from_the_given_snapshot(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    sources = load_source_polygons(integration_connection, snapshot_id=ctx["snapshot"], ordinals=[1, 4, 99])
    assert sorted(sources) == [1, 4]
    assert sources[4].is_valid is False
    assert sources[1].attributes["n_rodal"] == "17"


def test_missing_report_is_not_found(integration_connection: Connection, ctx: dict[str, int]) -> None:
    assert get_report(integration_connection, 999_999) is None
    with pytest.raises(ReportError) as raised:
        save_report_features(integration_connection, report_id=999_999, expected_revision=1, inputs=[])
    assert code(raised) == "not_found"


def submitted_report(connection: Connection, ctx: dict[str, int]) -> int:
    """A report with the rodal-17 split, submitted (revision 3)."""

    report_id = new_report(connection, ctx)
    save_report_features(connection, report_id=report_id, expected_revision=1, inputs=split_rodal_17())
    transition_report(
        connection, report_id=report_id, action="submit", expected_revision=2,
        actor_app_user_id=ctx["operator"],
    )
    return report_id
```

Note on `test_saving_after_a_newer_publish_warns_and_uses_the_report_base`: the newer base changes one attribute, because ingesting identical content returns the same snapshot (ingestion is idempotent).

- [ ] **Step 2: Run to see them fail**

Run: `POSTGRES_PASSWORD=x uv run --extra api --extra transelec pytest -q apps/api/integration_tests/test_forestry_reports.py`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.forestry_reports'`.

- [ ] **Step 3: Implement the module**

Create `apps/api/app/forestry_reports.py`:

```python
"""Rodales management reports (informes de manejo): storage and lifecycle.

A report is a named, reviewable set of polygon copies taken from one
published base snapshot; it never changes what the dashboard serves. The
geometry rules are ``app.forestry_report_geometry``; this module loads a
report's source polygons, applies those rules, and keeps status, revision
and review notes consistent. Every change bumps ``revision`` and every
change states the revision it expects, so nobody overwrites or approves a
version they did not see.

Authorization is the router's job (``Action.EDIT`` / ``Action.APPROVE``).
"""

from __future__ import annotations

import datetime as dt
import json
import re
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import shapely
from shapely.geometry import MultiPolygon
from sqlalchemy import Connection, text

from app.forestry_publication import read_published_snapshot_id
from app.forestry_report_geometry import (
    FeatureInput,
    ReportWarning,
    SourcePolygon,
    resolve_features,
)

ReportType = Literal["cosecha", "manejo", "reforestacion", "plantacion", "otro"]
ReportStatus = Literal["borrador", "enviado", "aprobado", "cambios_solicitados", "archivado"]
TransitionAction = Literal["submit", "approve", "request_changes", "archive"]

EDITABLE_STATUSES: frozenset[str] = frozenset({"borrador", "cambios_solicitados"})
MAX_NAME_LENGTH = 120
MAX_NOTE_LENGTH = 2000
MONTH_PATTERN = r"^[0-9]{4}-(0[1-9]|1[0-2])$"
_STORAGE_SRID = 32718
_MAX_COPY_SUFFIX = 50

_TRANSITIONS: dict[str, tuple[frozenset[str], ReportStatus]] = {
    "submit": (frozenset({"borrador", "cambios_solicitados"}), "enviado"),
    "approve": (frozenset({"enviado"}), "aprobado"),
    "request_changes": (frozenset({"enviado"}), "cambios_solicitados"),
    "archive": (
        frozenset({"borrador", "enviado", "aprobado", "cambios_solicitados"}),
        "archivado",
    ),
}

REPORT_ERROR_MESSAGES: dict[str, str] = {
    "not_found": "No se encontró el informe.",
    "no_published_base": (
        "Aún no hay una versión publicada de Rodales; publíquela antes de crear informes."
    ),
    "name_taken": "Ya existe un informe con ese nombre.",
    "invalid_name": f"El nombre debe tener entre 1 y {MAX_NAME_LENGTH} caracteres.",
    "invalid_month": "El mes debe tener la forma AAAA-MM, por ejemplo 2027-01.",
    "not_editable": "Este informe ya no se puede editar. Duplíquelo para hacer cambios.",
    "stale_revision": "Otra persona guardó cambios en este informe; recárguelo.",
    "invalid_transition": "Esta acción no aplica al estado actual del informe.",
    "nothing_marked": "Marque al menos un polígono como área de manejo antes de enviar.",
    "note_required": "Escriba qué hay que cambiar.",
    "note_too_long": "La nota no puede superar 2.000 caracteres.",
    "cannot_delete": "Sólo se puede borrar un borrador que nunca se envió; archívelo.",
}
WARNING_MESSAGES: dict[str, str] = {
    "base_outdated": (
        "Este informe se hizo sobre una versión anterior de la base; hay una versión más nueva."
    ),
}


class ReportError(RuntimeError):
    """A report operation that does not apply; ``code`` is stable, ``message`` Spanish."""

    def __init__(self, code: str) -> None:
        super().__init__(REPORT_ERROR_MESSAGES[code])
        self.code = code
        self.message = REPORT_ERROR_MESSAGES[code]


@dataclass(frozen=True, slots=True)
class Report:
    id: int
    name: str
    report_type: str
    report_month: str
    status: str
    base_snapshot_id: int
    revision: int
    created_by_app_user_id: int
    created_by_display_name: str
    created_at: dt.datetime
    updated_at: dt.datetime
    submitted_at: dt.datetime | None
    decided_at: dt.datetime | None
    decided_by_display_name: str | None
    feature_count: int
    managed_feature_count: int
    managed_area_ha: float


@dataclass(frozen=True, slots=True)
class StoredFeature:
    position: int
    source_feature_ordinal: int
    in_report: bool
    geometry_changed: bool
    attributes: dict[str, Any]
    geometry: MultiPolygon


@dataclass(frozen=True, slots=True)
class ReportNote:
    kind: str
    body: str
    author_display_name: str
    created_at: dt.datetime


@dataclass(frozen=True, slots=True)
class SaveOutcome:
    revision: int
    feature_count: int
    warnings: list[ReportWarning]


@dataclass(frozen=True, slots=True)
class _Locked:
    status: str
    revision: int
    base_snapshot_id: int
    submitted_at: dt.datetime | None


_REPORT_SELECT = """
SELECT
    r.id, r.name, r.report_type, r.report_month, r.status, r.base_snapshot_id, r.revision,
    r.created_by_app_user_id, creator.display_name AS created_by_display_name,
    r.created_at, r.updated_at, r.submitted_at, r.decided_at,
    decider.display_name AS decided_by_display_name,
    count(f.id) AS feature_count,
    count(f.id) FILTER (WHERE f.in_report) AS managed_feature_count,
    COALESCE(sum((f.attributes ->> 'sup_ha')::float8) FILTER (WHERE f.in_report), 0)
        AS managed_area_ha
FROM forestry.report r
JOIN platform.app_user creator ON creator.id = r.created_by_app_user_id
LEFT JOIN platform.app_user decider ON decider.id = r.decided_by_app_user_id
LEFT JOIN forestry.report_feature f ON f.report_id = r.id
"""
_REPORT_GROUP = " GROUP BY r.id, creator.display_name, decider.display_name"


def _report(row: Any) -> Report:
    return Report(
        id=row.id,
        name=row.name,
        report_type=row.report_type,
        report_month=row.report_month,
        status=row.status,
        base_snapshot_id=row.base_snapshot_id,
        revision=row.revision,
        created_by_app_user_id=row.created_by_app_user_id,
        created_by_display_name=row.created_by_display_name,
        created_at=row.created_at,
        updated_at=row.updated_at,
        submitted_at=row.submitted_at,
        decided_at=row.decided_at,
        decided_by_display_name=row.decided_by_display_name,
        feature_count=int(row.feature_count),
        managed_feature_count=int(row.managed_feature_count),
        managed_area_ha=float(row.managed_area_ha),
    )


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def list_reports(connection: Connection, *, statuses: Collection[str] | None = None) -> list[Report]:
    """Reports, submitted ones first, then most recently changed."""

    where = " WHERE r.status = ANY(:statuses)" if statuses is not None else ""
    rows = connection.execute(
        text(
            _REPORT_SELECT
            + where
            + _REPORT_GROUP
            + " ORDER BY (r.status = 'enviado') DESC, r.updated_at DESC, r.id DESC"
        ),
        {"statuses": list(statuses)} if statuses is not None else {},
    )
    return [_report(row) for row in rows]


def get_report(connection: Connection, report_id: int) -> Report | None:
    row = connection.execute(
        text(_REPORT_SELECT + " WHERE r.id = :id" + _REPORT_GROUP), {"id": report_id}
    ).one_or_none()
    return None if row is None else _report(row)


def list_report_features(connection: Connection, report_id: int) -> list[StoredFeature]:
    rows = connection.execute(
        text(
            """
            SELECT position, source_feature_ordinal, in_report, geometry_changed, attributes,
                   ST_AsBinary(geometry) AS wkb
            FROM forestry.report_feature
            WHERE report_id = :id
            ORDER BY position
            """
        ),
        {"id": report_id},
    )
    return [
        StoredFeature(
            position=row.position,
            source_feature_ordinal=row.source_feature_ordinal,
            in_report=row.in_report,
            geometry_changed=row.geometry_changed,
            attributes=dict(row.attributes),
            geometry=shapely.from_wkb(bytes(row.wkb)),
        )
        for row in rows
    ]


def load_source_polygons(
    connection: Connection, *, snapshot_id: int, ordinals: Collection[int]
) -> dict[int, SourcePolygon]:
    """Polygons of ``snapshot_id`` by feature ordinal (missing ordinals are absent)."""

    if not ordinals:
        return {}
    rows = connection.execute(
        text(
            """
            SELECT feature_ordinal, source_attributes, geometry_is_valid,
                   ST_AsBinary(geometry) AS wkb
            FROM forestry.source_feature
            WHERE shapefile_snapshot_id = :snapshot_id AND feature_ordinal = ANY(:ordinals)
            """
        ),
        {"snapshot_id": snapshot_id, "ordinals": sorted(set(ordinals))},
    )
    return {
        row.feature_ordinal: SourcePolygon(
            feature_ordinal=row.feature_ordinal,
            attributes=dict(row.source_attributes),
            geometry=shapely.from_wkb(bytes(row.wkb)),
            is_valid=row.geometry_is_valid,
        )
        for row in rows
    }


def list_report_sources(connection: Connection, report_id: int) -> list[SourcePolygon]:
    """The base polygons a report refers to (for the review overlay)."""

    report = get_report(connection, report_id)
    if report is None:
        return []
    ordinals = connection.execute(
        text(
            "SELECT DISTINCT source_feature_ordinal FROM forestry.report_feature "
            "WHERE report_id = :id"
        ),
        {"id": report_id},
    ).scalars()
    sources = load_source_polygons(
        connection, snapshot_id=report.base_snapshot_id, ordinals=list(ordinals)
    )
    return [sources[ordinal] for ordinal in sorted(sources)]


def list_report_notes(connection: Connection, report_id: int) -> list[ReportNote]:
    rows = connection.execute(
        text(
            """
            SELECT n.kind, n.body, u.display_name AS author_display_name, n.created_at
            FROM forestry.report_note n
            JOIN platform.app_user u ON u.id = n.author_app_user_id
            WHERE n.report_id = :id
            ORDER BY n.created_at, n.id
            """
        ),
        {"id": report_id},
    )
    return [
        ReportNote(row.kind, row.body, row.author_display_name, row.created_at) for row in rows
    ]


# ---------------------------------------------------------------------------
# Writes (inside the caller's transaction)
# ---------------------------------------------------------------------------


def create_report(
    connection: Connection,
    *,
    name: str,
    report_type: str,
    report_month: str,
    actor_app_user_id: int,
) -> int:
    clean = _clean_name(name)
    _check_month(report_month)
    base = read_published_snapshot_id(connection)
    if base is None:
        raise ReportError("no_published_base")
    _ensure_name_free(connection, clean)
    return int(
        connection.execute(
            text(
                """
                INSERT INTO forestry.report
                    (name, report_type, report_month, base_snapshot_id, created_by_app_user_id)
                VALUES (:name, :report_type, :report_month, :base, :actor)
                RETURNING id
                """
            ),
            {
                "name": clean,
                "report_type": report_type,
                "report_month": report_month,
                "base": base,
                "actor": actor_app_user_id,
            },
        ).scalar_one()
    )


def save_report_features(
    connection: Connection,
    *,
    report_id: int,
    expected_revision: int,
    inputs: Sequence[FeatureInput],
) -> SaveOutcome:
    """Replace the report's features; raise ``ReportError`` / ``ReportValidationError``."""

    locked = _lock(connection, report_id)
    if locked.status not in EDITABLE_STATUSES:
        raise ReportError("not_editable")
    if locked.revision != expected_revision:
        raise ReportError("stale_revision")

    sources = load_source_polygons(
        connection,
        snapshot_id=locked.base_snapshot_id,
        ordinals={item.source_feature_ordinal for item in inputs},
    )
    resolution = resolve_features(inputs, sources)

    connection.execute(
        text("DELETE FROM forestry.report_feature WHERE report_id = :id"), {"id": report_id}
    )
    if resolution.features:
        connection.execute(
            text(
                """
                INSERT INTO forestry.report_feature (
                    report_id, position, source_feature_ordinal, in_report, geometry_changed,
                    attributes, geometry
                )
                VALUES (
                    :report_id, :position, :ordinal, :in_report, :changed,
                    CAST(:attributes AS jsonb), ST_GeomFromWKB(:wkb, :srid)
                )
                """
            ),
            [
                {
                    "report_id": report_id,
                    "position": feature.position,
                    "ordinal": feature.source_feature_ordinal,
                    "in_report": feature.in_report,
                    "changed": feature.geometry_changed,
                    "attributes": json.dumps(feature.attributes, ensure_ascii=False),
                    "wkb": shapely.to_wkb(feature.geometry),
                    "srid": _STORAGE_SRID,
                }
                for feature in resolution.features
            ],
        )
    revision = _bump(connection, report_id)

    warnings = list(resolution.warnings)
    if read_published_snapshot_id(connection) != locked.base_snapshot_id:
        warnings.append(ReportWarning("base_outdated", WARNING_MESSAGES["base_outdated"]))
    warnings.extend(_shared_source_warnings(connection, report_id, locked.base_snapshot_id))
    return SaveOutcome(revision, len(resolution.features), warnings)


def update_report_header(
    connection: Connection,
    *,
    report_id: int,
    expected_revision: int,
    name: str | None = None,
    report_type: str | None = None,
    report_month: str | None = None,
) -> int:
    locked = _lock(connection, report_id)
    if locked.status not in EDITABLE_STATUSES:
        raise ReportError("not_editable")
    if locked.revision != expected_revision:
        raise ReportError("stale_revision")
    clean = None if name is None else _clean_name(name)
    if clean is not None:
        _ensure_name_free(connection, clean, except_id=report_id)
    if report_month is not None:
        _check_month(report_month)
    connection.execute(
        text(
            """
            UPDATE forestry.report
            SET name = COALESCE(:name, name),
                report_type = COALESCE(:report_type, report_type),
                report_month = COALESCE(:report_month, report_month)
            WHERE id = :id
            """
        ),
        {"name": clean, "report_type": report_type, "report_month": report_month, "id": report_id},
    )
    return _bump(connection, report_id)


def transition_report(
    connection: Connection,
    *,
    report_id: int,
    action: TransitionAction,
    expected_revision: int,
    actor_app_user_id: int,
    note: str | None = None,
) -> ReportStatus:
    locked = _lock(connection, report_id)
    allowed_from, target = _TRANSITIONS[action]
    if locked.status not in allowed_from:
        raise ReportError("invalid_transition")
    if locked.revision != expected_revision:
        raise ReportError("stale_revision")
    body = (note or "").strip()
    if len(body) > MAX_NOTE_LENGTH:
        raise ReportError("note_too_long")
    if action == "request_changes" and not body:
        raise ReportError("note_required")
    if action == "submit":
        marked = connection.execute(
            text(
                "SELECT count(*) FROM forestry.report_feature WHERE report_id = :id AND in_report"
            ),
            {"id": report_id},
        ).scalar_one()
        if marked == 0:
            raise ReportError("nothing_marked")

    decides = action in ("approve", "request_changes")
    connection.execute(
        text(
            """
            UPDATE forestry.report
            SET status = :target,
                submitted_at = CASE WHEN :submits THEN now() ELSE submitted_at END,
                decided_at = CASE WHEN :decides THEN now() ELSE decided_at END,
                decided_by_app_user_id = CASE
                    WHEN :decides THEN CAST(:actor AS bigint) ELSE decided_by_app_user_id
                END
            WHERE id = :id
            """
        ),
        {
            "target": target,
            "submits": action == "submit",
            "decides": decides,
            "actor": actor_app_user_id,
            "id": report_id,
        },
    )
    if action == "request_changes" or (action == "approve" and body):
        connection.execute(
            text(
                "INSERT INTO forestry.report_note (report_id, kind, body, author_app_user_id) "
                "VALUES (:id, :kind, :body, :actor)"
            ),
            {
                "id": report_id,
                "kind": "cambios_solicitados" if action == "request_changes" else "aprobado",
                "body": body,
                "actor": actor_app_user_id,
            },
        )
    _bump(connection, report_id)
    return target


def duplicate_report(connection: Connection, *, report_id: int, actor_app_user_id: int) -> int:
    source = get_report(connection, report_id)
    if source is None:
        raise ReportError("not_found")
    name = _free_copy_name(connection, source.name)
    new_id = int(
        connection.execute(
            text(
                """
                INSERT INTO forestry.report
                    (name, report_type, report_month, base_snapshot_id, created_by_app_user_id)
                SELECT :name, report_type, report_month, base_snapshot_id, :actor
                FROM forestry.report WHERE id = :id
                RETURNING id
                """
            ),
            {"name": name, "actor": actor_app_user_id, "id": report_id},
        ).scalar_one()
    )
    connection.execute(
        text(
            """
            INSERT INTO forestry.report_feature (
                report_id, position, source_feature_ordinal, in_report, geometry_changed,
                attributes, geometry
            )
            SELECT :new_id, position, source_feature_ordinal, in_report, geometry_changed,
                   attributes, geometry
            FROM forestry.report_feature WHERE report_id = :id
            """
        ),
        {"new_id": new_id, "id": report_id},
    )
    return new_id


def delete_report(connection: Connection, *, report_id: int) -> None:
    locked = _lock(connection, report_id)
    if locked.status != "borrador" or locked.submitted_at is not None:
        raise ReportError("cannot_delete")
    connection.execute(text("DELETE FROM forestry.report WHERE id = :id"), {"id": report_id})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _lock(connection: Connection, report_id: int) -> _Locked:
    row = connection.execute(
        text(
            "SELECT status, revision, base_snapshot_id, submitted_at "
            "FROM forestry.report WHERE id = :id FOR UPDATE"
        ),
        {"id": report_id},
    ).one_or_none()
    if row is None:
        raise ReportError("not_found")
    return _Locked(row.status, row.revision, row.base_snapshot_id, row.submitted_at)


def _bump(connection: Connection, report_id: int) -> int:
    return int(
        connection.execute(
            text(
                "UPDATE forestry.report SET revision = revision + 1, updated_at = now() "
                "WHERE id = :id RETURNING revision"
            ),
            {"id": report_id},
        ).scalar_one()
    )


def _clean_name(name: str) -> str:
    clean = name.strip()
    if not clean or len(clean) > MAX_NAME_LENGTH:
        raise ReportError("invalid_name")
    return clean


def _check_month(report_month: str) -> None:
    if not re.fullmatch(MONTH_PATTERN, report_month):
        raise ReportError("invalid_month")


def _name_in_use(connection: Connection, name: str, *, except_id: int | None = None) -> bool:
    return (
        connection.execute(
            text(
                """
                SELECT 1 FROM forestry.report
                WHERE lower(name) = lower(:name) AND status <> 'archivado'
                  AND (CAST(:except_id AS bigint) IS NULL OR id <> CAST(:except_id AS bigint))
                LIMIT 1
                """
            ),
            {"name": name, "except_id": except_id},
        ).scalar_one_or_none()
        is not None
    )


def _ensure_name_free(connection: Connection, name: str, *, except_id: int | None = None) -> None:
    if _name_in_use(connection, name, except_id=except_id):
        raise ReportError("name_taken")


def _free_copy_name(connection: Connection, name: str) -> str:
    for number in range(1, _MAX_COPY_SUFFIX + 1):
        suffix = " (copia)" if number == 1 else f" (copia {number})"
        candidate = name[: MAX_NAME_LENGTH - len(suffix)] + suffix
        if not _name_in_use(connection, candidate):
            return candidate
    raise ReportError("name_taken")


def _shared_source_warnings(
    connection: Connection, report_id: int, base_snapshot_id: int
) -> list[ReportWarning]:
    rows = connection.execute(
        text(
            """
            SELECT DISTINCT f.source_feature_ordinal, r.name
            FROM forestry.report_feature f
            JOIN forestry.report r ON r.id = f.report_id
            WHERE r.id <> :id
              AND r.status <> 'archivado'
              AND r.base_snapshot_id = :base
              AND f.source_feature_ordinal IN (
                  SELECT source_feature_ordinal FROM forestry.report_feature WHERE report_id = :id
              )
            ORDER BY f.source_feature_ordinal, r.name
            """
        ),
        {"id": report_id, "base": base_snapshot_id},
    )
    return [
        ReportWarning(
            "also_in_other_report",
            f"Este polígono también está en «{row.name}».",
            row.source_feature_ordinal,
        )
        for row in rows
    ]
```

- [ ] **Step 4: Run the tests**

Run: `POSTGRES_PASSWORD=x uv run --extra api --extra transelec pytest -q apps/api/integration_tests/test_forestry_reports.py`
Expected: 24 passed.

- [ ] **Step 5: Lint and types**

Run: `uv run ruff check apps/api && uv run ruff format --check apps/api && uv run mypy apps/api/app`
Expected: clean (`uv run ruff format` the new files first if listed).

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/forestry_reports.py apps/api/integration_tests/test_forestry_reports.py
git commit -m "feat(rodales): store management reports with review lifecycle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: HTTP routes

**Files:**
- Create: `apps/api/app/routers/forestry_reports.py`
- Modify: `apps/api/app/main.py` (imports near line 46; `UPLOAD_BODY_LIMITS`; `include_router` after `forestry_workflow_router`)
- Test: `apps/api/integration_tests/test_forestry_reports_router.py`

**Interfaces:**
- Consumes: everything from Tasks 2–5; `require_forestry_grant(action)` from `app.routers.forestry_workflow`; `require_forestry_viewer`, `ViewerRole`, `ReadConnection`, `FORESTRY_PRODUCT_KEY` from `app.routers.forestry`; `record_audit_event`; `require_csrf`; `get_current_app_user`; `get_database_engine`.
- Produces: routes under `/api/forestry/reports`; constants `REPORT_FEATURES_PATH = "/api/forestry/reports/features"`, `REPORT_FEATURES_MAX_BYTES = 8 * 1024 * 1024`. Error bodies: `{"detail": {"code": str, "message": str, "source_feature_ordinal"?: int}}`.

- [ ] **Step 1: Write the failing router tests**

Create `apps/api/integration_tests/test_forestry_reports_router.py`:

```python
"""Rodales management reports over HTTP: roles, CSRF, the review flow and exports."""

from __future__ import annotations

import io
import zipfile
from collections.abc import Generator
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
import shapefile
from app.access import Role
from app.access_repository import grant_product_role, resolve_or_create_app_user
from app.csrf import CSRF_HEADER_NAME
from app.deps import SESSION_COOKIE_NAME
from app.forestry_report_geometry import MESSAGES
from app.main import app
from app.session_store import PlatformSessionStore
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import Engine, text

from forestry_report_fixtures import seed_published_base, square_geojson

_sessions = PlatformSessionStore()
_ORIGIN = {"Origin": "http://testserver"}


@pytest.fixture
def client(integration_engine: Engine) -> Generator[TestClient, None, None]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _isolated_tables(integration_engine: Engine) -> Generator[None, None, None]:
    yield
    with integration_engine.begin() as connection:
        connection.execute(text("UPDATE forestry.publication_state SET published_snapshot_id = NULL"))
        for table in (
            "forestry.report_note",
            "forestry.report_feature",
            "forestry.report",
            "forestry.publication_event",
            "forestry.snapshot_upload",
            "forestry.source_feature",
            "forestry.shapefile_snapshot",
            "platform.source_observation",
            "platform.source_snapshot",
            "platform.source_asset",
            "platform.source_system",
            "platform.audit_event",
            "platform.security_event",
            "platform.session",
            "platform.product_grant",
            "platform.app_user",
        ):
            connection.execute(text(f"DELETE FROM {table}"))


@pytest.fixture
def base(integration_engine: Engine, tmp_path: Path) -> int:
    with integration_engine.begin() as connection:
        return seed_published_base(connection, tmp_path)


def sign_in(client: TestClient, engine: Engine, name: str, role: Role | None) -> None:
    with engine.begin() as connection:
        user = resolve_or_create_app_user(
            connection,
            identity_kind="google",
            identity_key=f"sub-{name}",
            display_name=name,
            email=f"{name}@campodigital.cl",
        )
        if role is not None:
            grant_product_role(connection, app_user_id=user.id, product_key="forestry", role=role)
        secret = _sessions.create_session(connection, app_user_id=user.id, ttl=timedelta(hours=1))
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, secret)
    client.headers.pop(CSRF_HEADER_NAME, None)
    token = client.get("/api/auth/csrf")
    assert token.status_code == 200, token.text
    client.headers[CSRF_HEADER_NAME] = token.json()["csrf_token"]


def create(client: TestClient, name: str = "Cosecha pino enero 2027") -> int:
    response = client.post(
        "/api/forestry/reports",
        json={"name": name, "report_type": "cosecha", "report_month": "2027-01"},
        headers=_ORIGIN,
    )
    assert response.status_code == 201, response.text
    return int(response.json()["report_id"])


SPLIT: list[dict[str, Any]] = [
    {"source_feature_ordinal": 1, "in_report": True, "attributes": {"n_rodal": "17-1"},
     "geometry": square_geojson(0, 0, 60, 100)},
    {"source_feature_ordinal": 1, "in_report": False, "geometry": square_geojson(60, 0, 40, 100)},
    {"source_feature_ordinal": 2, "in_report": False, "geometry": None},
]


def save(client: TestClient, report_id: int, revision: int, features: list[dict[str, Any]]) -> Response:
    return client.put(
        "/api/forestry/reports/features",
        json={"report_id": report_id, "revision": revision, "features": features},
        headers=_ORIGIN,
    )


def act(client: TestClient, report_id: int, action: str, revision: int, note: str | None = None) -> Response:
    return client.post(
        f"/api/forestry/reports/{report_id}/{action}",
        json={"revision": revision, "note": note},
        headers=_ORIGIN,
    )


def audit_types(engine: Engine) -> list[str]:
    with engine.connect() as connection:
        return list(
            connection.execute(
                text("SELECT event_type FROM platform.audit_event ORDER BY id")
            ).scalars()
        )


def test_full_flow_from_draft_to_approved_export(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    saved = save(client, report_id, 1, SPLIT)
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 2
    assert act(client, report_id, "submit", 2).status_code == 200

    sign_in(client, integration_engine, "javier", Role.ADMIN)
    listing = client.get("/api/forestry/reports").json()
    assert listing["pending_review_count"] == 1
    detail = client.get(f"/api/forestry/reports/{report_id}").json()
    assert detail["report"]["status"] == "enviado"
    assert detail["srid"] == 32718
    assert [f["attributes"]["n_rodal"] for f in detail["features"]] == ["17-1", "17", "18"]
    assert sorted(s["source_feature_ordinal"] for s in detail["sources"]) == [1, 2]
    changes = act(client, report_id, "request-changes", 3, "Saca el rodal 18.")
    assert changes.status_code == 200, changes.text

    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    assert save(client, report_id, 4, SPLIT[:2]).status_code == 200
    assert act(client, report_id, "submit", 5).status_code == 200

    sign_in(client, integration_engine, "javier", Role.ADMIN)
    approved = act(client, report_id, "approve", 6)
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "aprobado"

    sign_in(client, integration_engine, "dueno", Role.VIEWER)
    assert [r["report_id"] for r in client.get("/api/forestry/reports").json()["reports"]] == [report_id]
    exported = client.get(f"/api/forestry/reports/{report_id}/export?format=shp")
    assert exported.status_code == 200
    assert exported.headers["content-type"] == "application/zip"
    assert 'filename="Cosecha_pino_enero_2027.zip"' in exported.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        reader = shapefile.Reader(
            shp=io.BytesIO(archive.read("Cosecha_pino_enero_2027.shp")),
            shx=io.BytesIO(archive.read("Cosecha_pino_enero_2027.shx")),
            dbf=io.BytesIO(archive.read("Cosecha_pino_enero_2027.dbf")),
            encoding="utf-8",
        )
        records = [record.as_dict() for record in reader.records()]
    assert [(r["N_Rodal"], r["EN_INFORME"], r["ESTADO"]) for r in records] == [
        ("17-1", "si", "Aprobado"),
        ("17", "no", "Aprobado"),
    ]

    assert audit_types(integration_engine) == [
        "forestry.report.created",
        "forestry.report.saved",
        "forestry.report.submitted",
        "forestry.report.changes_requested",
        "forestry.report.saved",
        "forestry.report.submitted",
        "forestry.report.approved",
        "forestry.report.exported",
    ]


def test_viewer_cannot_see_or_export_a_draft(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    sign_in(client, integration_engine, "dueno", Role.VIEWER)
    assert client.get("/api/forestry/reports").json()["reports"] == []
    assert client.get(f"/api/forestry/reports/{report_id}").status_code == 404
    assert client.get(f"/api/forestry/reports/{report_id}/export?format=csv").status_code == 404


def test_viewer_cannot_create_and_operator_cannot_approve(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "dueno", Role.VIEWER)
    refused = client.post(
        "/api/forestry/reports",
        json={"name": "X", "report_type": "cosecha", "report_month": "2027-01"},
        headers=_ORIGIN,
    )
    assert refused.status_code == 403
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    save(client, report_id, 1, SPLIT)
    act(client, report_id, "submit", 2)
    assert act(client, report_id, "approve", 3).status_code == 403
    assert act(client, report_id, "archive", 3).status_code == 403


def test_no_grant_and_no_session(client: TestClient, integration_engine: Engine, base: int) -> None:
    client.cookies.clear()
    assert client.get("/api/forestry/reports").status_code == 401
    sign_in(client, integration_engine, "otro", None)
    assert client.get("/api/forestry/reports").status_code == 403


def test_writes_need_csrf(client: TestClient, integration_engine: Engine, base: int) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    client.headers.pop(CSRF_HEADER_NAME)
    response = client.post(
        "/api/forestry/reports",
        json={"name": "X", "report_type": "cosecha", "report_month": "2027-01"},
        headers=_ORIGIN,
    )
    assert response.status_code == 403


def test_validation_errors_carry_a_code_and_the_polygon(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    response = save(client, report_id, 1, SPLIT[:1])
    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "split_coverage",
        "message": MESSAGES["split_coverage"],
        "source_feature_ordinal": 1,
    }


def test_stale_revision_is_a_conflict(client: TestClient, integration_engine: Engine, base: int) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    assert save(client, report_id, 1, []).status_code == 200
    stale = save(client, report_id, 1, [])
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "stale_revision"


def test_warnings_are_returned_on_save(client: TestClient, integration_engine: Engine, base: int) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    response = save(client, report_id, 1, [{"source_feature_ordinal": 4, "in_report": True, "geometry": None}])
    assert response.status_code == 200
    assert [w["code"] for w in response.json()["warnings"]] == ["invalid_source_carried"]


def test_source_polygons_in_utm_for_the_editor(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    response = client.get(f"/api/forestry/reports/{report_id}/source-polygons?ordinals=1,3")
    assert response.status_code == 200
    polygons = response.json()["sources"]
    assert [p["source_feature_ordinal"] for p in polygons] == [1, 3]
    exterior = polygons[0]["geometry"]["coordinates"][0][0]  # MultiPolygon -> polygon -> ring
    assert max(point[0] for point in exterior) == 100.0  # metres, not degrees


def test_patch_duplicate_archive_and_delete(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    patched = client.patch(
        f"/api/forestry/reports/{report_id}", json={"revision": 1, "name": "Raleo"}, headers=_ORIGIN
    )
    assert patched.status_code == 200 and patched.json()["revision"] == 2
    copy = client.post(f"/api/forestry/reports/{report_id}/duplicate", headers=_ORIGIN)
    assert copy.status_code == 201
    copy_id = copy.json()["report_id"]
    assert client.delete(f"/api/forestry/reports/{copy_id}", headers=_ORIGIN).status_code == 204
    save(client, report_id, 2, SPLIT)
    act(client, report_id, "submit", 3)
    refused = client.delete(f"/api/forestry/reports/{report_id}", headers=_ORIGIN)
    assert refused.status_code == 409
    sign_in(client, integration_engine, "javier", Role.ADMIN)
    assert act(client, report_id, "archive", 4).json()["status"] == "archivado"


def test_gpkg_and_csv_exports_and_marked_scope(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    save(client, report_id, 1, SPLIT)
    gpkg = client.get(f"/api/forestry/reports/{report_id}/export?format=gpkg")
    assert gpkg.status_code == 200 and gpkg.content[:16] == b"SQLite format 3\x00"
    marked = client.get(f"/api/forestry/reports/{report_id}/export?format=csv&scope=marked")
    lines = marked.content.decode("utf-8-sig").strip().split("\r\n")
    assert len(lines) == 2  # header + the one marked piece


def test_audit_and_exports_carry_no_email(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    save(client, report_id, 1, SPLIT)
    for fmt in ("shp", "gpkg", "csv"):
        content = client.get(f"/api/forestry/reports/{report_id}/export?format={fmt}").content
        assert b"campodigital.cl" not in content  # geometry bytes may contain 0x40
    with integration_engine.connect() as connection:
        metadata = connection.execute(text("SELECT metadata::text FROM platform.audit_event")).scalars().all()
    assert all("@" not in value for value in metadata)


def test_save_body_over_the_limit_is_refused(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    response = client.put(
        "/api/forestry/reports/features",
        content=b"{" + b" " * (8 * 1024 * 1024 + 1) + b"}",
        headers={**_ORIGIN, "Content-Type": "application/json"},
    )
    assert response.status_code == 413
```

- [ ] **Step 2: Run to see them fail**

Run: `POSTGRES_PASSWORD=x uv run --extra api --extra transelec pytest -q apps/api/integration_tests/test_forestry_reports_router.py`
Expected: FAIL — every request answers `404` (no such routes) and `test_full_flow...` fails on `create`'s `assert response.status_code == 201`.

- [ ] **Step 3: Implement the router**

Create `apps/api/app/routers/forestry_reports.py`:

```python
"""Rodales management reports (informes de manejo) over HTTP.

All routes sit under ``/api/forestry/reports`` behind ``require_forestry_viewer``
(a session plus a ``forestry`` grant). Writes need CSRF and:

- ``Action.EDIT`` (operator, admin): create, save features, rename, submit,
  duplicate, delete a never-submitted draft;
- ``Action.APPROVE`` (admin): approve, request changes, archive.

Viewers see approved reports only; any other report answers ``404`` to them,
so a draft's existence is not disclosed. Errors carry a stable ``code`` and
a Spanish ``message``. Geometry travels as GeoJSON in EPSG:32718 metres.

The save route is a fixed path (``PUT /features``, report id in the body)
so the body-limit middleware can raise its bound and refuse it without a
live session before reading it (``app.main``).
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from pydantic import BaseModel, Field
from shapely.geometry import mapping
from sqlalchemy import Engine

from app.access import Action, can
from app.access_repository import AppUser
from app.audit import record_audit_event
from app.csrf import require_csrf
from app.database import get_database_engine
from app.deps import get_current_app_user
from app.forestry_publication import read_published_snapshot_id
from app.forestry_report_export import ExportFormat, ExportReport, ExportRow, export_report
from app.forestry_report_geometry import (
    MAX_FEATURES,
    FeatureInput,
    ReportValidationError,
    ReportWarning,
)
from app.forestry_reports import (
    MONTH_PATTERN,
    Report,
    ReportError,
    ReportStatus,
    ReportType,
    TransitionAction,
    create_report,
    delete_report,
    duplicate_report,
    get_report,
    list_report_features,
    list_report_notes,
    list_report_sources,
    list_reports,
    load_source_polygons,
    save_report_features,
    transition_report,
    update_report_header,
)
from app.routers.forestry import (
    FORESTRY_PRODUCT_KEY,
    ReadConnection,
    ViewerRole,
    require_forestry_viewer,
)
from app.routers.forestry_workflow import require_forestry_grant

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/forestry/reports",
    tags=["forestry"],
    dependencies=[Depends(require_forestry_viewer)],
)

REPORT_FEATURES_PATH = "/api/forestry/reports/features"
# A 500-polygon report with detailed outlines stays well under this.
REPORT_FEATURES_MAX_BYTES = 8 * 1024 * 1024
_SRID = 32718

ReportIdPath = Annotated[int, Path(ge=1)]
CurrentUser = Annotated[AppUser, Depends(get_current_app_user)]
DatabaseEngine = Annotated[Engine, Depends(get_database_engine)]
_EDIT = [Depends(require_csrf), Depends(require_forestry_grant(Action.EDIT))]
_APPROVE = [Depends(require_csrf), Depends(require_forestry_grant(Action.APPROVE))]

_STATUS_FOR_CODE = {
    "not_found": 404,
    "no_published_base": 409,
    "name_taken": 409,
    "invalid_name": 422,
    "invalid_month": 422,
    "not_editable": 409,
    "stale_revision": 409,
    "invalid_transition": 409,
    "nothing_marked": 422,
    "note_required": 422,
    "note_too_long": 422,
    "cannot_delete": 409,
}
_AUDIT_FOR_ACTION: dict[str, str] = {
    "submit": "forestry.report.submitted",
    "approve": "forestry.report.approved",
    "request_changes": "forestry.report.changes_requested",
    "archive": "forestry.report.archived",
}


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ReportModel(BaseModel):
    report_id: int
    name: str
    report_type: str
    report_month: str
    status: str
    base_snapshot_id: int
    revision: int
    created_by_display_name: str
    created_at: dt.datetime
    updated_at: dt.datetime
    submitted_at: dt.datetime | None
    decided_at: dt.datetime | None
    decided_by_display_name: str | None
    feature_count: int
    managed_feature_count: int
    managed_area_ha: float


class ReportListResponse(BaseModel):
    reports: list[ReportModel]
    pending_review_count: int


class FeatureModel(BaseModel):
    position: int
    source_feature_ordinal: int
    in_report: bool
    geometry_changed: bool
    attributes: dict[str, Any]
    geometry: dict[str, Any]


class SourceModel(BaseModel):
    source_feature_ordinal: int
    attributes: dict[str, Any]
    geometry: dict[str, Any]
    is_valid: bool


class NoteModel(BaseModel):
    kind: str
    body: str
    author_display_name: str
    created_at: dt.datetime


class ReportDetailResponse(BaseModel):
    report: ReportModel
    features: list[FeatureModel]
    sources: list[SourceModel]
    notes: list[NoteModel]
    srid: int
    published_snapshot_id: int | None


class SourcePolygonsResponse(BaseModel):
    sources: list[SourceModel]
    srid: int


class CreateReportRequest(BaseModel):
    name: str = Field(max_length=500)
    report_type: ReportType
    report_month: str = Field(pattern=MONTH_PATTERN)


class UpdateReportRequest(BaseModel):
    revision: int = Field(ge=1)
    name: str | None = Field(default=None, max_length=500)
    report_type: ReportType | None = None
    report_month: str | None = Field(default=None, pattern=MONTH_PATTERN)


class FeatureInputModel(BaseModel):
    source_feature_ordinal: int = Field(ge=1)
    in_report: bool = False
    attributes: dict[str, Any] = Field(default_factory=dict)
    geometry: dict[str, Any] | None = None


class SaveFeaturesRequest(BaseModel):
    report_id: int = Field(ge=1)
    revision: int = Field(ge=1)
    features: list[FeatureInputModel]


class WarningModel(BaseModel):
    code: str
    message: str
    source_feature_ordinal: int | None


class SaveFeaturesResponse(BaseModel):
    revision: int
    feature_count: int
    warnings: list[WarningModel]


class TransitionRequest(BaseModel):
    revision: int = Field(ge=1)
    note: str | None = Field(default=None, max_length=10_000)


class StatusResponse(BaseModel):
    report_id: int
    status: str
    revision: int


class CreatedResponse(BaseModel):
    report_id: int


def _report_model(report: Report) -> ReportModel:
    return ReportModel(
        report_id=report.id,
        name=report.name,
        report_type=report.report_type,
        report_month=report.report_month,
        status=report.status,
        base_snapshot_id=report.base_snapshot_id,
        revision=report.revision,
        created_by_display_name=report.created_by_display_name,
        created_at=report.created_at,
        updated_at=report.updated_at,
        submitted_at=report.submitted_at,
        decided_at=report.decided_at,
        decided_by_display_name=report.decided_by_display_name,
        feature_count=report.feature_count,
        managed_feature_count=report.managed_feature_count,
        managed_area_ha=report.managed_area_ha,
    )


def _warning_model(warning: ReportWarning) -> WarningModel:
    return WarningModel(
        code=warning.code,
        message=warning.message,
        source_feature_ordinal=warning.source_feature_ordinal,
    )


def _http_error(error: ReportError | ReportValidationError) -> HTTPException:
    detail: dict[str, Any] = {"code": error.code, "message": error.message}
    if isinstance(error, ReportValidationError):
        if error.source_feature_ordinal is not None:
            detail["source_feature_ordinal"] = error.source_feature_ordinal
        return HTTPException(status_code=422, detail=detail)
    return HTTPException(status_code=_STATUS_FOR_CODE[error.code], detail=detail)


def _visible_report(connection: ReadConnection, role: ViewerRole, report_id: int) -> Report:
    report = get_report(connection, report_id)
    if report is None or (not can(role, Action.EDIT) and report.status != "aprobado"):
        raise _http_error(ReportError("not_found"))
    return report


def _audit(
    engine: Engine, user: AppUser, event_type: str, report_id: int, metadata: dict[str, object]
) -> None:
    with engine.begin() as connection:
        record_audit_event(
            connection,
            actor_app_user_id=user.id,
            event_type=event_type,
            product_key=FORESTRY_PRODUCT_KEY,
            subject_kind="forestry_report",
            subject_id=str(report_id),
            metadata=metadata,
        )


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


@router.get("", response_model=ReportListResponse)
def get_reports(
    connection: ReadConnection,
    role: ViewerRole,
    status: ReportStatus | None = None,
    report_type: ReportType | None = None,
) -> ReportListResponse:
    """«Informes»: the list; viewers get approved reports only."""

    reports = list_reports(connection, statuses=None if can(role, Action.EDIT) else ["aprobado"])
    pending = sum(1 for r in reports if r.status == "enviado") if can(role, Action.APPROVE) else 0
    if status is not None:
        reports = [r for r in reports if r.status == status]
    if report_type is not None:
        reports = [r for r in reports if r.report_type == report_type]
    return ReportListResponse(
        reports=[_report_model(r) for r in reports], pending_review_count=pending
    )


@router.get("/{report_id}", response_model=ReportDetailResponse)
def get_report_detail(
    report_id: ReportIdPath, connection: ReadConnection, role: ViewerRole
) -> ReportDetailResponse:
    report = _visible_report(connection, role, report_id)
    return ReportDetailResponse(
        report=_report_model(report),
        features=[
            FeatureModel(
                position=f.position,
                source_feature_ordinal=f.source_feature_ordinal,
                in_report=f.in_report,
                geometry_changed=f.geometry_changed,
                attributes=f.attributes,
                geometry=dict(mapping(f.geometry)),
            )
            for f in list_report_features(connection, report_id)
        ],
        sources=[
            SourceModel(
                source_feature_ordinal=s.feature_ordinal,
                attributes=dict(s.attributes),
                geometry=dict(mapping(s.geometry)),
                is_valid=s.is_valid,
            )
            for s in list_report_sources(connection, report_id)
        ],
        notes=[
            NoteModel(
                kind=n.kind, body=n.body, author_display_name=n.author_display_name,
                created_at=n.created_at,
            )
            for n in list_report_notes(connection, report_id)
        ],
        srid=_SRID,
        published_snapshot_id=read_published_snapshot_id(connection),
    )


@router.get(
    "/{report_id}/source-polygons",
    response_model=SourcePolygonsResponse,
    dependencies=[Depends(require_forestry_grant(Action.EDIT))],
)
def get_source_polygons(
    report_id: ReportIdPath,
    connection: ReadConnection,
    ordinals: Annotated[str, Query(pattern=r"^[0-9]+(,[0-9]+)*$", max_length=5000)],
) -> SourcePolygonsResponse:
    """Base polygons in UTM for the editor to split (the report's own base)."""

    report = get_report(connection, report_id)
    if report is None:
        raise _http_error(ReportError("not_found"))
    wanted = sorted({int(value) for value in ordinals.split(",")})[:MAX_FEATURES]
    sources = load_source_polygons(connection, snapshot_id=report.base_snapshot_id, ordinals=wanted)
    return SourcePolygonsResponse(
        sources=[
            SourceModel(
                source_feature_ordinal=s.feature_ordinal,
                attributes=dict(s.attributes),
                geometry=dict(mapping(s.geometry)),
                is_valid=s.is_valid,
            )
            for s in (sources[o] for o in sorted(sources))
        ],
        srid=_SRID,
    )


@router.get("/{report_id}/export")
def export_report_file(
    report_id: ReportIdPath,
    connection: ReadConnection,
    role: ViewerRole,
    user: CurrentUser,
    engine: DatabaseEngine,
    format: ExportFormat = "shp",  # noqa: A002 - the query parameter's public name
    scope: Literal["all", "marked"] = "all",
) -> Response:
    report = _visible_report(connection, role, report_id)
    rows = [
        ExportRow(f.attributes, f.geometry, f.in_report, f.geometry_changed)
        for f in list_report_features(connection, report_id)
        if scope == "all" or f.in_report
    ]
    content, media_type, filename = export_report(
        format,
        ExportReport(report.name, report.report_type, report.report_month, report.status),
        rows,
    )
    _audit(engine, user, "forestry.report.exported", report_id,
           {"format": format, "scope": scope, "row_count": len(rows)})
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


@router.post("", response_model=CreatedResponse, status_code=201, dependencies=_EDIT)
def post_report(request: CreateReportRequest, user: CurrentUser, engine: DatabaseEngine) -> CreatedResponse:
    """«Nuevo informe» against the published base."""

    try:
        with engine.begin() as connection:
            report_id = create_report(
                connection,
                name=request.name,
                report_type=request.report_type,
                report_month=request.report_month,
                actor_app_user_id=user.id,
            )
            record_audit_event(
                connection,
                actor_app_user_id=user.id,
                event_type="forestry.report.created",
                product_key=FORESTRY_PRODUCT_KEY,
                subject_kind="forestry_report",
                subject_id=str(report_id),
                metadata={"report_type": request.report_type},
            )
    except ReportError as error:
        raise _http_error(error) from error
    return CreatedResponse(report_id=report_id)


@router.put("/features", response_model=SaveFeaturesResponse, dependencies=_EDIT)
def put_report_features(
    request: SaveFeaturesRequest, user: CurrentUser, engine: DatabaseEngine
) -> SaveFeaturesResponse:
    """«Guardar»: replace the report's features (checked against its base)."""

    inputs = [
        FeatureInput(f.source_feature_ordinal, f.in_report, f.attributes, f.geometry)
        for f in request.features
    ]
    try:
        with engine.begin() as connection:
            outcome = save_report_features(
                connection,
                report_id=request.report_id,
                expected_revision=request.revision,
                inputs=inputs,
            )
            record_audit_event(
                connection,
                actor_app_user_id=user.id,
                event_type="forestry.report.saved",
                product_key=FORESTRY_PRODUCT_KEY,
                subject_kind="forestry_report",
                subject_id=str(request.report_id),
                metadata={
                    "revision": outcome.revision,
                    "feature_count": outcome.feature_count,
                    "warning_codes": sorted({w.code for w in outcome.warnings}),
                },
            )
    except (ReportError, ReportValidationError) as error:
        raise _http_error(error) from error
    return SaveFeaturesResponse(
        revision=outcome.revision,
        feature_count=outcome.feature_count,
        warnings=[_warning_model(w) for w in outcome.warnings],
    )


@router.patch("/{report_id}", response_model=StatusResponse, dependencies=_EDIT)
def patch_report(
    report_id: ReportIdPath, request: UpdateReportRequest, user: CurrentUser, engine: DatabaseEngine
) -> StatusResponse:
    try:
        with engine.begin() as connection:
            revision = update_report_header(
                connection,
                report_id=report_id,
                expected_revision=request.revision,
                name=request.name,
                report_type=request.report_type,
                report_month=request.report_month,
            )
            record_audit_event(
                connection,
                actor_app_user_id=user.id,
                event_type="forestry.report.saved",
                product_key=FORESTRY_PRODUCT_KEY,
                subject_kind="forestry_report",
                subject_id=str(report_id),
                metadata={"revision": revision, "header": True},
            )
            current = get_report(connection, report_id)
    except ReportError as error:
        raise _http_error(error) from error
    status = current.status if current is not None else "borrador"
    return StatusResponse(report_id=report_id, status=status, revision=revision)


def _transition(
    report_id: int, request: TransitionRequest, user: AppUser, engine: Engine, action: TransitionAction
) -> StatusResponse:
    try:
        with engine.begin() as connection:
            status = transition_report(
                connection,
                report_id=report_id,
                action=action,
                expected_revision=request.revision,
                actor_app_user_id=user.id,
                note=request.note,
            )
            record_audit_event(
                connection,
                actor_app_user_id=user.id,
                event_type=_AUDIT_FOR_ACTION[action],
                product_key=FORESTRY_PRODUCT_KEY,
                subject_kind="forestry_report",
                subject_id=str(report_id),
                metadata={"revision": request.revision + 1},
            )
    except ReportError as error:
        raise _http_error(error) from error
    return StatusResponse(report_id=report_id, status=status, revision=request.revision + 1)


@router.post("/{report_id}/submit", response_model=StatusResponse, dependencies=_EDIT)
def submit_report(
    report_id: ReportIdPath, request: TransitionRequest, user: CurrentUser, engine: DatabaseEngine
) -> StatusResponse:
    """«Enviar a revisión»."""

    return _transition(report_id, request, user, engine, "submit")


@router.post("/{report_id}/approve", response_model=StatusResponse, dependencies=_APPROVE)
def approve_report(
    report_id: ReportIdPath, request: TransitionRequest, user: CurrentUser, engine: DatabaseEngine
) -> StatusResponse:
    """«Aprobar»."""

    return _transition(report_id, request, user, engine, "approve")


@router.post("/{report_id}/request-changes", response_model=StatusResponse, dependencies=_APPROVE)
def request_report_changes(
    report_id: ReportIdPath, request: TransitionRequest, user: CurrentUser, engine: DatabaseEngine
) -> StatusResponse:
    """«Pedir cambios» (note required)."""

    return _transition(report_id, request, user, engine, "request_changes")


@router.post("/{report_id}/archive", response_model=StatusResponse, dependencies=_APPROVE)
def archive_report(
    report_id: ReportIdPath, request: TransitionRequest, user: CurrentUser, engine: DatabaseEngine
) -> StatusResponse:
    return _transition(report_id, request, user, engine, "archive")


@router.post(
    "/{report_id}/duplicate", response_model=CreatedResponse, status_code=201, dependencies=_EDIT
)
def duplicate(report_id: ReportIdPath, user: CurrentUser, engine: DatabaseEngine) -> CreatedResponse:
    """«Duplicar como borrador»."""

    try:
        with engine.begin() as connection:
            new_id = duplicate_report(connection, report_id=report_id, actor_app_user_id=user.id)
            record_audit_event(
                connection,
                actor_app_user_id=user.id,
                event_type="forestry.report.duplicated",
                product_key=FORESTRY_PRODUCT_KEY,
                subject_kind="forestry_report",
                subject_id=str(new_id),
                metadata={"from_report_id": report_id},
            )
    except ReportError as error:
        raise _http_error(error) from error
    return CreatedResponse(report_id=new_id)


@router.delete("/{report_id}", status_code=204, dependencies=_EDIT)
def delete(report_id: ReportIdPath, user: CurrentUser, engine: DatabaseEngine) -> Response:
    try:
        with engine.begin() as connection:
            delete_report(connection, report_id=report_id)
            record_audit_event(
                connection,
                actor_app_user_id=user.id,
                event_type="forestry.report.deleted",
                product_key=FORESTRY_PRODUCT_KEY,
                subject_kind="forestry_report",
                subject_id=str(report_id),
                metadata={},
            )
    except ReportError as error:
        raise _http_error(error) from error
    return Response(status_code=204)
```

- [ ] **Step 4: Wire it into `main.py`**

In `apps/api/app/main.py`, next to the forestry workflow imports (around line 46):

```python
from app.routers.forestry_reports import REPORT_FEATURES_MAX_BYTES, REPORT_FEATURES_PATH
from app.routers.forestry_reports import router as forestry_reports_router
```

Add to `UPLOAD_BODY_LIMITS`:

```python
    REPORT_FEATURES_PATH: REPORT_FEATURES_MAX_BYTES,
```

And after `app.include_router(forestry_workflow_router)`:

```python
app.include_router(forestry_reports_router)
```

- [ ] **Step 5: Run the router tests and the existing forestry/main tests**

Run: `POSTGRES_PASSWORD=x uv run --extra api --extra transelec pytest -q apps/api/integration_tests/test_forestry_reports_router.py`
Expected: 13 passed.
Run: `uv run --extra api --extra transelec pytest -q apps/api/tests/test_main_forestry_gate.py apps/api/tests/test_forestry_route_access.py`
Expected: PASS. If `test_forestry_route_access.py` enumerates every `/api/forestry` route and fails on the new ones, add the new routes to its table with the roles above (viewer for the three GETs; operator for EDIT routes; admin for APPROVE routes).

- [ ] **Step 6: Lint, types, full suites**

Run: `uv run ruff check apps/api && uv run ruff format --check apps/api && uv run mypy apps/api/app`
Run: `uv run --extra api --extra transelec pytest -q` (unit, no DB env) and `POSTGRES_PASSWORD=x make persistence-check` (integration).
Expected: all clean and green; report any failure by name.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/routers/forestry_reports.py apps/api/app/main.py apps/api/integration_tests/test_forestry_reports_router.py
git commit -m "feat(rodales): management report API (/api/forestry/reports)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Consola labels and the technical record

**Files:**
- Modify: `scripts/consola/index.html` (the `ACTIONS` map)
- Create: `products/forestry/docs/management-reports-v1.md`
- Modify: navigation files touched by `python scripts/update_doc_nav.py`

**Interfaces:**
- Consumes: audit event types from Task 6.

- [ ] **Step 1: Add the Consola labels**

In `scripts/consola/index.html`, replace `"publish": "publicó", "restore": "restauró"` (the last entries of `ACTIONS`) with:

```js
"publish": "publicó", "restore": "restauró",
  "forestry.report.created": "creó un informe de Rodales", "forestry.report.saved": "guardó un informe",
  "forestry.report.submitted": "envió un informe a revisión", "forestry.report.approved": "aprobó un informe",
  "forestry.report.changes_requested": "pidió cambios en un informe",
  "forestry.report.duplicated": "duplicó un informe", "forestry.report.archived": "archivó un informe",
  "forestry.report.deleted": "borró un borrador", "forestry.report.exported": "exportó un informe"
```


Run: `uv run pytest -q tests/scripts/test_consola.py`
Expected: PASS.

- [ ] **Step 2: Write the technical record**

Create `products/forestry/docs/management-reports-v1.md` with these sections, in English, following `docs/DOCUMENTATION_POLICY.md` labels:

```markdown
# Rodales management reports V1 (API)

Status: **API implemented (stage 1)**; screens are stage 2.
Design: [spec](../../../docs/superpowers/specs/2026-10-16-rodales-informes-de-manejo-design.md).

## What it is
- DECISION: a report is a named, reviewable set of polygon copies from one published base snapshot; it never changes the base. The MASTER stays in ArcMap.

## Data
Tables `forestry.report`, `forestry.report_note`, `forestry.report_feature` (migration 0014). Identity of a copied polygon: `source_feature_ordinal` in the report's base snapshot.

## Rules on save
(table of codes from `app.forestry_report_geometry.MESSAGES` and `app.forestry_reports.REPORT_ERROR_MESSAGES`, with HTTP status)

## Lifecycle and roles
borrador → enviado → aprobado / cambios_solicitados → archivado; EDIT (operator, admin), APPROVE (admin). Viewers see approved reports only; other reports answer 404.

## Export
Columns, widths, `OBJECTID = 0` for changed pieces, `OID_ORIGEN`, `.prj`/`.cpg`, GeoPackage 1.3, CSV format.

## Limitations
- LIMITATION: displayed piece areas are rounded to two decimals and may not add up exactly to the original.
- DECISION: changed rows get `Editada = wb` (2 characters, like `mv`).
- LIMITATION: Shapely and PostGIS share GEOS but are separate builds; a geometry accepted here is stored without a second PostGIS check.

## Open questions
- OPEN QUESTION: meaning of `N_Rodal_te`; pieces copy the root's value.
- OPEN QUESTION: Plan de Manejo request format (may add report fields).
- OPEN QUESTION: whether gerencia needs an approver role.
```

Fill the "Rules on save" table and "Export" section with the exact codes, messages, statuses and columns from the code written in Tasks 3–6 (copy them; do not paraphrase codes).

- [ ] **Step 3: Navigation and links**

Run: `uv run python scripts/update_doc_nav.py && uv run python scripts/check_doc_links.py && make docs-check`
Expected: navigation updated, "Documentation links OK".

- [ ] **Step 4: Final checks**

Run: `make check` (format-check, lint, typecheck, architecture-check, test, docs-check) and `POSTGRES_PASSWORD=x make persistence-check`.
Expected: all green. Report any failure by name with its output.

- [ ] **Step 5: Commit**

```bash
git add scripts/consola/index.html products/forestry/docs/management-reports-v1.md docs products/forestry/docs
git commit -m "docs(rodales): management reports V1 record; Consola labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

- **Spec coverage:** data model (Task 1, with rulings 1–3), lifecycle and notes (Task 5), geometry rules and codes (Task 3), areas, codes, `editada` (Task 3), export (Task 4), API table (Task 6, save path per ruling 5, source polygons per ruling 8), roles (Task 2 + 6), audit events and Consola (Tasks 6–7), privacy (Tasks 4 and 6), testing list (all tasks). Screens are stage 2 by design.
- **Deferred to stage 2:** rodal-suffix suggestion (`17-1`), the change list wording, «Mostrar base original», the empty-state guidance — all client-side over this API.
- **Type consistency:** `FeatureInput(source_feature_ordinal, in_report, attributes, geometry)` is used identically in Tasks 3, 5 and 6; `ReportWarning(code, message, source_feature_ordinal)` in Tasks 3, 5, 6; `ReportError.code/.message` in Tasks 5–6.
