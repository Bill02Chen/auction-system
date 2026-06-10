const redis = require('redis');

let redisClient;

async function initRedis() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  const config = {
    url: redisUrl
  };
  
  redisClient = redis.createClient(config);
  
  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  redisClient.on('connect', () => console.log('Redis Client Connected'));
  
  await redisClient.connect();
  return redisClient;
}

function getRedisClient() {
  return redisClient;
}

module.exports = { initRedis, getRedisClient };
