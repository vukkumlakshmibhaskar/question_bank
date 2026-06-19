import itertools
import os
import secrets
import time
from contextlib import asynccontextmanager
from typing import Iterable

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse
from starlette.requests import ClientDisconnect


GATEWAY_NAME = os.getenv("GATEWAY_NAME", "ads").lower()
COOKIE_NAME = os.getenv("GATEWAY_COOKIE_NAME", f"ads_{GATEWAY_NAME}_backend")
BACKEND_PORTS = [
    int(port.strip())
    for port in os.getenv("BACKEND_PORTS", "").split(",")
    if port.strip()
]
BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
REQUEST_TIMEOUT = float(os.getenv("GATEWAY_TIMEOUT", "600"))

if not BACKEND_PORTS:
    raise RuntimeError("BACKEND_PORTS must contain at least one backend port.")

_port_cycle = itertools.cycle(BACKEND_PORTS)
_sessions: dict[str, int] = {}
_session_seen: dict[str, float] = {}
_unhealthy_until: dict[int, float] = {}
_client: httpx.AsyncClient | None = None
ACTIVE_WINDOW_SECONDS = int(os.getenv("GATEWAY_ACTIVE_WINDOW_SECONDS", "20"))
UNHEALTHY_SECONDS = int(os.getenv("GATEWAY_UNHEALTHY_SECONDS", "60"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _client
    _client = httpx.AsyncClient(
        timeout=httpx.Timeout(REQUEST_TIMEOUT, connect=15.0, read=REQUEST_TIMEOUT, write=REQUEST_TIMEOUT),
        follow_redirects=False,
    )
    yield
    await _client.aclose()


app = FastAPI(title=f"ADS {GATEWAY_NAME.title()} Gateway", lifespan=lifespan)


def _next_port() -> int:
    return next(_port_cycle)


def _is_unhealthy(port: int) -> bool:
    until = _unhealthy_until.get(port, 0)
    if until <= time.time():
        _unhealthy_until.pop(port, None)
        return False
    return True


def _mark_unhealthy(port: int) -> None:
    _unhealthy_until[port] = time.time() + UNHEALTHY_SECONDS


def _should_mark_unhealthy(path: str, exc: Exception) -> bool:
    # A short read timeout on polling/save endpoints usually means the backend
    # is busy with extraction, not dead. Mark only connection-level failures.
    if path.startswith(("data/", "logs/", "redis/", "sync-db/")) and isinstance(exc, httpx.ReadTimeout):
        return False
    return True


def _next_available_port() -> int:
    for _ in BACKEND_PORTS:
        port = _next_port()
        if not _is_unhealthy(port):
            return port
    return _next_port()


def _candidate_ports(primary: int) -> list[int]:
    candidates = []
    if primary in BACKEND_PORTS and not _is_unhealthy(primary):
        candidates.append(primary)
    for port in BACKEND_PORTS:
        if port != primary and not _is_unhealthy(port):
            candidates.append(port)
    if not candidates and primary in BACKEND_PORTS:
        candidates.append(primary)
    return candidates


def _timeout_for_path(path: str) -> dict[str, float]:
    quick_paths = (
        "redis/load",
        "redis/save",
    )
    if path in quick_paths or path.startswith(("data/", "workspace/", "download", "delete-row/", "sync-db/")):
        return {"connect": 2.0, "read": 10.0, "write": 8.0, "pool": 2.0}
    if path.startswith("logs/"):
        return {"connect": 2.0, "read": 20.0, "write": 4.0, "pool": 2.0}
    return {"connect": 8.0, "read": REQUEST_TIMEOUT, "write": REQUEST_TIMEOUT, "pool": 8.0}


def _session_and_port(request: Request) -> tuple[str, int, bool]:
    _cleanup_sessions()
    session_id = request.cookies.get(COOKIE_NAME)
    is_new = False
    if not session_id:
        session_id = secrets.token_urlsafe(18)
        is_new = True

    port = _sessions.get(session_id)
    if port not in BACKEND_PORTS or _is_unhealthy(port):
        port = _next_available_port()
        _sessions[session_id] = port
        is_new = True

    _session_seen[session_id] = time.time()
    return session_id, port, is_new


def _cleanup_sessions() -> None:
    cutoff = time.time() - ACTIVE_WINDOW_SECONDS
    expired = [session_id for session_id, seen_at in _session_seen.items() if seen_at < cutoff]
    for session_id in expired:
        _session_seen.pop(session_id, None)
        # Keep the sticky backend mapping even after a user is no longer counted
        # as active. Long extraction jobs and their log/data requests must keep
        # returning to the same backend port.


def _copy_headers(headers: Iterable[tuple[str, str]]) -> dict[str, str]:
    blocked = {
        "connection",
        "content-encoding",
        "content-length",
        "host",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    }
    return {key: value for key, value in headers if key.lower() not in blocked}


@app.get("/gateway-health")
async def gateway_health(request: Request, response: Response):
    session_id, port, is_new = _session_and_port(request)
    per_port = {str(port): 0 for port in BACKEND_PORTS}
    for active_session_id in _session_seen:
        session_port = _sessions.get(active_session_id)
        if session_port in BACKEND_PORTS:
            per_port[str(session_port)] += 1
    if is_new:
        response.set_cookie(
            COOKIE_NAME,
            session_id,
            max_age=60 * 60 * 12,
            httponly=True,
            samesite="lax",
        )
    return {
        "gateway": GATEWAY_NAME,
        "ports": BACKEND_PORTS,
        "active_sessions": len(_session_seen),
        "active_window_seconds": ACTIVE_WINDOW_SECONDS,
        "sessions_per_port": per_port,
        "unhealthy_ports": sorted(str(port) for port in BACKEND_PORTS if _is_unhealthy(port)),
    }


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy(path: str, request: Request):
    session_id, port, is_new = _session_and_port(request)
    try:
        body = await request.body()
    except ClientDisconnect:
        return Response(
            content="Client disconnected before the request body was received.",
            status_code=499,
            media_type="text/plain",
        )
    headers = _copy_headers(request.headers.items())
    headers["x-ads-gateway"] = GATEWAY_NAME
    headers["x-ads-session-id"] = session_id
    timeout = _timeout_for_path(path)
    upstream = None
    selected_port = port
    last_error: Exception | None = None

    for candidate_port in _candidate_ports(port):
        selected_port = candidate_port
        target_url = f"http://{BACKEND_HOST}:{candidate_port}/{path}"
        if request.url.query:
            target_url = f"{target_url}?{request.url.query}"

        headers["x-ads-backend-port"] = str(candidate_port)
        req = _client.build_request(
            request.method,
            target_url,
            content=body,
            headers=headers,
        )
        req.extensions["timeout"] = timeout

        try:
            upstream = await _client.send(req, stream=True)
            if candidate_port != port:
                _sessions[session_id] = candidate_port
            break
        except (httpx.TimeoutException, httpx.RequestError) as exc:
            last_error = exc
            if _should_mark_unhealthy(path, exc):
                _mark_unhealthy(candidate_port)

    if upstream is None:
        return Response(
            content=f"Backend temporarily unavailable. Last error: {last_error}",
            status_code=502,
            media_type="text/plain",
        )

    response_headers = _copy_headers(upstream.headers.items())
    response_headers["x-ads-backend-port"] = str(selected_port)

    async def response_stream():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        except (httpx.TimeoutException, httpx.RequestError):
            return
        finally:
            await upstream.aclose()

    response = StreamingResponse(
        response_stream(),
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )
    if is_new:
        response.set_cookie(
            COOKIE_NAME,
            session_id,
            max_age=60 * 60 * 12,
            httponly=True,
            samesite="lax",
        )
    return response
