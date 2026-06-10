import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LiveRoom from './pages/LiveRoom';
import MyOrders from './pages/MyOrders';
import AdminLayout from './pages/admin/AdminLayout';
import AuctionCreate from './pages/admin/AuctionCreate';
import AuctionManage from './pages/admin/AuctionManage';
import OrderManage from './pages/admin/OrderManage';
import AuctionMonitor from './pages/admin/AuctionMonitor';
import AdminLogin from './pages/AdminLogin';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LiveRoom />} />
        <Route path="/my-orders" element={<MyOrders />} />
        <Route path="/live/:auctionId" element={<LiveRoom />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AuctionCreate />} />
          <Route path="monitor" element={<AuctionMonitor />} />
          <Route path="auctions" element={<AuctionManage />} />
          <Route path="orders" element={<OrderManage />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
