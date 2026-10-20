#!/bin/bash
# Redis 宕机演练（第二轮）。目标：真挂起 / 真崩溃 / 真丢数据 三种情形。
LOG=perf-run/drill2-actions.log
RCLI="redis-cli -h 127.0.0.1 -p 6379"
RCLIT="redis-cli -h 127.0.0.1 -p 6379 -t 2"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-change-me}"
RMYSQL="docker exec auction-master-mysql mysql -uroot -p${MYSQL_PASSWORD} -N -s -e"
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOG"; }
mp() { $RMYSQL "SELECT current_price FROM auction_master.auctions WHERE id='test-auction-001'" 2>/dev/null | grep -v Warning | head -1; }
sp() { $RCLIT HGET auction:state:test-auction-001 currentPrice 2>/dev/null; }
zc() { $RCLIT ZCARD auction:ranking:test-auction-001 2>/dev/null; }

say "=== DRILL2 START ==="
say "baseline: redis_price=$(sp) redis_zcard=$(zc) mysql_price=$(mp)"

say "--- P1: Redis 挂起 25 秒（CLIENT PAUSE ALL） ---"
say "P1 t0 发起 CLIENT PAUSE 25000 ALL"
$RCLI CLIENT PAUSE 25000 ALL >> "$LOG" 2>&1
sleep 30
say "P1 结束后 PING=$($RCLIT PING 2>&1 | head -1) state=$(sp) mysql=$(mp)"

say "--- P2: Redis 崩溃（SHUTDOWN NOSAVE）+ launchd 自动拉起 ---"
say "P2 t0 发起 SHUTDOWN NOSAVE"
$RCLIT SHUTDOWN NOSAVE >> "$LOG" 2>&1
DS=$(date +%s); REC=""
for i in $(seq 1 240); do
  P=$(redis-cli -h 127.0.0.1 -p 6379 -t 1 PING 2>/dev/null)
  if [ "$P" = "PONG" ]; then REC="yes"; break; fi
  sleep 0.5
done
DE=$(date +%s)
say "P2 恢复：down≈$((DE-DS))s，轮询次数=$i，恢复=$( [ -n "$REC" ] && echo 是 || echo 否 )"
sleep 15
say "P2 恢复后 state=$(sp) redis_zcard=$(zc) mysql=$(mp)"

say "--- P3: 数据丢失（删除该竞拍的 Redis 键） ---"
say "P3 删除前: redis_price=$(sp) redis_zcard=$(zc) mysql_price=$(mp)"
$RCLI DEL auction:state:test-auction-001 auction:ranking:test-auction-001 >> "$LOG" 2>&1
D0=$(date +%s)
FIRST=""
for i in $(seq 1 60); do
  E=$($RCLIT EXISTS auction:state:test-auction-001 2>/dev/null)
  if [ "$E" = "1" ]; then FIRST=$(( $(date +%s) - D0 )); break; fi
  sleep 0.5
done
say "P3 自愈完成：state 重建耗时≈${FIRST}s（轮询 $i 次），重建后 redis_price=$(sp) mysql_price=$(mp)"
sleep 25
say "P3 25 秒后: redis_price=$(sp) redis_zcard=$(zc) mysql_price=$(mp)"
say "P3 MySQL bids 表最高价: $($RMYSQL "SELECT MAX(price) FROM auction_master.bids WHERE auction_id='test-auction-001'" 2>/dev/null | grep -v Warning | head -1)"
say "=== DRILL2 END ==="
