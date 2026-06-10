const { v4: uuidv4 } = require('uuid');

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

  async withLock(lockKey, callback, timeoutMs = 3000) {
    const lockValue = await this.acquire(lockKey, timeoutMs);
    if (!lockValue) {
      throw new Error('获取分布式锁失败，系统繁忙，请稍后重试');
    }
    try {
      return await callback();
    } finally {
      await this.release(lockKey, lockValue);
    }
  }
}

module.exports = DistributedLock;
