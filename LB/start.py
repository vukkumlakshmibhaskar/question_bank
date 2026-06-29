import os
import signal
import socket
import subprocess
import sys
import threading
import time
from dotenv import load_dotenv

load_dotenv()

# ==========================================
# MASTER CONFIGURATION
# ==========================================
HOST_IP = os.getenv("HOST_IP", "0.0.0.0")
WORKERS = int(os.getenv("WORKERS", "1"))
PYTHON = sys.executable
TRANSLATION_PORT = int(os.getenv("TRANSLATION_PORT", "8024"))
TRANSLATION_MODULE = os.getenv("TRANSLATION_MODULE", "tr51:app")

ENGINES = [
    {
        "name": "Standard Engine",
        "module": "F52:app",
        "redis_db": "0",
        "ports": list(range(8071, 8080)),
        "gateway_port": 8070,
        "key_pool": "standard",
        "prefix": "STD",
    },
    {
        "name": "Language Engine",
        "module": "Lt:app",
        "redis_db": "1",
        "ports": list(range(8081, 8090)), 
        "gateway_port": 8090,
        "key_pool": "language",
        "prefix": "LANG",
    },
    {
        "name": "Question Crafter",
        "module": "question_crafter.textbook_question_api:app",
        "redis_db": "2",
        "ports": list(range(8101, 8110)), 
        "gateway_port": 8100,
        "key_pool": "question",
        "prefix": "QC",
    },
]

# ==========================================
# API KEY POOLING
# ==========================================
raw_keys = os.getenv("GEMINI_API_KEYS", os.getenv("GEMINI_API_KEY", ""))
API_KEYS = [k.strip() for k in raw_keys.split(",") if k.strip()]

if not API_KEYS:
    print("ERROR: No GEMINI_API_KEYS found. Add them to .env before starting production engines.")
    sys.exit(1)


def distribute_keys(keys: list[str], num_ports: int) -> list[list[str]]:
    buckets = [[] for _ in range(num_ports)]
    for index, key in enumerate(keys):
        buckets[index % num_ports].append(key)
    for index, bucket in enumerate(buckets):
        if not bucket:
            buckets[index] = [keys[index % len(keys)]]
    return buckets


def validate_engine_config() -> None:
    used_ports: dict[int, str] = {}
    for engine in ENGINES:
        ports = list(engine["ports"])
        gateway_port = int(engine["gateway_port"])
        if gateway_port in ports:
            print(
                f"ERROR: {engine['name']} gateway port {gateway_port} is also in its backend ports. "
                "Use a separate gateway port."
            )
            sys.exit(1)
        for port in [gateway_port, *ports]:
            owner = f"{engine['prefix']}-GW" if port == gateway_port else engine["prefix"]
            if port in used_ports:
                print(f"ERROR: Port {port} is used by both {used_ports[port]} and {owner}.")
                sys.exit(1)
            used_ports[port] = owner

    if TRANSLATION_PORT in used_ports:
        print(f"ERROR: Translation API port {TRANSLATION_PORT} is already used by {used_ports[TRANSLATION_PORT]}.")
        sys.exit(1)
    used_ports[TRANSLATION_PORT] = "TR"


def all_runtime_ports() -> list[int]:
    ports: list[int] = []
    for engine in ENGINES:
        ports.extend([int(engine["gateway_port"]), *engine["ports"]])
    ports.append(TRANSLATION_PORT)
    return ports


