const RedisService = require('./services/redisService');
const AuctionService = require('./services/auctionService');
const { getMySQLPool } = require('./config/mysql');

function setupSocketServer(io, redisClient) {
  const redisService = new RedisService();
  const auctionService = new AuctionService(redisClient);

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    const query = socket.handshake.query;
    if (query.userId && query.userId.startsWith('user_')) {
      socket.data.userId = query.userId;
      socket.data.userName = query.userName || `买家${Math.floor(Math.random() * 9999)}`;
    } else {
      socket.data.userId = `user_${socket.id}`;
      socket.data.userName = `买家${Math.floor(Math.random() * 9999)}`;
    }
    
    socket.emit('connected:ack', {
      userId: socket.data.userId,
      userName: socket.data.userName
    });

    socket.on('auction:join', async (auctionId) => {
      if (socket.data.auctionId && socket.data.auctionId !== auctionId) {
        const oldAuctionId = socket.data.auctionId;
        socket.leave(`auction:${oldAuctionId}`);
        await redisService.removeOnlineUser(oldAuctionId, socket.data.userId);
        const oldOnlineCount = await redisService.getOnlineCount(oldAuctionId);
        io.to(`auction:${oldAuctionId}`).emit('user:count', oldOnlineCount);
      }
      
      socket.join(`auction:${auctionId}`);
      socket.data.auctionId = auctionId;
      
      await redisService.addOnlineUser(auctionId, socket.data.userId);
      
      const onlineCount = await redisService.getOnlineCount(auctionId);
      io.to(`auction:${auctionId}`).emit('user:count', onlineCount);
      
      const state = await redisService.getAuctionState(auctionId);
      if (state) {
        socket.emit('auction:state', state);
      }
      
      const ranking = await redisService.getTopRanking(auctionId, 10);
      socket.emit('rank:update', ranking);
      
      console.log(`User ${socket.data.userId} joined auction ${auctionId}`);
    });

    socket.on('auction:leave', async (auctionId) => {
      socket.leave(`auction:${auctionId}`);
      if (socket.data.userId) {
        await redisService.removeOnlineUser(auctionId, socket.data.userId);
        const onlineCount = await redisService.getOnlineCount(auctionId);
        io.to(`auction:${auctionId}`).emit('user:count', onlineCount);
      }
      console.log(`User ${socket.data.userId} left auction ${auctionId}`);
    });

    socket.on('bid:submit', async (data) => {
      try {
        const { auctionId, userName, userAvatar } = data;
        const userId = socket.data.userId || `user_${socket.id}`;
        const finalUserName = userName || socket.data.userName || '神秘买家';
        
        const allowed = await redisService.checkRateLimit(userId, 3);
        if (!allowed) {
          socket.emit('bid:error', { message: '出价太频繁，请稍后再试' });
          return;
        }

        const oldState = await redisService.getAuctionState(auctionId);
        const result = await auctionService.processBid(auctionId, userId, finalUserName, userAvatar || '');
        
        const ranking = await redisService.getTopRanking(auctionId, 10);
        const fullState = await redisService.getAuctionState(auctionId);
        
        io.to(`auction:${auctionId}`).emit('bid:success', {
          auctionId,
          userId,
          userName: finalUserName,
          newPrice: result.newPrice,
          timestamp: Date.now()
        });
        
        io.to(`auction:${auctionId}`).emit('rank:update', ranking);
        
        if (oldState && result.newEndTime && result.newEndTime > oldState.endTime) {
          io.to(`auction:${auctionId}`).emit('auction:delayed', {
            newEndTime: result.newEndTime,
            autoDelaySeconds: result.autoDelaySeconds || 15
          });
        }
        
        if (fullState) {
          io.to(`auction:${auctionId}`).emit('auction:state', fullState);
        }
        
      } catch (error) {
        socket.emit('bid:error', { message: error.message });
      }
    });

    socket.on('disconnect', async () => {
      const auctionId = socket.data.auctionId;
      const userId = socket.data.userId;
      
      if (auctionId && userId) {
        await redisService.removeOnlineUser(auctionId, userId);
        const onlineCount = await redisService.getOnlineCount(auctionId);
        io.to(`auction:${auctionId}`).emit('user:count', onlineCount);
      }
      
      console.log('Client disconnected:', socket.id);
    });
  });

  setInterval(async () => {
    try {
      const pool = getMySQLPool();
      const now = Date.now();
      
      const [activeAuctions] = await pool.query(`SELECT * FROM auctions WHERE status = 'active'`);
      
      for (const auction of activeAuctions) {
        let state = await redisService.getAuctionState(auction.id);
        
        if (!state) {
          console.log(`🔄 检测到MySQL中活跃但Redis不存在的竞拍，自动恢复状态: ${auction.name} (${auction.id})`);
          await redisService.initAuctionState({
            id: auction.id,
            name: auction.name,
            startPrice: auction.start_price,
            minIncrement: auction.min_increment,
            maxPrice: auction.max_price,
            duration: auction.duration,
            autoDelaySeconds: auction.auto_delay_seconds,
            status: 'active',
            endTime: auction.end_time
          });
          state = await redisService.getAuctionState(auction.id);
        }
        
        if (state && now >= state.endTime) {
          console.log(`⏰ 检测到竞拍已过期，自动结束: ${auction.name} (${auction.id})`);
          const winner = await auctionService.endAuction(auction.id);
          io.to(`auction:${auction.id}`).emit('auction:ended', winner);
          console.log(`✅ 竞拍已自动结束，获胜者: ${winner?.userName || '无'}`);
        }
      }
    } catch (error) {
      console.error('❌ 心跳检查出错:', error.message);
    }
  }, 1000);

  setInterval(async () => {
    try {
      const pool = getMySQLPool();
      const [activeAuctions] = await pool.query(`SELECT * FROM auctions WHERE status = 'active'`);
      let syncedCount = 0;
      
      for (const auction of activeAuctions) {
        const state = await redisService.getAuctionState(auction.id);
        
        if (state && state.status === 'active') {
          await pool.query(
            `UPDATE auctions SET end_time = ? WHERE id = ?`,
            [new Date(state.endTime), auction.id]
          );
          syncedCount++;
        }
      }
      
      console.log(`📝 批量同步完成: 已同步 ${syncedCount} 个活跃竞拍的 endTime 到 MySQL`);
    } catch (error) {
      console.error('❌ 批量同步 endTime 出错:', error.message);
    }
  }, 10000);

  setInterval(async () => {
    try {
      const flushedCount = await auctionService.flushPendingBidsToMySQL();
      if (flushedCount > 0) {
        console.log(`💾 批量落盘完成: 已将 ${flushedCount} 条出价记录从 Redis 同步到 MySQL`);
      }
    } catch (error) {
      console.error('❌ 批量落盘出价记录出错:', error.message);
    }
  }, 5000);

  return io;
}

module.exports = setupSocketServer;
