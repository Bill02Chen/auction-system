require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { initRedis, getRedisClient } = require('./config/redis');
const { initMySQL, getMySQLPool } = require('./config/mysql');
const setupSocketServer = require('./socketServer');
const AuctionService = require('./services/auctionService');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_RAW = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_PASSWORD_SALT = process.env.ADMIN_PASSWORD_SALT || 'auction_master_secure_salt_2024';
const ADMIN_TOKEN_PREFIX = 'admin:token:';

const hashPassword = (password, salt) => {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex');
};

const ADMIN_PASSWORD_HASH = hashPassword(ADMIN_PASSWORD_RAW, ADMIN_PASSWORD_SALT);

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const adminAuthMiddleware = async (req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (!token) {
    return res.status(401).json({ success: false, message: '未登录，请先登录' });
  }
  const redisClient = getRedisClient();
  const stored = await redisClient.get(`${ADMIN_TOKEN_PREFIX}${token}`);
  if (!stored) {
    return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
  }
  next();
};

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

async function initializeDatabase() {
  console.log('正在初始化MySQL数据库...');
  const pool = getMySQLPool();
  
  await pool.query(`CREATE DATABASE IF NOT EXISTS auction_master DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`USE auction_master`);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auctions (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      image LONGTEXT,
      description TEXT,
      start_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      current_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      min_increment DECIMAL(12,2) NOT NULL DEFAULT 1,
      max_price DECIMAL(12,2) NOT NULL DEFAULT 999999,
      duration INT NOT NULL DEFAULT 300,
      auto_delay_seconds INT NOT NULL DEFAULT 15,
      status ENUM('pending', 'active', 'paused', 'ended', 'cancelled') DEFAULT 'pending',
      start_time DATETIME,
      end_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_end_time (end_time)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bids (
      id VARCHAR(36) PRIMARY KEY,
      auction_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      user_name VARCHAR(100),
      user_avatar LONGTEXT,
      price DECIMAL(12,2) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_auction_id (auction_id),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(36) PRIMARY KEY,
      auction_id VARCHAR(36) NOT NULL,
      winner_id VARCHAR(36) NOT NULL,
      winner_name VARCHAR(100),
      final_price DECIMAL(12,2) NOT NULL,
      status ENUM('pending_payment', 'paid', 'cancelled') DEFAULT 'pending_payment',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_auction_id (auction_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  
  console.log('MySQL数据库表结构初始化完成！');
}

const demoAuctionList = [
  {
    name: '稀世珠宝 - 天然钻石项链',
    image: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400',
    description: '18K白金镶嵌1克拉天然钻石，GIA认证，限量发售，极具收藏价值。',
    startPrice: 10000,
    minIncrement: 500,
    maxPrice: 500000,
    duration: 600,
    autoDelaySeconds: 15
  },
  {
    name: '限量潮玩 - 艺术家联名手办',
    image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400',
    description: '国际知名艺术家限量联名款，全球仅发售999体，编号001。',
    startPrice: 500,
    minIncrement: 50,
    maxPrice: 50000,
    duration: 300,
    autoDelaySeconds: 10
  },
  {
    name: '古董收藏 - 清代青花瓷瓶',
    image: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400',
    description: '清乾隆年间官窑青花瓷瓶，保存完好，附专业鉴定证书。',
    startPrice: 50000,
    minIncrement: 2000,
    maxPrice: 2000000,
    duration: 900,
    autoDelaySeconds: 20
  },
  {
    name: '数码尖货 - 最新款限量版手机',
    image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400',
    description: '品牌限定版旗舰手机，全球限量1000台，未拆封全新。',
    startPrice: 8000,
    minIncrement: 200,
    maxPrice: 30000,
    duration: 240,
    autoDelaySeconds: 15
  },
  {
    name: '奢华珠宝 - 天然红宝石戒指',
    image: 'https://images.unsplash.com/photo-1599643478518-a784e5dc3c8f?w=400',
    description: '2克拉天然鸽血红红宝石，18K白金戒托，国际证书认证。',
    startPrice: 30000,
    minIncrement: 1000,
    maxPrice: 300000,
    duration: 480,
    autoDelaySeconds: 15
  },
  {
    name: '潮玩收藏 - 巨型限量公仔',
    image: 'https://images.unsplash.com/photo-1560343090-f0409e92791a?w=400',
    description: '1米高巨型艺术家联名公仔，全球限量50体。',
    startPrice: 2000,
    minIncrement: 100,
    maxPrice: 20000,
    duration: 360,
    autoDelaySeconds: 10
  },
  {
    name: '古董字画 - 民国名家书法',
    image: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400',
    description: '民国著名书法家真迹，保存完好，附鉴定证书。',
    startPrice: 80000,
    minIncrement: 5000,
    maxPrice: 1000000,
    duration: 720,
    autoDelaySeconds: 20
  },
  {
    name: '数码藏品 - 复古限量相机',
    image: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400',
    description: '经典复古胶片相机，限量版，功能完好，收藏级成色。',
    startPrice: 5000,
    minIncrement: 300,
    maxPrice: 80000,
    duration: 420,
    autoDelaySeconds: 15
  },
  {
    name: '奢侈品箱包 - 经典款铂金包',
    image: 'https://images.unsplash.com/photo-1548036328-ecebd6dcf6df?w=400',
    description: '经典款奢侈品铂金包，全新未使用，全套配件齐全。',
    startPrice: 100000,
    minIncrement: 5000,
    maxPrice: 800000,
    duration: 600,
    autoDelaySeconds: 15
  },
  {
    name: '潮流球鞋 - 限量联名款',
    image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400',
    description: '超级限量联名款球鞋，US10码，全新未拆封。',
    startPrice: 3000,
    minIncrement: 200,
    maxPrice: 50000,
    duration: 300,
    autoDelaySeconds: 10
  },
  {
    name: '名贵腕表 - 经典机械表',
    image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400',
    description: '瑞士经典自动机械腕表，全套附件，保卡齐全。',
    startPrice: 50000,
    minIncrement: 2000,
    maxPrice: 500000,
    duration: 540,
    autoDelaySeconds: 15
  },
  {
    name: '艺术藏品 - 限量版画',
    image: 'https://images.unsplash.com/photo-1579762715118-a6f1d4b934f1?w=400',
    description: '国际知名艺术家限量签名版画，编号001/100，附证书。',
    startPrice: 15000,
    minIncrement: 800,
    maxPrice: 150000,
    duration: 480,
    autoDelaySeconds: 15
  }
];

async function seedDemoData(auctionService, seedMode) {
  const pool = getMySQLPool();
  
  const [existingAuctions] = await pool.query(`SELECT COUNT(*) as count FROM auctions`);
  
  if (seedMode === 'force') {
    console.log('强制模式：清空所有旧数据...');
    await pool.query(`DELETE FROM orders`);
    await pool.query(`DELETE FROM bids`);
    await pool.query(`DELETE FROM auctions`);
  } else if (existingAuctions[0].count > 0) {
    console.log('数据库中已有数据，跳过演示数据生成');
    return;
  }
  
  console.log('正在生成演示数据...');
  
  const activeAuctions = [];
  
  for (let i = 0; i < demoAuctionList.length; i++) {
    const auctionData = demoAuctionList[i];
    const newAuction = await auctionService.createAuction(auctionData);
    
    if (i < 4) {
      await auctionService.startAuction(newAuction.id);
      activeAuctions.push(newAuction);
      console.log(`已启动活跃竞拍: ${newAuction.name}`);
    } else {
      console.log(`已创建待开始竞拍: ${newAuction.name}`);
    }
  }
  
  console.log(`已生成 ${demoAuctionList.length} 个演示竞拍商品！`);
  return activeAuctions;
}

async function restoreRedisFromMySQL(auctionService) {
  console.log('正在从MySQL恢复Redis活跃竞拍状态...');
  const pool = getMySQLPool();
  
  const [activeAuctions] = await pool.query(`SELECT * FROM auctions WHERE status = 'active'`);
  
  for (const auction of activeAuctions) {
    await auctionService.redisService.initAuctionState(auction);
    console.log(`已恢复: auction:state:${auction.id} - ${auction.name}`);
  }
  
  console.log(`Redis数据恢复完成，共恢复 ${activeAuctions.length} 个活跃竞拍！`);
  return activeAuctions;
}

async function printSystemStats() {
  const pool = getMySQLPool();
  const redisClient = getRedisClient();
  
  const [auctionsCount] = await pool.query(`SELECT COUNT(*) as count FROM auctions`);
  const [activeCount] = await pool.query(`SELECT COUNT(*) as count FROM auctions WHERE status = 'active'`);
  const [bidsCount] = await pool.query(`SELECT COUNT(*) as count FROM bids`);
  const [ordersCount] = await pool.query(`SELECT COUNT(*) as count FROM orders`);
  
  let redisKeys = [];
  try { redisKeys = await redisClient.keys('auction:*'); } catch(e) { /* NOPERM 跳过 */ }
  
  console.log('');
  console.log('====================================================================================================');
  console.log('           实时竞拍大师 - 生产级演示系统已就绪');
  console.log('====================================================================================================');
  console.log(` 数据库统计:`);
  console.log(`    - 总竞拍数: ${auctionsCount[0].count} 个`);
  console.log(`    - 进行中竞拍: ${activeCount[0].count} 个 (active)`);
  console.log(`    - 总出价记录: ${bidsCount[0].count} 条`);
  console.log(`    - 总订单数: ${ordersCount[0].count} 个`);
  console.log(` Redis状态:`);
  console.log(`    - 已连接`);
  console.log(`    - Redis Key总数: ${redisKeys.length} 个`);
  console.log(` 访问地址:`);
  console.log(`    - 用户直播间:   http://localhost:5173`);
  console.log(`    - 管理后台:     http://localhost:5173/admin`);
  console.log(`    - 健康检查:     http://localhost:3002/api/health`);
  console.log('====================================================================================================');
  console.log('');
}

async function bootstrap() {
  console.log('='.repeat(80));
  console.log(' 实时竞拍大师 - 生产级演示模式 (MySQL + Redis)');
  console.log('='.repeat(80));
  console.log('');
  
  const seedMode = process.env.SEED_DEMO_DATA || 'auto';
  console.log(`演示数据生成模式: ${seedMode}`);
  
  const redisClient = await initRedis();
  await initMySQL();
  
  await initializeDatabase();
  
  const auctionService = new AuctionService(redisClient);
  
  await seedDemoData(auctionService, seedMode);
  
  await restoreRedisFromMySQL(auctionService);
  
  setupSocketServer(io, redisClient);
  
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      mode: 'production-demo',
      mysql: 'connected',
      redis: 'connected',
      timestamp: Date.now() 
    });
  });

  app.post('/api/admin/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      const inputPasswordHash = hashPassword(password || '', ADMIN_PASSWORD_SALT);
      if (username === ADMIN_USERNAME && inputPasswordHash === ADMIN_PASSWORD_HASH) {
        const token = uuidv4();
        const redisClient = getRedisClient();
        await redisClient.set(`${ADMIN_TOKEN_PREFIX}${token}`, '1', { EX: 86400 });
        res.json({ success: true, data: { token, username } });
      } else {
        res.status(401).json({ success: false, message: '用户名或密码错误' });
      }
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.use('/api/admin', adminAuthMiddleware);
  
  app.get('/api/auctions', async (req, res) => {
    try {
      const statusFilter = req.query.status;
      console.log(`收到竞拍列表查询请求，status筛选条件: ${statusFilter || '无'}`);
      let auctions;
      const pool = getMySQLPool();
      if (statusFilter) {
        const [rows] = await pool.query(`SELECT * FROM auctions WHERE status = ? ORDER BY created_at DESC`, [statusFilter]);
        auctions = rows;
      } else {
        auctions = await auctionService.getAllAuctions();
      }
      res.json({ success: true, data: auctions });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.post('/api/auctions', async (req, res) => {
    try {
      const auction = await auctionService.createAuction(req.body);
      res.json({ success: true, data: auction });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.post('/api/auctions/:id/start', adminAuthMiddleware, async (req, res) => {
    try {
      const pool = getMySQLPool();
      const [rows] = await pool.query(`SELECT * FROM auctions WHERE id = ?`, [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: '竞拍不存在' });
      }
      if (rows[0].status !== 'pending') {
        return res.status(400).json({ success: false, message: '只有待开始的竞拍才能启动' });
      }
      const auction = await auctionService.startAuction(req.params.id);
      console.log(`Redis竞拍状态已初始化 - auction:state:${auction.id}`);
      io.emit('auction:started', auction);
      console.log(`全局广播：新竞拍已开始 - ${auction.name}`);
      res.json({ success: true, data: auction });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.post('/api/auctions/:id/end', adminAuthMiddleware, async (req, res) => {
    try {
      const pool = getMySQLPool();
      const [rows] = await pool.query(`SELECT * FROM auctions WHERE id = ?`, [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: '竞拍不存在' });
      }
      if (rows[0].status !== 'active') {
        return res.status(400).json({ success: false, message: '只有竞拍中的商品才能手动结束' });
      }
      const winner = await auctionService.endAuction(req.params.id);
      io.to(`auction:${req.params.id}`).emit('auction:ended', winner);
      res.json({ success: true, data: winner });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.post('/api/auctions/:id/cancel', adminAuthMiddleware, async (req, res) => {
    try {
      const pool = getMySQLPool();
      const [rows] = await pool.query(`SELECT * FROM auctions WHERE id = ?`, [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: '竞拍不存在' });
      }
      if (rows[0].status !== 'pending' && rows[0].status !== 'active') {
        return res.status(400).json({ success: false, message: '只有待开始或竞拍中的商品才能取消' });
      }
      await auctionService.cancelAuction(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.delete('/api/admin/auctions/:id', async (req, res) => {
    try {
      const pool = getMySQLPool();
      const [rows] = await pool.query(`SELECT * FROM auctions WHERE id = ?`, [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: '竞拍不存在' });
      }
      if (rows[0].status !== 'cancelled') {
        return res.status(400).json({ success: false, message: '只能删除已取消的竞拍' });
      }
      await pool.query(`DELETE FROM bids WHERE auction_id = ?`, [req.params.id]);
      await pool.query(`DELETE FROM orders WHERE auction_id = ?`, [req.params.id]);
      await pool.query(`DELETE FROM auctions WHERE id = ?`, [req.params.id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.post('/api/admin/auctions/batch-start', async (req, res) => {
    try {
      const { ids } = req.body;
      const pool = getMySQLPool();
      const results = [];
      for (const id of ids) {
        const [rows] = await pool.query(`SELECT * FROM auctions WHERE id = ?`, [id]);
        if (rows.length > 0 && rows[0].status === 'pending') {
          const auction = await auctionService.startAuction(id);
          io.emit('auction:started', auction);
          results.push(auction);
        }
      }
      res.json({ success: true, data: results });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.post('/api/admin/auctions/batch-delete', async (req, res) => {
    try {
      const { ids } = req.body;
      const pool = getMySQLPool();
      for (const id of ids) {
        const [rows] = await pool.query(`SELECT * FROM auctions WHERE id = ?`, [id]);
        if (rows.length > 0 && rows[0].status === 'cancelled') {
          await pool.query(`DELETE FROM bids WHERE auction_id = ?`, [id]);
          await pool.query(`DELETE FROM orders WHERE auction_id = ?`, [id]);
          await pool.query(`DELETE FROM auctions WHERE id = ?`, [id]);
        }
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.get('/api/admin/health-check', async (req, res) => {
    try {
      const pool = getMySQLPool();
      const redisClient = getRedisClient();
      
      const [auctionsCount] = await pool.query(`SELECT COUNT(*) as count FROM auctions`);
      const [bidsCount] = await pool.query(`SELECT COUNT(*) as count FROM bids`);
      const [ordersCount] = await pool.query(`SELECT COUNT(*) as count FROM orders`);
      const [activeAuctions] = await pool.query(`SELECT * FROM auctions WHERE status = 'active'`);
      
      const redisKeys = await redisClient.keys('auction:*');
      const redisActiveStates = await redisClient.keys('auction:state:*');
      
      const inconsistencies = [];
      for (const mysqlAuction of activeAuctions) {
        const hasRedis = redisActiveStates.includes(`auction:state:${mysqlAuction.id}`);
        if (!hasRedis) {
          inconsistencies.push(`竞拍 ${mysqlAuction.id} (${mysqlAuction.name}) 在MySQL中是active但Redis中无状态`);
        }
      }
      
      res.json({
        status: 'ok',
        mysql: {
          connected: true,
          auctions_count: auctionsCount[0].count,
          bids_count: bidsCount[0].count,
          orders_count: ordersCount[0].count
        },
        redis: {
          connected: true,
          active_auctions_in_redis: redisActiveStates.length,
          keys_pattern_auction: redisKeys.length
        },
        inconsistencies
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.post('/api/admin/repair-data', async (req, res) => {
    try {
      const pool = getMySQLPool();
      const [activeAuctions] = await pool.query(`SELECT * FROM auctions WHERE status = 'active'`);
      
      const repaired = [];
      for (const auction of activeAuctions) {
        await auctionService.redisService.initAuctionState(auction);
        repaired.push(auction);
      }
      
      res.json({ success: true, repaired_count: repaired.length, data: repaired });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.get('/api/admin/auctions', async (req, res) => {
    try {
      const statusFilter = req.query.status;
      let auctions;
      const pool = getMySQLPool();
      if (statusFilter) {
        const [rows] = await pool.query(`SELECT * FROM auctions WHERE status = ? ORDER BY created_at DESC`, [statusFilter]);
        auctions = rows;
      } else {
        auctions = await auctionService.getAllAuctions();
      }
      res.json({ success: true, data: auctions });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.get('/api/admin/auctions/:id', async (req, res) => {
    try {
      const detail = await auctionService.getAuctionDetail(req.params.id);
      if (!detail) {
        return res.status(404).json({ success: false, message: '竞拍不存在' });
      }
      res.json({ success: true, data: detail });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.put('/api/admin/auctions/:id', async (req, res) => {
    try {
      const auction = await auctionService.updateAuction(req.params.id, req.body);
      res.json({ success: true, data: auction });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.get('/api/admin/orders', async (req, res) => {
    try {
      const orders = await auctionService.getAllOrders();
      res.json({ success: true, data: orders });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.get('/api/admin/orders/:id', async (req, res) => {
    try {
      const order = await auctionService.getOrderDetail(req.params.id);
      if (!order) {
        return res.status(404).json({ success: false, message: '订单不存在' });
      }
      res.json({ success: true, data: order });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.put('/api/admin/orders/:id/status', async (req, res) => {
    try {
      const order = await auctionService.updateOrderStatus(req.params.id, req.body.status);
      res.json({ success: true, data: order });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get('/api/admin/monitor/active-auctions', async (req, res) => {
    try {
      const pool = getMySQLPool();
      
      const [activeAuctions] = await pool.query(`SELECT * FROM auctions WHERE status = 'active' ORDER BY start_time DESC`);
      
      const result = [];
      for (const auction of activeAuctions) {
        const state = await auctionService.redisService.getAuctionState(auction.id);
        const top3 = await auctionService.redisService.getTopRanking(auction.id, 3);
        
        const endTime = state?.endTime || 0;
        const now = Date.now();
        const timeLeft = Math.max(0, endTime - now);
        
        result.push({
          id: auction.id,
          name: auction.name,
          image: auction.image,
          currentPrice: state?.currentPrice !== undefined ? state.currentPrice : auction.current_price,
          startPrice: auction.start_price,
          maxPrice: auction.max_price,
          timeLeft,
          top3: top3.map((item) => ({
            rank: item.rank,
            userName: item.userName,
            price: item.price
          }))
        });
      }
      
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('monitor error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get('/api/user/my-orders', async (req, res) => {
    try {
      const userId = req.query.userId;
      if (!userId) {
        return res.status(400).json({ success: false, message: 'userId 必填' });
      }
      const pool = getMySQLPool();
      const [orders] = await pool.query(`
        SELECT o.*, a.name as auction_name, a.image as auction_image 
        FROM orders o 
        JOIN auctions a ON o.auction_id = a.id 
        WHERE o.winner_id = ? 
        ORDER BY o.created_at DESC
      `, [userId]);
      res.json({ success: true, data: orders });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get('/api/user/my-participations', async (req, res) => {
    try {
      const userId = req.query.userId;
      if (!userId) {
        return res.status(400).json({ success: false, message: 'userId 必填' });
      }
      const pool = getMySQLPool();
      
      const [participations] = await pool.query(`
        SELECT 
          a.id as auction_id,
          a.name as auction_name,
          a.image as auction_image,
          a.status as auction_status,
          a.current_price as auction_final_price,
          (SELECT MAX(price) FROM bids WHERE user_id = ? AND auction_id = a.id) as my_max_bid,
          o.id as my_order_id,
          o.status as my_order_status,
          o.final_price as my_win_price,
          CASE WHEN o.winner_id = ? THEN 1 ELSE 0 END as i_am_winner
        FROM (SELECT DISTINCT auction_id FROM bids WHERE user_id = ?) my_bids
        JOIN auctions a ON my_bids.auction_id = a.id
        LEFT JOIN orders o ON o.auction_id = a.id AND o.winner_id = ?
        ORDER BY a.created_at DESC
      `, [userId, userId, userId, userId]);
      
      res.json({ success: true, data: participations });
    } catch (error) {
      console.error('my-participations error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/user/orders/:id/pay', async (req, res) => {
    try {
      const pool = getMySQLPool();
      const [rows] = await pool.query(`SELECT * FROM orders WHERE id = ?`, [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: '订单不存在' });
      }
      
      await pool.query(`UPDATE orders SET status = 'paid' WHERE id = ?`, [req.params.id]);
      const [updatedOrders] = await pool.query(`SELECT * FROM orders WHERE id = ?`, [req.params.id]);
      
      io.emit('order:paid', updatedOrders[0]);
      console.log('全局广播订单已支付:', updatedOrders[0]);
      
      res.json({ success: true, data: updatedOrders[0] });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  const PORT = process.env.PORT || 3002;
  server.listen(PORT, async () => {
    await printSystemStats();
  });
}

bootstrap().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
