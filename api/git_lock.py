import threading
from contextlib import contextmanager

_locks: dict[str, threading.RLock] = {}
_registry_lock = threading.Lock()


def _get_lock(name: str) -> threading.RLock:
    with _registry_lock:
        if name not in _locks:
            _locks[name] = threading.RLock()
        return _locks[name]


@contextmanager
def workspace_write_lock(name: str, timeout: float = 30.0):
    lock = _get_lock(name)
    acquired = lock.acquire(timeout=timeout)
    if not acquired:
        from .errors import server_error
        raise server_error("Another git operation is in progress for this workspace")
    try:
        yield
    finally:
        lock.release()
