"""Planted species from the 2026 use code (CodUso_2026).

This module mirrors ``products/forestry/dashboard/src/lib/species.ts``.
**Both files must change together**: the species prefix list, SPECIES_ORDER,
the mixture-grouping rules, the all-caps prefix skip, the Ensayo sentinel,
and the plantation-year parsing are shared across the TypeScript dashboard and
this Python module.  Update one → update the other.

INFERENCE (Javier, Campo Digital, 2026-10-19): the 2026 code's two-letter
capitalized prefixes name the planted species; the digits name the plantation
year.  Example: ``Pi06`` = P. radiata 2006.  Only the first word of the code
is read; later words describe understory or regeneration.

For the plantation year:
- A two-digit ``yy`` → ``1900+yy`` when ``yy`` is greater than the current
  2-digit year (i.e., it could not be a future plantation year), else
  ``2000+yy``.
- A ``??`` placeholder means the year is unknown; returns ``None``.
"""

from __future__ import annotations

import datetime
import re

# Species prefix → full display name.
# Order defines mixture-grouping (ties in a mixture are sorted by this order).
# Must stay in sync with the ``SPECIES`` const in species.ts.
SPECIES: dict[str, str] = {
    "Pi": "pino radiata",
    "Po": "pino oregón",
    "En": "Eucalyptus nitens",
    "Eg": "Eucalyptus globulus",
    "Ar": "aromo",
    "Ro": "roble",
    "Co": "coigüe",
    "Ra": "raulí",
    "Ul": "ulmo",
    "Te": "tepa",
    "Al": "aliso",
    "Se": "secuoya",
    "Ci": "ciprés",
    "Ss": "Sequoia sempervirens",
}
SPECIES_ORDER: list[str] = list(SPECIES.keys())

ENSAYO_KEY = "__ensayo__"
NO_SPECIES_KEY = "__sin_especie__"
ENSAYO_LABEL = "Ensayo (varias especies)"
NO_SPECIES_LABEL = "Sin especie en el código"


def species_tokens(code: str | None) -> list[str]:
    """Species prefixes of the code's first word, in order, without repeats.

    Mirrors ``speciesTokens`` in species.ts.
    """
    first_word = (code or "").strip().split()[0] if (code or "").strip() else ""
    # An all-caps prefix may precede the species token (e.g. ``CPLCo06``).
    rest = re.sub(r"^[A-Z]{2,}(?=[A-Z][a-z])", "", first_word)
    tokens: list[str] = []

    while rest:
        token = rest[:2]
        if not re.match(r"^[A-Z][a-z]$", token) or token not in SPECIES:
            break
        rest = rest[2:]
        # A species token must end at a year, another species token, or the
        # word's end.  A lowercase letter immediately after means the two chars
        # were not a token boundary (e.g. "Ali" is not "Al" + "i").
        if rest and rest[0].islower():
            return []
        if token not in tokens:
            tokens.append(token)
        # Consume year digits or "??" placeholders.
        rest = re.sub(r"^(\d\d|\?\?)+", "", rest)

    return tokens


def species_group_key(code: str | None) -> str:
    """Stable group key: prefixes joined by '+', or a sentinel string.

    Mirrors the ``speciesGroup`` key in species.ts.
    """
    if code is not None and re.match(r"^ES(\d|\s|$)", code.strip()):
        return ENSAYO_KEY
    tokens = species_tokens(code)
    if not tokens:
        return NO_SPECIES_KEY
    sorted_tokens = sorted(tokens, key=lambda t: SPECIES_ORDER.index(t))
    return "+".join(sorted_tokens)


def species_label(code: str | None) -> str:
    """Human-readable species label for a 2026 use code.

    Returns the species name (capitalized) for a single species, a
    "Mixta: …" label for a mixture, or the sentinel label for Ensayo /
    unknown codes.  Mirrors ``speciesGroup(code).label`` in species.ts.
    """
    key = species_group_key(code)
    if key == ENSAYO_KEY:
        return ENSAYO_LABEL
    if key == NO_SPECIES_KEY:
        return NO_SPECIES_LABEL
    token_list = key.split("+")
    if len(token_list) == 1:
        name = SPECIES.get(token_list[0], token_list[0])
        return name[0].upper() + name[1:]
    names = [SPECIES.get(t, t) for t in token_list]
    return "Mixta: " + " + ".join(names)


def plantation_year(code: str | None) -> int | None:
    """First four-digit plantation year inferred from the 2026 use code.

    Reads the first two-digit year segment from the code's first word, after
    any species prefixes.

    Two-digit ``yy`` → ``1900+yy`` when ``yy > current_2d``, else ``2000+yy``.
    A ``??`` placeholder returns ``None`` (year unknown).
    Returns ``None`` if no year segment is present.
    """
    current_2d = datetime.date.today().year % 100
    first_word = (code or "").strip().split()[0] if (code or "").strip() else ""
    # Strip leading all-caps prefix.
    rest = re.sub(r"^[A-Z]{2,}(?=[A-Z][a-z])", "", first_word)

    while rest:
        token = rest[:2]
        if not re.match(r"^[A-Z][a-z]$", token) or token not in SPECIES:
            break
        rest = rest[2:]
        # A lowercase letter after the token means it was not a boundary.
        if rest and rest[0].islower():
            return None
        # "??" means the year is unknown.
        if rest.startswith("??"):
            return None
        yy_match = re.match(r"^(\d\d)", rest)
        if yy_match:
            yy = int(yy_match.group(1))
            return (1900 + yy) if yy > current_2d else (2000 + yy)
        # No year segment after this token; move on to the next prefix.
        rest = re.sub(r"^(\d\d|\?\?)+", "", rest)

    return None
