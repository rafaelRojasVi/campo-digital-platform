"""Reading CONAF's public consulta page (synthetic pages; no network)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from urllib.error import URLError

import pytest
from app.conaf import (
    MAX_BYTES,
    ConafClient,
    normalize_solicitud,
    parse_conaf_page,
    public_url,
)

HEADER = (
    "<tr><th>Solicitud</th><th>Tipo de Solicitud</th><th>Superficie</th>"
    "<th>Fecha de Ingreso</th><th>Estado</th><th>Fecha de Resoluci&oacute;n</th></tr>"
)


def page(*rows: tuple[str, ...]) -> bytes:
    body = "".join("<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "\n</tr>" for row in rows)
    html = (
        "<html><body><h3>Consulta estado de solicitudes</h3>"
        f"<table class='tabla'>{HEADER}{body}</table>"
        "<button>Volver</button></body></html>"
    )
    return html.encode("iso-8859-1")


FOUND = page(
    (
        "090663",
        "PLAN DE MANEJO  PLAN DE MANEJO",
        "3",
        "16/04/1996",
        "P.M. APROBADA NO VIGENTE",
        "11/06/1996",
    )
)
NOT_FOUND = (
    "<html><body><p>ATENCI\xd3N</p><p>La solicitud indicada no existe.</p></body></html>"
).encode("iso-8859-1")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("090663", "090663"),
        (" 90663 ", "090663"),
        ("123456789", "123456789"),
        ("1", "000001"),
        ("12/34-5/26", None),
        ("MP002-202-5", None),
        ("1234567890", None),
        ("", None),
        (None, None),
        ("１２３", None),  # full-width digits are not ASCII
    ],
)
def test_normalize_solicitud(raw: str | None, expected: str | None) -> None:
    assert normalize_solicitud(raw) == expected


def test_public_url_sends_the_padded_number() -> None:
    assert public_url("090663") == (
        "https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=090663"
    )


def test_found_page_is_parsed() -> None:
    result = parse_conaf_page("090663", FOUND)
    assert result.status == "found"
    assert result.tipo == "PLAN DE MANEJO PLAN DE MANEJO"
    assert result.superficie_ha == Decimal("3")
    assert result.fecha_ingreso == date(1996, 4, 16)
    assert result.estado == "P.M. APROBADA NO VIGENTE"
    assert result.fecha_resolucion == date(1996, 6, 11)


def test_leading_dot_superficie_and_accents() -> None:
    body = page(("000001", "BONIFICACI\xd3N FORESTACI\xd3N", ".3", "17/07/1998", "APROBADA", ""))
    result = parse_conaf_page("000001", body)
    assert result.tipo == "BONIFICACIÓN FORESTACIÓN"
    assert result.superficie_ha == Decimal("0.3")
    assert result.fecha_resolucion is None


def test_not_found_page() -> None:
    assert parse_conaf_page("999999", NOT_FOUND).status == "not_found"


def test_returned_number_must_match() -> None:
    body = page(("069025", "CTAPF APF PRE LEY 19561", "2", "26/07/1985", "APROBADA", "07/08/1985"))
    result = parse_conaf_page("090663", body)
    assert result.status == "mismatch"
    assert result.returned_solicitud == "069025"
    assert result.estado is None


def test_unknown_page_shape_is_unavailable() -> None:
    assert parse_conaf_page("090663", b"<html><body>Mantenimiento</body></html>").status == (
        "unavailable"
    )


class FakeFetch:
    def __init__(self, *responses: tuple[int, bytes] | Exception) -> None:
        self.responses = list(responses)
        self.urls: list[str] = []

    def __call__(self, url: str) -> tuple[int, bytes]:
        self.urls.append(url)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def test_client_returns_the_parsed_page() -> None:
    fetch = FakeFetch((200, FOUND))
    client = ConafClient(fetch, min_interval=0)
    assert client.lookup("090663").status == "found"
    assert fetch.urls == [public_url("090663")]


@pytest.mark.parametrize(
    "response",
    [URLError("down"), TimeoutError(), (500, b"error"), (200, b"x" * (MAX_BYTES + 1))],
)
def test_client_failures_are_unavailable(response: tuple[int, bytes] | Exception) -> None:
    client = ConafClient(FakeFetch(response), min_interval=0)
    assert client.lookup("090663").status == "unavailable"


def test_client_waits_between_requests() -> None:
    now = [100.0]
    waits: list[float] = []

    def sleep(seconds: float) -> None:
        waits.append(seconds)
        now[0] += seconds

    client = ConafClient(
        FakeFetch((200, FOUND), (200, FOUND)), min_interval=1.0, clock=lambda: now[0], sleep=sleep
    )
    client.lookup("090663")
    now[0] += 0.25
    client.lookup("090663")
    assert waits == [pytest.approx(0.75)]
