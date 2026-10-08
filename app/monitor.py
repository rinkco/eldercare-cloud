"""后台离线巡检：周期检查超过 120 秒无消息的设备。"""

import logging
import threading

from app.alerts import sweep_offline_devices
from app.db import SessionLocal

logger = logging.getLogger("eldercare.monitor")


class OfflineMonitor:
    def __init__(self, interval_seconds: float = 15.0) -> None:
        self._interval = interval_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name="offline-monitor", daemon=True
        )
        self._thread.start()
        logger.info("离线巡检已启动，间隔 %.0f 秒", self._interval)

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            if self._thread.is_alive():
                logger.warning("离线巡检线程未在 5 秒内停止，保留引用避免重复启动")
            else:
                self._thread = None

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                with SessionLocal() as db:
                    events = sweep_offline_devices(db)
                if events:
                    logger.info("离线巡检生成 %d 条设备离线告警", len(events))
            except Exception:
                logger.exception("离线巡检失败")


offline_monitor = OfflineMonitor()
