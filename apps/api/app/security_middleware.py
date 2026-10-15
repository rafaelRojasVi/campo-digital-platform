"""Turn security notes and 401 answers into security events (pure ASGI)."""

from __future__ import annotations

import logging

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.security_events import STATE_KEY, SecurityEventRecorder, client_ip, is_ignored_path

logger = logging.getLogger(__name__)


class SecurityEventMiddleware:
    """Observe the final status of each request; record after the response.

    Sits outside ``RequestBodyLimitMiddleware`` so the ``401`` it answers for
    sessionless uploads is counted too. Recording failures are logged and
    swallowed: they must never change what the client receives.
    """

    def __init__(self, app: ASGIApp, *, recorder: SecurityEventRecorder) -> None:
        self.app = app
        self.recorder = recorder

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or is_ignored_path(scope["path"]):
            await self.app(scope, receive, send)
            return

        state = scope.setdefault("state", {})
        status: dict[str, int] = {}

        async def send_and_watch(message: Message) -> None:
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_and_watch)
        finally:
            if "code" in status:
                try:
                    self.recorder.observe(
                        path=scope["path"],
                        status=status["code"],
                        client_ip=client_ip(scope),
                        note=state.get(STATE_KEY),
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Security event not observed (%s)", type(exc).__name__)
