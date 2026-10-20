const { v4: uuidv4 } = require('uuid');
const metrics = require('./metrics');

class DistributedLock {
  constructor(redisClient) {
    this.redis = redisClient;
    this.LOCK_SCRIPT = `
      if redis.call('set', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
        return 1
      else
        return 0
      end
    `;
    this.UNLOCK_SCRIPT = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `;
  }

  async acquire(lockKey, timeoutMs = 3000) {
    const lockValue = uuidv4();
    metrics.recordLockAttempt();
    const result = await this.redis.eval(this.LOCK_SCRIPT, {
      keys: [lockKey],
      arguments: [lockValue, timeoutMs.toString()]
    });
    if (result === 1) {
      return lockValue;
    }
    return null;
  }

  async release(lockKey, lockValue) {
    const result = await this.redis.eval(this.UNLOCK_SCRIPT, {
      keys: [lockKey],
      arguments: [lockValue]
    });
    return result === 1;
  }

  // 有限重试 + 抖动退避。
  // 背景：原来只抢一次，抢不到立刻抛错。突发压测下 3000 个请求只有 1 个成功（见 施工单 #4 记录）。
  // 参数可用环境变量覆盖：
  //   LOCK_MAX_ATTEMPTS  最多尝试次数（含首次），默认 5
  //   LOCK_RETRY_BASE_MS 首次退避基数（毫秒），默认 15
  //   LOCK_RETRY_MAX_MS  单次退避上限（毫秒），默认 200
  //   LOCK_TTL_MS        锁自动过期时间（毫秒），默认 3000
  retryConfig() {
    return {
      maxAttempts: parseInt(process.env.LOCK_MAX_ATTEMPTS || '5', 10),
      baseDelayMs: parseInt(process.env.LOCK_RETRY_BASE_MS || '15', 10),
      maxDelayMs: parseInt(process.env.LOCK_RETRY_MAX_MS || '200', 10),
      ttlMs: parseInt(process.env.LOCK_TTL_MS || '3000', 10)
    };
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async withLock(lockKey, callback, timeoutMs) {
    const config = this.retryConfig();
    const ttlMs = typeof timeoutMs === 'number' ? timeoutMs : config.ttlMs;
    const maxAttempts = config.maxAttempts > 0 ? config.maxAttempts : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const lockValue = await this.acquire(lockKey, ttlMs);
      if (lockValue) {
        try {
          return await callback();
        } finally {
          await this.release(lockKey, lockValue);
        }
      }
      if (attempt === maxAttempts) {
        metrics.recordLockExhausted();
        throw new Error('获取分布式锁失败，系统繁忙，请稍后重试');
      }
      // 指数退避 + 全抖动，避免重试风暴同步化。
      const backoff = Math.min(config.baseDelayMs * Math.pow(2, attempt - 1), config.maxDelayMs);
      const jittered = Math.floor(Math.random() * backoff) + 1;
      metrics.recordLockRetry();
      await this.wait(jittered);
    }
    metrics.recordLockExhausted();
    throw new Error('获取分布式锁失败，系统繁忙，请稍后重试');
  }
}

module.exports = DistributedLock;
