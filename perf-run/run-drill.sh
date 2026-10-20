#!/bin/bash
# Redis 宕机演练驱动脚本。每一步都打时间戳。
LOG=perf-run/drill-actions.log
export HOMEBREW_NO_AUTO_UPDATE=1
RCLI="redis-cli -h 127.0.0.1 -p 6379"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-change-me}"
RMYSQL="docker exec auction-master-mysql mysql -uroot -p${MYSQL_PASSWORD} -N -s -e"
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOG"; }
mysql_price() { $RMYSQL "SELECT current_price FROM auction_master.auctions WHERE id='test-auction-001'" 2>/dev/null | grep -v Warning | head -1; }

say "=== DRILL START ==="
say "baseline redis state: $($RCLI HGET auction:state:test-auction-001 currentPrice 2>&1) | ranking zcard: $($RCLI ZCARD auction:ranking:test-auction-001 2>&1) | mysql: $(mysql_price)"

say "--- PHASE A: 进程宕机（数据保留） ---"
say "A1 执行 brew services stop redis"
brew services stop redis >> "$LOG" 2>&1
say "A2 停止返回，等待 20 秒（模拟宕机中）"
sleep 20
say "A3 宕机中 PING: $($RCLI PING 2>&1 | head -1)"
say "A4 执行 brew services start redis"
brew services start redis >> "$LOG" 2>&1
sleep 6
say "A5 启动后 PING: $($RCLI PING 2>&1 | head -1)"
say "A6 启动后 state: $($RCLI HGET auction:state:test-auction-001 currentPrice 2>&1 | head -1) | ranking zcard: $($RCLI ZCARD auction:ranking:test-auction-001 2>&1 | head -1)"
say "A7 等待 45 秒观察恢复"
sleep 45
say "A8 恢复后 mysql: $(mysql_price)"

say "--- PHASE B: 数据丢失（模拟宕机后无持久化） ---"
say "B1 删除前 state: $($RCLI HGET auction:state:test-auction-001 currentPrice 2>&1) | mysql: $(mysql_price)"
say "B2 删除 test-auction-001 的 Redis 键（state + ranking）"
$RCLI DEL auction:state:test-auction-001 auction:ranking:test-auction-001 >> "$LOG" 2>&1
say "B3 删除后立刻 state 存在性: $($RCLI EXISTS auction:state:test-auction-001 2>&1)"
say "B4 等待 30 秒观察自愈"
sleep 30
say "B5 自愈后 state: $($RCLI HGETALL auction:state:test-auction-001 2>/dev/null | tr '\n' ' ')"
say "B6 自愈后 ranking zcard: $($RCLI ZCARD auction:ranking:test-auction-001 2>&1) | mysql: $(mysql_price)"
say "B7 等待 20 秒观察探针出价后的价格"
sleep 20
say "B8 state: $($RCLI HGET auction:state:test-auction-001 currentPrice 2>&1) | mysql: $(mysql_price)"
say "=== DRILL END ==="
