"""日志脱敏工具：避免 JWT 等敏感查询参数进入访问日志。"""

import logging
import re


class SensitiveQueryFilter(logging.Filter):
    """把日志参数中的 token=xxx 替换为 token=***。"""

    _pattern = re.compile(r"(?i)(token=)[^&\s\"']+")

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(self._redact(item) for item in record.args)
        elif isinstance(record.args, dict):
            record.args = {
                key: self._redact(value)
                for key, value in record.args.items()
            }
        return True

    @classmethod
    def _redact(cls, value: object) -> object:
        if isinstance(value, str):
            return cls._pattern.sub(r"\1***", value)
        return value


def install_log_redaction() -> None:
    """给 uvicorn 的访问与错误日志器安装查询参数脱敏过滤器。

    注意：WebSocket 的 "[accepted]" 行由 uvicorn.error 记录，
    REST 访问行由 uvicorn.access 记录，两者都要覆盖。
    """
    redaction = SensitiveQueryFilter()
    for name in (
        "uvicorn",
        "uvicorn.error",
        "uvicorn.access",
        "uvicorn.asgi",
    ):
        logging.getLogger(name).addFilter(redaction)
