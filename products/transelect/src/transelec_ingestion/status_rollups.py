"""The three named, evidenced PMF/predio status-rollup bases (TR-OPEN-01).

Javier's two HTML dashboards compute a PMF's or a predio's "status" three
different, genuinely disagreeing ways depending on which section of which
file you look at (source forensic audit, section 5, "Ambiguous conflicts
requiring a named decision"; functional parity matrix, TR-FUNC-005/006/007/
011/013/032). There is no canonical rule yet — TR-OPEN-01 is open, and this
module does not invent one. Instead it ships each of Javier's own current
rules, faithfully, under its own explicit basis identifier, so a future
canonical decision replaces exactly one of them, in one place, without
touching every call site that reads a status:

- ``estado_resumido_first_row`` — TR-FUNC-005/006/011. A `Map`-insertion-
  order "first row wins" dedup by PMF or by predio_group_key, reading the
  winning row's own ``Estado resumido``.
- ``pending_priority_legacy`` — TR-FUNC-007/032 (``isPendingPMF``). Same
  first-row-wins dedup mechanism, but the winning row is tested against a
  completely different predicate (blank ``N Ingreso`` or ``Estado``
  containing "rechaz"), which is *why* it can disagree with
  ``estado_resumido_first_row`` for the very same underlying row — confirmed
  live in the forensic audit (filtering to "rechaz" on the real dashboard
  produced PMFs whose Estado-resumido-based approval rate showed
  "0 Aprobados, 8 En trámite" while the same PMFs are "pending" here).
- ``owner_stage_legacy`` — TR-FUNC-013 (``ownerStage()``). Predio-grain,
  same dedup mechanism again; the winning row's raw ``Estado`` overrides
  ``Estado resumido`` with a synthesized "Rechazado" label when it contains
  "rechaz", otherwise the raw ``Estado resumido`` value passes through
  unchanged.

None of these three is "the" correct rollup. All three are shipped, all
three are named, and all three stay independently swappable behind the
``STATUS_ROLLUP_BASES`` lookup below.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Literal

GroupKey = Literal["pmf", "predio_group_key"]

Bucket3Way = Literal["aprobado", "en_tramite", "pendiente_o_tachado"]
HeroState = Literal["aprobado", "en_tramite", "pendiente", "tachado", "sin_estado"]
PendingStage = Literal["preparacion", "recurso_rechazo", "otros"]


@dataclass(frozen=True, slots=True)
class RolledRow:
    """The minimal per-row shape every status-rollup basis needs.

    A thin, DB-agnostic view over one ``transelec_resumen_row`` — callers
    (the HTTP router) project a fetched database row into this shape;
    nothing here touches SQLAlchemy or the database, so every basis below is
    unit-testable with a hand-built list of these.
    """

    source_row_number: int
    pmf: str
    predio_group_key: str
    estado: str | None
    estado_resumido: str | None
    numero_ingreso: str | None
    tipo_propietario: str | None = None


def first_row_wins(rows: Iterable[RolledRow], *, key: GroupKey) -> dict[str, RolledRow]:
    """Return, for each distinct value of ``key``, its first-encountered row.

    "First" means the smallest ``source_row_number`` — the forensic audit's
    own characterization of the HTML's ``Map``-insertion-order dedup
    ("Dedup tie-break ... is first source row encountered"), not merely
    whichever row happens to appear first in the ``rows`` iterable. This is
    the single shared mechanism behind both ``estado_resumido_first_row``
    and ``pending_priority_legacy``, and (at predio grain) ``owner_stage_legacy``.
    """

    winners: dict[str, RolledRow] = {}
    for row in rows:
        group_value = getattr(row, key)
        current = winners.get(group_value)
        if current is None or row.source_row_number < current.source_row_number:
            winners[group_value] = row
    return winners


# ---------------------------------------------------------------------------
# Basis: estado_resumido_first_row — TR-FUNC-005/006/011
# ---------------------------------------------------------------------------


def estado_resumido_first_row(rows: Iterable[RolledRow], *, key: GroupKey) -> dict[str, str | None]:
    """Each key's ``Estado resumido``, read off its first-encountered row."""

    winners = first_row_wins(rows, key=key)
    return {group_key: row.estado_resumido for group_key, row in winners.items()}


# ---------------------------------------------------------------------------
# Basis: pending_priority_legacy — TR-FUNC-007/032 (isPendingPMF)
# ---------------------------------------------------------------------------


def is_pending_row(row: RolledRow) -> bool:
    """``isPendingPMF``: blank ``N Ingreso`` OR ``Estado`` contains "rechaz".

    Case-insensitive substring match on ``Estado``, per the ratified matrix.
    """

    blank_ingreso = row.numero_ingreso is None or not row.numero_ingreso.strip()
    rejected = row.estado is not None and "rechaz" in row.estado.lower()
    return blank_ingreso or rejected


