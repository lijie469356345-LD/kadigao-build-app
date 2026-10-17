import { useState, useEffect, useRef } from 'react';
import { Plus, X, FileText, Camera, Save, ArrowLeft, Trash2, Clock, LogIn, LogOut, Loader } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useDataCacheStore } from '../../store/dataCacheStore';
import { createLog, updateLog, getLogById, deleteLog } from '../../api/logs';
import { getShops } from '../../api/shops';
import { compressImage } from '../utils/imageCompress';
import type { LogContent, LogModule, LogSubItem, LogItem, Shop } from '../../types';

const moduleNames = [
  { key: 'coreItems', label: '核心事项' },
  { key: 'shopIssues', label: '店铺问题' },
  { key: 'teachingTraining', label: '带教培训' },
  { key: 'competitorInfo', label: '竞品信息' },
  { key: 'marketResearch', label: '市场调研' },
  { key: 'staffCollection', label: '外部人员收集' },
  { key: 'marketChanges', label: '市场变化' },
] as const;

function LogFormPage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const { setLogData } = useDataCacheStore();
  const [isEdit, setIsEdit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false); // 图片压缩中
  const [previewImage, setPreviewImage] = useState<string | null>(null); // 图片放大预览
  const [shops, setShops] = useState<Shop[]>([]);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const checkInInputRef = useRef<HTMLInputElement>(null);
  const checkOutInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState<{
    supervisor: string;
    date: string;
    departure: string;
    destination: string;
    arrivalTime: string;
    departureTime: string;
    content: LogContent;
    remarks: string;
    signature: string;
    checkInPhoto: string | null;
    checkOutPhoto: string | null;
  }>({
    supervisor: '',
    date: new Date().toISOString().split('T')[0],
    departure: '',
    destination: '',
    arrivalTime: '',
    departureTime: '',
    content: {
      coreItems: [{ items: [] as LogSubItem[] }],
      shopIssues: [{ items: [] as LogSubItem[] }],
      competitorInfo: [{ items: [] as LogSubItem[] }],
      marketChanges: [{ items: [] as LogSubItem[] }],
      marketResearch: [{ items: [] as LogSubItem[] }],
      staffCollection: [{ items: [] as LogSubItem[] }],
      teachingTraining: [{ items: [] as LogSubItem[] }],
    },
    remarks: '',
    signature: '',
    checkInPhoto: null,
    checkOutPhoto: null,
  });

  useEffect(() => {
    loadShops();
    if (params.id) {
      setIsEdit(true);
      loadLog(params.id);
    } else if (user) {
      setFormData(prev => ({
        ...prev,
        supervisor: user.userName || '',
      }));
    }
  }, [params.id, user]);

  const loadShops = async () => {
    try {
      const shopsData = await getShops(user?.groupName);
      setShops(shopsData);
    } catch (error) {
      console.error('Failed to load shops:', error);
    }
  };

  const loadLog = async (id: string) => {
    try {
      setLoading(true);
      const log = await getLogById(id);

      const today = new Date().toISOString().split('T')[0];
      let dateStr = today;

      if (log.date && typeof log.date === 'string') {
        const trimmedDate = log.date.trim();
        if (trimmedDate) {
          if (trimmedDate.includes('/')) {
            const parts = trimmedDate.split('/');
            if (parts.length === 3) {
              dateStr = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
            } else {
              dateStr = trimmedDate;
            }
          } else {
            dateStr = trimmedDate;
          }
        }
      }

      setFormData({
        supervisor: log.supervisor || '',
        date: dateStr,
        departure: log.departure || '',
        destination: log.destination || '',
        arrivalTime: log.arrivalTime || '',
        departureTime: log.departureTime || '',
        content: log.content || {
          coreItems: [{ items: [] }],
          shopIssues: [{ items: [] }],
          competitorInfo: [{ items: [] }],
          marketChanges: [{ items: [] }],
          marketResearch: [{ items: [] }],
          staffCollection: [{ items: [] }],
          teachingTraining: [{ items: [] }],
        },
        remarks: log.remarks || '',
        signature: log.signature || '',
        checkInPhoto: log.checkInPhoto || null,
        checkOutPhoto: log.checkOutPhoto || null,
      });
      setIsSubmitted(log.status === 'submitted');
    } catch (error) {
      console.error('Failed to load log:', error);
    } finally {
      setLoading(false);
    }
  };

  const addNewItem = (moduleKey: keyof LogContent) => {
    const newContent = { ...formData.content };
    if (!newContent[moduleKey][0]) {
      newContent[moduleKey] = [{ items: [] as LogSubItem[] }];
    }
    newContent[moduleKey][0].items.push({
      item: '',
      result: '',
      photo: null,
      photoName: null,
    } as LogSubItem);
    setFormData({ ...formData, content: newContent });
  };

  const removeItem = (moduleKey: keyof LogContent, itemIndex: number) => {
    const newContent = { ...formData.content };
    if (newContent[moduleKey][0] && newContent[moduleKey][0].items.length > 0) {
      newContent[moduleKey][0].items.splice(itemIndex, 1);
      setFormData({ ...formData, content: newContent });
    }
  };

  const updateItemField = (
    moduleKey: keyof LogContent,
    itemIndex: number,
    field: keyof LogSubItem,
    value: string | null
  ) => {
    const newContent = { ...formData.content };
    if (newContent[moduleKey][0] && newContent[moduleKey][0].items[itemIndex]) {
      (newContent[moduleKey][0].items[itemIndex] as any)[field] = value;
      setFormData({ ...formData, content: newContent });
    }
  };

  const handlePhotoUpload = async (
    moduleKey: keyof LogContent,
    itemIndex: number,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setCompressing(true);
      const compressed = await compressImage(file);
      updateItemField(moduleKey, itemIndex, 'photo', compressed);
      updateItemField(moduleKey, itemIndex, 'photoName', file.name);
    } catch (err) {
      console.error('图片压缩失败:', err);
      alert('图片处理失败，请重试');
    } finally {
      setCompressing(false);
    }
  };

  const handleCheckInPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setCompressing(true);
      const compressed = await compressImage(file);
      setFormData(prev => ({ ...prev, checkInPhoto: compressed }));
    } catch (err) {
      console.error('图片压缩失败:', err);
      alert('图片处理失败，请重试');
    } finally {
      setCompressing(false);
    }
  };

  const handleCheckOutPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setCompressing(true);
      const compressed = await compressImage(file);
      setFormData(prev => ({ ...prev, checkOutPhoto: compressed }));
    } catch (err) {
      console.error('图片压缩失败:', err);
      alert('图片处理失败，请重试');
    } finally {
      setCompressing(false);
    }
  };

  const handleDelete = async () => {
    if (!params.id) return;
    if (!window.confirm('确定要删除这条日志吗？删除后不可恢复。')) return;
    try {
      setLoading(true);
      await deleteLog(Number(params.id));
      setLogData([]);
      alert('日志已删除');
      navigate('/logs');
    } catch (error) {
      console.error('Failed to delete log:', error);
      alert('删除失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent | React.MouseEvent, action: 'draft' | 'submit') => {
    if (e && 'preventDefault' in e) {
      e.preventDefault();
    }

    if (!formData.supervisor.trim()) {
      alert('请输入用户姓名');
      return;
    }

    if (!formData.date) {
      alert('请选择巡店日期');
      return;
    }

    if (!formData.destination) {
      alert('请选择目的地店铺');
      return;
    }

    if (action === 'submit') {
      if (!formData.departure.trim()) {
        alert('请输入出发地');
        return;
      }
      if (!formData.arrivalTime) {
        alert('请选择到达时间');
        return;
      }
      if (!formData.departureTime) {
        alert('请选择离开时间');
        return;
      }
      if (formData.departureTime <= formData.arrivalTime) {
        alert('离开时间必须晚于到达时间');
        return;
      }
      const [ah, am] = formData.arrivalTime.split(':').map(Number);
      const [dh, dm] = formData.departureTime.split(':').map(Number);
      if (dh * 60 + dm - (ah * 60 + am) < 30) {
        alert('离开时间必须与到达时间间隔至少30分钟');
        return;
      }
      if (!formData.checkInPhoto) {
        alert('请上传到店打卡照片');
        return;
      }
      if (!formData.checkOutPhoto) {
        alert('请上传离店打卡照片');
        return;
      }
    }
    if (action === 'submit' && !formData.signature.trim()) {
      alert('请输入签名后才能提交');
      return;
    }

    // 提交时校验：已新增的事项，内容/结果/照片都必须填写
    if (action === 'submit') {
      for (const mod of moduleNames) {
        const items = formData.content[mod.key as keyof LogContent][0]?.items || [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it.item || !it.item.trim()) {
            alert(`「${mod.label}」第 ${i + 1} 条事项的内容未填写`);
            return;
          }
          if (!it.result || !it.result.trim()) {
            alert(`「${mod.label}」第 ${i + 1} 条事项的处理结果未填写`);
            return;
          }
          if (!it.photo || !it.photo.trim()) {
            alert(`「${mod.label}」第 ${i + 1} 条事项的照片未上传`);
            return;
          }
        }
      }
    }

    setLoading(true);
    try {
      const logItem = {
        supervisor: formData.supervisor,
        date: formData.date,
        departure: formData.departure,
        destination: formData.destination,
        arrivalTime: formData.arrivalTime,
        departureTime: formData.departureTime,
        content: formData.content,
        remarks: formData.remarks,
        signature: formData.signature,
        userId: user?.id || 1,
        userName: formData.supervisor,
        status: action === 'draft' ? 'draft' : 'submitted',
        checkInPhoto: formData.checkInPhoto,
        checkOutPhoto: formData.checkOutPhoto,
      };

      if (isEdit && params.id) {
        await updateLog(params.id, logItem);
      } else {
        await createLog(logItem);
      }

      setLogData([]);

      if (action === 'draft') {
        alert('草稿保存成功');
      } else {
        alert('日志提交成功');
      }
      navigate('/logs');
    } catch (error) {
      console.error('Failed to save log:', error);
      alert(action === 'draft' ? '保存草稿失败，请重试' : '提交失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate('/logs')}
              className="flex items-center gap-2 text-gray-600 hover:text-primary transition-colors"
            >
              <ArrowLeft size={20} />
              <span>返回</span>
            </button>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-800">
                {isEdit ? '查看巡店日志' : '新建巡店日志'}
              </h1>
              {isSubmitted && (
                <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">已提交</span>
              )}
            </div>
            <div className="w-20" />
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <form className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                用户姓名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.supervisor}
                onChange={(e) => setFormData({ ...formData, supervisor: e.target.value })}
                disabled={isSubmitted}
                className={`w-full px-4 py-2 border rounded-lg ${isSubmitted ? 'border-gray-100 bg-gray-50 cursor-not-allowed' : 'border-gray-200 focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none'}`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                巡店日期
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                disabled={isSubmitted}
                min={isEdit ? undefined : new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                max={new Date().toISOString().split('T')[0]}
                className={`w-full px-4 py-2 border rounded-lg ${isSubmitted ? 'border-gray-100 bg-gray-50 cursor-not-allowed' : 'border-gray-200 focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none'}`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                出发地 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.departure}
                onChange={(e) => setFormData({ ...formData, departure: e.target.value })}
                disabled={isSubmitted}
                className={`w-full px-4 py-2 border rounded-lg ${isSubmitted ? 'border-gray-100 bg-gray-50 cursor-not-allowed' : 'border-gray-200 focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none'}`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                目的地 <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.destination}
                onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                disabled={isSubmitted}
                className={`w-full px-4 py-2 border rounded-lg ${isSubmitted ? 'border-gray-100 bg-gray-50 cursor-not-allowed' : 'border-gray-200 focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none'}`}
              >
                <option value="">请选择店铺</option>
                {shops.map((shop) => (
                  <option key={shop.id || shop.shopName} value={shop.shopName}>
                    {shop.shopName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                到达时间 <span className="text-red-500">*</span>
              </label>
              {isSubmitted ? (
                <div className="w-full px-4 py-2 border border-gray-100 bg-gray-50 rounded-lg text-sm">
                  {formData.arrivalTime || '未记录'}
                </div>
              ) : (
                <input
                  type="time"
                  value={formData.arrivalTime}
                  onChange={(e) => setFormData({ ...formData, arrivalTime: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                离开时间 <span className="text-red-500">*</span>
              </label>
              {isSubmitted ? (
                <div className="w-full px-4 py-2 border border-gray-100 bg-gray-50 rounded-lg text-sm">
                  {formData.departureTime || '未记录'}
                </div>
              ) : (
                <input
                  type="time"
                  value={formData.departureTime}
                  onChange={(e) => setFormData({ ...formData, departureTime: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                />
              )}
            </div>
          </div>

          {!isSubmitted && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <LogIn size={20} className="text-green-600" />
                  <h3 className="font-medium text-gray-800">到店打卡</h3>
                </div>
                <label className={`flex flex-col items-center gap-2 px-4 py-4 border-2 border-dashed border-green-200 rounded-lg ${compressing ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:border-green-400 hover:bg-green-50'} transition-colors`}>
                  {compressing ? (
                    <>
                      <Loader size={32} className="text-green-400 animate-spin" />
                      <span className="text-sm text-green-600">压缩中...</span>
                    </>
                  ) : formData.checkInPhoto ? (
                    <img src={formData.checkInPhoto} alt="到店打卡" className="max-h-32 rounded-lg" />
                  ) : (
                    <>
                      <Camera size={32} className="text-green-400" />
                      <span className="text-sm text-green-600">点击上传到店打卡照片</span>
                      <span className="text-xs text-red-400">*必填</span>
                    </>
                  )}
                  <input ref={checkInInputRef} type="file" accept="image/*" onChange={handleCheckInPhoto} className="hidden" />
                </label>
                {formData.checkInPhoto && (
                  <button
                    type="button"
                    onClick={() => checkInInputRef.current?.click()}
                    className="mt-2 w-full text-xs text-green-600 hover:text-green-800"
                  >
                    重新上传
                  </button>
                )}
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <LogOut size={20} className="text-red-500" />
                  <h3 className="font-medium text-gray-800">离店打卡</h3>
                </div>
                <label className={`flex flex-col items-center gap-2 px-4 py-4 border-2 border-dashed border-red-200 rounded-lg ${compressing ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:border-red-400 hover:bg-red-50'} transition-colors`}>
                  {compressing ? (
                    <>
                      <Loader size={32} className="text-red-400 animate-spin" />
                      <span className="text-sm text-red-600">压缩中...</span>
                    </>
                  ) : formData.checkOutPhoto ? (
                    <img src={formData.checkOutPhoto} alt="离店打卡" className="max-h-32 rounded-lg" />
                  ) : (
                    <>
                      <Camera size={32} className="text-red-400" />
                      <span className="text-sm text-red-600">点击上传离店打卡照片</span>
                      <span className="text-xs text-red-400">*必填</span>
                    </>
                  )}
                  <input ref={checkOutInputRef} type="file" accept="image/*" onChange={handleCheckOutPhoto} className="hidden" />
                </label>
                {formData.checkOutPhoto && (
                  <button
                    type="button"
                    onClick={() => checkOutInputRef.current?.click()}
                    className="mt-2 w-full text-xs text-red-600 hover:text-red-800"
                  >
                    重新上传
                  </button>
                )}
              </div>
            </div>
          )}

          {isSubmitted && (formData.checkInPhoto || formData.checkOutPhoto) && (
            <div className="grid grid-cols-2 gap-4">
              {formData.checkInPhoto && (
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <LogIn size={18} className="text-green-600" />
                    <span className="text-sm font-medium text-gray-700">到店打卡</span>
                  </div>
                  <img src={formData.checkInPhoto} alt="到店打卡" className="max-h-40 rounded-lg cursor-pointer" onClick={() => setPreviewImage(formData.checkInPhoto)} />
                </div>
              )}
              {formData.checkOutPhoto && (
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <LogOut size={18} className="text-red-500" />
                    <span className="text-sm font-medium text-gray-700">离店打卡</span>
                  </div>
                  <img src={formData.checkOutPhoto} alt="离店打卡" className="max-h-40 rounded-lg cursor-pointer" onClick={() => setPreviewImage(formData.checkOutPhoto)} />
                </div>
              )}
            </div>
          )}

          {moduleNames.map((module) => {
            const items = formData.content[module.key as keyof LogContent][0]?.items || [];
            return (
              <div key={module.key} className="bg-white rounded-xl border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-800 flex items-center gap-2">
                    <FileText size={20} className="text-primary" />
                    {module.label}
                  </h3>
                  {!isSubmitted && (
                    <button
                      type="button"
                      onClick={() => addNewItem(module.key as keyof LogContent)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-primary/10 text-primary text-sm rounded-lg hover:bg-primary/20 transition-colors"
                    >
                      <Plus size={16} />
                      <span>新增事项</span>
                    </button>
                  )}
                </div>
                <div className="space-y-4">
                  {items.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <FileText size={48} className="mx-auto mb-2 opacity-50" />
                      <p>暂无事项，点击上方按钮添加</p>
                    </div>
                  ) : (
                    items.map((_, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-600">
                            事项 {index + 1}
                          </span>
                          {!isSubmitted && (
                              <button
                                type="button"
                                onClick={() => removeItem(module.key as keyof LogContent, index)}
                                className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
                              >
                                <X size={16} />
                              </button>
                            )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-600 mb-1">
                            事项内容 <span className="text-red-500">*</span>
                          </label>
                          {isSubmitted ? (
                            <div className="w-full px-4 py-2 border border-gray-100 bg-gray-50 rounded-lg text-sm text-gray-800 whitespace-pre-wrap break-words min-h-[40px]">
                              {items[index].item || '无'}
                            </div>
                          ) : (
                            <input
                              type="text"
                              value={items[index].item}
                              onChange={(e) =>
                                updateItemField(
                                  module.key as keyof LogContent,
                                  index,
                                  'item',
                                  e.target.value
                                )
                              }
                              placeholder="请输入事项内容"
                              className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                            />
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-600 mb-1">
                            处理结果 <span className="text-red-500">*</span>
                          </label>
                          {isSubmitted ? (
                            <div className="w-full px-4 py-2 border border-gray-100 bg-gray-50 rounded-lg text-sm text-gray-800 whitespace-pre-wrap break-words min-h-[40px]">
                              {items[index].result || '无'}
                            </div>
                          ) : (
                            <textarea
                              value={items[index].result}
                              onChange={(e) =>
                                updateItemField(
                                  module.key as keyof LogContent,
                                  index,
                                  'result',
                                  e.target.value
                                )
                              }
                              placeholder="请输入处理结果"
                              rows={2}
                              className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
                            />
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-600 mb-1">
                            上传图片 <span className="text-red-500">*</span>
                          </label>
                          {isSubmitted ? (
                            <div className="flex items-center gap-2 px-4 py-3 border border-dashed border-gray-100 bg-gray-50 rounded-lg">
                              <Camera size={18} className="text-gray-300" />
                              <span className="text-sm text-gray-400">
                                {items[index].photoName || '无图片'}
                              </span>
                            </div>
                          ) : compressing ? (
                            <div className="flex items-center gap-2 px-4 py-3 border border-dashed border-primary/30 bg-primary/5 rounded-lg">
                              <Loader size={18} className="text-primary animate-spin" />
                              <span className="text-sm text-primary">压缩中...</span>
                            </div>
                          ) : (
                            <label className="flex items-center gap-2 px-4 py-3 border border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors">
                              <Camera size={18} className="text-gray-400" />
                              <span className="text-sm text-gray-500">
                                {items[index].photoName || '点击上传图片'}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) =>
                                  handlePhotoUpload(
                                    module.key as keyof LogContent,
                                    index,
                                    e
                                  )
                                }
                                className="hidden"
                              />
                            </label>
                          )}
                          {items[index].photo && (
                            <img
                              src={items[index].photo}
                              alt={items[index].photoName || undefined}
                              className="mt-2 max-w-xs rounded-lg cursor-pointer"
                              onClick={() => setPreviewImage(items[index].photo)}
                            />
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}

          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h3 className="text-lg font-medium text-gray-800 mb-4">备注</h3>
            {isSubmitted ? (
              <div className="w-full px-4 py-3 border border-gray-100 bg-gray-50 rounded-lg text-sm text-gray-800 whitespace-pre-wrap break-words min-h-[60px]">
                {formData.remarks || '无'}
              </div>
            ) : (
              <textarea
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                placeholder="请输入备注信息"
                rows={3}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg resize-none focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
              />
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h3 className="text-lg font-medium text-gray-800 mb-4">签名 <span className="text-red-500">*</span></h3>
            <input
              type="text"
              value={formData.signature}
              onChange={(e) => setFormData({ ...formData, signature: e.target.value })}
              disabled={isSubmitted}
              placeholder="请输入签名"
              className={`w-full px-4 py-2 border rounded-lg ${isSubmitted ? 'border-gray-100 bg-gray-50 cursor-not-allowed' : 'border-gray-200 focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none'}`}
            />
          </div>

          <div className="flex justify-between gap-4">
            {isEdit && !isSubmitted ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 size={18} />
                <span>删除</span>
              </button>
            ) : <div />}
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => navigate('/logs')}
                className="px-6 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {isSubmitted ? '返回' : '取消'}
              </button>
              {!isSubmitted && (
                <>
                  <button
                    type="button"
                    onClick={(e) => handleSubmit(e, 'draft')}
                    disabled={loading}
                    className="flex items-center gap-2 px-6 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save size={18} />
                    <span>{loading ? '保存中...' : '保存草稿'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleSubmit(e, 'submit')}
                    disabled={loading}
                    className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save size={18} />
                    <span>{loading ? '提交中...' : '提交'}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* 图片放大预览弹窗 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setPreviewImage(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors"
            onClick={() => setPreviewImage(null)}
            aria-label="关闭预览"
          >
            <X size={28} />
          </button>
          <img
            src={previewImage}
            alt="预览"
            className="max-w-full max-h-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export default LogFormPage;
