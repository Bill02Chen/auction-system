import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Order } from '../../types';
import { adminFetch } from './AdminLayout';

const API_BASE = window.location.protocol + '//' + window.location.host;

const orderStatusLabels: Record<string, { label: string; color: string }> = {
  pending_payment: { label: '待付款', color: 'bg-yellow-100 text-yellow-800' },
  paid: { label: '已付款', color: 'bg-green-100 text-green-800' },
  cancelled: { label: '已取消', color: 'bg-red-100 text-red-800' },
};

const filterOptions = [
  { value: '', label: '全部订单' },
  { value: 'pending_payment', label: '待付款' },
  { value: 'paid', label: '已付款' },
  { value: 'cancelled', label: '已取消' },
];

const OrderManage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  
  const scrollPositionRef = useRef<number>(0);
  const isFirstLoadRef = useRef(true);

  const filteredOrders = useMemo(() => {
    if (!filterStatus) return orders;
    return orders.filter(o => o.status === filterStatus);
  }, [orders, filterStatus]);

  const stats = useMemo(() => ({
    totalAmount: orders.filter(o => o.status === 'paid').reduce((sum, o) => sum + (Number(o.final_price) || 0), 0),
    pendingPayment: orders.filter(o => o.status === 'pending_payment').length,
    paid: orders.filter(o => o.status === 'paid').length,
  }), [orders]);

  const saveScrollPosition = () => {
    const scrollContainer = document.querySelector('main.overflow-auto') as HTMLElement;
    if (scrollContainer) {
      scrollPositionRef.current = scrollContainer.scrollTop;
    }
  };

  const restoreScrollPosition = () => {
    requestAnimationFrame(() => {
      const scrollContainer = document.querySelector('main.overflow-auto') as HTMLElement;
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollPositionRef.current;
      }
    });
  };

  const fetchOrders = async () => {
    if (isFirstLoadRef.current) {
      setLoading(true);
    } else {
      saveScrollPosition();
    }
    try {
      const res = await adminFetch(`${API_BASE}/api/admin/orders`);
      const data = await res.json();
      if (data.success) {
        setOrders(data.data);
      }
    } catch (err) {
      console.error('获取订单列表失败', err);
    } finally {
      setLoading(false);
      if (isFirstLoadRef.current) {
        isFirstLoadRef.current = false;
      } else {
        restoreScrollPosition();
      }
    }
  };

  useEffect(() => {
    fetchOrders();
    
    const refreshTimer = setInterval(() => {
      fetchOrders();
    }, 5000);

    return () => clearInterval(refreshTimer);
  }, []);

  const handleMarkPaid = async (orderId: string) => {
    if (!confirm('确定标记为已付款吗？')) return;
    try {
      const res = await adminFetch(`${API_BASE}/api/admin/orders/${orderId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'paid' }),
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ 订单状态已更新！');
        fetchOrders();
      }
    } catch (err) {
      alert('❌ 操作失败');
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!confirm('⚠️ 确定要取消这个订单吗？')) return;
    try {
      const res = await adminFetch(`${API_BASE}/api/admin/orders/${orderId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ 订单已取消！');
        fetchOrders();
      }
    } catch (err) {
      alert('❌ 操作失败');
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-800">订单管理</h2>
        <p className="text-gray-500 mt-2">查看所有成交订单详情，管理付款状态</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gradient-to-r from-douyin-red to-douyin-orange rounded-2xl shadow-sm p-6 text-white">
          <div className="text-sm text-white/80 mb-1">💰 总成交额</div>
          <div className="text-3xl font-bold">¥ {stats.totalAmount.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-6 border-l-4 border-yellow-500">
          <div className="text-sm text-gray-500 mb-1">📋 待付款</div>
          <div className="text-3xl font-bold text-yellow-600">{stats.pendingPayment}</div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-6 border-l-4 border-green-500">
          <div className="text-sm text-gray-500 mb-1">✅ 已付款</div>
          <div className="text-3xl font-bold text-green-600">{stats.paid}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {filterOptions.map(opt => (
          <button
            key={opt.value}
            onClick={() => setFilterStatus(opt.value)}
            className={`px-5 py-2.5 rounded-xl font-medium transition-all ${
              filterStatus === opt.value
                ? 'bg-douyin-red text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500">加载中...</div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-20 text-gray-400">暂无订单数据</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredOrders.map((order) => (
            <div key={order.id} className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="text-xs text-gray-400 font-mono mb-1">订单号</div>
                  <div className="text-sm text-gray-600 font-mono">{order.id.slice(0, 12)}...</div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${orderStatusLabels[order.status]?.color}`}>
                  {orderStatusLabels[order.status]?.label || order.status}
                </span>
              </div>

              <div className="mb-4">
                <div className="text-sm text-gray-500 mb-1">商品名称</div>
                <div className="font-semibold text-gray-800">{order.auction_name || '未知商品'}</div>
              </div>

              <div className="mb-4">
                <div className="text-sm text-gray-500 mb-1">获胜者</div>
                <div className="font-medium text-gray-700">{order.winner_name}</div>
              </div>

              <div className="mb-4">
                <div className="text-sm text-gray-500 mb-1">成交价格</div>
                <div className="text-2xl font-bold text-douyin-red">¥ {order.final_price?.toLocaleString() || 0}</div>
              </div>

              <div className="text-xs text-gray-400 mb-4">
                {new Date(order.created_at).toLocaleString('zh-CN')}
              </div>

              <div className="flex gap-2 pt-3 border-t border-gray-100">
                <button
                  onClick={() => setSelectedOrder(order)}
                  className="flex-1 px-3 py-2 text-sm bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-all"
                >
                  详情
                </button>
                {order.status === 'pending_payment' && (
                  <>
                    <button
                      onClick={() => handleMarkPaid(order.id)}
                      className="flex-1 px-3 py-2 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-all"
                    >
                      标记已付
                    </button>
                    <button
                      onClick={() => handleCancelOrder(order.id)}
                      className="flex-1 px-3 py-2 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-all"
                    >
                      取消
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full">
            <h3 className="text-2xl font-bold text-gray-800 mb-6">📋 订单详情</h3>
            <div className="space-y-4">
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">订单号</span>
                <span className="font-mono text-sm">{selectedOrder.id}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">商品名称</span>
                <span className="font-medium">{selectedOrder.auction_name || '-'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">获胜者</span>
                <span className="font-medium">{selectedOrder.winner_name}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">成交价格</span>
                <span className="font-bold text-douyin-red text-xl">¥ {selectedOrder.final_price?.toLocaleString() || 0}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">订单状态</span>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${orderStatusLabels[selectedOrder.status]?.color}`}>
                  {orderStatusLabels[selectedOrder.status]?.label || selectedOrder.status}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-500">创建时间</span>
                <span className="text-sm">{new Date(selectedOrder.created_at).toLocaleString('zh-CN')}</span>
              </div>
            </div>
            <button
              onClick={() => setSelectedOrder(null)}
              className="w-full mt-6 px-4 py-3 bg-gray-900 text-white rounded-xl font-medium"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderManage;
