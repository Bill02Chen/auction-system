const { v4: uuidv4 } = require('uuid');
const { getMySQLPool } = require('../config/mysql');
const RedisService = require('./redisService');
const DistributedLock = require('../utils/distributedLock');
const metrics = require('../utils/metrics');
const BID_SCRIPT = require('../utils/bidScript');

class AuctionService {
  constructor(redisClient) {
    this.mysql = getMySQLPool();
    this.redisService = new RedisService();
    this.redis = redisClient;
    this.distributedLock = new DistributedLock(redisClient);
    this.bidScriptSha = null;
  }

  async createAuction(auctionData) {
    if (!auctionData.startPrice || auctionData.startPrice < 1) {
      throw new Error('起拍价最小为1元');
    }
    if (!auctionData.minIncrement || auctionData.minIncrement < 1) {
      throw new Error('最小加价幅度最小为1元');
    }
    
    const id = uuidv4();
    
    const [result] = await this.mysql.query(
      `INSERT INTO auctions (id, name, image, description, start_price, current_price, min_increment, max_price, duration, auto_delay_seconds, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        auctionData.name,
        auctionData.image || '',
        auctionData.description || '',
        auctionData.startPrice,
        auctionData.startPrice,
        auctionData.minIncrement,
        auctionData.maxPrice,
        auctionData.duration,
        auctionData.autoDelaySeconds || 15,
        'pending'
      ]
    );

    const auction = { id, ...auctionData, currentPrice: auctionData.startPrice, status: 'pending' };
    return auction;
  }

  async startAuction(auctionId) {
    const now = Date.now();
    
    const [rows] = await this.mysql.query(`SELECT * FROM auctions WHERE id = ?`, [auctionId]);
    const auction = rows[0];
    
    const newEndTime = new Date(now + auction.duration * 1000);
    const newStartTime = new Date(now);
    
    await this.mysql.query(
      `UPDATE auctions SET status = 'active', start_time = ?, end_time = ? WHERE id = ?`,
      [newStartTime, newEndTime, auctionId]
    );

    await this.redisService.initAuctionState({
      id: auction.id,
      name: auction.name,
      startPrice: auction.start_price,
      minIncrement: auction.min_increment,
      maxPrice: auction.max_price,
      duration: auction.duration,
      autoDelaySeconds: auction.auto_delay_seconds,
      status: 'active',
      endTime: newEndTime
    });

    return { ...auction, start_time: newStartTime, end_time: newEndTime };
  }

  // 出价入口。默认走原子 Lua 脚本（#8）；BID_ENGINE=lock 可切回原来的抢锁实现做对比。
  async processBid(auctionId, userId, userName, userAvatar) {
    const engine = process.env.BID_ENGINE || 'lua';
    if (engine === 'lock') {
      return this.processBidWithLock(auctionId, userId, userName, userAvatar);
    }
    return this.processBidAtomic(auctionId, userId, userName, userAvatar);
  }

  async loadBidScript() {
    this.bidScriptSha = await this.redis.scriptLoad(BID_SCRIPT);
    return this.bidScriptSha;
  }

  // 单次原子出价。Redis 串行执行脚本，因此并发出价会依次成交，而不是被拒绝。
  async processBidAtomic(auctionId, userId, userName, userAvatar) {
    if (!this.bidScriptSha) {
      await this.loadBidScript();
    }

    const now = Date.now();
    const bidId = uuidv4();
    const keys = [
      this.redisService.getAuctionStateKey(auctionId),
      this.redisService.getAuctionRankingKey(auctionId),
      this.redisService.getBidPendingQueueKey()
    ];
    const args = [
      auctionId,
      bidId,
      userId,
      userName || '神秘买家',
      userAvatar || '',
      String(now),
      new Date(now).toISOString()
    ];

    let raw;
    try {
      raw = await this.redis.evalSha(this.bidScriptSha, { keys, arguments: args });
    } catch (error) {
      // 脚本缓存可能在 Redis 重启或 SCRIPT FLUSH 之后失效。
      if (error && /NOSCRIPT/i.test(error.message || '')) {
        await this.loadBidScript();
        raw = await this.redis.evalSha(this.bidScriptSha, { keys, arguments: args });
      } else {
        throw error;
      }
    }

    const result = JSON.parse(raw);
    if (!result.ok) {
      throw new Error(result.reason || '出价失败');
    }

    metrics.recordBidEngine('lua');
    return {
      success: true,
      newPrice: result.newPrice,
      newEndTime: result.newEndTime,
      autoDelaySeconds: result.autoDelaySeconds || 15,
      newRank: result.newRank,
      message: '出价成功'
    };
  }

  async processBidWithLock(auctionId, userId, userName, userAvatar) {
    const lockKey = this.redisService.getAuctionLockKey(auctionId);
    metrics.recordBidEngine('lock');

    return await this.distributedLock.withLock(lockKey, async () => {
      const state = await this.redisService.getAuctionState(auctionId);
      if (!state) {
        throw new Error('竞拍不存在');
      }
      
      if (state.status !== 'active') {
        throw new Error('竞拍未开始或已结束');
      }

      const now = Date.now();
      if (now >= state.endTime) {
        throw new Error('竞拍已结束');
      }

      if (state.currentPrice >= state.maxPrice) {
        throw new Error('已达到封顶价，无法再出价');
      }

      const topRanking = await this.redisService.getTopRanking(auctionId, 1);
      const hasAnyBids = topRanking.length > 0;
      
      let newPrice;
      if (!hasAnyBids) {
        newPrice = state.startPrice;
      } else {
        newPrice = state.currentPrice + state.minIncrement;
      }
      
      if (newPrice > state.maxPrice) {
        newPrice = state.maxPrice;
      }

      const bidId = uuidv4();
      
      await this.redisService.enqueuePendingBid({
        id: bidId,
        auctionId,
        userId,
        userName,
        userAvatar,
        price: newPrice,
        createdAt: new Date().toISOString()
      });

      await this.redisService.updateCurrentPrice(auctionId, newPrice);
      await this.redisService.addToRanking(auctionId, userId, userName, userAvatar, newPrice);

      let newEndTime = state.endTime;
      const timeRemaining = state.endTime - now;
      if (timeRemaining < 30000 && timeRemaining > 0) {
        const autoDelayMs = (state.autoDelaySeconds || 15) * 1000;
        newEndTime = state.endTime + autoDelayMs;
        await this.redisService.updateEndTime(auctionId, newEndTime);
      }

      const userRank = await this.redisService.getUserRank(auctionId, userId);

      return {
        success: true,
        newPrice,
        newEndTime,
        autoDelaySeconds: state.autoDelaySeconds || 15,
        newRank: userRank,
        message: '出价成功'
      };
    });
  }

  // 从 bids 表回放排行榜。用于 Redis 数据丢失后的自愈：
  // 心跳只重建了 auction:state，ZSet 排行榜若不回放，赢家会判不出来。
  async rebuildRankingFromMySQL(auctionId) {
    const [rows] = await this.mysql.query(
      `SELECT user_id, ANY_VALUE(user_name) AS user_name, ANY_VALUE(user_avatar) AS user_avatar, MAX(price) AS price
       FROM bids WHERE auction_id = ? GROUP BY user_id`,
      [auctionId]
    );

    await this.redisService.clearRanking(auctionId);
    if (rows.length === 0) return 0;

    await this.redisService.addToRankingBulk(
      auctionId,
      rows.map((row) => ({
        userId: row.user_id,
        userName: row.user_name || '神秘买家',
        userAvatar: row.user_avatar || '',
        price: Number(row.price)
      }))
    );
    return rows.length;
  }

  // 对账：Redis 价格 / MySQL current_price / bids 最高价 三者应一致。
  // 返回不一致的描述数组，空数组表示一致。
  async reconcilePrices(auction) {
    const [rows] = await this.mysql.query(
      `SELECT MAX(price) AS maxBid FROM bids WHERE auction_id = ?`,
      [auction.id]
    );
    const maxBid = rows[0] && rows[0].maxBid !== null ? Number(rows[0].maxBid) : null;
    if (maxBid === null) return [];

    const state = await this.redisService.getAuctionState(auction.id);
    const redisPrice = state ? Number(state.currentPrice) : null;
    const mysqlPrice = Number(auction.current_price);
    const problems = [];

    if (redisPrice !== null && redisPrice < maxBid) {
      problems.push(`Redis价格(${redisPrice}) < bids最高价(${maxBid})`);
    }
    if (mysqlPrice < maxBid) {
      problems.push(`MySQL价格(${mysqlPrice}) < bids最高价(${maxBid})`);
    }
    return problems;
  }

  async endAuction(auctionId) {
    const topRanking = await this.redisService.getTopRanking(auctionId, 1);
    let winner = topRanking[0] || null;

    // 兜底：排行榜为空（例如 Redis 数据丢失且尚无新出价）时，从 bids 表判定赢家。
    if (!winner) {
      const [rows] = await this.mysql.query(
        `SELECT user_id, user_name, price FROM bids WHERE auction_id = ? ORDER BY price DESC, created_at ASC LIMIT 1`,
        [auctionId]
      );
      if (rows.length > 0) {
        winner = {
          userId: rows[0].user_id,
          userName: rows[0].user_name || '神秘买家',
          price: Number(rows[0].price)
        };
        console.log(`🧮 排行榜为空，已从 bids 表判定赢家: ${winner.userName} (${winner.price})`);
      }
    }

    await this.redisService.updateAuctionStatus(auctionId, 'ended');
    
    const now = new Date();
    await this.mysql.query(
      `UPDATE auctions SET status = 'ended', end_time = ? WHERE id = ?`,
      [now, auctionId]
    );

    if (winner) {
      const orderId = uuidv4();
      await this.mysql.query(
        `INSERT INTO orders (id, auction_id, winner_id, winner_name, final_price, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, auctionId, winner.userId, winner.userName, winner.price, 'pending_payment']
      );
    }

