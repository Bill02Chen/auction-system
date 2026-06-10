const { v4: uuidv4 } = require('uuid');
const { getMySQLPool } = require('../config/mysql');
const RedisService = require('./redisService');
const DistributedLock = require('../utils/distributedLock');

class AuctionService {
  constructor(redisClient) {
    this.mysql = getMySQLPool();
    this.redisService = new RedisService();
    this.distributedLock = new DistributedLock(redisClient);
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

  async processBid(auctionId, userId, userName, userAvatar) {
    const lockKey = this.redisService.getAuctionLockKey(auctionId);
    
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

  async endAuction(auctionId) {
    const topRanking = await this.redisService.getTopRanking(auctionId, 1);
    const winner = topRanking[0] || null;

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

    setTimeout(async () => {
      await this.redisService.cleanupAuctionData(auctionId);
      console.log(`🧹 竞拍数据已清理: ${auctionId}`);
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
          `UPDATE auctions SET current_price = ? WHERE id = ?`,
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
