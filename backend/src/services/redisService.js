const { getRedisClient } = require('../config/redis');

class RedisService {
  constructor() {
    this.redis = getRedisClient();
  }

  getAuctionStateKey(auctionId) {
    return `auction:state:${auctionId}`;
  }

  getAuctionRankingKey(auctionId) {
    return `auction:ranking:${auctionId}`;
  }

  getAuctionOnlineKey(auctionId) {
    return `auction:online:${auctionId}`;
  }

  getAuctionLockKey(auctionId) {
    return `auction:lock:${auctionId}`;
  }

  getUserRateKey(userId) {
    return `auction:rate:${userId}`;
  }

  getBidPendingQueueKey() {
    return 'auction:bid:pending:queue';
  }

  async initAuctionState(auction) {
    const key = this.getAuctionStateKey(auction.id);
    
    const currentPrice = auction.current_price !== undefined ? auction.current_price : auction.start_price !== undefined ? auction.start_price : auction.startPrice;
    const startPrice = auction.start_price !== undefined ? auction.start_price : auction.startPrice;
    const minIncrement = auction.min_increment !== undefined ? auction.min_increment : auction.minIncrement;
    const maxPrice = auction.max_price !== undefined ? auction.max_price : auction.maxPrice;
    
    let endTimeMs;
    if (auction.end_time) {
      endTimeMs = new Date(auction.end_time).getTime();
    } else if (auction.endTime) {
      endTimeMs = auction.endTime.getTime();
    } else {
      endTimeMs = Date.now() + 300 * 1000;
    }
    
    await this.redis.hSet(key, {
      id: auction.id,
      name: auction.name || '',
      currentPrice: String(currentPrice || 0),
      startPrice: String(startPrice || 0),
      minIncrement: String(minIncrement || 1),
      maxPrice: String(maxPrice || 999999),
      endTime: String(endTimeMs),
      status: auction.status || 'active',
      autoDelaySeconds: String(auction.autoDelaySeconds || auction.auto_delay_seconds || 15)
    });
    await this.redis.expire(key, 86400);
  }

  async getAuctionState(auctionId) {
    const key = this.getAuctionStateKey(auctionId);
    const state = await this.redis.hGetAll(key);
    if (!state || Object.keys(state).length === 0) return null;
    return {
      id: state.id,
      currentPrice: parseFloat(state.currentPrice),
      startPrice: parseFloat(state.startPrice),
      minIncrement: parseFloat(state.minIncrement),
      maxPrice: parseFloat(state.maxPrice),
      endTime: parseInt(state.endTime),
      status: state.status,
      autoDelaySeconds: state.autoDelaySeconds ? parseInt(state.autoDelaySeconds) : 15
    };
  }

  async updateCurrentPrice(auctionId, newPrice) {
    const key = this.getAuctionStateKey(auctionId);
    await this.redis.hSet(key, 'currentPrice', newPrice.toString());
  }

  async updateEndTime(auctionId, newEndTimeMs) {
    const key = this.getAuctionStateKey(auctionId);
    await this.redis.hSet(key, 'endTime', newEndTimeMs.toString());
  }

  async updateAuctionStatus(auctionId, status) {
    const key = this.getAuctionStateKey(auctionId);
    await this.redis.hSet(key, 'status', status);
  }

  async addToRanking(auctionId, userId, userName, userAvatar, price) {
    const key = this.getAuctionRankingKey(auctionId);
    const member = JSON.stringify({ userId, userName, userAvatar });
    await this.redis.zAdd(key, { score: price, value: member });
  }

  async getTopRanking(auctionId, topN = 10) {
    const key = this.getAuctionRankingKey(auctionId);
    const results = await this.redis.zRangeWithScores(key, -topN, -1);
    return results.reverse().map((item, index) => {
      const userInfo = JSON.parse(item.value);
      return { ...userInfo, price: item.score, rank: index + 1 };
    });
  }

  async getUserRank(auctionId, userId) {
    const key = this.getAuctionRankingKey(auctionId);
    const allMembers = await this.redis.zRangeWithScores(key, 0, -1, { REV: true });
    for (let i = 0; i < allMembers.length; i++) {
      try {
        const userInfo = JSON.parse(allMembers[i].value);
        if (userInfo.userId === userId) {
          return i + 1;
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  async cleanupAuctionData(auctionId) {
    const stateKey = this.getAuctionStateKey(auctionId);
    const rankingKey = this.getAuctionRankingKey(auctionId);
    const onlineKey = this.getAuctionOnlineKey(auctionId);
    await this.redis.del(stateKey, rankingKey, onlineKey);
  }

  async addOnlineUser(auctionId, userId) {
    const key = this.getAuctionOnlineKey(auctionId);
    await this.redis.sAdd(key, userId);
  }

  async removeOnlineUser(auctionId, userId) {
    const key = this.getAuctionOnlineKey(auctionId);
    await this.redis.sRem(key, userId);
  }

  async getOnlineCount(auctionId) {
    const key = this.getAuctionOnlineKey(auctionId);
    return await this.redis.sCard(key);
  }

  async checkRateLimit(userId, maxPerSecond = 2) {
    const key = this.getUserRateKey(userId);
    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, 1);
    }
    return current <= maxPerSecond;
  }

  async enqueuePendingBid(bidData) {
    const key = this.getBidPendingQueueKey();
    await this.redis.lPush(key, JSON.stringify(bidData));
    await this.redis.expire(key, 86400);
  }

  async dequeueAllPendingBids() {
    const key = this.getBidPendingQueueKey();
    const bids = [];
    const len = await this.redis.lLen(key);
    for (let i = 0; i < len; i++) {
      const item = await this.redis.rPop(key);
      if (item) {
        try {
          bids.push(JSON.parse(item));
        } catch (e) {
          continue;
        }
      }
    }
    return bids;
  }
}

module.exports = RedisService;
