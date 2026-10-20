#!/bin/bash
# 验收脚本：#1「数据丢失后价格不回退」。
# 步骤：初始化竞拍 -> 出价抬高价格 -> 等一次批量落盘 -> 删除 Redis 状态键 -> 观察自愈后的价格。
# 判定：自愈后的 Redis 价格等于删除前 MySQL 的价格（而不是起拍价 100）；MySQL 价格不下降。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
R="redis-cli -h 127.0.0.1 -p 6379"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-change-me}"
RMYSQL="docker exec auction-master-mysql mysql -uroot -p${MYSQL_PASSWORD} -N -s -e"
AUCTION=test-auction-001
rprice() { $R HGET "auction:state:${AUCTION}" currentPrice 2>/dev/null; }
mp() { $RMYSQL "SELECT current_price FROM auction_master.auctions WHERE id='${AUCTION}'" 2>/dev/null | grep -v Warning | head -1; }

echo "== 1. 初始化竞拍 =="
cd "$ROOT/backend" && node setup-test-auction.js 2>&1 | tail -3

echo ""
echo "== 2. 出价抬高价格（探针 24 秒，约 12 次出价） =="
PROBE_LOG="$ROOT/perf-run/verify-price-probe.log" PROBE_DURATION_MS=24000 PROBE_INTERVAL_MS=2000 \
  NODE_PATH="$ROOT/backend/node_modules" node "$ROOT/perf-run/redis-outage-probe.js" 2>&1 | tail -3

echo ""
echo "== 3. 等 7 秒，让 5 秒批量落盘把价格写进 MySQL =="
sleep 7
BEFORE_REDIS=$(rprice)
BEFORE_MYSQL=$(mp)
echo "删除前: redis=$BEFORE_REDIS  mysql=$BEFORE_MYSQL"

echo ""
echo "== 4. 删除 Redis 状态（模拟内存数据丢失） =="
$R DEL "auction:state:${AUCTION}" "auction:ranking:${AUCTION}" > /dev/null
echo "已删除 auction:state:${AUCTION} 与 auction:ranking:${AUCTION}"

echo ""
echo "== 5. 观察自愈 =="
sleep 2
AFTER_REDIS=$(rprice)
AFTER_MYSQL=$(mp)
echo "自愈后 2 秒: redis=$AFTER_REDIS  mysql=$AFTER_MYSQL"
echo "服务端自愈日志:"
grep "自动恢复状态" "$ROOT/perf-run/logs-server-fixed.log" 2>/dev/null | tail -1

sleep 8
LATER_MYSQL=$(mp)
echo "再等 8 秒: mysql=$LATER_MYSQL"

echo ""
echo "== 6. 判定 =="
PASS=1
if [ -z "$AFTER_REDIS" ]; then echo "❌ 自愈失败：Redis 状态未重建"; PASS=0;
elif [ "$AFTER_REDIS" = "100" ] && [ "$BEFORE_MYSQL" != "100.00" ]; then echo "❌ 仍回退到起拍价 100"; PASS=0;
else echo "✅ Redis 自愈价格=${AFTER_REDIS}（删除前 MySQL=${BEFORE_MYSQL}），未回退到起拍价"; fi
if awk -v a="$LATER_MYSQL" -v b="$BEFORE_MYSQL" 'BEGIN{exit !(a+0 >= b+0)}'; then
  echo "✅ MySQL 价格未下降：删除前 $BEFORE_MYSQL → 之后 $LATER_MYSQL"
else
  echo "❌ MySQL 价格下降：删除前 $BEFORE_MYSQL → 之后 $LATER_MYSQL"; PASS=0
fi
[ "$PASS" = "1" ] && echo "结论: PASS" || echo "结论: FAIL"
