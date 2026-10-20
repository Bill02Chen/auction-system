// 出价原子脚本（#8）。
// 目的：把「抢分布式锁 + 6 次 Redis 往返」压成一次原子操作。
// 背景：抢锁失败即拒绝的设计，在同一毫秒 3000 次出价时只成交 1 次（见 修改清单.md 第 6.1 节）。
// Redis 单线程执行脚本，脚本之间天然串行，因此所有出价都会依次成交，价格逐次递增。
// KEYS[1]=state KEYS[2]=ranking KEYS[3]=pending queue
// ARGV[1..7]=auctionId, bidId, userId, userName, userAvatar, nowMs, createdAtIso
// 返回：JSON 字符串 {ok=true,newPrice,newEndTime,autoDelaySeconds,newRank} 或 {ok=false,reason}
module.exports = `
local stateKey = KEYS[1]
local rankKey = KEYS[2]
local queueKey = KEYS[3]

local auctionId = ARGV[1]
local bidId = ARGV[2]
local userId = ARGV[3]
local userName = ARGV[4]
local userAvatar = ARGV[5]
local nowMs = tonumber(ARGV[6])
local createdAt = ARGV[7]

local function fail(reason)
  return cjson.encode({ ok = false, reason = reason })
end

if redis.call('EXISTS', stateKey) == 0 then
  return fail('竞拍不存在')
end

local flat = redis.call('HGETALL', stateKey)
local state = {}
for i = 1, #flat, 2 do
  state[flat[i]] = flat[i + 1]
end

if state['status'] ~= 'active' then
  return fail('竞拍未开始或已结束')
end

local endTime = tonumber(state['endTime'])
if nowMs >= endTime then
  return fail('竞拍已结束')
end

local currentPrice = tonumber(state['currentPrice'])
local startPrice = tonumber(state['startPrice'])
local minIncrement = tonumber(state['minIncrement'])
local maxPrice = tonumber(state['maxPrice'])
local autoDelaySeconds = tonumber(state['autoDelaySeconds'] or '15')

if currentPrice >= maxPrice then
  return fail('已达到封顶价，无法再出价')
end

-- 与旧实现一致：排行榜里有没有人出过价，决定首次出价用起拍价。
local hasAnyBids = redis.call('ZCARD', rankKey) > 0
local newPrice
if hasAnyBids then
  newPrice = currentPrice + minIncrement
else
  newPrice = startPrice
end
if newPrice > maxPrice then
  newPrice = maxPrice
end

-- 与旧实现一致的自动延时：剩余不足 30 秒时延长 endTime。
local newEndTime = endTime
local timeRemaining = endTime - nowMs
if timeRemaining < 30000 and timeRemaining > 0 then
  newEndTime = endTime + autoDelaySeconds * 1000
end

redis.call('HSET', stateKey,
  'currentPrice', tostring(newPrice),
  'endTime', tostring(newEndTime))

local member = cjson.encode({ userId = userId, userName = userName, userAvatar = userAvatar })
redis.call('ZADD', rankKey, newPrice, member)

local record = cjson.encode({
  id = bidId,
  auctionId = auctionId,
  userId = userId,
  userName = userName,
  userAvatar = userAvatar,
  price = newPrice,
  createdAt = createdAt
})
redis.call('LPUSH', queueKey, record)
redis.call('EXPIRE', queueKey, 86400)

-- 名次 = 分数比我高的人数 + 1
local higher = redis.call('ZCOUNT', rankKey, '(' .. newPrice, '+inf')
local newRank = higher + 1

return cjson.encode({
  ok = true,
  newPrice = newPrice,
  newEndTime = newEndTime,
  autoDelaySeconds = autoDelaySeconds,
  newRank = newRank
})
`;
