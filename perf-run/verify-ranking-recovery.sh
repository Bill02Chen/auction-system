#!/bin/bash
# 验收 #2：排行榜从 bids 表回放重建 + 价格对账 + 赢家兜底。
# 前置：后端已用新代码启动，MySQL 容器在跑。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
R="redis-cli -h 127.0.0.1 -p 6379"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-change-me}"
RMYSQL="docker exec auction-master-mysql mysql -uroot -p${MYSQL_PASSWORD} -N -s -e"
AUCTION=test-auction-001
SERVER_LOG="${SERVER_LOG:-$ROOT/perf-run/logs-server-final.log}"
api() { curl -s -m 8 "$@"; }
mysql_q() { $RMYSQL "$1" 2>/dev/null | grep -v Warning | head -1; }
rfield() { $R HGET "auction:state:${AUCTION}" "$1" 2>/dev/null; }

echo "== 1. 初始化测试竞拍（同时清理 Redis 排行榜） =="
cd "$ROOT/backend" && node setup-test-auction.js 2>&1 | grep -E "清理|准备完成"
echo "  初始化后 zcard=$($R ZCARD auction:ranking:${AUCTION})（期望 0）"

echo ""
echo "== 2. 20 个用户 x 2 次出价 =="
CONCURRENT_USERS=20 BIDS_PER_USER=2 PACE_MS=50 BID_TIMEOUT_MS=5000 node test-high-concurrency.js 2>&1 | grep -E "成功出价|失败出价|成功率" | head -3
sleep 7   # 等一次批量落盘

BIDS_MAX=$(mysql_q "SELECT MAX(price) FROM auction_master.bids WHERE auction_id='${AUCTION}'")
USERS=$(mysql_q "SELECT COUNT(DISTINCT user_id) FROM auction_master.bids WHERE auction_id='${AUCTION}'")
BEFORE_PRICE=$(rfield currentPrice)
BEFORE_ZCARD=$($R ZCARD "auction:ranking:${AUCTION}")
echo "  出价后: bids最高价=${BIDS_MAX} 不同用户数=${USERS} Redis价格=${BEFORE_PRICE} zcard=${BEFORE_ZCARD}"

echo ""
echo "== 3. 删除 Redis 的 state + ranking（模拟内存数据全丢） =="
$R DEL "auction:state:${AUCTION}" "auction:ranking:${AUCTION}" > /dev/null
echo "  已删除，等待 3 秒自愈"
sleep 3

AFTER_PRICE=$(rfield currentPrice)
AFTER_ZCARD=$($R ZCARD "auction:ranking:${AUCTION}")
TOP=$($R ZREVRANGE "auction:ranking:${AUCTION}" 0 0 WITHSCORES 2>/dev/null | tr '\n' ' ')
echo "  自愈后: Redis价格=${AFTER_PRICE} zcard=${AFTER_ZCARD}"
echo "  榜首: ${TOP}"
echo "  服务端日志:"
grep -E "自动恢复状态|排行榜已从 bids 表回放" "$SERVER_LOG" 2>/dev/null | tail -2 | sed 's/^/    /'

echo ""
echo "== 4. 判定 =="
PASS=1
if [ "$AFTER_PRICE" = "$BIDS_MAX" ] || [ "$(printf '%.0f' "$AFTER_PRICE")" = "$(printf '%.0f' "$BIDS_MAX")" ]; then
  echo "  ✅ 价格恢复正确: ${AFTER_PRICE} = bids 最高价 ${BIDS_MAX}"
else
  echo "  ❌ 价格不一致: Redis=${AFTER_PRICE} bids最高价=${BIDS_MAX}"; PASS=0
fi
if [ "$AFTER_ZCARD" = "$USERS" ]; then
  echo "  ✅ 排行榜回放完整: zcard=${AFTER_ZCARD} = 不同用户数 ${USERS}"
else
  echo "  ❌ 排行榜回放不完整: zcard=${AFTER_ZCARD}，期望 ${USERS}"; PASS=0
fi

echo ""
echo "== 5. 对账告警验证：把 MySQL 价格改低 =="
mysql_q "UPDATE auction_master.auctions SET current_price = 1 WHERE id='${AUCTION}'" > /dev/null
echo "  已把 MySQL current_price 改成 1，等待 12 秒对账周期"
sleep 12
WARN=$(grep "对账不一致" "$SERVER_LOG" 2>/dev/null | tail -1)
if [ -n "$WARN" ]; then echo "  ✅ 对账告警已触发: ${WARN}"; else echo "  ❌ 未看到对账告警"; PASS=0; fi

echo ""
echo "== 6. 赢家兜底验证：清空排行榜后结束竞拍 =="
$R DEL "auction:ranking:${AUCTION}" > /dev/null
echo "  已清空 ranking，调用管理端结束接口"
LOGIN_RAW=$(api -X POST http://localhost:3002/api/admin/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
TOKEN=$(echo "$LOGIN_RAW" | sed -E 's/.*"token":"([^"]+)".*/\1/')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "$LOGIN_RAW" ]; then
  echo "  ⚠️ 登录响应异常: ${LOGIN_RAW:-（空）}"
  PASS=0
fi
END_RESULT=$(api -X POST "http://localhost:3002/api/auctions/${AUCTION}/end" -H "x-admin-token: ${TOKEN}")
echo "  结束接口返回: $(echo "$END_RESULT" | head -c 200)"
sleep 2
ORDER=$(mysql_q "SELECT CONCAT(winner_name,'|',final_price) FROM auction_master.orders WHERE auction_id='${AUCTION}' ORDER BY created_at DESC LIMIT 1")
echo "  生成的订单(赢家|成交价): ${ORDER:-无}"
FB_LOG=$(grep "排行榜为空，已从 bids 表判定赢家" "$SERVER_LOG" 2>/dev/null | tail -1)
if [ -n "$ORDER" ]; then echo "  ✅ 赢家兜底生效: ${ORDER}"; else echo "  ❌ 未生成订单，兜底失败"; PASS=0; fi
[ -n "$FB_LOG" ] && echo "  兜底日志: ${FB_LOG}"

echo ""
[ "$PASS" = "1" ] && echo "结论: PASS" || echo "结论: FAIL"
