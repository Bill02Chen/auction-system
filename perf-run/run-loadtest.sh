#!/bin/bash
# 压测运行器：负责「stdout 落盘 + 环境指纹 + 服务端指标 + 命名规范」。
# 用法: bash perf-run/run-loadtest.sh <场景名> [并发用户数] [每人出价次数] [发送节奏ms]
# 例:   bash perf-run/run-loadtest.sh baseline 1000 3 50     # 原始节奏（约 20 次/秒）
#       bash perf-run/run-loadtest.sh burst    1000 3 0      # 突发（无节流）
# 输出: perf-run/logs/<时间戳>-<场景名>-<并发>u-x<次数>[-pace<N>].log
set -u
SCENARIO="${1:?用法: bash perf-run/run-loadtest.sh <场景名> [并发用户数] [每人出价次数] [发送节奏ms]}"
USERS="${2:-1000}"
BIDS="${3:-3}"
PACE="${4:-50}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGDIR="$ROOT/perf-run/logs"
mkdir -p "$LOGDIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
SUFFIX=""
[ "$PACE" != "50" ] && SUFFIX="-pace${PACE}"
LOG="$LOGDIR/${STAMP}-${SCENARIO}-${USERS}u-x${BIDS}${SUFFIX}.log"
PRETTY='let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(d),null,2))}catch(e){console.log(d)}})'

echo "健康检查: http://localhost:3002/api/health"
if ! curl -s -m 5 http://localhost:3002/api/health > /dev/null; then
  echo "❌ 后端未运行（端口 3002 无响应）。先执行: cd backend && node src/index.js"
  exit 1
fi

{
  echo "===== 压测轮次 ====="
  echo "场景: $SCENARIO"
  echo "并发用户数: $USERS  每人出价次数: $BIDS  预计总出价: $((USERS * BIDS))"
  echo "发送节奏: $([ "$PACE" = "0" ] && echo '突发（无节流）' || echo "${PACE} ms/次")"
  echo "提示: 压测前用 QUIET_SOCKET_LOG=1 启动后端，避免逐连接同步日志影响结果"
} > "$LOG"

bash "$ROOT/perf-run/env-fingerprint.sh" "$LOG" > /dev/null 2>&1

cd "$ROOT/backend" || exit 1

echo "" >> "$LOG"
echo "===== setup-test-auction.js =====" >> "$LOG"
node setup-test-auction.js >> "$LOG" 2>&1
SETUP_EXIT=$?
echo "SETUP_EXIT=$SETUP_EXIT" >> "$LOG"
if [ "$SETUP_EXIT" -ne 0 ]; then
  echo "❌ 竞拍初始化失败，见 $LOG"
  exit 1
fi

# 服务端指标清零，作为本轮基线
echo "" >> "$LOG"
echo "===== 服务端指标（压测前，已清零） =====" >> "$LOG"
curl -s -m 5 "http://localhost:3002/api/metrics?reset=1" | node -e "$PRETTY" >> "$LOG" 2>&1

echo "" >> "$LOG"
echo "===== test-high-concurrency.js（并发 ${USERS}，每人 ${BIDS} 次，节奏 ${PACE} ms） =====" >> "$LOG"
CONCURRENT_USERS="$USERS" BIDS_PER_USER="$BIDS" PACE_MS="$PACE" \
  CONNECT_TIMEOUT_MS="${CONNECT_TIMEOUT_MS:-5000}" \
  node test-high-concurrency.js >> "$LOG" 2>&1
TEST_EXIT=$?
echo "TEST_EXIT=$TEST_EXIT" >> "$LOG"

echo "" >> "$LOG"
echo "===== 服务端指标（压测后） =====" >> "$LOG"
curl -s -m 5 "http://localhost:3002/api/metrics" | node -e "$PRETTY" >> "$LOG" 2>&1

echo "日志: $LOG"
[ "$TEST_EXIT" -eq 0 ] || echo "⚠️ 压测脚本退出码 ${TEST_EXIT}，请查看日志"
