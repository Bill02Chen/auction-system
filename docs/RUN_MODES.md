# 运行模式说明

本系统支持两种运行模式，配置方式不同：

---

## 模式1：开发模式（推荐）- 后端在宿主机直接运行，MySQL/Redis 在 Docker 内

这是最常用的开发模式，配置如下：

### .env 配置
```env
PORT=3002

# 二选一：宿主机 Redis（6379）或 docker-compose 的 Redis 容器（6380）
REDIS_URL=redis://127.0.0.1:6379
# REDIS_URL=redis://127.0.0.1:6380

MYSQL_HOST=localhost
MYSQL_PORT=3307
MYSQL_USER=root
MYSQL_PASSWORD=change-me
MYSQL_DATABASE=auction_master
```

### 启动步骤
```bash
# 1. 启动 Docker 容器（只运行 MySQL 和 Redis）
docker-compose up -d

# 2. 直接在宿主机运行后端
cd backend
npm install
node src/production-demo.js
```

### 验证数据
```bash
# 方式1：在宿主机用 redis-cli 直接连接
redis-cli -p 6379
# 若用容器 Redis，改为 redis-cli -p 6380
KEYS auction:*

# 方式2：进入 Docker 容器查看
docker exec -it auction-master-redis redis-cli
KEYS auction:*
```

---

## 模式2：全 Docker 模式 - 所有服务都在 Docker 内

后端也打包成 Docker 镜像，和 MySQL/Redis 在同一个 Docker 网络内。

### .env 配置
```env
PORT=3002

# 使用 Docker 服务名作为 hostname
REDIS_URL=redis://redis:6379

MYSQL_HOST=mysql
MYSQL_PORT=3306  # 注意：Docker 网络内直接用容器内部端口 3306
MYSQL_USER=root
MYSQL_PASSWORD=change-me
MYSQL_DATABASE=auction_master
```

---

## 端口映射对照表

| 服务 | Docker 容器内部端口 | 宿主机访问端口 |
|------|-------------------|--------------|
| MySQL | 3306 | 3307 |
| Redis | 6379 | 6380（容器）/ 6379（宿主机） |
