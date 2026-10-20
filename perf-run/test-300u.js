const { io } = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

const CONFIG = {
  SERVER_URL: 'http://localhost:3002',
  AUCTION_ID: 'test-auction-001',
  CONCURRENT_USERS: 300,
  BIDS_PER_USER: 3
};

class PerformanceTest {
  constructor() {
    this.sockets = [];
    this.processedBidIds = new Set();
    this.stats = {
      totalBids: 0,
      successBids: 0,
      failedBids: 0,
      errors: [],
      startTime: null,
      endTime: null,
      latencies: []
    };
  }

  async run() {
    console.log('='.repeat(70));
    console.log('🚀 高并发竞拍系统性能测试开始');
    console.log('='.repeat(70));
    console.log(`配置参数:`);
    console.log(`  - 服务端地址: ${CONFIG.SERVER_URL}`);
    console.log(`  - 并发用户数: ${CONFIG.CONCURRENT_USERS}`);
    console.log(`  - 每用户出价次数: ${CONFIG.BIDS_PER_USER}`);
    console.log(`  - 预计总出价数: ${CONFIG.CONCURRENT_USERS * CONFIG.BIDS_PER_USER}`);
    console.log('='.repeat(70));

    this.stats.startTime = Date.now();

    await this.connectAllSockets();
    await this.wait(2000);
    await this.sendConcurrentBids();
    await this.wait(5000);

    this.stats.endTime = Date.now();
    this.printReport();
    this.cleanup();
  }

  async connectAllSockets() {
    console.log(`\n🔌 正在连接 ${CONFIG.CONCURRENT_USERS} 个客户端...`);
    
    const connectPromises = [];
    for (let i = 0; i < CONFIG.CONCURRENT_USERS; i++) {
      connectPromises.push(this.connectSingleSocket(i));
    }
    
    await Promise.all(connectPromises);
    console.log(`✅ 所有客户端连接完成，共 ${this.sockets.length} 个`);
  }

  async connectSingleSocket(index) {
    return new Promise((resolve) => {
      const socket = io(CONFIG.SERVER_URL, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 5000
      });

      socket.userId = `test_user_${index}_${uuidv4().substring(0, 8)}`;
      socket.userName = `测试用户${index}`;

      socket.on('connect', () => {
        socket.emit('auction:join', CONFIG.AUCTION_ID);
        this.sockets.push(socket);
        resolve(socket);
      });

      socket.on('connect_error', (err) => {
        console.error(`❌ 客户端 ${index} 连接失败:`, err.message);
        resolve(null);
      });
    });
  }

  async sendConcurrentBids() {
    console.log(`\n⚡ 开始发送高并发出价...`);
    
    const bidPromises = [];
    for (let i = 0; i < this.sockets.length; i++) {
      const socket = this.sockets[i];
      if (!socket || !socket.connected) continue;

      for (let j = 0; j < CONFIG.BIDS_PER_USER; j++) {
        bidPromises.push(this.sendSingleBid(socket, j));
        await this.wait(50);
      }
    }

    console.log(`准备发送 ${bidPromises.length} 个出价请求...`);
    await Promise.all(bidPromises);
    console.log(`✅ 所有出价请求发送完成`);
  }

  async sendSingleBid(socket, bidIndex) {
    return new Promise((resolve) => {
      const bidUniqueId = `${socket.userId}_bid_${bidIndex}`;
      const startTime = Date.now();
      this.stats.totalBids++;

      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved && !this.processedBidIds.has(bidUniqueId)) {
          resolved = true;
          this.processedBidIds.add(bidUniqueId);
          this.stats.failedBids++;
          this.stats.errors.push(`出价超时 - 用户:${socket.userName} 第${bidIndex}次`);
          resolve();
        }
      }, 8000);

      const onSuccess = (data) => {
        if (!resolved && !this.processedBidIds.has(bidUniqueId)) {
          resolved = true;
          this.processedBidIds.add(bidUniqueId);
          clearTimeout(timeout);
          const latency = Date.now() - startTime;
          this.stats.successBids++;
          this.stats.latencies.push(latency);
          socket.off('bid:success', onSuccess);
          socket.off('bid:error', onError);
          resolve();
        }
      };

      const onError = (data) => {
        if (!resolved && !this.processedBidIds.has(bidUniqueId)) {
          resolved = true;
          this.processedBidIds.add(bidUniqueId);
          clearTimeout(timeout);
          this.stats.failedBids++;
          this.stats.errors.push(`出价失败 - 用户:${socket.userName}: ${data.message}`);
          socket.off('bid:success', onSuccess);
          socket.off('bid:error', onError);
          resolve();
        }
      };

      socket.on('bid:success', onSuccess);
      socket.on('bid:error', onError);

      socket.emit('bid:submit', {
        auctionId: CONFIG.AUCTION_ID,
        userName: socket.userName,
        userAvatar: ''
      });
    });
  }

  printReport() {
    const totalTime = (this.stats.endTime - this.stats.startTime) / 1000;
    const qps = this.stats.successBids / totalTime;
    
    const latencies = this.stats.latencies.sort((a, b) => a - b);
    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
    const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;
    const p99 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : 0;
    const avgLatency = latencies.length > 0 
      ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length 
      : 0;

    console.log('\n' + '='.repeat(70));
    console.log('📊 性能测试报告');
    console.log('='.repeat(70));
    console.log(`总耗时: ${totalTime.toFixed(2)} 秒`);
    console.log(`总出价数: ${this.stats.totalBids}`);
    console.log(`成功出价: ${this.stats.successBids}`);
    console.log(`失败出价: ${this.stats.failedBids}`);
    
    if (this.stats.totalBids > 0) {
      console.log(`成功率: ${((this.stats.successBids / this.stats.totalBids) * 100).toFixed(2)}%`);
    }
    
    console.log(`QPS (每秒成功出价): ${qps.toFixed(2)}`);
    console.log('');
    console.log(`延迟统计 (毫秒):`);
    console.log(`  - 平均延迟: ${avgLatency.toFixed(2)} ms`);
    console.log(`  - P50 延迟: ${p50} ms`);
    console.log(`  - P95 延迟: ${p95} ms`);
    console.log(`  - P99 延迟: ${p99} ms`);
    console.log('');
    
    if (this.stats.errors.length > 0) {
      console.log(`错误样本 (前10条):`);
      this.stats.errors.slice(0, 10).forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err}`);
      });
    }
    
    console.log('='.repeat(70));
  
  }

  cleanup() {
    this.sockets.forEach(socket => {
      if (socket && socket.connected) {
        socket.disconnect();
      }
    });
    console.log(`\n🧹 所有客户端已断开连接`);
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function main() {
  const test = new PerformanceTest();
  await test.run();
  process.exit(0);
}

main().catch(err => {
  console.error('测试运行出错:', err);
  process.exit(1);
});
