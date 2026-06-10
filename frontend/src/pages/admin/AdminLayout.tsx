import React, { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';

const API_BASE = window.location.protocol + '//' + window.location.host;
const STORAGE_KEY_ADMIN_TOKEN = 'admin_token';

export const getAdminToken = () => localStorage.getItem(STORAGE_KEY_ADMIN_TOKEN) || '';

export const adminFetch = async (url: string, options: RequestInit = {}) => {
  const token = getAdminToken();
  const headers = new Headers(options.headers);
  headers.set('x-admin-token', token);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...options, headers });
};

const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    document.title = '主播管理后台 - 实时竞拍大师';
  }, []);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      navigate('/admin/login');
      return;
    }
    const verify = async () => {
      try {
        const res = await adminFetch(`${API_BASE}/api/admin/health-check`);
        if (!res.ok) {
          localStorage.removeItem(STORAGE_KEY_ADMIN_TOKEN);
          navigate('/admin/login');
          return;
        }
      } catch (e) {
      } finally {
        setChecking(false);
      }
    };
    verify();
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY_ADMIN_TOKEN);
    navigate('/admin/login');
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
        <div className="text-xl">验证登录中...</div>
      </div>
    );
  }

  const navItems = [
    { path: '/admin', label: '竞拍发布', icon: '' },
    { path: '/admin/monitor', label: '实时监控', icon: '' },
    { path: '/admin/auctions', label: '商品管理', icon: '' },
    { path: '/admin/orders', label: '订单管理', icon: '' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-52 bg-gray-900 text-white flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-lg font-bold">主播管理后台</h1>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all text-base ${
                location.pathname === item.path
                  ? 'bg-douyin-red text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <span className="font-medium">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-700 space-y-1">
          <Link
            to="/"
            className="flex items-center gap-2 px-3 py-2.5 text-gray-400 hover:text-white transition-all text-base"
          >
            <span>返回直播间</span>
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2.5 text-gray-400 hover:text-red-400 transition-all w-full text-left text-base"
          >
            <span>退出登录</span>
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
};

export default AdminLayout;
