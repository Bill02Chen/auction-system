require('dotenv').config();
const { initRedis, getRedisClient } = require('./src/config/redis');
const { initMySQL, getMySQLPool } = require('./src/config/mysql');
const AuctionService = require('./src/services/auctionService');

async function setupTestAuction() {
  console.log('🔧 正在初始化测试环境...');
  
  await initRedis();
  await initMySQL();
  
  const redisClient = getRedisClient();
  const auctionService = new AuctionService(redisClient);
  const pool = getMySQLPool();
  
  const testAuctionId = 'test-auction-001';
  
  console.log('🗑️  清理旧的测试数据...');
  await pool.query(`DELETE FROM bids WHERE auction_id = ?`, [testAuctionId]);
  await pool.query(`DELETE FROM orders WHERE auction_id = ?`, [testAuctionId]);
  await pool.query(`DELETE FROM auctions WHERE id = ?`, [testAuctionId]);
  // Redis 侧也要清：ranking 是 ZSet，历史轮次的高分成员会被 endAuction 当成赢家。
  await auctionService.redisService.clearRanking(testAuctionId);
  await redisClient.del(`auction:online:${testAuctionId}`);
  console.log('🧹 已清理 Redis 排行榜与在线集合');
  
  console.log('✨ 创建新的测试竞拍...');
  const [result] = await pool.query(
    `INSERT INTO auctions (id, name, image, description, start_price, current_price, min_increment, max_price, duration, auto_delay_seconds, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      testAuctionId,
      '高并发性能测试竞拍',
      '',
      '用于系统高并发性能测试的竞拍',
      100,
      100,
      1,
      999999,
      3600,
      15,
      'active'
    ]
  );
  
  const endTime = new Date(Date.now() + 3600 * 1000);
  await pool.query(
    `UPDATE auctions SET start_time = NOW(), end_time = ? WHERE id = ?`,
    [endTime, testAuctionId]
  );
  
  console.log('📤 初始化Redis竞拍状态...');
  await auctionService.redisService.initAuctionState({
    id: testAuctionId,
    name: '高并发性能测试竞拍',
    startPrice: 100,
    minIncrement: 1,
    maxPrice: 999999,
    duration: 3600,
    autoDelaySeconds: 15,
    status: 'active',
    endTime: endTime
  });
  
  console.log('✅ 测试环境准备完成！');
  console.log('');
  console.log('测试竞拍信息:');
  console.log(`  - ID: ${testAuctionId}`);
  console.log(`  - 初始价格: 100`);
  console.log(`  - 最小加价: 1`);
  console.log(`  - 封顶价格: 999999`);
  console.log(`  - 状态: active`);
  console.log(`  - 结束时间: ${endTime.toISOString()}`);
  console.log('');
  console.log('现在可以运行: node test-high-concurrency.js');
  
  process.exit(0);
}

setupTestAuction().catch(err => {
  console.error('❌ 初始化测试环境失败:', err);
  process.exit(1);
});
