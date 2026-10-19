"""Gzip for the large geometry reads, and nothing else.

The Rodales map loads every polygon of a version in one response (about
9.4 MB of GeoJSON for the Degenfeld base) and the report editor loads a
report with its source geometries. Over the network from Chile to the
hosting region, compression is the difference between one second and
several.

Only these GET paths are compressed. They carry no secret and do not echo
request input, which is what a BREACH-style attack on compressed responses
needs; session, CSRF and form responses stay uncompressed.
"""

from __future__ import annotations

import re

from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

COMPRESSED_PATHS: tuple[re.Pattern[str], ...] = (
    re.compile(r"/api/forestry/snapshots/\d+/feature-collection"),
    re.compile(r"/api/forestry/reports/\d+"),
    # Transelec's row-level reads (a 729-row planilla: ~200 KB per page).
    re.compile(r"/api/transelec/(pmfs|lifecycle|plazos|aef|pending)"),
)

# Below this a response is not worth compressing.
_MINIMUM_SIZE = 1024
# Level 6 instead of Starlette's default 9: measured on the Degenfeld
# collection, about the same size for far less server time per request.
_COMPRESS_LEVEL = 6


class SelectiveGZipMiddleware:
    """Apply Starlette's GZipMiddleware to GET requests on `paths` only."""

    def __init__(self, app: ASGIApp, *, paths: tuple[re.Pattern[str], ...]) -> None:
        self.app = app
        self.paths = paths
        self.gzip = GZipMiddleware(app, minimum_size=_MINIMUM_SIZE, compresslevel=_COMPRESS_LEVEL)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] == "GET"
            and any(pattern.fullmatch(scope["path"]) for pattern in self.paths)
        ):
            await self.gzip(scope, receive, send)
            return
        await self.app(scope, receive, send)
