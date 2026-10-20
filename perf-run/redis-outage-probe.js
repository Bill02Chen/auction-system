// Redis 宕机演练用出价探针。不修改仓库脚本，独立运行。
// 每 PROBE_INTERVAL_MS 毫秒发一次出价，记录结果与耗时。
const { io } = require('socket.io-client');
const fs = require('fs');

const LOG = process.env.PROBE_LOG || 'perf-run/probe-events.log';
const INTERVAL = parseInt(process.env.PROBE_INTERVAL_MS || '2000', 10);
const DURATION = parseInt(process.env.PROBE_DURATION_MS || '300000', 10);
const BID_TIMEOUT = parseInt(process.env.PROBE_BID_TIMEOUT_MS || '9000', 10);
const SERVER_URL = 'http://localhost:3002';
const AUCTION_ID = 'test-auction-001';

const log = (obj) => {
  const line = JSON.stringify({ iso: new Date().toISOString(), ...obj });
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
};

const socket = io(SERVER_URL, { transports: ['websocket'], reconnection: true, timeout: 5000 });

let lastPrice = null;
socket.on('connect', () => log({ event: 'socket_connect', id: socket.id }));
socket.on('disconnect', (reason) => log({ event: 'socket_disconnect', reason }));
socket.io.on('reconnect', (n) => log({ event: 'socket_reconnect', attempt: n }));

socket.on('connect', () => socket.emit('auction:join', AUCTION_ID));

socket.on('auction:state', (s) => {
  if (s && s.currentPrice !== lastPrice) {
    lastPrice = s.currentPrice;
    log({ event: 'auction_state', currentPrice: s.currentPrice, status: s.status });
  }
});

let n = 0;
let seq = 0;

function sendBid() {
  return new Promise((resolve) => {
    const start = Date.now();
    const mySeq = ++seq;
    let done = false;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.off('bid:success', onSuccess);
      socket.off('bid:error', onError);
      log({ event: 'bid', seq: mySeq, outcome, latencyMs: Date.now() - start, ...outcomeData });
      resolve();
    };
    let outcomeData = {};
    const onSuccess = (d) => { outcomeData = { newPrice: d.newPrice }; finish('success'); };
    const onError = (d) => { outcomeData = { message: d.message }; finish('error'); };
    const timer = setTimeout(() => finish('timeout'), BID_TIMEOUT);
    socket.on('bid:success', onSuccess);
    socket.on('bid:error', onError);
    socket.emit('bid:submit', { auctionId: AUCTION_ID, userName: `探针用户${mySeq}`, userAvatar: '' });
  });
}

async function main() {
  fs.appendFileSync(LOG, JSON.stringify({ iso: new Date().toISOString(), event: 'probe_start', interval: INTERVAL, duration: DURATION }) + '\n');
  const endAt = Date.now() + DURATION;
  while (Date.now() < endAt) {
    n++;
    if (socket.connected) {
      await sendBid();
    } else {
      log({ event: 'bid', seq: ++seq, outcome: 'skipped_socket_down', latencyMs: 0 });
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
  log({ event: 'probe_end', attempts: n });
  socket.disconnect();
  process.exit(0);
}

main();