    // 延迟清理。必须先确认这个 ID 仍然是「已结束」状态：
    // 否则用同一 ID 重新创建的竞拍，会在 60 秒后被上一次的定时器误删 Redis 状态。
    setTimeout(async () => {
      try {
        const [rows] = await this.mysql.query(`SELECT status FROM auctions WHERE id = ?`, [auctionId]);
        const status = rows[0] && rows[0].status;
        if (status === 'ended' || status === 'cancelled') {
          await this.redisService.cleanupAuctionData(auctionId);
          console.log(`🧹 竞拍数据已清理: ${auctionId}`);
        } else {
          console.log(`⏭️ 跳过清理（竞拍已是 ${status || '不存在的记录'}，可能被重新创建）: ${auctionId}`);
        }
      } catch (error) {
        console.error('❌ 清理竞拍数据失败:', error.message);
      }
    }, 60000);

    return winner;
  }

  async getAllAuctions() {
    const [rows] = await this.mysql.query(`SELECT * FROM auctions ORDER BY created_at DESC`);
    return rows;
  }

  async cancelAuction(auctionId) {
    await this.mysql.query(`UPDATE auctions SET status = 'cancelled' WHERE id = ?`, [auctionId]);
    await this.redisService.updateAuctionStatus(auctionId, 'cancelled');
  }

  async updateAuction(auctionId, updateData) {
    const [rows] = await this.mysql.query(`SELECT * FROM auctions WHERE id = ?`, [auctionId]);
    const auction = rows[0];
    
    if (!auction) {
      throw new Error('竞拍不存在');
    }
    if (auction.status !== 'pending') {
      throw new Error('只能修改未开始的竞拍');
    }

    const fields = [];
    const values = [];
    
    if (updateData.name !== undefined) { fields.push('name = ?'); values.push(updateData.name); }
    if (updateData.image !== undefined) { fields.push('image = ?'); values.push(updateData.image); }
    if (updateData.description !== undefined) { fields.push('description = ?'); values.push(updateData.description); }
    if (updateData.startPrice !== undefined) { fields.push('start_price = ?'); values.push(updateData.startPrice); }
    if (updateData.minIncrement !== undefined) { fields.push('min_increment = ?'); values.push(updateData.minIncrement); }
    if (updateData.maxPrice !== undefined) { fields.push('max_price = ?'); values.push(updateData.maxPrice); }
    if (updateData.duration !== undefined) { fields.push('duration = ?'); values.push(updateData.duration); }
    if (updateData.autoDelaySeconds !== undefined) { fields.push('auto_delay_seconds = ?'); values.push(updateData.autoDelaySeconds); }

    values.push(auctionId);
    await this.mysql.query(`UPDATE auctions SET ${fields.join(', ')} WHERE id = ?`, values);
    
    const [updatedRows] = await this.mysql.query(`SELECT * FROM auctions WHERE id = ?`, [auctionId]);
    return updatedRows[0];
  }

  async getAuctionDetail(auctionId) {
    const [auctionRows] = await this.mysql.query(`SELECT * FROM auctions WHERE id = ?`, [auctionId]);
    if (auctionRows.length === 0) return null;
    
    const [bidRows] = await this.mysql.query(`SELECT * FROM bids WHERE auction_id = ? ORDER BY created_at DESC LIMIT 50`, [auctionId]);
    const [orderRows] = await this.mysql.query(`SELECT * FROM orders WHERE auction_id = ?`, [auctionId]);
    
    return {
      auction: auctionRows[0],
      bids: bidRows,
      order: orderRows[0] || null
    };
  }

  async getAllOrders() {
    const [rows] = await this.mysql.query(`SELECT o.*, a.name as auction_name FROM orders o LEFT JOIN auctions a ON o.auction_id = a.id ORDER BY o.created_at DESC`);
    return rows;
  }

  async getOrderDetail(orderId) {
    const [rows] = await this.mysql.query(`SELECT o.*, a.name as auction_name FROM orders o LEFT JOIN auctions a ON o.auction_id = a.id WHERE o.id = ?`, [orderId]);
    return rows[0] || null;
  }

  async updateOrderStatus(orderId, status) {
    await this.mysql.query(`UPDATE orders SET status = ? WHERE id = ?`, [status, orderId]);
    const [rows] = await this.mysql.query(`SELECT * FROM orders WHERE id = ?`, [orderId]);
    return rows[0];
  }

  async flushPendingBidsToMySQL() {
    const pendingBids = await this.redisService.dequeueAllPendingBids();
    
    if (pendingBids.length === 0) {
      return 0;
    }

    const connection = await this.mysql.getConnection();
    try {
      await connection.beginTransaction();

      for (const bid of pendingBids) {
        await connection.query(
          `INSERT IGNORE INTO bids (id, auction_id, user_id, user_name, user_avatar, price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [bid.id, bid.auctionId, bid.userId, bid.userName, bid.userAvatar, bid.price, new Date(bid.createdAt)]
        );
      }

      const priceMap = new Map();
      for (const bid of pendingBids) {
        if (!priceMap.has(bid.auctionId) || bid.price > priceMap.get(bid.auctionId)) {
          priceMap.set(bid.auctionId, bid.price);
        }
      }

      for (const [auctionId, finalPrice] of priceMap) {
        await connection.query(
          `UPDATE auctions SET current_price = GREATEST(current_price, ?) WHERE id = ?`,
          [finalPrice, auctionId]
        );
      }

      await connection.commit();
      return pendingBids.length;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = AuctionService;
