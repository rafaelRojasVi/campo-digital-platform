"""Unit tests for forestry_species.py — mirrors species.test.ts in the dashboard.

Both test suites must stay in sync; see the header comment in
apps/api/app/forestry_species.py.
"""

from __future__ import annotations

import pytest
from app.forestry_species import (
    ENSAYO_KEY,
    ENSAYO_LABEL,
    NO_SPECIES_KEY,
    NO_SPECIES_LABEL,
    plantation_year,
    species_group_key,
    species_label,
    species_tokens,
)

# ---------------------------------------------------------------------------
# species_tokens — mirrors speciesTokens in species.test.ts
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "code,expected",
    [
        ("Pi06", ["Pi"]),
        ("Pi?? Rzg", ["Pi"]),
        ("Pi24??", ["Pi"]),
        ("En?? Rzg", ["En"]),
        ("Ro", ["Ro"]),
        ("Ar Rn", ["Ar"]),
        ("Ar Ro", ["Ar"]),
        ("Eg91 Pi Rn", ["Eg"]),
        ("Co02 Ar Rn", ["Co"]),
        ("PiPo98", ["Pi", "Po"]),
        ("Po99Eg97", ["Po", "Eg"]),
        ("CoRa04En08", ["Co", "Ra", "En"]),
        ("RaCoRo01P*", ["Ra", "Co", "Ro"]),
        ("UlTe02", ["Ul", "Te"]),
        ("CPLCo06", ["Co"]),
        ("PoSs05", ["Po", "Ss"]),
        ("Al97", ["Al"]),
    ],
)
def test_species_tokens_recognized(code: str, expected: list[str]) -> None:
    assert species_tokens(code) == expected


@pytest.mark.parametrize(
    "code",
    [
        "BN",
        "VN",
        "Ve",
        "Ve PLT",
        "Prot",
        "Mat",
        "Mx",
        "Ali",
        "Adm",
        "APF06",
        "CCV En",
        "CAS Ar Rn",
        "CL",
        "Escuela",
        "ES98 PoRa",
        "",
    ],
)
def test_species_tokens_not_recognized(code: str) -> None:
    assert species_tokens(code) == []


def test_species_tokens_no_duplicate() -> None:
    assert species_tokens("PiPi03") == ["Pi"]


def test_species_tokens_null() -> None:
    assert species_tokens(None) == []


# ---------------------------------------------------------------------------
# species_group_key — mirrors speciesGroup.key in species.test.ts
# ---------------------------------------------------------------------------


def test_species_group_key_single() -> None:
    assert species_group_key("Pi06") == "Pi"
    assert species_group_key("Eg97 Rzg") == "Eg"


def test_species_group_key_confirmed_species() -> None:
    assert species_group_key("Se18") == "Se"
    assert species_group_key("Al05") == "Al"
    assert species_group_key("Ci10") == "Ci"


def test_species_group_key_mixture_canonical_order() -> None:
    # Mixture is always sorted by SPECIES_ORDER, whatever order the code uses.
    assert species_group_key("PoRaCo98") == "Po+Co+Ra"
    assert species_group_key("RaCo07") == species_group_key("CoRa03")
    assert species_group_key("Co06Po06") == "Po+Co"
    assert species_group_key("PoSs05") == "Po+Ss"


def test_species_group_key_ensayo() -> None:
    assert species_group_key("ES98 PoRa") == ENSAYO_KEY
    assert species_group_key("ES") == ENSAYO_KEY


def test_species_group_key_no_species() -> None:
    assert species_group_key("BN") == NO_SPECIES_KEY
    assert species_group_key(None) == NO_SPECIES_KEY


# ---------------------------------------------------------------------------
# species_label — mirrors speciesGroup.label and speciesLabel in species.test.ts
# ---------------------------------------------------------------------------


def test_species_label_single() -> None:
    assert species_label("Pi06") == "Pino radiata"
    assert species_label("Eg97 Rzg") == "Eucalyptus globulus"
    assert species_label("Se18") == "Secuoya"
    assert species_label("Al05") == "Aliso"
    assert species_label("Ci10") == "Ciprés"


def test_species_label_mixture() -> None:
    assert species_label("PoRaCo98") == "Mixta: pino oregón + coigüe + raulí"
    assert species_label("PoSs05") == "Mixta: pino oregón + Sequoia sempervirens"


def test_species_label_ensayo() -> None:
    assert species_label("ES98 PoRa") == ENSAYO_LABEL


def test_species_label_no_species() -> None:
    assert species_label("BN") == NO_SPECIES_LABEL
    assert species_label(None) == NO_SPECIES_LABEL


# ---------------------------------------------------------------------------
# plantation_year (new — not in species.test.ts)
# ---------------------------------------------------------------------------


def test_plantation_year_recent_codes() -> None:
    # yy <= 26 (current 2-digit year) → 2000+yy
    assert plantation_year("Pi06") == 2006
    assert plantation_year("Eg03") == 2003
    assert plantation_year("En24") == 2024


def test_plantation_year_old_codes() -> None:
    # yy > 26 → 1900+yy
    assert plantation_year("Eg94") == 1994
    assert plantation_year("Eg98") == 1998


def test_plantation_year_unknown() -> None:
    assert plantation_year("Pi?? Rzg") is None
    assert plantation_year("En?? Rzg") is None


def test_plantation_year_no_year() -> None:
    # Code has a species but no year segment
    assert plantation_year("Ro") is None


def test_plantation_year_null() -> None:
    assert plantation_year(None) is None


def test_plantation_year_all_caps_prefix() -> None:
    assert plantation_year("CPLCo06") == 2006


def test_plantation_year_mixture_first_species_year() -> None:
    # PiPo98 → first year after Pi is 98 → 1998
    assert plantation_year("PiPo98") == 1998
