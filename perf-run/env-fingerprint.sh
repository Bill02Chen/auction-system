#!/bin/bash
# 输出压测环境指纹。用法：bash perf-run/env-fingerprint.sh [输出文件]
# 设计原则：只读，不修改任何状态。每次压测前跑一次，结果写进当轮日志头部。
set -u
RCLI="redis-cli -h 127.0.0.1 -p 6379"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-change-me}"
RMYSQL="docker exec auction-master-mysql mysql -uroot -p${MYSQL_PASSWORD} -N -s -e"
OUT="${1:-}"
# 有参数：追加写入该文件；无参数：直接打印到 stdout。
if [ -n "$OUT" ]; then exec >> "$OUT" 2>&1; fi

{
  echo "===== 环境指纹 ====="
  echo "采集时间: $(date -u +%Y-%m-%dT%H:%M:%SZ)（UTC） / $(date '+%Y-%m-%d %H:%M:%S %Z')（本机）"
  echo "主机: $(hostname)"
  echo "系统: $(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null) (Build $(sw_vers -buildVersion 2>/dev/null)) / $(uname -m)"
  echo "CPU: $(sysctl -n machdep.cpu.brand_string 2>/dev/null) / 逻辑核 $(sysctl -n hw.ncpu 2>/dev/null)"
  echo "内存: $(sysctl -n hw.memsize 2>/dev/null) 字节"
  echo "Node: $(node -v 2>/dev/null) ($(command -v node))"
  echo "npm: $(npm -v 2>/dev/null)"
  echo "Docker: $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
  REPO="$(dirname "$0")/.."
  HEAD_REV=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null)
  if [ -z "$HEAD_REV" ]; then HEAD_REV="无提交"; fi
  echo "代码版本: ${HEAD_REV} / 未提交改动文件数 $(git -C "$REPO" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

  echo "--- Redis（应用实际使用） ---"
  if [ "$($RCLI PING 2>/dev/null)" = "PONG" ]; then
    $RCLI INFO server 2>/dev/null | grep -E "redis_version|process_id|uptime_in_seconds|executable|config_file|tcp_port" | sed 's/^/  /'
    echo "  appendonly=$($RCLI CONFIG GET appendonly 2>/dev/null | tail -1)"
    echo "  save=$($RCLI CONFIG GET save 2>/dev/null | tail -1)"
    echo "  dir=$($RCLI CONFIG GET dir 2>/dev/null | tail -1)"
    echo "  keys=$($RCLI DBSIZE 2>/dev/null)"
  else
    echo "  ❌ 无法连接 127.0.0.1:6379"
  fi

  echo "--- MySQL ---"
  VER=$($RMYSQL "SELECT VERSION()" 2>/dev/null | grep -v Warning | head -1)
  if [ -n "$VER" ]; then
    echo "  version=$VER"
    echo "  auctions=$($RMYSQL "SELECT COUNT(*) FROM auction_master.auctions" 2>/dev/null | grep -v Warning | head -1) bids=$($RMYSQL "SELECT COUNT(*) FROM auction_master.bids" 2>/dev/null | grep -v Warning | head -1)"
  else
    echo "  ❌ 无法连接 MySQL 容器（localhost:3307）"
  fi

  echo "--- 容器 ---"
  docker ps --format "  {{.Names}} | {{.Image}} | {{.Ports}}" 2>/dev/null
  echo "===== 指纹结束 ====="
}
