import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Auction, AuctionState, RankItem, BidData } from '../types';

const API_BASE = window.location.protocol + '//' + window.location.host;

type EffectType = 'lead' | 'overtaken' | 'congratulations';

const LiveRoom: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [selectedAuction, setSelectedAuction] = useState<Auction | null>(null);
  const [auctionState, setAuctionState] = useState<AuctionState | null>(null);
  const [ranking, setRanking] = useState<RankItem[]>([]);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [onlineCount, setOnlineCount] = useState(0);
  const [messages, setMessages] = useState<{id: number; text: string; type: string}[]>([]);
  const [isBidding, setIsBidding] = useState(false);
  const [showLeadEffect, setShowLeadEffect] = useState(false);
  const [showOvertakenEffect, setShowOvertakenEffect] = useState(false);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [priceAnimating, setPriceAnimating] = useState(false);
  const [newAuctionNotify, setNewAuctionNotify] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(true);
  const [isVideoMuted, setIsVideoMuted] = useState(true);
  const [auctionsCountdowns, setAuctionsCountdowns] = useState<Record<string, number>>({});
  const [myLastBidPrice, setMyLastBidPrice] = useState(0);
  
  const messageIdRef = useRef(0);
  const userIdRef = useRef<string>('');
  const userNameRef = useRef<string>('');
  const lastBidPriceRef = useRef(0);
  const myLastBidPriceRef = useRef(0);
  const wasLeadingRef = useRef(false);
  const latestEndTimeRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentAuctionIdRef = useRef<string>('');
  
  const currentEffectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const addMessage = useCallback((text: string, type: string = 'info') => {
    const id = ++messageIdRef.current;
    setMessages(prev => [...prev.slice(-4), { id, text, type }]);
  }, []);

  const showEffect = useCallback((type: EffectType, duration: number) => {
    console.log('🎬 立即显示特效:', type, '时长:', duration);
    
    if (currentEffectTimeoutRef.current) {
      console.log('⏹️  打断当前正在播放的特效');
      clearTimeout(currentEffectTimeoutRef.current);
      currentEffectTimeoutRef.current = null;
    }
    
    setShowLeadEffect(false);
    setShowOvertakenEffect(false);
    setShowCongratulations(false);
    
    if (type === 'lead') {
      setShowLeadEffect(true);
    } else if (type === 'overtaken') {
      setShowOvertakenEffect(true);
    } else if (type === 'congratulations') {
      setShowCongratulations(true);
    }
    
    currentEffectTimeoutRef.current = setTimeout(() => {
      console.log('✅ 特效结束:', type);
      setShowLeadEffect(false);
      setShowOvertakenEffect(false);
      setShowCongratulations(false);
      currentEffectTimeoutRef.current = null;
    }, duration);
  }, []);

  const fetchActiveAuctions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auctions?status=active`);
      const data = await res.json();
      if (data.success) {
        setAuctions(data.data);
        const initialCountdowns: Record<string, number> = {};
        data.data.forEach((a: Auction) => {
          if (a.end_time) {
            initialCountdowns[a.id] = new Date(a.end_time).getTime() - Date.now();
          }
        });
        setAuctionsCountdowns(initialCountdowns);
      }
    } catch (err) {
      console.error('获取竞拍列表失败', err);
    }
  }, []);

  const STORAGE_KEY_USER = 'auction_user_info';
  const STORAGE_KEY_MY_BIDS = 'auction_my_bids';
  
  const getStoredUserInfo = () => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY_USER);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.log('读取本地用户信息失败');
    }
    return null;
  };
  
  const saveUserInfo = (userId: string, userName: string) => {
    try {
      sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify({ userId, userName }));
    } catch (e) {
      console.log('保存用户信息失败');
    }
  };

  const getMyAllBids = (): Record<string, number> => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY_MY_BIDS);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.log('读取我的出价记录失败');
    }
    return {};
  };

  const getMyBidForAuction = (auctionId: string): number => {
    const allBids = getMyAllBids();
    return allBids[auctionId] || 0;
  };

  const saveMyBidForAuction = (auctionId: string, price: number) => {
    const allBids = getMyAllBids();
    allBids[auctionId] = price;
    try {
      sessionStorage.setItem(STORAGE_KEY_MY_BIDS, JSON.stringify(allBids));
    } catch (e) {
      console.log('保存我的出价记录失败');
    }
  };

  useEffect(() => {
    if (auctions.length === 0) return;
    
    const countdownTimer = setInterval(() => {
      setAuctionsCountdowns(prev => {
        const newCountdowns: Record<string, number> = {};
        auctions.forEach(a => {
          if (a.end_time) {
            newCountdowns[a.id] = Math.max(0, new Date(a.end_time).getTime() - Date.now());
          }
        });
        return newCountdowns;
      });
    }, 1000);

    const refreshTimer = setInterval(() => {
      if (!selectedAuction) {
        fetchActiveAuctions();
      }
    }, 5000);

    return () => {
      clearInterval(countdownTimer);
      clearInterval(refreshTimer);
    };
  }, [auctions, selectedAuction, fetchActiveAuctions]);

  const formatCountdown = (ms: number) => {
    if (ms <= 0) return '已结束';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `距截拍还剩 ${days}天 ${hours % 24}小时`;
    if (hours > 0) return `距截拍还剩 ${hours}小时 ${minutes % 60}分`;
    if (minutes > 0) return `距截拍还剩 ${minutes}分 ${seconds % 60}秒`;
    return `距截拍还剩 ${seconds}秒`;
  };

  useEffect(() => {
    fetchActiveAuctions();

    const storedUser = getStoredUserInfo();
    const newSocket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      query: {
        userId: storedUser?.userId || '',
        userName: storedUser?.userName || ''
      }
    });

    newSocket.on('connected:ack', (ackData) => {
      console.log('✅ 后端确认连接，ackData:', ackData);
      userIdRef.current = ackData.userId;
      userNameRef.current = ackData.userName;
      saveUserInfo(ackData.userId, ackData.userName);
      console.log('✅ 我的 userId:', userIdRef.current, '我的 userName:', userNameRef.current);
      addMessage(`🎉 欢迎 ${userNameRef.current} 进入直播间！`, 'success');
    });

    newSocket.on('auction:started', (newAuction: Auction) => {
      console.log('📢 收到新竞拍开始通知:', newAuction);
      setNewAuctionNotify(true);
      fetchActiveAuctions();
      setTimeout(() => setNewAuctionNotify(false), 5000);
      addMessage(`🔥 新竞拍已开始：${newAuction.name}`, 'warning');
    });

    newSocket.on('auction:state', (state: AuctionState) => {
      console.log('📊 auction:state 收到:', state);
      setAuctionState(state);
      latestEndTimeRef.current = state.endTime;
      setCurrentPrice(state.currentPrice);
      const remaining = Math.max(0, state.endTime - Date.now());
      setTimeLeft(remaining);
    });

    newSocket.on('bid:success', (data: BidData) => {
      console.log('💰 bid:success 收到:', data);
      setCurrentPrice(data.newPrice);
      setPriceAnimating(true);
      setTimeout(() => setPriceAnimating(false), 300);
      addMessage(`💰 ${data.userName} 出价 ¥${data.newPrice}`, 'bid');
      
      console.log('比较 data.userId:', data.userId, '=== myUserId:', userIdRef.current, '?', data.userId === userIdRef.current);
      if (data.userId === userIdRef.current) {
        console.log('✅ 我出价成功，标记为领先，立即显示"领先"特效！');
        lastBidPriceRef.current = data.newPrice;
        myLastBidPriceRef.current = data.newPrice;
        setMyLastBidPrice(data.newPrice);
        if (currentAuctionIdRef.current) {
          saveMyBidForAuction(currentAuctionIdRef.current, data.newPrice);
          console.log('💾 已保存我的出价到本地存储', currentAuctionIdRef.current, ':', data.newPrice);
        }
        wasLeadingRef.current = true;
        showEffect('lead', 1500);
      } else if (lastBidPriceRef.current > 0 && data.newPrice > lastBidPriceRef.current) {
        const remainingTime = Math.max(0, latestEndTimeRef.current - Date.now());
        console.log('⚡ 被超越！剩余时间:', remainingTime, 'wasLeading:', wasLeadingRef.current);
        if (wasLeadingRef.current && remainingTime < 30000) {
          console.log('🎬 立即显示"被超越"特效！打断之前的特效');
          showEffect('overtaken', 3000);
        }
        wasLeadingRef.current = false;
      }
    });

    newSocket.on('rank:update', (newRanking: RankItem[]) => {
      setRanking(newRanking);
    });

    newSocket.on('auction:delayed', (data: any) => {
      console.log('⏰ auction:delayed 收到:', data);
      const newEndTime = typeof data === 'object' ? data.newEndTime : data;
      const autoDelaySeconds = typeof data === 'object' ? (data.autoDelaySeconds || 15) : 15;
      const remaining = Math.max(0, newEndTime - Date.now());
      setTimeLeft(remaining);
      addMessage(`⏰ 有人出价！竞拍自动延时${autoDelaySeconds}秒`, 'warning');
    });

    newSocket.on('auction:ended', (winner) => {
      console.log('🏆 auction:ended 收到 winner:', winner, 'myUserId:', userIdRef.current, 'myUserName:', userNameRef.current);
      addMessage(`🏆 竞拍结束！恭喜 ${winner?.userName || '神秘买家'} 获得商品！`, 'success');
      
      if (winner) {
        const winnerId = typeof winner === 'object' ? (winner.userId || winner.id) : winner;
        console.log('比较 winnerId:', winnerId, '=== myUserId:', userIdRef.current, '?', winnerId === userIdRef.current);
        if (winnerId === userIdRef.current || (winner.userName && winner.userName === userNameRef.current)) {
          console.log('🎉 立即显示"恭喜"特效！打断之前的特效');
          showEffect('congratulations', 3000);
        }
      }
    });

    newSocket.on('user:count', (count: number) => {
      setOnlineCount(count);
    });

    newSocket.on('bid:error', (error) => {
      addMessage(`❌ ${error.message}`, 'error');
      setIsBidding(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [addMessage, fetchActiveAuctions, showEffect]);

  useEffect(() => {
    if (!auctionState || !selectedAuction) return;
    
    const timer = setInterval(() => {
      const remaining = Math.max(0, auctionState.endTime - Date.now());
      setTimeLeft(remaining);
    }, 50);

    return () => clearInterval(timer);
  }, [auctionState, selectedAuction]);

  const handleSelectAuction = (auction: Auction) => {
    if (!socket) return;
    
    currentAuctionIdRef.current = auction.id;
    setSelectedAuction(auction);
    setAuctionState(null);
    setRanking([]);
    setCurrentPrice(auction.current_price || auction.start_price);
    setTimeLeft(0);
    setOnlineCount(0);
    setMessages([]);
    setShowCongratulations(false);
    setShowOvertakenEffect(false);
    setShowLeadEffect(false);
    
    if (currentEffectTimeoutRef.current) {
      clearTimeout(currentEffectTimeoutRef.current);
      currentEffectTimeoutRef.current = null;
    }
    
    wasLeadingRef.current = false;
    lastBidPriceRef.current = 0;
    
    const mySavedBid = getMyBidForAuction(auction.id);
    myLastBidPriceRef.current = mySavedBid;
    setMyLastBidPrice(mySavedBid);
    
    console.log('📥 从本地存储恢复我的出价', auction.id, ':', mySavedBid);
    
    document.title = `${auction.name} - 实时竞拍大师`;
    socket.emit('auction:join', auction.id);
    addMessage(`✅ 已进入竞拍：${auction.name}`, 'success');
  };

  const handleBackToSelect = () => {
    if (socket && selectedAuction) {
      socket.emit('auction:leave', selectedAuction.id);
    }
    document.title = '选择直播间 - 实时竞拍大师';
    setSelectedAuction(null);
    setAuctionState(null);
    setRanking([]);
    fetchActiveAuctions();
  };

  const handleBid = useCallback(() => {
    if (!socket || !selectedAuction || !auctionState || isBidding) return;
    
    setIsBidding(true);
    socket.emit('bid:submit', {
      auctionId: selectedAuction.id,
      userId: userIdRef.current,
      userName: userNameRef.current,
      userAvatar: ''
    });
    
    setTimeout(() => setIsBidding(false), 500);
  }, [socket, selectedAuction, auctionState, isBidding]);

  const toggleVideoPlay = () => {
    if (!videoRef.current) return;
    if (isVideoPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsVideoPlaying(!isVideoPlaying);
  };

  const toggleVideoMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isVideoMuted;
    setIsVideoMuted(!isVideoMuted);
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const centiseconds = Math.floor((ms % 1000) / 10);
    return `${seconds}.${centiseconds.toString().padStart(2, '0')}`;
  };

  const isUrgent = timeLeft < 10000 && timeLeft > 0;

  useEffect(() => {
    document.title = '选择直播间 - 实时竞拍大师';
  }, []);

  if (!selectedAuction) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 p-3">
        {newAuctionNotify && (
          <div className="fixed top-3 right-3 z-[9999] bg-douyin-red text-white px-3 py-2 rounded-xl shadow-lg animate-bounce text-xs">
            新竞拍已开始！
          </div>
        )}
        
        <div className="max-w-4xl mx-auto pt-4">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-2xl font-black">选择直播间</h1>
              <p className="text-gray-500 mt-1">正在进行中的实时竞拍</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchActiveAuctions}
                className="px-3 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300 transition-all"
              >
                刷新列表
              </button>
              <a
                href="/my-orders"
                className="px-3 py-2 bg-white rounded-lg text-sm hover:bg-gray-100 transition-all shadow-sm border border-gray-200"
              >
                我的竞拍历史
              </a>
            </div>
          </div>

          {auctions.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <div className="text-5xl mb-3">🎯</div>
              <p className="text-lg">暂无正在进行的竞拍</p>
              <p className="text-sm mt-2">请先去管理后台发布并开始一个竞拍</p>
              <a
                href="/admin"
                className="inline-block mt-4 px-5 py-3 bg-douyin-red text-white rounded-xl font-medium hover:bg-red-600 transition-all"
              >
                前往管理后台 →
              </a>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
              {auctions.map((auction) => (
                <div
                  key={auction.id}
                  onClick={() => handleSelectAuction(auction)}
                  className="bg-white rounded-2xl overflow-hidden cursor-pointer hover:ring-2 hover:ring-douyin-red transition-all transform hover:scale-[1.02] shadow-md"
                >
                  <div className="h-32 sm:h-36 bg-gradient-to-br from-gray-100 to-gray-200 relative">
                    {auction.image ? (
                      <img
                        src={auction.image}
                        alt={auction.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl sm:text-5xl">
                        🎁
                      </div>
                    )}
                    <div className="absolute top-2 right-2 bg-green-500 text-white px-2 py-1 rounded-full text-xs font-bold">
                      竞拍中
                    </div>
                  </div>
                  <div className="p-3 sm:p-4">
                    <h3 className="text-base sm:text-lg font-bold mb-1 text-gray-800 truncate">
                      {auction.name}
                    </h3>
                    <div className="text-xl sm:text-2xl font-black text-douyin-red mb-1">
                      ¥ {(auction.current_price || auction.start_price)?.toLocaleString()}
                    </div>
                    {auctionsCountdowns[auction.id] !== undefined && (
                      <p className="text-xs text-douyin-orange font-medium mb-1">
                        {formatCountdown(auctionsCountdowns[auction.id])}
                      </p>
                    )}
                    <p className="text-gray-500 text-xs mt-1 line-clamp-1 sm:line-clamp-2">
                      {auction.description || '暂无描述'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-gray-50 text-gray-900 relative overflow-hidden flex flex-col">
      {showCongratulations && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-gradient-to-br from-yellow-400/95 via-orange-400/95 to-douyin-red/95 pointer-events-none">
          <div className="text-center animate-bounce">
            <div className="text-5xl font-black text-white drop-shadow-2xl">
              🎉 恭喜！
            </div>
            <div className="text-xl font-bold text-white mt-2">
              您成功拍得商品！
            </div>
          </div>
        </div>
      )}

      {showOvertakenEffect && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-gradient-to-br from-red-600/95 via-red-700/95 to-red-900/95 pointer-events-none">
          <div className="text-center animate-pulse">
            <div className="text-5xl font-black text-white drop-shadow-2xl">
              ⚡ 被超越！
            </div>
            <div className="text-xl font-bold text-white mt-2">
              时间不多啦！快出价反超！
            </div>
          </div>
        </div>
      )}

      {showLeadEffect && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 pointer-events-none">
          <div className="text-4xl font-bold text-yellow-400 animate-bounce">🎉 领先！</div>
        </div>
      )}

      {isUrgent && (
        <div className="absolute inset-0 pointer-events-none z-10">
          <div className="absolute inset-0 border-4 border-douyin-red/30 animate-pulse-fast rounded-lg" />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex justify-between items-center mb-2">
          <button
            onClick={handleBackToSelect}
            className="px-3 py-1.5 bg-white rounded-lg text-xs hover:bg-gray-100 transition-all shadow-sm border border-gray-200"
          >
            ← 返回
          </button>
          <div className="text-xs text-gray-500">
            👥 {onlineCount} 人
          </div>
          <div className="text-xs text-douyin-orange">
            🔥 竞拍中
          </div>
        </div>

        <div className="bg-gradient-to-r from-douyin-red/10 to-douyin-orange/10 rounded-xl p-2.5 mb-2 text-center border border-douyin-red/20">
          <h1 className="text-lg font-black text-gray-800">{selectedAuction.name}</h1>
        </div>

        <div className="flex flex-col gap-2">
          <div className="relative rounded-xl overflow-hidden bg-black shadow-lg">
            <video
              ref={videoRef}
              className="w-full aspect-video object-cover"
              autoPlay
              muted={isVideoMuted}
              loop
              playsInline
              src="https://www.w3schools.com/html/mov_bbb.mp4"
            />
            
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
            
            <div className="absolute top-2 left-2 flex items-center gap-1.5">
              <div className="w-8 h-8 rounded-full bg-douyin-red flex items-center justify-center text-base">
                🎤
              </div>
              <div>
                <div className="font-bold text-xs text-white">直播中</div>
                <div className="text-xs text-gray-300">@{userNameRef.current}</div>
              </div>
              <div className="ml-1 px-1.5 py-1 bg-douyin-red rounded-full text-xs font-bold text-white">
                LIVE
              </div>
            </div>

            <div className="absolute bottom-2 left-2 flex gap-2">
              <button
                onClick={toggleVideoPlay}
                className="w-8 h-8 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-black/70 transition-all"
              >
                {isVideoPlaying ? '⏸️' : '▶️'}
              </button>
              <button
                onClick={toggleVideoMute}
                className="w-8 h-8 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-black/70 transition-all"
              >
                {isVideoMuted ? '🔇' : '🔊'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gradient-to-r from-douyin-red/10 to-douyin-orange/10 rounded-xl p-2.5 border border-douyin-red/20">
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-0.5">当前价格</div>
                <div className={`text-xl font-black text-douyin-red ${priceAnimating ? 'animate-bounce-price' : ''}`}>
                  ¥ {currentPrice.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-2.5 border border-gray-200">
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-0.5">我的出价</div>
                {myLastBidPrice > 0 ? (
                  <div className="text-lg font-black text-douyin-orange">
                    ¥ {myLastBidPrice.toLocaleString()}
                  </div>
                ) : (
                  <div className="text-base font-medium text-gray-400">
                    暂无出价
                  </div>
                )}
              </div>
            </div>

            <div className={`text-center py-2.5 rounded-xl ${isUrgent ? 'bg-douyin-red/20 animate-pulse-fast border border-douyin-red/30' : 'bg-white border border-gray-200'}`}>
              <div className="text-xs text-gray-500 mb-0.5">剩余时间</div>
              <div className={`text-xl font-mono font-bold ${isUrgent ? 'text-douyin-red' : 'text-gray-800'}`}>
                {formatTime(timeLeft)}
              </div>
            </div>
          </div>

          <button
            onClick={handleBid}
            disabled={isBidding || timeLeft <= 0}
            className="w-full h-14 rounded-xl text-lg font-black transition-all transform active:scale-95 bg-gradient-to-r from-douyin-red to-douyin-orange hover:shadow-lg hover:shadow-douyin-red/50 disabled:opacity-50 text-white"
          >
            {isBidding ? '出价中...' : '立即出价'}
          </button>

          <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-200 mb-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <div className="text-gray-500 mb-0.5">起拍价</div>
                <div className="font-bold text-douyin-red">¥ {selectedAuction?.start_price?.toLocaleString() || 0}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <div className="text-gray-500 mb-0.5">最小加价</div>
                <div className="font-bold text-douyin-orange">¥ {selectedAuction?.min_increment?.toLocaleString() || 0}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <div className="text-gray-500 mb-0.5">封顶价</div>
                <div className="font-bold text-gray-700">¥ {selectedAuction?.max_price?.toLocaleString() || 0}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <div className="text-gray-500 mb-0.5">延时规则</div>
                <div className="font-bold text-gray-700">最后30秒出价+{selectedAuction?.auto_delay_seconds || 15}秒</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white rounded-xl p-2.5 shadow-sm border border-gray-200">
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {ranking.length === 0 ? (
                  <div className="text-center text-gray-400 py-2 text-xs">等待第一个出价...</div>
                ) : (
                  ranking.slice(0, 5).map((item, index) => (
                    <div
                      key={`${item.userId}-${index}`}
                      className={`flex items-center justify-between p-1.5 rounded-lg ${
                        index === 0 ? 'bg-yellow-50 border border-yellow-200' :
                        index === 1 ? 'bg-gray-50 border border-gray-200' :
                        index === 2 ? 'bg-orange-50 border border-orange-200' :
                        'bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-base font-bold w-6 text-center ${
                          index === 0 ? 'text-yellow-600' :
                          index === 1 ? 'text-gray-500' :
                          index === 2 ? 'text-orange-600' :
                          'text-gray-400'
                        }`}>
                          {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                        </span>
                        <span className="font-medium text-gray-700 text-xs">{item.userName}</span>
                      </div>
                      <span className="font-bold text-douyin-orange text-sm">¥ {item.price.toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl p-2.5 shadow-sm border border-gray-200">
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {messages.length === 0 ? (
                  <div className="text-center text-gray-400 py-2 text-xs">暂无消息...</div>
                ) : (
                  messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`p-1.5 rounded-lg text-xs ${
                        msg.type === 'bid' ? 'bg-orange-50 text-orange-700' :
                        msg.type === 'success' ? 'bg-green-50 text-green-700' :
                        msg.type === 'warning' ? 'bg-yellow-50 text-yellow-700' :
                        msg.type === 'error' ? 'bg-red-50 text-red-700' :
                        'bg-gray-50 text-gray-700'
                      }`}
                    >
                      {msg.text}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveRoom;