def is_port_busy(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def ensure_ports_available() -> None:
    busy_ports = [port for port in all_runtime_ports() if is_port_busy(port)]
    if not busy_ports:
        return

    print("\nADS backends appear to be already running.")
    print("Busy port(s): " + ", ".join(str(port) for port in busy_ports))
    print(
        "\nDo not run python start.py again while the services are already live. "
        "Use ops\\restart_ads_backends.ps1 if you want a clean restart."
    )
    sys.exit(1)


def warn_if_redis_unavailable() -> None:
    if is_port_busy(6379):
        return
    print(
        "\nWARNING: Redis is not reachable on localhost:6379. "
        "Backends will use in-memory fallback where available, but live logs and saved workspace recovery "
        "are safer when Redis is running."
    )


# ==========================================
# PROCESS MANAGEMENT
# ==========================================
processes: list[subprocess.Popen] = []
stop_event = threading.Event()


def stream_output(pipe, prefix: str) -> None:
    try:
        for line in iter(pipe.readline, b""):
            if line:
                print(f"{prefix} | {line.decode('utf-8', errors='replace').rstrip()}")
    except Exception:
        pass


def launch_port(port: int, assigned_keys: list[str], engine: dict) -> subprocess.Popen:
    if not assigned_keys:
        assigned_keys = API_KEYS

    env = os.environ.copy()
    env["PORT"] = str(port)
    env["REDIS_DB"] = engine["redis_db"]
    env["GEMINI_API_KEYS"] = ",".join(assigned_keys)
    env["GEMINI_API_KEY"] = assigned_keys[0]
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    cmd = [
        PYTHON,
        "-m",
        "uvicorn",
        engine["module"],
        "--host",
        HOST_IP,
        "--port",
        str(port),
        "--workers",
        str(WORKERS),
        "--log-level",
        "info",
        "--loop",
        "asyncio",
    ]

    proc = subprocess.Popen(
        cmd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=os.path.dirname(os.path.abspath(__file__)),
    )

    threading.Thread(
        target=stream_output,
        args=(proc.stdout, f"[{engine['prefix']}:{port}]"),
        daemon=True,
    ).start()
    return proc


def launch_gateway(engine: dict) -> subprocess.Popen:
    env = os.environ.copy()
    env["GATEWAY_NAME"] = engine["key_pool"]
    env["GATEWAY_COOKIE_NAME"] = f"ads_{engine['key_pool']}_backend"
    env["BACKEND_PORTS"] = ",".join(str(port) for port in engine["ports"])
    env["BACKEND_HOST"] = "127.0.0.1"
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    cmd = [
        PYTHON,
        "-m",
        "uvicorn",
        "gateway:app",
        "--host",
        HOST_IP,
        "--port",
        str(engine["gateway_port"]),
        "--workers",
        "1",
        "--log-level",
        "info",
        "--loop",
        "asyncio",
    ]

    proc = subprocess.Popen(
        cmd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=os.path.dirname(os.path.abspath(__file__)),
    )

    threading.Thread(
        target=stream_output,
        args=(proc.stdout, f"[{engine['prefix']}-GW:{engine['gateway_port']}]"),
        daemon=True,
    ).start()
    return proc


def launch_translation_api() -> subprocess.Popen:
    env = os.environ.copy()
    env["PORT"] = str(TRANSLATION_PORT)
    env["SERVER_URL"] = env.get("SERVER_URL") or f"http://localhost:{TRANSLATION_PORT}"
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    for index, key in enumerate(API_KEYS[:5], start=1):
        env[f"GEMINI_API_KEY_{index}"] = key
    if API_KEYS and not env.get("GEMINI_API_KEY_1"):
        env["GEMINI_API_KEY_1"] = API_KEYS[0]

    cmd = [
        PYTHON,
        "-m",
        "uvicorn",
        TRANSLATION_MODULE,
        "--host",
        HOST_IP,
        "--port",
        str(TRANSLATION_PORT),
        "--workers",
        "1",
        "--log-level",
        "info",
        "--loop",
        "asyncio",
    ]

    proc = subprocess.Popen(
        cmd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=os.path.dirname(os.path.abspath(__file__)),
    )

    threading.Thread(
        target=stream_output,
        args=(proc.stdout, f"[TR:{TRANSLATION_PORT}]"),
        daemon=True,
    ).start()
    return proc


def shutdown(sig=None, frame=None) -> None:
    print("\nStopping all ADS tool backends...")
    stop_event.set()
    for process in processes:
        try:
            process.terminate()
        except Exception:
            pass
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    print("All backend ports stopped safely.")
    sys.exit(0)


signal.signal(signal.SIGINT, shutdown)
signal.signal(signal.SIGTERM, shutdown)

# ==========================================
# BOOT SEQUENCE
# ==========================================
print(f"\nBOOTING ADS PRODUCTION TOOL BACKENDS on {HOST_IP}")
print(f"Keys in pool: {len(API_KEYS)}\n")
validate_engine_config()
ensure_ports_available()
warn_if_redis_unavailable()

STD_KEYS = API_KEYS
LANG_KEYS = API_KEYS
QUESTION_KEYS = API_KEYS

ENGINE_KEYS = {
    "standard": STD_KEYS,
    "language": LANG_KEYS,
    "question": QUESTION_KEYS,
}

print(f"   Standard Engine  -> {len(STD_KEYS)} key(s)")
print(f"   Language Engine  -> {len(LANG_KEYS)} key(s)")
print(f"   Question Crafter -> {len(QUESTION_KEYS)} key(s)\n")
print(f"   Translation API  -> {min(len(API_KEYS), 5)} key slot(s), port {TRANSLATION_PORT}\n")

for engine in ENGINES:
    ports = engine["ports"]
    engine_pool = ENGINE_KEYS[engine["key_pool"]]

    print(f"--- Booting {engine['name']} ({len(ports)} port(s), {len(engine_pool)} key(s)) ---")
    assigned_port_keys = distribute_keys(engine_pool, len(ports))
    key_summary = ", ".join(f"{port}:{len(assigned_port_keys[index])}" for index, port in enumerate(ports))
    print(f"    Key distribution per port -> {key_summary}")
    for index, port in enumerate(ports):
        proc = launch_port(port, assigned_port_keys[index], engine)
        processes.append(proc)
        time.sleep(0.2)
    gateway_proc = launch_gateway(engine)
    processes.append(gateway_proc)
    print(f"    Gateway live on {engine['gateway_port']} -> {ports[0]}-{ports[-1]}")
    time.sleep(0.2)

print(f"--- Booting Translation API ({TRANSLATION_PORT}) ---")
translation_proc = launch_translation_api()
processes.append(translation_proc)
print(f"    Translation API live on {TRANSLATION_PORT}")
time.sleep(0.2)

print(f"\nAll backend clusters live. Total active processes: {len(processes)}. Press Ctrl+C to stop.")
print("=" * 60 + "\n")

try:
    while not stop_event.is_set():
        time.sleep(1)
except KeyboardInterrupt:
    shutdown()
