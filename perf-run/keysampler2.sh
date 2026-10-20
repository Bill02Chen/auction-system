#!/bin/bash
# 每秒采样 Redis 键与 MySQL 价格，用于测量自愈耗时。
# 注意：应用连的是宿主机 Homebrew Redis（127.0.0.1:6379），不是 docker 容器。
OUT=perf-run/keysampler2.log
RCLI="redis-cli -h 127.0.0.1 -p 6379 --raw"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-change-me}"
RMYSQL="docker exec auction-master-mysql mysql -uroot -p${MYSQL_PASSWORD} -N -s -e"
echo "iso,redis_up,state_price,state_endTime,state_status,ranking_zcard,pending_llen,mysql_price,mysql_status" > "$OUT"
for i in $(seq 1 400); do
  ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  PONG=$($RCLI PING 2>/dev/null)
  if [ "$PONG" = "PONG" ]; then
    RU=1
    SP=$($RCLI HGET auction:state:test-auction-001 currentPrice 2>/dev/null)
    SE=$($RCLI HGET auction:state:test-auction-001 endTime 2>/dev/null)
    SS=$($RCLI HGET auction:state:test-auction-001 status 2>/dev/null)
    ZC=$($RCLI ZCARD auction:ranking:test-auction-001 2>/dev/null)
    LL=$($RCLI LLEN auction:bid:pending:queue 2>/dev/null)
  else
    RU=0; SP=""; SE=""; SS=""; ZC=""; LL=""
  fi
  MY=$($RMYSQL "SELECT CONCAT(current_price,'|',status) FROM auction_master.auctions WHERE id='test-auction-001'" 2>/dev/null | grep -v Warning | head -1)
  MP=${MY%%|*}; MS=${MY##*|}
  echo "$ISO,$RU,$SP,$SE,$SS,$ZC,$LL,$MP,$MS" >> "$OUT"
  sleep 1
done
