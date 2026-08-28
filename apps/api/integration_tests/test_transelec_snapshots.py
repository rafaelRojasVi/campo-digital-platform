"""Real PostgreSQL coverage for hosted Transelec workbook snapshots."""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import xlsxwriter
from app.transelec_snapshots import (
    SYSTEM_KEY,
    activate_workbook_snapshot,
    get_active_workbook_snapshot,
    list_workbook_snapshots,
    persist_validated_workbook,
    validate_workbook_upload,
)
from sqlalchemy import Engine, text

from transelec_ingestion.xlsx_contract import (
    EXPECTED_RESUMEN_HEADERS,
    RESUMEN_COLUMNS,
)


def _source_row(**overrides: Any) -> list[Any]:
    values: dict[str, Any] = {field_name: None for _, field_name in RESUMEN_COLUMNS}
    values.update(
        {
            "pmf": "MP001",
            "estado": "En revisión",
            "estado_resumido": "En tramite",
            "id_predio_unico": "MP001-123-1",
            "numero_area_corta": "1",
            "superficie_corta": 1.5,
            "sector": "Sur",
            "empresa": "Empresa A",
            "rol": "ROL-1",
        }
    )
    values.update(overrides)
    return [values[field_name] for _, field_name in RESUMEN_COLUMNS]


def _workbook_bytes(*, pmf: str, surface: float) -> bytes:
    with TemporaryDirectory(prefix="transelec-integration-") as directory:
        path = Path(directory) / "PlanillaMaestra.xlsx"
        workbook = xlsxwriter.Workbook(path)
        worksheet = workbook.add_worksheet("Resumen")

        for column, header in enumerate(EXPECTED_RESUMEN_HEADERS):
            worksheet.write(0, column, header)

        row = _source_row(
            pmf=pmf,
            id_predio_unico=f"{pmf}-123-1",
            superficie_corta=surface,
        )

        for column, value in enumerate(row):
            if value is not None:
                worksheet.write(1, column, value)

        workbook.close()
        return path.read_bytes()


def _clear_test_snapshots(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE platform.transelec_dashboard_state
                SET active_source_snapshot_id = NULL
                WHERE id = 1
                """
            )
        )
        connection.execute(text("DELETE FROM platform.transelec_workbook_snapshot"))
        connection.execute(
            text(
                """
                DELETE FROM platform.source_observation
                WHERE source_snapshot_id IN (
                    SELECT snapshot.id
                    FROM platform.source_snapshot AS snapshot
                    JOIN platform.source_asset AS asset
                      ON asset.id = snapshot.source_asset_id
                    JOIN platform.source_system AS system
                      ON system.id = asset.source_system_id
                    WHERE system.system_key = :system_key
                )
                """
            ),
            {"system_key": SYSTEM_KEY},
        )
        connection.execute(
            text(
                """
                DELETE FROM platform.source_snapshot
                WHERE source_asset_id IN (
                    SELECT asset.id
                    FROM platform.source_asset AS asset
                    JOIN platform.source_system AS system
                      ON system.id = asset.source_system_id
                    WHERE system.system_key = :system_key
                )
                """
            ),
            {"system_key": SYSTEM_KEY},
        )
        connection.execute(
            text(
                """
                DELETE FROM platform.source_asset
                WHERE source_system_id IN (
                    SELECT id
                    FROM platform.source_system
                    WHERE system_key = :system_key
                )
                """
            ),
            {"system_key": SYSTEM_KEY},
        )
        connection.execute(
            text(
                """
                DELETE FROM platform.source_system
                WHERE system_key = :system_key
                """
            ),
            {"system_key": SYSTEM_KEY},
        )


def test_publish_deduplicate_history_and_restore(
    integration_engine: Engine,
) -> None:
    _clear_test_snapshots(integration_engine)

    first_bytes = _workbook_bytes(pmf="MP001", surface=1.5)
    second_bytes = _workbook_bytes(pmf="MP002", surface=2.5)

    first_upload = validate_workbook_upload(
        first_bytes,
        filename="PlanillaMaestra.xlsx",
        media_type=("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    )
    second_upload = validate_workbook_upload(
        second_bytes,
        filename="PlanillaMaestra.xlsx",
    )

    try:
        first = persist_validated_workbook(
            integration_engine,
            first_upload,
        )
        assert not first.duplicate
        assert first.snapshot.active
        assert first.snapshot.distinct_pmf == 1

        second = persist_validated_workbook(
            integration_engine,
            second_upload,
        )
        assert not second.duplicate
        assert second.snapshot.active

        duplicate_first = persist_validated_workbook(
            integration_engine,
            first_upload,
        )
        assert duplicate_first.duplicate
        assert duplicate_first.snapshot.source_snapshot_id == (first.snapshot.source_snapshot_id)

        active = get_active_workbook_snapshot(integration_engine)
        assert active is not None
        assert active.snapshot.source_snapshot_id == (second.snapshot.source_snapshot_id)
        assert active.content == second_bytes

        history = list_workbook_snapshots(integration_engine)
        assert len(history) == 2
        assert sum(snapshot.active for snapshot in history) == 1

        restored = activate_workbook_snapshot(
            integration_engine,
            first.snapshot.source_snapshot_id,
        )
        assert restored is not None
        assert restored.active

        active_after_restore = get_active_workbook_snapshot(integration_engine)
        assert active_after_restore is not None
        assert active_after_restore.snapshot.source_snapshot_id == (
            first.snapshot.source_snapshot_id
        )
        assert active_after_restore.content == first_bytes
    finally:
        _clear_test_snapshots(integration_engine)