def pending_priority_legacy(rows: Iterable[RolledRow], *, key: GroupKey = "pmf") -> dict[str, bool]:
    """Each key's pending-priority flag, evaluated on its first-encountered row.

    Uses the same first-row-wins dedup as ``estado_resumido_first_row``, but
    applies a different predicate to the winning row — which is exactly why
    the two bases can (and, per the forensic audit, do) disagree for the
    same underlying row.
    """

    return {
        group_key: is_pending_row(row) for group_key, row in first_row_wins(rows, key=key).items()
    }


# ---------------------------------------------------------------------------
# Basis: owner_stage_legacy — TR-FUNC-013 (ownerStage())
# ---------------------------------------------------------------------------


def owner_stage_from_row(row: RolledRow) -> str | None:
    """``ownerStage()``: "Rechazado" override when raw Estado contains
    "rechaz", else the raw ``Estado resumido`` value, unchanged."""

    if row.estado is not None and "rechaz" in row.estado.lower():
        return "Rechazado"
    return row.estado_resumido


def owner_stage_legacy(
    rows: Iterable[RolledRow], *, key: GroupKey = "predio_group_key"
) -> dict[str, str | None]:
    """Each key's owner-stage label, evaluated on its first-encountered row."""

    return {
        group_key: owner_stage_from_row(row)
        for group_key, row in first_row_wins(rows, key=key).items()
    }


STATUS_ROLLUP_BASES: Mapping[str, Callable[..., Mapping[str, object]]] = {
    "estado_resumido_first_row": estado_resumido_first_row,
    "pending_priority_legacy": pending_priority_legacy,
    "owner_stage_legacy": owner_stage_legacy,
}


# ---------------------------------------------------------------------------
# pending_stage — TR-FUNC-032's 3-way substring heuristic over raw Estado.
#
# NOT one of the three basis identifiers above (it further subdivides an
# already-pending row, it does not decide whether a row is pending), but
# named and disclosed the same way: the parity matrix flags it explicitly as
# "INFERENCE-quality (not a confirmed CONAF taxonomy)", and this
# implementation makes no attempt to upgrade that confidence level.
# ---------------------------------------------------------------------------


def pending_stage(estado: str | None) -> PendingStage:
    """3-way heuristic: 'prepar' / ('recurso' AND 'rechaz') / else.

    Case-insensitive substring checks, per the ratified matrix's own
    characterization of ``pendingStage()``. "prepar" is checked first, so a
    string containing both "prepar" and "recurso"/"rechaz" is classified as
    "preparacion" — the matrix does not evidence a tie-break, so this
    mirrors the natural reading order of a 3-way if/else-if chain.
    """

    normalized = (estado or "").lower()
    if "prepar" in normalized:
        return "preparacion"
    if "recurso" in normalized and "rechaz" in normalized:
        return "recurso_rechazo"
    return "otros"


# ---------------------------------------------------------------------------
# Chart/hero bucketing — TR-FUNC-009/010 (3-way) and TR-FUNC-011 (4-state).
#
# Both read the same estado_resumido_first_row-deduped representative row;
# these two functions only decide how to *bucket* that row's Estado
# resumido value for display. Not a new rollup basis: same input, same
# dedup, just a different presentation grouping.
# ---------------------------------------------------------------------------

_APROBADO = "aprobado"
_EN_TRAMITE = {"en tramite", "en trámite"}


def bucket_3way(estado_resumido: str | None) -> Bucket3Way:
    """Aprobado / En trámite / Pendiente-o-Tachado (TR-FUNC-009/010).

    Anything that is not recognizably "Aprobado" or "En tramite" — including
    a blank/unexpected value — merges into the third bucket, matching the
    matrix's own "Pendiente-o-Tachado" catch-all framing.
    """

    normalized = (estado_resumido or "").strip().lower()
    if normalized == _APROBADO:
        return "aprobado"
    if normalized in _EN_TRAMITE:
        return "en_tramite"
    return "pendiente_o_tachado"


_HERO_STATES: dict[str, HeroState] = {
    "aprobado": "aprobado",
    "en tramite": "en_tramite",
    "en trámite": "en_tramite",
    "pendiente": "pendiente",
    "tachado": "tachado",
}


def hero_state(estado_resumido: str | None) -> HeroState:
    """One of the 4 known ``Estado resumido`` values (TR-FUNC-011), or the
    defensive ``"sin_estado"`` bucket for a blank/unrecognized value.

    ``sin_estado`` is a technical safety net, not a 5th business category:
    the reviewed workbook has exactly 4 distinct values here, but nothing
    guarantees a future import does, and TR-FUNC-011's acceptance test
    requires hero counts to sum exactly to the predio total.
    """

    normalized = (estado_resumido or "").strip().lower()
    return _HERO_STATES.get(normalized, "sin_estado")
