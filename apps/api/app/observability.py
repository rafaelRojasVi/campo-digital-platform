"""Optional server-error reporting to Sentry, off unless ``SENTRY_DSN`` is set.

Client data must not leave the platform, so the client is configured to ship
only the technical failure: the exception, its stack (without local variable
values), the HTTP method and the URL path. Request bodies, query strings,
headers, cookies, user identity and breadcrumbs are never sent. Expected 4xx
answers (sign-in required, forbidden, not found) are not reported.
"""

from __future__ import annotations

import copy
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.types import DataCollectionUserOptions, Event, Hint

_SERVER_ERRORS = set(range(500, 600))

# Collect nothing about the request or the people making it. ``scrub_event``
# repeats the reduction in ``before_send`` as a second, SDK-independent layer.
DATA_COLLECTION: DataCollectionUserOptions = {
    "user_info": False,
    "cookies": {"mode": "off"},
    "http_headers": {"request": {"mode": "off"}},
    "http_bodies": [],
    "url_query_params": {"mode": "off"},
    "database_query_data": False,
    "queues": False,
    "stack_frame_variables": False,
}


def scrub_event(event: Event, hint: Hint) -> Event | None:
    """``before_send`` hook: reduce the request to method + path, drop the user."""

    request = event.get("request")
    if isinstance(request, dict):
        kept: dict[str, Any] = {}
        if "method" in request:
            kept["method"] = request["method"]
        url = request.get("url")
        if isinstance(url, str):
            # Query strings carry OAuth codes and typed searches; fragments too.
            parts = urlsplit(url)
            kept["url"] = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
        event["request"] = kept
    event.pop("user", None)
    return event


def init_error_reporting(*, dsn: str | None, environment: str, release: str | None) -> bool:
    """Start the Sentry client when a DSN is configured; return whether it started."""

    if dsn is None or not dsn.strip():
        return False

    sentry_sdk.init(
        dsn=dsn.strip(),
        environment=environment,
        release=release,
        data_collection=copy.deepcopy(DATA_COLLECTION),
        max_request_body_size="never",
        max_breadcrumbs=0,
        # Errors only: no performance tracing.
        traces_sample_rate=0,
        before_send=scrub_event,
        integrations=[
            StarletteIntegration(failed_request_status_codes=_SERVER_ERRORS),
            FastApiIntegration(failed_request_status_codes=_SERVER_ERRORS),
        ],
    )
    return True
