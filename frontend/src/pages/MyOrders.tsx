import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

const API_BASE = window.location.protocol + '//' + window.location.host;

interface Participation {
  auction_id: string;
  auction_name: string;
  auction_image: string;
  auction_status: string;
  auction_final_price: number;
  my_max_bid: number;
  my_order_id: string | null;
  my_order_status: string | null;
  my_win_price: number | null;
  i_am_winner: number;
}

const MyOrders: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [participations, setParticipations] = useState<Participation[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string>('');
  const userNameRef = useRef<string>('');

  useEffect(() => {
    document.title = '我的竞拍历史 - 实时竞拍大师';
  }, []);

  const STORAGE_KEY_USER = 'auction_user_info';
  
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

  useEffect(() => {
    const storedUser = getStoredUserInfo();
    const newSocket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      query: {
        userId: storedUser?.userId || '',
        userName: storedUser?.userName || ''
      }
    });

    newSocket.on('connected:ack', (ackData) => {
      console.log('✅ 连接成功', ackData);
      setUserId(ackData.userId);
      userNameRef.current = ackData.userName;
      saveUserInfo(ackData.userId, ackData.userName);
    });

    newSocket.on('order:paid', () => {
      console.log('💳 收到全局订单已支付通知，刷新列表');
      fetchMyParticipations();
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const fetchMyParticipations = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/user/my-participations?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.success) {
        setParticipations(data.data);
      }
    } catch (err) {
      console.error('获取我的参与记录失败', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId) {
      fetchMyParticipations();
    }
  }, [userId]);

  const handlePay = async (orderId: string) => {
    if (!confirm('确认支付该订单？')) return;
    try {
      const res = await fetch(`${API_BASE}/api/user/orders/${orderId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        alert('支付成功！');
        fetchMyParticipations();
      }
    } catch (err) {
        alert('支付失败');
      }
  };

  const getStatusInfo = (p: Participation) => {
    if (p.i_am_winner === 1) {
      if (p.my_order_status === 'pending_payment') {
        return { label: '待付款', color: 'bg-yellow-100 text-yellow-800' };
      } else if (p.my_order_status === 'paid') {
        return { label: '已付款', color: 'bg-green-100 text-green-800' };
      }
      return { label: '已拍得', color: 'bg-green-100 text-green-800' };
    }
    return { label: '未拍得', color: 'bg-gray-100 text-gray-600' };
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-3">
      <div className="max-w-4xl mx-auto pt-4">
        <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-2xl font-black">我的竞拍历史</h1>
              <p className="text-gray-500 mt-1">你参与过的所有竞拍记录</p>
            </div>
          <button
              onClick={() => window.location.href = '/'}
              className="px-3 py-2 bg-white rounded-lg text-sm hover:bg-gray-100 transition-all shadow-sm border border-gray-200"
            >
              返回直播间
            </button>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-500">加载中...</div>
        ) : participations.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <div className="text-5xl mb-3">📭</div>
            <p className="text-lg">暂无竞拍记录</p>
            <p className="text-sm mt-2">快去直播间参与竞拍吧！</p>
            <button
              onClick={() => window.location.href = '/'}
              className="mt-4 px-5 py-3 bg-douyin-red text-white rounded-xl font-medium hover:bg-red-600 transition-all"
            >
              去直播间
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            {participations.map((p) => {
              const statusInfo = getStatusInfo(p);
              return (
                <div key={p.auction_id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-200">
                  <div className="h-36 sm:h-40 bg-gradient-to-br from-gray-100 to-gray-200 relative">
                    {p.auction_image ? (
                      <img
                        src={p.auction_image}
                        alt={p.auction_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl sm:text-5xl">
                        🎁
                      </div>
                    )}
                    <div className="absolute top-2 right-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    </div>
                  </div>
                  <div className="p-3 sm:p-4">
                    <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-2 truncate">
                      {p.auction_name}
                    </h3>
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <div className="text-xs text-gray-500">我的最高出价</div>
                        <div className="text-base sm:text-lg font-black text-douyin-orange">
                          ¥ {p.my_max_bid?.toLocaleString() || 0}
                        </div>
                      </div>
                      {p.i_am_winner === 1 ? (
                        <div className="text-right">
                          <div className="text-xs text-gray-500">成交价格</div>
                          <div className="text-base sm:text-lg font-black text-douyin-red">
                            ¥ {p.my_win_price?.toLocaleString() || p.auction_final_price?.toLocaleString() || 0}
                          </div>
                        </div>
                      ) : (
                        <div className="text-right">
                          <div className="text-xs text-gray-500">最终成交价</div>
                          <div className="text-base sm:text-lg font-black text-gray-500">
                            ¥ {p.auction_final_price?.toLocaleString() || 0}
                          </div>
                        </div>
                      )}
                    </div>
                    {p.i_am_winner === 1 && p.my_order_status === 'pending_payment' && (
                      <button
                        onClick={() => p.my_order_id && handlePay(p.my_order_id)}
                        className="w-full py-3 bg-douyin-red text-white rounded-xl font-bold hover:bg-red-600 transition-all mt-2"
                      >
                        立即支付
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyOrders;
