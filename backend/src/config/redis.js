const redis = require('redis');

let redisClient;
let lastFingerprint = null;

function parseInfo(text) {
  const result = {};
  String(text)
    .split('\n')
    .forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) {
        result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    });
  return result;
}

function describe(fingerprint) {
  return `executable=${fingerprint.executable} pid=${fingerprint.processId} port=${fingerprint.tcpPort} version=${fingerprint.redisVersion} uptime=${fingerprint.uptimeSeconds}s`;
}

// 读取实际连接的 Redis 实例指纹。用于发现「连接静默落到另一个实例」。
async function readRedisFingerprint(client) {
  const info = parseInfo(await client.info('server'));
  return {
    executable: info.executable || 'unknown',
    processId: info.process_id || 'unknown',
    tcpPort: info.tcp_port || 'unknown',
    redisVersion: info.redis_version || 'unknown',
    uptimeSeconds: info.uptime_in_seconds || 'unknown'
  };
}

async function selfCheck(client, label) {
  const fingerprint = await readRedisFingerprint(client);
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  console.log(`🔎 Redis 自检(${label}): url=${url} ${describe(fingerprint)}`);

  const expectExecutable = process.env.REDIS_EXPECT_EXECUTABLE;
  if (expectExecutable && fingerprint.executable !== expectExecutable) {
    const message = `Redis 实例与预期不符: 期望 executable=${expectExecutable}，实际 ${fingerprint.executable}（pid=${fingerprint.processId}）`;
    if (process.env.REDIS_STRICT === '0') {
      console.error(`❌ ${message}（REDIS_STRICT=0，仅告警）`);
    } else {
      console.error(`❌ ${message}。设置 REDIS_STRICT=0 可只告警。`);
      process.exit(1);
    }
  }

  if (lastFingerprint && (lastFingerprint.processId !== fingerprint.processId || lastFingerprint.executable !== fingerprint.executable)) {
    console.error(`❌ Redis 实例已变更: 之前 ${describe(lastFingerprint)} → 现在 ${describe(fingerprint)}。请确认缓存数据来源。`);
  }
  lastFingerprint = fingerprint;
  return fingerprint;
}

async function initRedis() {
  redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  });

  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  redisClient.on('connect', () => console.log('Redis Client Connected'));
  // ready 在首次连接和每次重连后触发。首次交给下面的显式自检（在 listen 之前完成），
  // 这里只负责「重连后实例变了」这种情况。
  let firstReady = true;
  redisClient.on('ready', () => {
    if (firstReady) return;
    selfCheck(redisClient, '重连就绪').catch((err) => {
      console.error('Redis 自检失败:', err.message);
    });
  });

  await redisClient.connect();
  await selfCheck(redisClient, '启动');
  firstReady = false;
  return redisClient;
}

function getRedisClient() {
  return redisClient;
}

module.exports = { initRedis, getRedisClient, readRedisFingerprint };
