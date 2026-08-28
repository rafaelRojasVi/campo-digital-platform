from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest
import xlsxwriter

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.main import app  # noqa: E402
from app.routers.transelec import get_workbook_path  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from transelec_ingestion.xlsx_contract import (  # noqa: E402
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


def _write_workbook(path: Path, *, rows: list[list[Any]]) -> None:
    workbook = xlsxwriter.Workbook(path)
    worksheet = workbook.add_worksheet("Resumen")

    for column, header in enumerate(EXPECTED_RESUMEN_HEADERS):
        worksheet.write(0, column, header)

    for row_index, row in enumerate(rows, start=1):
        for column, value in enumerate(row):
            if value is not None:
                worksheet.write(row_index, column, value)

    workbook.close()


@pytest.fixture
def workbook_path(tmp_path: Path) -> Path:
    path = tmp_path / "transelec.xlsx"
    _write_workbook(
        path,
        rows=[
            _source_row(),
            _source_row(
                pmf="MP002",
                id_predio_unico="MP002-456-2",
                sector="Norte",
                empresa="Empresa B",
                estado_resumido="Aprobado",
            ),
        ],
    )
    return path


@pytest.fixture
def client(workbook_path: Path):
    app.dependency_overrides[get_workbook_path] = lambda: workbook_path

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


def test_summary_returns_kpi_numbers(client: TestClient) -> None:
    response = client.get("/transelec/summary")

    assert response.status_code == 200

    body = response.json()
    assert body["business_rows"] == 2
    assert body["distinct_pmf"] == 2
    assert body["distinct_provisional_predio_ids"] == 2


def test_filters_returns_distinct_values(client: TestClient) -> None:
    response = client.get("/transelec/filters")

    assert response.status_code == 200

    body = response.json()
    assert body["sectors"] == ["Norte", "Sur"]
    assert body["empresas"] == ["Empresa A", "Empresa B"]


def test_list_pmfs_returns_all_by_default(client: TestClient) -> None:
    response = client.get("/transelec/pmfs")

    assert response.status_code == 200
    assert [item["pmf"] for item in response.json()] == ["MP001", "MP002"]


def test_list_pmfs_filters_by_query_params(client: TestClient) -> None:
    response = client.get("/transelec/pmfs", params={"sector": "Norte"})

    assert response.status_code == 200
    assert [item["pmf"] for item in response.json()] == ["MP002"]


def test_get_pmf_detail_returns_predios(client: TestClient) -> None:
    response = client.get("/transelec/pmfs/MP001")

    assert response.status_code == 200

    body = response.json()
    assert body["pmf"] == "MP001"
    assert len(body["predios"]) == 1
    assert body["predios"][0]["provisional_predio_id"] == "MP001-123-1"


def test_get_pmf_detail_returns_404_for_unknown_pmf(client: TestClient) -> None:
    response = client.get("/transelec/pmfs/DOES-NOT-EXIST")

    assert response.status_code == 404


def test_endpoints_return_503_when_source_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CAMPO_TRANSELEC_WORKBOOK_PATH", raising=False)

    with TestClient(app) as test_client:
        response = test_client.get("/transelec/summary")

    assert response.status_code == 503


def test_max_workbook_bytes_defaults_to_64_mib() -> None:
    from app.transelec_snapshots import DEFAULT_MAX_WORKBOOK_BYTES, get_max_workbook_bytes

    assert DEFAULT_MAX_WORKBOOK_BYTES == 64 * 1024 * 1024
    assert get_max_workbook_bytes() == 64 * 1024 * 1024


def test_max_workbook_bytes_is_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.transelec_snapshots import get_max_workbook_bytes

    monkeypatch.setenv("CAMPO_TRANSELEC_MAX_UPLOAD_BYTES", "1024")

    assert get_max_workbook_bytes() == 1024


def test_endpoints_return_503_when_workbook_is_invalid(tmp_path: Path) -> None:
    missing_path = tmp_path / "does-not-exist.xlsx"
    app.dependency_overrides[get_workbook_path] = lambda: missing_path

    try:
        with TestClient(app) as test_client:
            response = test_client.get("/transelec/summary")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
