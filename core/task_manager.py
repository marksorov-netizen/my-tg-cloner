"""
core/task_manager.py

Менеджер синхронизации фоновых задач парсинга между устройствами (ПК, телефон).
Позволяет запустить перенос постов с компьютера, уйти, зайти с телефона,
увидеть статус в реальном времени и остановить или запустить новую задачу.
"""

from typing import Dict, Any
from datetime import datetime, timezone
from copy import deepcopy


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

class BackgroundTaskManager:
    def __init__(self):
        self.state: Dict[str, Any] = {
            "is_running": False,
            "is_live_monitoring": False,
            "module": "store",  # "store" | "parser"
            "donor": "",
            "targets": [],
            "current": 0,
            "total": 0,
            "status_message": "Готов к работе",
            "countdown_sec": 0,
            "logs": [],
            "should_stop": False,
            "started_at": None,
            "updated_at": _now(),
        }

    def get_state(self) -> Dict[str, Any]:
        return deepcopy(self.state)

    def update_state(self, updates: Dict[str, Any]):
        # A delayed progress request must not undo a remote stop. Only start() resumes.
        if self.state["should_stop"] and updates.get("is_running"):
            return
        allowed = {
            "is_running", "is_live_monitoring", "module", "donor", "targets",
            "current", "total", "status_message", "countdown_sec",
        }
        safe_updates = {key: deepcopy(value) for key, value in updates.items() if key in allowed}
        if safe_updates.get("is_running"):
            if not self.state.get("is_running"):
                self.state["started_at"] = _now()
        self.state.update(safe_updates)
        if self.state["should_stop"]:
            self.state["is_running"] = False
            self.state["is_live_monitoring"] = False
        self.state["updated_at"] = _now()

    def start(self, module: str = "store", donor: str = "", targets: list = None, total: int = 0):
        self.state["is_running"] = True
        self.state["is_live_monitoring"] = False
        self.state["should_stop"] = False
        self.state["module"] = module
        self.state["donor"] = donor
        self.state["targets"] = list(targets or [])
        self.state["total"] = total
        self.state["current"] = 0
        self.state["status_message"] = "Запуск процесса..."
        self.state["countdown_sec"] = 0
        self.state["started_at"] = _now()
        self.state["updated_at"] = _now()

    def stop(self):
        self.state["is_running"] = False
        self.state["is_live_monitoring"] = False
        self.state["should_stop"] = True
        self.state["status_message"] = "Остановлено пользователем"
        self.state["updated_at"] = _now()

    def add_log(self, title: str, text: str, status: str = "info"):
        log_entry = {
            "title": title,
            "text": text,
            "status": status,
            "timestamp": datetime.now(timezone.utc).strftime("%H:%M:%S")
        }
        logs = self.state.get("logs", [])
        self.state["logs"] = [log_entry] + logs[:49]  # храним последние 50 записей


class UserTaskManagers:
    """One progress/stop state per authenticated owner, shared across their devices.

    Still process-local; not a durable job queue and not shared between workers.
    """
    def __init__(self):
        self._managers: Dict[str, BackgroundTaskManager] = {}

    def for_user(self, user_id: str) -> BackgroundTaskManager:
        if not user_id:
            raise ValueError("Task owner is required")
        if user_id not in self._managers:
            self._managers[user_id] = BackgroundTaskManager()
        return self._managers[user_id]


task_managers = UserTaskManagers()
