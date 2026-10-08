#!/bin/sh
# 启动前根据 .env 中的凭据生成 Mosquitto 密码文件，
# 避免把明文口令或口令哈希提交到仓库。
set -eu

: "${MQTT_USER:?缺少 MQTT_USER 环境变量}"
: "${MQTT_PASSWORD:?缺少 MQTT_PASSWORD 环境变量}"

PASSWORD_FILE="/mosquitto/data/passwd"

# 每次启动按当前环境变量重建密码文件，保证 .env 是唯一凭据来源。
# 注意：mosquitto_passwd -c 不会覆盖已存在的文件，必须先删除。
rm -f "$PASSWORD_FILE"
mosquitto_passwd -b -c "$PASSWORD_FILE" "$MQTT_USER" "$MQTT_PASSWORD"

chown -R mosquitto:mosquitto /mosquitto/data 2>/dev/null || true
chmod 600 "$PASSWORD_FILE" 2>/dev/null || true

exec mosquitto -c /mosquitto/config/mosquitto.conf
