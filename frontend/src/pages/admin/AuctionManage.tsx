import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Auction } from '../../types';
import { adminFetch } from './AdminLayout';

const API_BASE = window.location.protocol + '//' + window.location.host;

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: '待开始', color: 'bg-yellow-100 text-yellow-800' },
  active: { label: '竞拍中', color: 'bg-green-100 text-green-800' },
  paused: { label: '已暂停', color: 'bg-blue-100 text-blue-800' },
  ended: { label: '已结束', color: 'bg-gray-100 text-gray-800' },
  cancelled: { label: '已取消', color: 'bg-red-100 text-red-800' },
};

const filterOptions = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待开始' },
  { value: 'active', label: '竞拍中' },
  { value: 'ended', label: '已结束' },
];

const AuctionManage: React.FC = () => {
  const [allAuctions, setAllAuctions] = useState<Auction[]>([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingAuction, setEditingAuction] = useState<Auction | null>(null);
  const [editForm, setEditForm] = useState<Partial<Auction>>({});
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  
  const scrollPositionRef = useRef<number>(0);
  const isFirstLoadRef = useRef(true);

  const stats = useMemo(() => ({
    total: allAuctions.filter(a => a.status !== 'cancelled').length,
    active: allAuctions.filter(a => a.status === 'active').length,
    pending: allAuctions.filter(a => a.status === 'pending').length,
    ended: allAuctions.filter(a => a.status === 'ended').length,
  }), [allAuctions]);

  const filteredAuctions = useMemo(() => {
    if (showRecycleBin) {
      return allAuctions.filter(a => a.status === 'cancelled');
    }
    if (!filterStatus) {
      return allAuctions.filter(a => a.status !== 'cancelled');
    }
    return allAuctions.filter(a => a.status === filterStatus);
  }, [allAuctions, filterStatus, showRecycleBin]);

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

  const fetchAuctions = async () => {
    if (isFirstLoadRef.current) {
      setLoading(true);
    } else {
      saveScrollPosition();
    }
    try {
      const res = await adminFetch(`${API_BASE}/api/admin/auctions`);
      const data = await res.json();
      if (data.success) {
        setAllAuctions(data.data);
      }
    } catch (err) {
      console.error('获取竞拍列表失败', err);
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
    fetchAuctions();
    
    const refreshTimer = setInterval(() => {
      fetchAuctions();
    }, 5000);

    return () => clearInterval(refreshTimer);
  }, []);

  const handleStart = async (id: string) => {
    if (!confirm('确定要开始这个竞拍吗？')) return;
    try {
      const res = await adminFetch(`${API_BASE}/api/auctions/${id}/start`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        alert('竞拍已开始！全局广播通知所有用户端');
        fetchAuctions();
      } else {
        alert('操作失败：' + data.message);
      }
    } catch (err) {
      alert('操作失败');
    }
  };

  const handleEnd = async (id: string) => {
    if (!confirm('确定要手动结束这个竞拍吗？')) return;
    try {
      const res = await adminFetch(`${API_BASE}/api/auctions/${id}/end`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        alert('竞拍已结束！自动生成订单');
        fetchAuctions();
      } else {
        alert('操作失败：' + data.message);
      }
    } catch (err) {
      alert('操作失败');
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('确定要取消这个竞拍吗？此操作不可撤销！')) return;
    try {
      const res = await adminFetch(`${API_BASE}/api/auctions/${id}/cancel`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        alert('竞拍已取消！');
        fetchAuctions();
      } else {
        alert('操作失败：' + data.message);
      }
    } catch (err) {
      alert('操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('⚠️ 确定要永久物理删除这个竞拍吗？关联的出价和订单也会一起删除！')) return;
    try {
      const res = await adminFetch(`${API_BASE}/api/admin/auctions/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ 竞拍已永久删除！');
        fetchAuctions();
      } else {
        alert('❌ ' + data.message);
      }
    } catch (err) {
      alert('❌ 操作失败');
    }
  };

  const handleEdit = (auction: Auction) => {
    setEditingAuction(auction);
    setEditForm({
      name: auction.name,
      image: auction.image,
      description: auction.description,
      start_price: auction.start_price,
      min_increment: auction.min_increment,
      max_price: auction.max_price,
      duration: auction.duration,
      auto_delay_seconds: auction.auto_delay_seconds,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingAuction) return;
    try {
      const res = await adminFetch(`${API_BASE}/api/admin/auctions/${editingAuction.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editForm.name,
          image: editForm.image,
          description: editForm.description,
          startPrice: editForm.start_price,
          minIncrement: editForm.min_increment,
          maxPrice: editForm.max_price,
          duration: editForm.duration,
          autoDelaySeconds: editForm.auto_delay_seconds,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ 修改成功！');
        setEditingAuction(null);
        fetchAuctions();
      } else {
        alert('❌ ' + data.message);
      }
    } catch (err) {
      alert('❌ 网络错误');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedIds.length === filteredAuctions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredAuctions.map(a => a.id));
    }
  };

  const handleBatchStart = async () => {
    if (!confirm(`确定要批量开始选中的 ${selectedIds.length} 个竞拍吗？`)) return;
    try {
      const res = await adminFetch(`${API_BASE}/api/admin/auctions/batch-start`, {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ 批量启动成功！共启动 ${data.data.length} 个竞拍`);
        setSelectedIds([]);
        setBatchMode(false);
        fetchAuctions();
      }
    } catch (err) {
      alert('❌ 批量操作失败');
    }
  };

  const handleBatchDelete = async () => {
    if (!confirm(`⚠️ 确定要永久物理删除选中的 ${selectedIds.length} 个已取消竞拍吗？`)) return;
    try {
      const res = await adminFetch(`${API_BASE}/api/admin/auctions/batch-delete`, {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ 批量删除成功！`);
        setSelectedIds([]);
        setBatchMode(false);
        fetchAuctions();
      }
    } catch (err) {
      alert('❌ 批量操作失败');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-800">
            {showRecycleBin ? '🗑️ 回收站' : '商品管理'}
          </h2>
          <p className="text-gray-500 mt-2">
            {showRecycleBin ? '已取消的竞拍，支持永久删除' : '查看和管理所有竞拍商品的状态与进度'}
          </p>
        </div>
        <div className="flex gap-3">
          {!showRecycleBin && (
            <>
              <button
                onClick={() => {
                  setShowRecycleBin(true);
                  setBatchMode(false);
                  setSelectedIds([]);
                }}
                className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition-all"
              >
                🗑️ 回收站
              </button>
              <button
                onClick={() => setBatchMode(!batchMode)}
                className={`px-4 py-3 rounded-xl font-medium transition-all ${
                  batchMode ? 'bg-douyin-red text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                }`}
              >
                {batchMode ? '退出批量' : '批量操作'}
              </button>
            </>
          )}
          {showRecycleBin && (
            <button
              onClick={() => {
                setShowRecycleBin(false);
                setBatchMode(false);
                setSelectedIds([]);
              }}
              className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition-all"
            >
              ← 返回商品管理
            </button>
          )}
        </div>
      </div>

      {!showRecycleBin && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-2xl shadow-sm p-6 border-l-4 border-blue-500">
            <div className="text-sm text-gray-500 mb-1">📊 总竞拍数</div>
            <div className="text-3xl font-bold text-gray-800">{stats.total}</div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-6 border-l-4 border-green-500">
            <div className="text-sm text-gray-500 mb-1">🔥 竞拍中</div>
            <div className="text-3xl font-bold text-green-600">{stats.active}</div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-6 border-l-4 border-yellow-500">
            <div className="text-sm text-gray-500 mb-1">⏳ 待开始</div>
            <div className="text-3xl font-bold text-yellow-600">{stats.pending}</div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-6 border-l-4 border-gray-500">
            <div className="text-sm text-gray-500 mb-1">✅ 已结束</div>
            <div className="text-3xl font-bold text-gray-600">{stats.ended}</div>
          </div>
        </div>
      )}

      {!showRecycleBin && (
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
      )}

      {batchMode && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex justify-between items-center">
          <div className="text-blue-800 font-medium">
            已选中 {selectedIds.length} 个竞拍
          </div>
          <div className="flex gap-3">
            {!showRecycleBin && (
              <button
                onClick={handleBatchStart}
                disabled={selectedIds.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50"
              >
                批量开始
              </button>
            )}
            {showRecycleBin && (
              <button
                onClick={handleBatchDelete}
                disabled={selectedIds.length === 0}
                className="px-4 py-2 bg-red-600 text-white rounded-lg disabled:opacity-50"
              >
                批量永久删除
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-500">加载中...</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {batchMode && (
                    <th className="px-6 py-4 text-left">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === filteredAuctions.length && filteredAuctions.length > 0}
                        onChange={selectAll}
                        className="w-4 h-4"
                      />
                    </th>
                  )}
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">商品</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">商品名称</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">当前价</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">状态</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">创建时间</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredAuctions.map((auction) => (
                  <tr key={auction.id} className="hover:bg-gray-50 transition-all">
                    {batchMode && (
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(auction.id)}
                          onChange={() => toggleSelect(auction.id)}
                          className="w-4 h-4"
                        />
                      </td>
                    )}
                    <td className="px-6 py-4">
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100">
                        {auction.image ? (
                          <img src={auction.image} alt={auction.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-2xl">🎁</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-800">{auction.name}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-700 font-semibold">
                      ¥ {(auction.current_price || auction.start_price)?.toLocaleString() || 0}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusLabels[auction.status]?.color}`}>
                        {statusLabels[auction.status]?.label || auction.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-sm">
                      {new Date(auction.created_at).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {!showRecycleBin && auction.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleEdit(auction)}
                              className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-all flex items-center gap-1"
                            >
                              ✏️ 编辑
                            </button>
                            <button
                              onClick={() => handleStart(auction.id)}
                              className="px-3 py-1.5 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-all flex items-center gap-1"
                            >
                              ▶️ 开始
                            </button>
                            <button
                              onClick={() => handleCancel(auction.id)}
                              className="px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-all flex items-center gap-1"
                            >
                              ❌ 取消
                            </button>
                          </>
                        )}
                        {!showRecycleBin && auction.status === 'active' && (
                          <button
                            onClick={() => handleEnd(auction.id)}
                            className="px-3 py-1.5 text-sm bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 transition-all flex items-center gap-1"
                          >
                            ⏹️ 手动结束
                          </button>
                        )}
                        {showRecycleBin && auction.status === 'cancelled' && (
                          <button
                            onClick={() => handleDelete(auction.id)}
                            className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all flex items-center gap-1"
                          >
                            🗑️ 永久删除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredAuctions.length === 0 && (
                  <tr>
                    <td colSpan={batchMode ? 7 : 6} className="px-6 py-20 text-center text-gray-400">
                      {showRecycleBin ? '回收站为空' : '暂无竞拍数据'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingAuction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-lg w-full max-h-screen overflow-y-auto">
            <h3 className="text-2xl font-bold text-gray-800 mb-6">✏️ 编辑竞拍</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">商品名称</label>
                <input
                  type="text"
                  value={editForm.name || ''}
                  onChange={(e) => setEditForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">起拍价</label>
                <input
                  type="number"
                  value={editForm.start_price || 0}
                  onChange={(e) => setEditForm(p => ({ ...p, start_price: Number(e.target.value) }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">最小加价</label>
                <input
                  type="number"
                  value={editForm.min_increment || 10}
                  onChange={(e) => setEditForm(p => ({ ...p, min_increment: Number(e.target.value) }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl outline-none"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setEditingAuction(null)}
                  className="flex-1 px-4 py-3 bg-gray-200 rounded-xl font-medium"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 px-4 py-3 bg-douyin-red text-white rounded-xl font-medium"
                >
                  保存修改
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuctionManage;
