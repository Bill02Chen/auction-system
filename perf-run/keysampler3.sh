#!/bin/bash
# 每秒采样 Redis 键与 MySQL 价格（带 2 秒超时，避免被 CLIENT PAUSE 卡住）。
OUT=perf-run/keysampler3.log
RCLI="redis-cli -h 127.0.0.1 -p 6379 -t 2 --raw"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-change-me}"
RMYSQL="docker exec auction-master-mysql mysql -uroot -p${MYSQL_PASSWORD} -N -s -e"
echo "iso,redis_up,state_price,state_status,ranking_zcard,pending_llen,mysql_price,note" > "$OUT"
for i in $(seq 1 400); do
  ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  PONG=$($RCLI PING 2>/dev/null)
  if [ "$PONG" = "PONG" ]; then
    RU=1
    SP=$($RCLI HGET auction:state:test-auction-001 currentPrice 2>/dev/null)
    SS=$($RCLI HGET auction:state:test-auction-001 status 2>/dev/null)
    ZC=$($RCLI ZCARD auction:ranking:test-auction-001 2>/dev/null)
    LL=$($RCLI LLEN auction:bid:pending:queue 2>/dev/null)
  else
    RU=0; SP=""; SS=""; ZC=""; LL=""
  fi
  MY=$($RMYSQL "SELECT CONCAT(current_price,'|',status) FROM auction_master.auctions WHERE id='test-auction-001'" 2>/dev/null | grep -v Warning | head -1)
  MP=${MY%%|*}
  echo "$ISO,$RU,$SP,$SS,$ZC,$LL,$MP," >> "$OUT"
  sleep 1
done
