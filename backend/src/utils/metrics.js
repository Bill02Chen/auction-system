// 服务端侧指标。目的：把「第一个真正的瓶颈」变成可观测数字，而不是只看客户端。
// 只做内存计数，进程重启即清零。生产环境应换成 Prometheus 之类的方案。
const { monitorEventLoopDelay } = require('perf_hooks');

const MAX_LATENCY_SAMPLES = 50000;

const state = {
  startedAt: Date.now(),
  bids: {
    total: 0,
    success: 0,
    error: 0,
    byReason: {},
    latencyMs: []
  },
  lock: {
    attempts: 0,
    retries: 0,
    exhausted: 0
  },
  connections: {
    total: 0,
    current: 0,
    max: 0
  },
  broadcasts: {
    events: 0,
    messages: 0
  },
  bidEngine: {
    lua: 0,
    lock: 0
  },
  rateLimited: 0
};

const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();

function recordBidSuccess(latencyMs) {
  state.bids.total++;
  state.bids.success++;
  state.bids.latencyMs.push(latencyMs);
  if (state.bids.latencyMs.length > MAX_LATENCY_SAMPLES) {
    state.bids.latencyMs.shift();
  }
}

function recordBidError(reason, latencyMs) {
  state.bids.total++;
  state.bids.error++;
  const key = reason || 'unknown';
  state.bids.byReason[key] = (state.bids.byReason[key] || 0) + 1;
  if (typeof latencyMs === 'number') {
    state.bids.latencyMs.push(latencyMs);
    if (state.bids.latencyMs.length > MAX_LATENCY_SAMPLES) {
      state.bids.latencyMs.shift();
    }
  }
}

function recordConnection() {
  state.connections.total++;
  state.connections.current++;
  if (state.connections.current > state.connections.max) {
    state.connections.max = state.connections.current;
  }
}

function recordDisconnect() {
  state.connections.current = Math.max(0, state.connections.current - 1);
}

function recordBroadcast(recipients) {
  state.broadcasts.events++;
  state.broadcasts.messages += recipients;
}

function recordLockAttempt() {
  state.lock.attempts++;
}

function recordLockRetry() {
  state.lock.retries++;
}

function recordLockExhausted() {
  state.lock.exhausted++;
}

function recordRateLimited() {
  state.rateLimited++;
}

function recordBidEngine(engine) {
  if (state.bidEngine[engine] === undefined) {
    state.bidEngine[engine] = 0;
  }
  state.bidEngine[engine]++;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return Number(sorted[idx].toFixed(2));
}

function snapshot() {
  const sorted = state.bids.latencyMs.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const uptimeSec = (Date.now() - state.startedAt) / 1000;
  return {
    uptimeSeconds: Number(uptimeSec.toFixed(1)),
    bids: {
      total: state.bids.total,
      success: state.bids.success,
      error: state.bids.error,
      successRate: state.bids.total > 0 ? Number(((state.bids.success / state.bids.total) * 100).toFixed(2)) : null,
      byReason: state.bids.byReason,
      latencyMs: {
        samples: sorted.length,
        avg: sorted.length > 0 ? Number((sum / sorted.length).toFixed(2)) : null,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted.length > 0 ? sorted[sorted.length - 1] : null
      }
    },
    lock: state.lock,
    bidEngine: state.bidEngine,
    connections: state.connections,
    broadcasts: state.broadcasts,
    rateLimited: state.rateLimited,
    eventLoopDelayMs: {
      mean: Number((histogram.mean / 1e6).toFixed(2)),
      p99: Number((histogram.percentile(99) / 1e6).toFixed(2)),
      max: Number((histogram.max / 1e6).toFixed(2))
    },
    rssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1))
  };
}

function reset() {
  state.startedAt = Date.now();
  state.bids = { total: 0, success: 0, error: 0, byReason: {}, latencyMs: [] };
  state.lock = { attempts: 0, retries: 0, exhausted: 0 };
  state.connections = { total: state.connections.current, current: state.connections.current, max: state.connections.current };
  state.broadcasts = { events: 0, messages: 0 };
  state.bidEngine = { lua: 0, lock: 0 };
  state.rateLimited = 0;
  histogram.reset();
}

module.exports = {
  recordBidSuccess,
  recordBidError,
  recordConnection,
  recordDisconnect,
  recordBroadcast,
  recordLockAttempt,
  recordLockRetry,
  recordLockExhausted,
  recordRateLimited,
  recordBidEngine,
  snapshot,
  reset
};
