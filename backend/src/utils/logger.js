// 统一日志前缀：给 console 输出加 ISO 时间戳。
// 在进程启动最早期 require，保证所有后续日志都带时间戳。
const original = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

function stamp() {
  return `[${new Date().toISOString()}]`;
}

['log', 'info', 'warn', 'error'].forEach((level) => {
  console[level] = (...args) => original[level](stamp(), ...args);
});

module.exports = { stamp };
