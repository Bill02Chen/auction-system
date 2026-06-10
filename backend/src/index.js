require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
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

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const inputPasswordHash = hashPassword(password || '', ADMIN_PASSWORD_SALT);
    if (username === ADMIN_USERNAME && inputPasswordHash === ADMIN_PASSWORD_HASH) {
      const token = require('uuid').v4();
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

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

async function bootstrap() {
  console.log('Starting Auction Master Backend...');
  
  const redisClient = await initRedis();
  await initMySQL();
  
  setupSocketServer(io, redisClient);
  
  const auctionService = new AuctionService(redisClient);
  
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });
  
  app.get('/api/auctions', async (req, res) => {
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
      
      const redisClient = getRedisClient();
      const redisService = new (require('./services/redisService'))(redisClient);
      
      for (let i = 0; i < auctions.length; i++) {
        if (auctions[i].status === 'active') {
          const redisState = await redisService.getAuctionState(auctions[i].id);
          if (redisState && redisState.endTime) {
            auctions[i].end_time = new Date(redisState.endTime);
          }
        }
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
      
      let redisKeys = [], redisActiveStates = [];
      try { 
        redisKeys = await redisClient.keys('auction:*'); 
        redisActiveStates = await redisClient.keys('auction:state:*'); 
      } catch(e) { /* NOPERM 跳过 */ }
      
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
      const redisClient = getRedisClient();
      const tempAuctionService = new AuctionService(redisClient);
      
      const [activeAuctions] = await pool.query(`SELECT * FROM auctions WHERE status = 'active' ORDER BY start_time DESC`);
      
      const result = [];
      for (const auction of activeAuctions) {
        const state = await tempAuctionService.redisService.getAuctionState(auction.id);
        const top3 = await tempAuctionService.redisService.getTopRanking(auction.id, 3);
        
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
      console.log('💳 全局广播订单已支付:', updatedOrders[0]);
      
      res.json({ success: true, data: updatedOrders[0] });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  const PORT = process.env.PORT || 3002;
  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 Socket.IO ready for high concurrent connections`);
    console.log(`🎛️  Admin API ready at /api/admin`);
  });
}

bootstrap().catch(err => {
  console.error('Bootstrap error:', err);
  process.exit(1);
});
