"""Process-wide HTTP hardening: request-body limits and response security headers.

Both are pure ASGI middlewares rather than FastAPI dependencies, because the
problems they close happen *before* any dependency runs:

- FastAPI parses a ``multipart/form-data`` or JSON body before it resolves a
  route's dependencies, so ``get_current_app_user`` and ``require_csrf``
  only ever see a request whose whole body has already been received.
  Without a limit here, an anonymous caller could make the server spool an
  arbitrarily large upload to a temporary file (verified locally: a 400 MB
  anonymous POST to ``/api/transelec/uploads`` was written to disk in full
  before the ``401``), and the per-route ``MAX_UPLOAD_BYTES`` check in
  ``app.routers.ingestion`` runs only after that spool.
- Security headers have to be present on every response -- the built
  dashboard, API JSON, redirects and error bodies alike -- including the
  ``401``/``413`` answers this module itself produces.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from http.cookies import CookieError, SimpleCookie

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# ---------------------------------------------------------------------------
# Request-body limits
# ---------------------------------------------------------------------------


class _BodyTooLargeError(Exception):
    """Raised from the wrapped ``receive`` once a body passes its limit."""


async def _send_json(send: Send, status_code: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
                # The body was not read: the connection cannot be reused.
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


def _has_cookie(headers: Headers, name: str) -> bool:
    for raw in headers.getlist("cookie"):
        try:
            parsed = SimpleCookie(raw)
        except CookieError:
            continue
        if name in parsed and parsed[name].value:
            return True
    return False


class RequestBodyLimitMiddleware:
    """Bound every request body, and refuse anonymous uploads before reading them.

    ``default_limit`` applies to every path not listed in ``path_limits``
    (every JSON mutation this API has fits in far less). ``path_limits``
    raises the bound for the upload routes only. A declared
    ``Content-Length`` over the limit is answered ``413`` without reading
    anything; a chunked or under-declared body is counted as it streams and
    cut off at the limit.

    ``session_cookie_required`` lists upload paths that are answered ``401``
    before any of the body is read when the request carries no session
    cookie at all. This does not authenticate anyone -- the route still does
    that -- it only stops an anonymous caller from making the server receive
    an upload-sized body first.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        default_limit: int,
        path_limits: Mapping[str, int],
        session_cookie_name: str,
        session_cookie_required: Iterable[str] = (),
    ) -> None:
        self.app = app
        self.default_limit = default_limit
        self.path_limits = dict(path_limits)
        self.session_cookie_name = session_cookie_name
        self.session_cookie_required = frozenset(session_cookie_required)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope["path"]
        limit = self.path_limits.get(path, self.default_limit)
        headers = Headers(scope=scope)

        if path in self.session_cookie_required and not _has_cookie(
            headers, self.session_cookie_name
        ):
            await _send_json(send, 401, "Not authenticated.")
            return

        declared = headers.get("content-length")
        if declared is not None:
            try:
                declared_bytes = int(declared)
            except ValueError:
                await _send_json(send, 400, "Invalid Content-Length.")
                return
            if declared_bytes > limit:
                await _send_json(send, 413, "Request body exceeds the maximum allowed size.")
                return

        received = 0
        exceeded = False
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            if exceeded:
                raise _BodyTooLargeError
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    raise _BodyTooLargeError
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal response_started
            # FastAPI turns any error raised while it parses a body into its
            # own 400 ("There was an error parsing the body"). Once the limit
            # tripped, that answer is swallowed and replaced by a 413 below.
            if exceeded:
                return
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except Exception:
            # Whatever the app raised after the limit tripped (the limit's
            # own error, or one it wrapped) is answered as the 413 below.
            if not exceeded:
                raise

        if exceeded and not response_started:
            await _send_json(send, 413, "Request body exceeds the maximum allowed size.")


# ---------------------------------------------------------------------------
# Response security headers
# ---------------------------------------------------------------------------

# The built Transelec dashboard loads one module script and one stylesheet
# from /assets, images from /assets, and calls only same-origin /api/*. It
# has no inline <script> or <style>, no third-party origin, and no
# dangerouslySetInnerHTML. React's `style={{...}}` props are set through the
# CSSOM, which `style-src 'self'` does not restrict. Sign-in leaves the page
# by a top-level navigation to /api/auth/google/login, which CSP does not
# govern either.
DASHBOARD_CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self'",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    )
)

# FastAPI's interactive docs load Swagger UI / ReDoc from a CDN with an
# inline bootstrap script, so they keep only the framing restriction.
_DOCS_CONTENT_SECURITY_POLICY = "frame-ancestors 'none'"
_DOCS_PATHS = frozenset({"/docs", "/docs/oauth2-redirect", "/redoc"})

# Content-hashed build output (index-<hash>.js); safe to cache, and never
# carries client data.
_CACHEABLE_PATH_PREFIXES = ("/assets/",)

# A year, per common HSTS deployment guidance. No `preload`: that is a
# registry submission with its own consequences, not a header default.
_HSTS_VALUE = "max-age=31536000; includeSubDomains"

_HSTS_APP_ENVS = frozenset({"staging", "production"})


class SecurityHeadersMiddleware:
    """Attach security headers to every HTTP response.

    - ``Cache-Control: no-store`` on everything except content-hashed static
      assets: API responses carry client data (and the CSV export a whole
      table of it) that must not survive in a shared browser's cache or be
      replayed from history after sign-out.
    - ``Content-Security-Policy`` with ``frame-ancestors 'none'`` plus
      ``X-Frame-Options: DENY`` for older browsers, so no other site can
      frame the dashboard to click Publish or Restore on a user's behalf.
    - ``Strict-Transport-Security`` only where the service is HTTPS-only
      (staging, production); a development server on plain HTTP must not
      pin localhost to HTTPS.

    A header a route set explicitly is never overwritten.
    """

    def __init__(self, app: ASGIApp, *, app_env: str) -> None:
        self.app = app
        self.hsts = app_env in _HSTS_APP_ENVS

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope["path"]

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                defaults = {
                    "X-Content-Type-Options": "nosniff",
                    "X-Frame-Options": "DENY",
                    "Referrer-Policy": "same-origin",
                    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
                    "Content-Security-Policy": (
                        _DOCS_CONTENT_SECURITY_POLICY
                        if path in _DOCS_PATHS
                        else DASHBOARD_CONTENT_SECURITY_POLICY
                    ),
                }
                if not path.startswith(_CACHEABLE_PATH_PREFIXES):
                    defaults["Cache-Control"] = "no-store"
                if self.hsts:
                    defaults["Strict-Transport-Security"] = _HSTS_VALUE
                for name, value in defaults.items():
                    if name not in headers:
                        headers[name] = value
            await send(message)

        await self.app(scope, receive, send_with_headers)
