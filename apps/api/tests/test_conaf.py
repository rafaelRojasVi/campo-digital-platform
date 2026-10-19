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
    solicitudes_in_cell,
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
        # CONAF's own «correlativo/oficina-código/año» numbers, as the
        # Transelec planilla's «N Ingreso» carries them (checked 2026-10-18:
        # 12/345-6/24 answers APROBADA).
        ("12/345-6/24", "12/345-6/24"),
        (" 12/345-6/24 ", "12/345-6/24"),
        ("12/34-5/26", "12/34-5/26"),
        ("16/345-10-25", None),  # a typo in the planilla is not corrected
        ("39/345-6/24 11/345-6/26", None),  # two numbers: see solicitudes_in_cell
        ("MP002-202-5", None),
        ("1234567890", None),
        ("", None),
        (None, None),
        ("１２３", None),  # full-width digits are not ASCII
    ],
)
def test_normalize_solicitud(raw: str | None, expected: str | None) -> None:
    assert normalize_solicitud(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("12/345-6/24", ["12/345-6/24"]),
        ("39/345-6/24 11/345-6/26", ["39/345-6/24", "11/345-6/26"]),
        ("16/ 345-10-25", []),
        ("10099991", ["10099991"]),
        ("Sin ingreso", []),
        ("-", []),
        (None, []),
    ],
)
def test_solicitudes_in_cell(raw: str | None, expected: list[str]) -> None:
    # A planilla cell may hold the ingreso and the reingreso: both, in order.
    assert solicitudes_in_cell(raw) == expected


def test_public_url_encodes_a_slashed_number() -> None:
    assert public_url("12/345-6/24") == (
        "https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=12%2F345-6%2F24"
    )


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


def test_busy_client_does_not_wait_forever() -> None:
    # Another request holds the lock (CONAF hanging): an interactive lookup gives up.
    import threading

    from app.conaf import ConafBusyError

    client = ConafClient(FakeFetch((200, FOUND)), min_interval=0)
    client._lock.acquire()
    try:
        with pytest.raises(ConafBusyError):
            client.lookup("090663", wait=0.05)
    finally:
        client._lock.release()
    assert isinstance(threading.Lock(), type(client._lock))


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity", "12345678901", "-1"])
def test_superficie_out_of_range_is_dropped(value: str) -> None:
    body = page(("090663", "PLAN DE MANEJO", value, "16/04/1996", "APROBADA", ""))
    assert parse_conaf_page("090663", body).superficie_ha is None


def test_fetch_has_a_total_deadline() -> None:
    from app.conaf import read_with_deadline

    class Drip:
        def __init__(self) -> None:
            self.now = 0.0

        def read(self, size: int) -> bytes:
            self.now += 5.0
            return b"x"

    drip = Drip()
    with pytest.raises(TimeoutError):
        read_with_deadline(drip, limit=MAX_BYTES, deadline=12.0, clock=lambda: drip.now)
