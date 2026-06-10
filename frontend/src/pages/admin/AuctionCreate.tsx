import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminFetch } from './AdminLayout';

const API_BASE = window.location.protocol + '//' + window.location.host;

const MAX_IMAGE_SIZE = 400;
const QUALITY = 0.7;

const AuctionCreate: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    name: '',
    image: '',
    description: '',
    startPrice: 1,
    minIncrement: 10,
    maxPrice: 999999,
    duration: 300,
    autoDelaySeconds: 15,
  });
  const [loading, setLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState('');
  const [previewError, setPreviewError] = useState(false);

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > height && width > MAX_IMAGE_SIZE) {
            height = (height * MAX_IMAGE_SIZE) / width;
            width = MAX_IMAGE_SIZE;
          } else if (height > MAX_IMAGE_SIZE) {
            width = (width * MAX_IMAGE_SIZE) / height;
            height = MAX_IMAGE_SIZE;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          const result = canvas.toDataURL('image/jpeg', QUALITY);
          resolve(result);
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? Number(value) : value,
    }));
    if (name === 'image') {
      setPreviewImage('');
      setPreviewError(false);
    }
  };

  const handleImagePreview = () => {
    if (formData.image) {
      setPreviewError(false);
      setPreviewImage(formData.image);
    }
  };

  const handleImageError = () => {
    setPreviewError(true);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    try {
      setLoading(true);
      const compressedBase64 = await compressImage(file);
      setPreviewError(false);
      setPreviewImage(compressedBase64);
      setFormData(prev => ({ ...prev, image: compressedBase64 }));
    } catch (err) {
      alert('图片处理失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleClearImage = () => {
    setPreviewImage('');
    setPreviewError(false);
    setFormData(prev => ({ ...prev, image: '' }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await adminFetch(`${API_BASE}/api/auctions`, {
        method: 'POST',
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (data.success) {
        alert('🎉 竞拍发布成功！');
        navigate('/admin/auctions');
      } else {
        alert('❌ 发布失败：' + data.message);
      }
    } catch (err) {
      alert('❌ 网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-800">发布新竞拍</h2>
        <p className="text-gray-500 mt-2">配置商品信息和竞拍规则，开始您的直播竞拍</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm p-8 space-y-6">
        <div className="border-b border-gray-200 pb-6">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">📦 商品信息</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">商品名称 *</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-douyin-red focus:border-transparent outline-none transition-all"
                placeholder="例如：稀世珠宝 - 钻石项链"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">商品图片</label>
              <div className="flex gap-3 flex-wrap">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="px-4 py-3 bg-douyin-red text-white rounded-xl hover:bg-red-600 transition-all disabled:opacity-50"
                >
                  {loading ? '处理中...' : '📷 上传本地图片'}
                </button>
                <div className="flex-1 flex gap-3 min-w-[200px]">
                  <input
                    type="url"
                    name="image"
                    value={formData.image}
                    onChange={handleChange}
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-douyin-red focus:border-transparent outline-none transition-all"
                    placeholder="或输入图片URL"
                  />
                  <button
                    type="button"
                    onClick={handleImagePreview}
                    className="px-4 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all"
                  >
                    预览
                  </button>
                </div>
                {previewImage && (
                  <button
                    type="button"
                    onClick={handleClearImage}
                    className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition-all"
                  >
                    清除
                  </button>
                )}
              </div>
              {previewImage && (
                <div className="mt-3">
                  {previewError ? (
                    <div className="w-48 h-48 bg-gray-100 border border-gray-200 rounded-xl flex flex-col items-center justify-center text-gray-500">
                      <div className="text-3xl mb-2">🖼️</div>
                      <p className="text-xs text-center px-2">图片加载失败</p>
                    </div>
                  ) : (
                    <img 
                      src={previewImage} 
                      alt="预览" 
                      className="w-48 h-48 object-cover rounded-xl border" 
                      onError={handleImageError}
                    />
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">商品介绍</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={4}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-douyin-red focus:border-transparent outline-none transition-all resize-none"
                placeholder="详细描述商品的特点、材质、规格等信息..."
              />
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-xl font-semibold text-gray-800 mb-4">⚙️ 竞拍规则配置</h3>
          
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">起拍价 (¥) *</label>
              <input
                type="number"
                name="startPrice"
                value={formData.startPrice}
                onChange={handleChange}
                min="1"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-douyin-red focus:border-transparent outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">最小加价幅度 (¥) *</label>
              <input
                type="number"
                name="minIncrement"
                value={formData.minIncrement}
                onChange={handleChange}
                min="1"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-douyin-red focus:border-transparent outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">封顶价 (¥)</label>
              <input
                type="number"
                name="maxPrice"
                value={formData.maxPrice}
                onChange={handleChange}
                min="1"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-douyin-red focus:border-transparent outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">竞拍时长 (秒)</label>
              <input
                type="number"
                name="duration"
                value={formData.duration}
                onChange={handleChange}
                min="10"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-douyin-red focus:border-transparent outline-none transition-all"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">自动延时秒数</label>
              <input
                type="number"
                name="autoDelaySeconds"
                value={formData.autoDelaySeconds}
                onChange={handleChange}
                min="0"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-douyin-red focus:border-transparent outline-none transition-all"
              />
              <p className="text-sm text-gray-500 mt-1">结束前30秒内有人出价，自动延长此秒数，防止秒杀</p>
            </div>
          </div>
        </div>

        <div className="flex gap-4 pt-4">
          <button
            type="button"
            onClick={() => navigate('/admin/auctions')}
            className="flex-1 px-6 py-4 bg-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-300 transition-all"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 px-6 py-4 bg-gradient-to-r from-douyin-red to-douyin-orange text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-douyin-red/30 transition-all disabled:opacity-50"
          >
            {loading ? '发布中...' : '🚀 发布竞拍'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AuctionCreate;
