import React, { useState, useEffect } from 'react';
import { adminFetch } from './AdminLayout';

const API_BASE = window.location.protocol + '//' + window.location.host;

interface MonitorAuction {
  id: string;
  name: string;
  image: string;
  currentPrice: number;
  startPrice: number;
  maxPrice: number;
  timeLeft: number;
  top3: Array<{
    rank: number;
    userName: string;
    price: number;
  }>;
}

const AuctionMonitor: React.FC = () => {
  const [auctions, setAuctions] = useState<MonitorAuction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = '主播管理后台 - 实时竞拍监控';
  }, []);

  const fetchMonitorData = async () => {
    try {
      const res = await adminFetch(`${API_BASE}/api/admin/monitor/active-auctions`);
      const data = await res.json();
      if (data.success) {
        setAuctions(data.data);
      }
    } catch (err) {
      console.error('获取监控数据失败', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMonitorData();
    const interval = setInterval(fetchMonitorData, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${minutes}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-800">实时竞拍监控</h2>
        <p className="text-gray-500 mt-2">所有正在进行中的竞拍商品实时状态</p>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-500">加载中...</div>
      ) : auctions.length === 0 ? (
        <div className="text-center py-16 text-gray-500 bg-white rounded-2xl shadow-sm border border-gray-200">
          <div className="text-5xl mb-3">📭</div>
          <p className="text-lg">当前没有正在进行的竞拍</p>
          <p className="text-sm mt-2">前往商品管理页面启动一个竞拍</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {auctions.map((a) => {
            const isUrgent = a.timeLeft < 10000 && a.timeLeft > 0;
            const isReachedMax = a.currentPrice >= a.maxPrice;
            
            return (
              <div key={a.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-200">
                <div className="h-40 bg-gradient-to-br from-gray-100 to-gray-200 relative">
                  {a.image ? (
                    <img
                      src={a.image}
                      alt={a.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-5xl">
                      🎁
                    </div>
                  )}
                  <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-bold ${
                    isReachedMax ? 'bg-yellow-500 text-white' :
                    isUrgent ? 'bg-red-500 text-white animate-pulse' :
                    'bg-green-500 text-white'
                  }`}>
                    {isReachedMax ? '已到封顶价' : isUrgent ? '紧急中' : '竞拍中'}
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-lg font-bold text-gray-800 mb-3 truncate">{a.name}</h3>
                  
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-gray-50 rounded-lg p-2 text-center">
                      <div className="text-xs text-gray-500 mb-0.5">起拍价</div>
                      <div className="font-bold text-gray-700">¥ {a.startPrice?.toLocaleString()}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2 text-center">
                      <div className="text-xs text-gray-500 mb-0.5">当前价</div>
                      <div className="font-bold text-douyin-red">¥ {a.currentPrice?.toLocaleString()}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2 text-center">
                      <div className="text-xs text-gray-500 mb-0.5">封顶价</div>
                      <div className="font-bold text-gray-700">¥ {a.maxPrice?.toLocaleString()}</div>
                    </div>
                  </div>

                  <div className={`text-center py-2.5 rounded-xl mb-3 ${
                    isUrgent ? 'bg-douyin-red/20 animate-pulse-fast border border-douyin-red/30' : 'bg-gray-50'
                  }`}>
                    <div className="text-xs text-gray-500 mb-0.5">剩余时间</div>
                    <div className={`text-xl font-mono font-bold ${isUrgent ? 'text-douyin-red' : 'text-gray-800'}`}>
                      {formatTime(a.timeLeft)}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-bold text-gray-500 mb-1">排行榜 Top 3</div>
                    {a.top3.length === 0 ? (
                      <div className="text-center text-gray-400 py-2 text-xs">暂无出价</div>
                    ) : (
                      a.top3.map((item) => (
                        <div
                          key={item.rank}
                          className={`flex items-center justify-between p-1.5 rounded-lg ${
                            item.rank === 1 ? 'bg-yellow-50 border border-yellow-200' :
                            item.rank === 2 ? 'bg-gray-50 border border-gray-200' :
                            'bg-orange-50 border border-orange-200'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`text-base font-bold w-6 text-center ${
                              item.rank === 1 ? 'text-yellow-600' :
                              item.rank === 2 ? 'text-gray-500' :
                              'text-orange-600'
                            }`}>
                              {item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : '🥉'}
                            </span>
                            <span className="font-medium text-gray-700 text-xs">{item.userName}</span>
                          </div>
                          <span className="font-bold text-douyin-orange text-sm">¥ {item.price.toLocaleString()}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AuctionMonitor;
