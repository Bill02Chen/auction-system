const RedisService = require('./services/redisService');
const AuctionService = require('./services/auctionService');
const { getMySQLPool } = require('./config/mysql');
const metrics = require('./utils/metrics');

function setupSocketServer(io, redisClient) {
  const redisService = new RedisService();
  const auctionService = new AuctionService(redisClient);
  // 压测场景下关闭逐连接日志：console.log 写重定向文件是同步 I/O，会成为观测者效应。
  const QUIET = process.env.QUIET_SOCKET_LOG === '1';
  // 状态类广播的合并窗口（毫秒）。0 = 关闭合并，恢复每次出价都推。
  const COALESCE_MS = parseInt(process.env.BROADCAST_COALESCE_MS || '100', 10);
  // bid:success 的投递范围：
  //   room   默认。广播全房间，前端消息流与「被超越」提示照旧。
  //   bidder 只回出价者。消息量降 3 个数量级，但别人看不到逐条消息流。
  //   auto   房间人数 <= 阈值时用 room，超过则用 bidder。
  const BID_SUCCESS_MODE = process.env.BROADCAST_BID_SUCCESS || 'room';
  const BID_SUCCESS_MAX_ROOM = parseInt(process.env.BROADCAST_BID_SUCCESS_MAX_ROOM || '200', 10);

  // 房间人数，用于统计广播放大。
  function roomSize(auctionId) {
    const room = io.sockets.adapter.rooms.get(`auction:${auctionId}`);
    return room ? room.size : 0;
  }

  function sendToRoom(auctionId, event, payload) {
    io.to(`auction:${auctionId}`).emit(event, payload);
    metrics.recordBroadcast(roomSize(auctionId));
  }

  // 合并窗口：把 auction:state / rank:update / auction:delayed 攒到一次发送。
  // 事件名与 payload 形状不变，前端无需改动。
  const pendingState = new Map();

  function flushState(auctionId) {
    const entry = pendingState.get(auctionId);
    if (!entry) return;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    pendingState.delete(auctionId);
    if (entry.delayed) sendToRoom(auctionId, 'auction:delayed', entry.delayed);
    if (entry.ranking) sendToRoom(auctionId, 'rank:update', entry.ranking);
    if (entry.state) sendToRoom(auctionId, 'auction:state', entry.state);
  }

  function queueState(auctionId, patch) {
    let entry = pendingState.get(auctionId);
    if (!entry) {
      entry = { ranking: null, state: null, delayed: null, timer: null };
      pendingState.set(auctionId, entry);
    }
    if (patch.ranking) entry.ranking = patch.ranking;
    if (patch.state) entry.state = patch.state;
    if (patch.delayed) entry.delayed = patch.delayed;

    if (COALESCE_MS <= 0) {
      flushState(auctionId);
      return;
    }
    if (!entry.timer) {
      entry.timer = setTimeout(() => flushState(auctionId), COALESCE_MS);
    }
  }

  io.on('connection', (socket) => {
    metrics.recordConnection();
    if (!QUIET) console.log('Client connected:', socket.id);
    
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
      
      if (!QUIET) console.log(`User ${socket.data.userId} joined auction ${auctionId}`);
    });

    socket.on('auction:leave', async (auctionId) => {
      socket.leave(`auction:${auctionId}`);
      if (socket.data.userId) {
        await redisService.removeOnlineUser(auctionId, socket.data.userId);
        const onlineCount = await redisService.getOnlineCount(auctionId);
        io.to(`auction:${auctionId}`).emit('user:count', onlineCount);
      }
      if (!QUIET) console.log(`User ${socket.data.userId} left auction ${auctionId}`);
    });

    socket.on('bid:submit', async (data) => {
      const startedAt = Date.now();
      // bidId 必须在 try 之外声明：catch 里也要用它回显，否则会抛 ReferenceError 并打挂进程。
      const bidId = data && data.bidId;
      try {
        const { auctionId, userName, userAvatar } = data;
        const userId = socket.data.userId || `user_${socket.id}`;
        const finalUserName = userName || socket.data.userName || '神秘买家';
        
        const allowed = await redisService.checkRateLimit(userId, 3);
        if (!allowed) {
          metrics.recordRateLimited();
          metrics.recordBidError('出价太频繁，请稍后再试', Date.now() - startedAt);
          socket.emit('bid:error', { message: '出价太频繁，请稍后再试', bidId });
          return;
        }

        const oldState = await redisService.getAuctionState(auctionId);
        const result = await auctionService.processBid(auctionId, userId, finalUserName, userAvatar || '');
        
        const ranking = await redisService.getTopRanking(auctionId, 10);
        const fullState = await redisService.getAuctionState(auctionId);

        const successPayload = {
          auctionId,
          userId,
          userName: finalUserName,
          newPrice: result.newPrice,
          timestamp: Date.now(),
          bidId
        };
        const successToRoom =
          BID_SUCCESS_MODE === 'room' ||
          (BID_SUCCESS_MODE === 'auto' && roomSize(auctionId) <= BID_SUCCESS_MAX_ROOM);
        if (successToRoom) {
          sendToRoom(auctionId, 'bid:success', successPayload);
        } else {
          // 只回出价者：消息量降 3 个数量级，但别人看不到逐条消息流与「被超越」提示。
          socket.emit('bid:success', successPayload);
          metrics.recordBroadcast(1);
        }

        // 状态类事件合并到窗口内一次发送（#9）。
        const delayed = oldState && result.newEndTime && result.newEndTime > oldState.endTime
          ? { newEndTime: result.newEndTime, autoDelaySeconds: result.autoDelaySeconds || 15 }
          : null;
        queueState(auctionId, { ranking, state: fullState, delayed });

        metrics.recordBidSuccess(Date.now() - startedAt);
      } catch (error) {
        metrics.recordBidError(error.message, Date.now() - startedAt);
        socket.emit('bid:error', { message: error.message, bidId });
      }
    });

    socket.on('disconnect', async () => {
      metrics.recordDisconnect();
      const auctionId = socket.data.auctionId;
      const userId = socket.data.userId;
      
      if (auctionId && userId) {
        await redisService.removeOnlineUser(auctionId, userId);
        const onlineCount = await redisService.getOnlineCount(auctionId);
        io.to(`auction:${auctionId}`).emit('user:count', onlineCount);
      }
      
      if (!QUIET) console.log('Client disconnected:', socket.id);
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
            current_price: auction.current_price,
            startPrice: auction.start_price,
            minIncrement: auction.min_increment,
            maxPrice: auction.max_price,
            duration: auction.duration,
            autoDelaySeconds: auction.auto_delay_seconds,
            status: 'active',
            endTime: auction.end_time
          });
          // 排行榜（ZSet）不在 state 里，必须单独从 bids 表回放，否则赢家判不出来。
          try {
            const rebuilt = await auctionService.rebuildRankingFromMySQL(auction.id);
            console.log(`🧮 排行榜已从 bids 表回放: ${rebuilt} 个用户 (${auction.id})`);
          } catch (rebuildError) {
            console.error('❌ 排行榜回放失败:', rebuildError.message);
          }
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

        // 对账：Redis 价格 / MySQL current_price / bids 最高价 三者应一致。
        try {
          const problems = await auctionService.reconcilePrices(auction);
          if (problems.length > 0) {
            console.warn(`⚠️ 对账不一致 [${auction.id}]: ${problems.join('；')}`);
          }
        } catch (reconcileError) {
          console.error('❌ 对账出错:', reconcileError.message);
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
