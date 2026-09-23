"""
core/task_manager.py

Менеджер синхронизации фоновых задач парсинга между устройствами (ПК, телефон).
Позволяет запустить перенос постов с компьютера, уйти, зайти с телефона,
увидеть статус в реальном времени и остановить или запустить новую задачу.
"""

from typing import Dict, Any, List
from datetime import datetime

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
            "updated_at": datetime.utcnow().isoformat(),
        }

    def get_state(self) -> Dict[str, Any]:
        return dict(self.state)

    def update_state(self, updates: Dict[str, Any]):
        if updates.get("is_running"):
            self.state["should_stop"] = False
            updates["should_stop"] = False
            if not self.state.get("is_running"):
                self.state["started_at"] = datetime.utcnow().isoformat()
        self.state.update(updates)
        self.state["updated_at"] = datetime.utcnow().isoformat()

    def start(self, module: str = "store", donor: str = "", targets: list = None, total: int = 0):
        self.state["is_running"] = True
        self.state["is_live_monitoring"] = False
        self.state["should_stop"] = False
        self.state["module"] = module
        if donor:
            self.state["donor"] = donor
        if targets is not None:
            self.state["targets"] = targets
        if total:
            self.state["total"] = total
        self.state["current"] = 0
        self.state["status_message"] = "Запуск процесса..."
        self.state["started_at"] = datetime.utcnow().isoformat()
        self.state["updated_at"] = datetime.utcnow().isoformat()

    def stop(self):
        self.state["is_running"] = False
        self.state["is_live_monitoring"] = False
        self.state["should_stop"] = True
        self.state["status_message"] = "Остановлено пользователем"
        self.state["updated_at"] = datetime.utcnow().isoformat()

    def reset_stop(self):
        self.state["should_stop"] = False
        self.state["updated_at"] = datetime.utcnow().isoformat()

    def add_log(self, title: str, text: str, status: str = "info"):
        log_entry = {
            "title": title,
            "text": text,
            "status": status,
            "timestamp": datetime.utcnow().strftime("%H:%M:%S")
        }
        logs = self.state.get("logs", [])
        self.state["logs"] = [log_entry] + logs[:49]  # храним последние 50 записей


task_manager = BackgroundTaskManager()
