# 实时竞拍大师 — 直播电商竞拍全栈系统

[作品集](https://bill02chen.github.io/chenyanrui-site/) · [GitHub](https://github.com/Bill02Chen)

面向直播竞拍的高并发全栈系统：React + TypeScript 前端，Node.js + Socket.IO
后端，Redis 承担出价主链路，MySQL 负责持久化。项目为 2026 字节跳动 AI 全栈
挑战赛个人参赛作品。

**关键结果：** 单直播间 1,000 并发 WebSocket 连接下，本机压测出价成功率
98.4%，客户端往返延迟平均 11.4 ms、P99 65 ms；同毫秒突发成交率从 0.03% 提升
到 100%，下行广播消息量降低约 430 倍。

> 上述数字是本机压测结果，不是生产 SLA。压测脚本未随仓库提交，复现口径见
> 「证据」一节。

## 问题

直播竞拍的核心矛盾是「毫秒级同步」与「数据不能丢」：

1. 每次出价同步写 MySQL，延迟随并发上升，无法支撑单直播间 1,000+ 连接。
2. Redis 宕机或重启会丢失当前竞拍状态，出价、排行榜和倒计时全部中断。
3. 同一毫秒的并发出价会超卖，或者出现后到出价覆盖先到出价。
4. 多个直播间同时运行时，消息必须按房间隔离，不能串播。
5. 主播后台需要实时看到价格、倒计时和 Top 排名。

## 做法

### 出价链路：纯 Redis 内存操作

- 出价全程在 Redis 内完成，不同步写 MySQL；
- 用 **Lua 脚本**原子执行「校验价格 → 校验用户 → 扣减/写入 → 更新 ZSet」，
  避免并发覆盖；
- 排行榜使用 **ZSet**，O(logN) 更新；
- 用户级限流，防止单用户刷价；
- 出价先进入待落盘队列，**每 5 秒批量写入 MySQL**，降低数据库 IO。

### 状态恢复与自愈

- 三个心跳任务：1 秒状态自愈、10 秒数据同步、5 秒定时落盘；
- Redis 状态丢失后，从 MySQL 重建竞拍状态并回放排行榜，目标是在一个心跳
  （约 1 秒）内恢复；
- 进程重启后自动恢复活跃竞拍，业务不依赖人工干预。

### 实时通信

- Socket.IO 按直播间分房间，出价、价格、倒计时和排名按房间广播；
- 前端 React + TypeScript，用户端包含直播间、我的订单；后台包含发布、商品
  管理、实时监控和订单管理；
- 仓库提供 `docker-compose.yml` 模板，补全 MySQL 8.0 / Redis 7.2 服务后即可启动；也可以连接已有实例。

```text
React + TS ──HTTP/WebSocket── Node.js + Socket.IO
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
              Redis 7.2                    MySQL 8.0
        Lua 原子出价 / ZSet 排行        竞拍、出价、订单
        限流 / 待落盘队列 / 在线集合     批量落盘 + 状态重建
```

## 关键结果

本机压测，单直播间 1,000 并发 WebSocket 连接：

| 指标 | 结果 |
| --- | --- |
| 出价成功率 | 98.4% |
| 客户端往返延迟 | 平均 11.4 ms / P99 65 ms |
| 同毫秒突发成交率 | 0.03% → 100%（平均 199 ms） |
| 下行广播消息量 | 降低约 430 倍 |
| Redis 状态丢失恢复 | 约 1 个心跳（1 秒）内从 MySQL 重建 |
| 数据库写入 | 5 秒批量落盘，非同步写 |

需要注意：这些是单机本地压测数据，测试机配置、客户端数量和压测方法未随仓库
固化；它们说明设计方向有效，不等同于生产容量承诺。

## 证据

- 出价主链路：[auctionService.js](backend/src/services/auctionService.js)
- Redis 操作与 Lua：[redisService.js](backend/src/services/redisService.js)
- 原子锁：[distributedLock.js](backend/src/utils/distributedLock.js)
- WebSocket 房间与心跳：[socketServer.js](backend/src/socketServer.js)
- 生产演示入口：[production-demo.js](backend/src/production-demo.js)
- 架构说明：[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)
- 数据库初始化：[init.sql](backend/init.sql)
- Compose 模板：[docker-compose.yml](docker-compose.yml)（需补全 services）
- 前端页面：[frontend/src/pages](frontend/src/pages)

压测脚本目前不在仓库内。若要复现，需要补一个客户端压测脚本，记录机器配置、
连接数、出价频率和延迟统计口径；当前 README 只报告已有结果，不把「预期值」
写成「实测值」。

## 快速启动

```sh
# 1. 准备 MySQL 8.0 + Redis 7.2。
#    仓库内 docker-compose.yml 是模板，先补全 mysql/redis 服务再执行；
#    也可以直接连接本机或远程实例。
docker-compose up -d

# 2. 启动后端
cd backend
cp .env.example .env
npm install
node src/production-demo.js

# 3. 启动前端（新终端）
cd frontend
npm install
npm run dev
```

- 用户端：<http://localhost:5173>
- 管理后台：<http://localhost:5173/admin>
- 健康检查：<http://localhost:3002/api/health>

管理员账号的代码默认值是 `admin` / `admin123`，可由 `ADMIN_USERNAME`、
`ADMIN_PASSWORD` 和 `ADMIN_PASSWORD_SALT` 覆盖。部署到公网前必须修改这三个值。

## 配置

后端环境变量位于 `backend/.env`，完整列表见 `.env.example`。关键项：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | 3002 | 后端 HTTP 端口（代码默认） |
| `REDIS_URL` | `redis://localhost:6379` | Redis 地址 |
| `MYSQL_HOST` / `MYSQL_PORT` | localhost / 3306 | MySQL 地址 |
| `MYSQL_DATABASE` | `auction_master` | 数据库名 |
| `SEED_DEMO_DATA` | `auto` | `auto` / `force` / `never` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123` | 代码默认值，部署前修改 |

## 目录

```text
backend/
  src/
    config/            MySQL、Redis 连接
    services/          auctionService、redisService
    utils/             distributedLock
    socketServer.js    WebSocket 房间与心跳
    production-demo.js 生产演示入口
  init.sql             表结构
frontend/
  src/pages/           用户直播间、订单、管理后台
docker-compose.yml     MySQL + Redis
TECHNICAL_ARCHITECTURE.md  分层、机制、定时任务
```

## 已知限制

- 压测脚本和原始日志未提交，复现需要自建压测客户端。
- 演示账号和默认盐值是公开的，只适合本地演示。
- `docker-compose.yml` 和 `.env.example` 是模板，不是开箱即用的完整配置。
- 单机部署；没有做多实例下的分布式协调和 Redis 集群方案。
- 前端偏演示性质，未做完整的支付、风控和审计。
