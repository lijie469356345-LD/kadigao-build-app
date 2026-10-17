import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ChevronRight, Loader2, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { submitShoeFeedback, decideShoeFeedback, getShoeFeedback, getShoeFeedbackByPhone, rateShoeFeedback, voidShoeFeedback } from '../../api/shoeFeedback';

// 状态显示映射
const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  evaluating: '评估中',
  submitted: '已提交',
  accepted: '已受理',
  completed: '已完成',
  voided: '已作废',
};

// 金额选项
const AMOUNT_OPTIONS = ['200', '299', '300', '399', '400', '500'];

// 受理时间范围
const START_DATE = new Date('2025-06-01');
const END_DATE = new Date('2026-06-05');

// 充值时间是否在受理范围外
function isOutOfRangeDate(dateStr?: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d < START_DATE || d > END_DATE;
}

// 上传限制（与服务端 multer 一致）：单张图片压缩至 150KB 以内
const MAX_UPLOAD_BYTES = 150 * 1024;

// 图片自动压缩：超过 maxBytes 时用 canvas 循环降尺寸/质量，直到不超限；未超限则原样返回
async function compressImageFile(file: File, maxBytes = MAX_UPLOAD_BYTES): Promise<File> {
  if (file.size <= maxBytes) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('图片解析失败'));
      el.src = url;
    });
    // 最长边压缩到 1920 以内
    let width = img.naturalWidth || 1920;
    let height = img.naturalHeight || 1080;
    const scale = Math.min(1, 1920 / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    let quality = 0.85;

    while (true) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('当前浏览器不支持图片压缩');
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) throw new Error('图片压缩失败');
      if (blob.size <= maxBytes) {
        const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        return new File([blob], name, { type: 'image/jpeg' });
      }
      // 仍超限：优先继续缩小尺寸，尺寸接近下限时降质量
      if (width > 512) {
        width = Math.round(width * 0.75);
        height = Math.round(height * 0.75);
      } else if (quality > 0.3) {
        quality -= 0.1;
      } else {
        throw new Error('图片过大且无法继续压缩');
      }
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ShoeFeedbackPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<'home' | 'feedback' | 'query'>('home');
  const [step, setStep] = useState(0); // 0=充值时间, 1=金额, 2=上传图片, 3=已用券数, 4=评估中转圈, 5=评估结果, 6=提交完成, 7=查看状态
  const [rechargeDate, setRechargeDate] = useState('');
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [paymentProofPreview, setPaymentProofPreview] = useState('');
  const [usedTicketCount, setUsedTicketCount] = useState(0);
  const [expiredTicketInfo, setExpiredTicketInfo] = useState(''); // '1'-'20' | '不记得' | '其他:x' | ''（未选择）
  const [expiredOtherValue, setExpiredOtherValue] = useState('');
  const [submitterName, setSubmitterName] = useState('');
  const [submitterPhone, setSubmitterPhone] = useState('');
  const [feedbackNo, setFeedbackNo] = useState('');
  const [feedbackId, setFeedbackId] = useState<number | null>(null);
  const [estimatedTickets, setEstimatedTickets] = useState(0);
  const [outOfRange, setOutOfRange] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [agree, setAgree] = useState<boolean | null>(null);
  const [disagreeDesc, setDisagreeDesc] = useState('');
  const [showDisagreeModal, setShowDisagreeModal] = useState(false);
  const [queryNo, setQueryNo] = useState('');
  const [queryResult, setQueryResult] = useState<any>(null);
  const [queryResults, setQueryResults] = useState<any[]>([]);
  const [showResultList, setShowResultList] = useState(false);
  const [qrPreview, setQrPreview] = useState(false);
  const [qrSaved, setQrSaved] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [ratedValue, setRatedValue] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 摄像头相关
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // URL参数：如果有 feedbackNo 则直接查看状态
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fn = params.get('feedbackNo');
    if (fn) {
      setQueryNo(fn);
      setStep(7);
      setView('query');
      loadFeedback(fn);
    }
  }, []);

  // 页面离开时：如果停在评估页面（step===5）未决策，则自动作废
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (step === 5 && feedbackNo) {
        // 用 sendBeverage 发送，不阻塞页面关闭
        const url = '/api/shoe-feedback/' + feedbackNo + '/void';
        const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [step, feedbackNo]);

  const loadFeedback = async (no: string) => {
    try {
      const data = await getShoeFeedback(no);
      setQueryResult(data);
    } catch (e: any) {
      setQueryResult({ error: e?.response?.data?.message || '查询失败' });
    }
  };

  // 按手机号查询
  const loadFeedbackByPhone = async (phone: string) => {
    try {
      const data = await getShoeFeedbackByPhone(phone);
      if (Array.isArray(data) && data.length > 0) {
        if (data.length === 1) {
          setQueryResult(data[0]);
          setShowResultList(false);
        } else {
          setQueryResults(data);
          setShowResultList(true);
          setQueryResult(null);
        }
        setStep(7);
      } else {
        setQueryResult({ error: '未找到该手机号的反馈记录' });
        setShowResultList(false);
        setStep(7);
      }
    } catch (e: any) {
      setQueryResult({ error: e?.response?.data?.message || '查询失败' });
      setShowResultList(false);
      setStep(7);
    }
  };

  // 步骤0：选择充值时间 -> 校验范围
  const handleDateNext = () => {
    if (!rechargeDate) return;
    if (!submitterPhone.trim()) return;
    const date = new Date(rechargeDate);
    if (date < START_DATE || date > END_DATE) {
      setOutOfRange(true);
      // 不在范围内，提交后直接完成
      handleSubmit(true);
    } else {
      setStep(1);
    }
  };

  // 步骤3完成 -> 提交表单
  const handleSubmit = async (outRange: boolean) => {
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('rechargeDate', rechargeDate);
      formData.append('rechargeAmount', rechargeAmount);
      formData.append('usedTicketCount', String(usedTicketCount));
      formData.append('expiredTicketCount', expiredTicketInfo || '');
      formData.append('submitterName', submitterName);
      formData.append('submitterPhone', submitterPhone);
      if (paymentProof) formData.append('paymentProof', paymentProof);

      const res = await submitShoeFeedback(formData);

      if (!res.inRange || outRange) {
        // 不在受理范围 -> 直接到流程页面展示提示
        setOutOfRange(true);
        setFeedbackNo(res.feedbackNo);
        setFeedbackId(res.feedbackId || null);
        setStep(7);
        loadFeedback(res.feedbackNo);
      } else {
        // 在受理范围 -> 进入评估转圈
        setFeedbackNo(res.feedbackNo);
        setEstimatedTickets(res.estimatedTickets);
        setStep(4); // 转圈页面
        // 3秒后进入评估结果
        setTimeout(() => {
          setStep(5);
        }, 3000);
      }
    } catch (e: any) {
      alert('提交失败: ' + (e?.response?.data?.message || e?.message || '未知错误'));
      setSubmitting(false);
    }
  };

  // 评估结果：同意/不同意
  const handleDecide = async (userAgree: boolean) => {
    if (!feedbackNo) return;
    try {
      const detail = await getShoeFeedback(feedbackNo);
      if (!detail.id) {
        alert('反馈记录查询失败');
        return;
      }
      await decideShoeFeedback(detail.id, {
        agree: userAgree,
        disagreeDesc: userAgree ? '' : disagreeDesc,
      });
      setAgree(userAgree);
      // 同意/不同意后统一进入提交完成页（无论预估补发几张都走人工确认流程，不自动完成）
      setStep(6);
      loadFeedback(feedbackNo);
    } catch (e: any) {
      alert('操作失败: ' + (e?.response?.data?.message || e?.message || ''));
    }
  };

  // 统一设置凭证图片（超过 150KB 自动压缩后上传）
  const applyPaymentProof = async (file: File) => {
    try {
      const finalFile = await compressImageFile(file);
      setPaymentProof(finalFile);
      setPaymentProofPreview(URL.createObjectURL(finalFile));
    } catch (e: any) {
      alert('图片处理失败: ' + (e?.message || '请压缩后重新选择'));
    }
  };

  // 选择图片（文件上传）
  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      alert('图片超过 150KB，正在自动压缩…');
    }
    applyPaymentProof(file);
    e.target.value = '';
  };

  // 开启摄像头
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setCameraStream(stream);
      setShowCamera(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (e) {
      alert('无法访问摄像头，请检查浏览器权限设置');
    }
  };

  // 关闭摄像头
  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      setCameraStream(null);
    }
    setShowCamera(false);
  };

  // 拍照
  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
          applyPaymentProof(file);
        }
        stopCamera();
      }, 'image/jpeg', 0.9);
    }
  };

  // 屏幕截图
  const captureScreen = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play();
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) {
              const file = new File([blob], `screenshot_${Date.now()}.jpg`, { type: 'image/jpeg' });
              applyPaymentProof(file);
            }
            stream.getTracks().forEach(t => t.stop());
          }, 'image/jpeg', 0.9);
        }
      };
    } catch (e) {
      alert('截图功能取消或不可用');
    }
  };

  // 保存二维码到手机
  const saveQrCode = async () => {
    try {
      const res = await fetch('/shoe-feedback-qr.png');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'shoe-feedback-qr.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setQrSaved(true);
      setTimeout(() => setQrSaved(false), 3000);
    } catch (e) {
      // 降级：直接打开图片让用户长按保存
      window.open('/shoe-feedback-qr.png', '_blank');
      setQrSaved(true);
      setTimeout(() => setQrSaved(false), 3000);
    }
  };

  // ============ 渲染各步骤 ============

  // 主界面：两个按钮
  if (view === 'home') {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto flex flex-col">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm">
            <div className="flex items-center justify-center mb-8">
              <img src="/logo.jpg" alt="logo" className="h-12 w-12 object-contain mr-2" />
              <h1 className="text-xl font-bold text-gray-800">卡迪高洗鞋服务</h1>
            </div>
            <p className="text-center text-sm text-gray-400 mb-12">请选择您需要的服务</p>

            <button
              onClick={() => { setView('feedback'); setStep(0); }}
              className="w-full py-5 bg-blue-600 text-white rounded-2xl font-bold text-lg flex items-center justify-center gap-3 mb-4 shadow-sm hover:bg-blue-700 transition-colors"
            >
              <Camera size={24} /> 反馈
            </button>
            <button
              onClick={() => { setView('query'); setStep(-1); }}
              className="w-full py-5 bg-gray-100 text-gray-700 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-gray-200 transition-colors"
            >
              <ChevronRight size={24} /> 查询
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 查询入口界面：输入手机号
  if (view === 'query' && step !== 7) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto">
        <div className="bg-white p-6 rounded-t-2xl min-h-screen">
          <button onClick={() => setView('home')} className="flex items-center text-gray-500 mb-4">
            <ArrowLeft size={18} className="mr-1" /> 返回
          </button>
          <div className="flex items-center justify-center mb-2">
            <img src="/logo.jpg" alt="logo" className="h-8 w-8 object-contain mr-2" />
            <h1 className="text-lg font-bold text-gray-800">查询反馈进度</h1>
          </div>
          <p className="text-xs text-gray-400 text-center mb-8">输入手机号查询您的反馈处理状态</p>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">手机号</label>
            <input
              type="tel"
              value={queryNo}
              onChange={(e) => setQueryNo(e.target.value)}
              className="w-full px-4 py-4 border border-gray-300 rounded-xl text-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="请输入您的手机号"
            />
          </div>

          <button
            onClick={() => { if (queryNo.trim()) { loadFeedbackByPhone(queryNo.trim()); } }}
            disabled={!queryNo.trim()}
            className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium text-base disabled:bg-gray-300 flex items-center justify-center gap-2"
          >
            查询手机号 <ChevronRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  // 步骤0：充值时间
  if (step === 0) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto">
        <div className="bg-white p-6 rounded-t-2xl min-h-screen">
          <button onClick={() => setView('home')} className="flex items-center text-gray-500 mb-4">
            <ArrowLeft size={18} className="mr-1" /> 返回
          </button>
          <div className="flex items-center justify-center mb-2">
            <img src="/logo.jpg" alt="logo" className="h-8 w-8 object-contain mr-2" />
            <h1 className="text-lg font-bold text-gray-800">卡迪高洗鞋服务反馈</h1>
          </div>
          <p className="text-xs text-gray-400 text-center mb-8">请按提示填写反馈信息</p>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              <span className="text-red-500">*</span> 您的礼包充值时间？
            </label>
            <input
              type="date"
              value={rechargeDate}
              onChange={(e) => setRechargeDate(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="请选择充值时间"
            />
            <p className="text-xs text-gray-400 mt-2">
              受理范围：2025年6月1日 ~ 2026年6月5日
            </p>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">您的姓名（选填）</label>
            <input
              type="text"
              value={submitterName}
              onChange={(e) => setSubmitterName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="请输入姓名"
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">手机号（必填）</label>
            <input
              type="tel"
              value={submitterPhone}
              onChange={(e) => setSubmitterPhone(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="请输入手机号"
            />
          </div>

          <button
            onClick={handleDateNext}
            disabled={!rechargeDate || !submitterPhone.trim() || submitting}
            className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium text-base disabled:bg-gray-300 flex items-center justify-center gap-2"
          >
            下一步 <ChevronRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  // 步骤1：充值金额
  if (step === 1) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto">
        <div className="bg-white p-6 rounded-t-2xl min-h-screen">
          <button onClick={() => setStep(0)} className="flex items-center text-gray-500 mb-4">
            <ArrowLeft size={18} className="mr-1" /> 返回
          </button>
          <div className="flex items-center justify-center mb-2">
            <img src="/logo.jpg" alt="logo" className="h-8 w-8 object-contain mr-2" />
            <h1 className="text-lg font-bold text-gray-800">卡迪高洗鞋服务反馈</h1>
          </div>

          <div className="mb-8 mt-6">
            <label className="block text-sm font-medium text-gray-700 mb-4">
              <span className="text-red-500">*</span> 您充值的礼包金额是多少？
            </label>
            <div className="grid grid-cols-3 gap-3">
              {AMOUNT_OPTIONS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setRechargeAmount(amt)}
                  className={`py-4 rounded-xl text-lg font-bold border-2 transition-all ${
                    rechargeAmount === amt
                      ? 'border-blue-500 bg-blue-50 text-blue-600'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  ¥{amt}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!rechargeAmount}
            className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium text-base disabled:bg-gray-300 flex items-center justify-center gap-2"
          >
            下一步 <ChevronRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  // 步骤2：上传付款记录
  if (step === 2) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto">
        <div className="bg-white p-6 rounded-t-2xl min-h-screen">
          <button onClick={() => setStep(1)} className="flex items-center text-gray-500 mb-4">
            <ArrowLeft size={18} className="mr-1" /> 返回
          </button>
          <div className="flex items-center justify-center mb-2">
            <img src="/logo.jpg" alt="logo" className="h-8 w-8 object-contain mr-2" />
            <h1 className="text-lg font-bold text-gray-800">卡迪高洗鞋服务反馈</h1>
          </div>

          <div className="mb-8 mt-6">
            <label className="block text-sm font-medium text-gray-700 mb-4">
              <span className="text-red-500">*</span> 请上传付款记录
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImagePick}
              className="hidden"
            />
            {paymentProofPreview ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer"
              >
                <img src={paymentProofPreview} alt="付款记录" className="max-h-64 mx-auto rounded-lg border border-gray-200" />
                <p className="text-xs text-gray-400 mt-2 text-center">点击重新选择</p>
              </div>
            ) : (
              <label className="flex items-center gap-2 px-4 py-3 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <Camera size={20} className="text-gray-400" />
                <span className="text-sm text-gray-500">点击上传图片</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImagePick}
                  className="hidden"
                />
              </label>
            )}
          </div>

          <button
            onClick={() => setStep(3)}
            disabled={!paymentProof}
            className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium text-base disabled:bg-gray-300 flex items-center justify-center gap-2"
          >
            下一步 <ChevronRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  // 步骤3：已使用券数
  if (step === 3) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto">
        <div className="bg-white p-6 rounded-t-2xl min-h-screen">
          <button onClick={() => setStep(2)} className="flex items-center text-gray-500 mb-4">
            <ArrowLeft size={18} className="mr-1" /> 返回
          </button>
          <div className="flex items-center justify-center mb-2">
            <img src="/logo.jpg" alt="logo" className="h-8 w-8 object-contain mr-2" />
            <h1 className="text-lg font-bold text-gray-800">卡迪高洗鞋服务反馈</h1>
          </div>

          <div className="mb-8 mt-6">
            <label className="block text-sm font-medium text-gray-700 mb-4">
              <span className="text-red-500">*</span> 您已经使用了几张洗鞋券？
            </label>
            <div className="flex items-center gap-4 mb-4">
              <button
                onClick={() => setUsedTicketCount(Math.max(0, usedTicketCount - 1))}
                className="w-12 h-12 rounded-full bg-gray-100 text-2xl font-bold text-gray-600 flex items-center justify-center"
              >
                -
              </button>
              <input
                type="number"
                value={usedTicketCount}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setUsedTicketCount(isNaN(v) ? 0 : Math.max(0, Math.min(20, v)));
                }}
                min={0}
                max={20}
                className="w-20 text-center px-2 py-3 border border-gray-300 rounded-xl text-2xl font-bold"
              />
              <button
                onClick={() => setUsedTicketCount(Math.min(20, usedTicketCount + 1))}
                className="w-12 h-12 rounded-full bg-gray-100 text-2xl font-bold text-gray-600 flex items-center justify-center"
              >
                +
              </button>
              <span className="text-sm text-gray-400">张（0-20）</span>
            </div>
            <div className="grid grid-cols-5 gap-2 mt-4">
              {Array.from({ length: 21 }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setUsedTicketCount(i)}
                  className={`py-2 rounded-lg text-sm font-medium border ${
                    usedTicketCount === i
                      ? 'border-blue-500 bg-blue-50 text-blue-600'
                      : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          {/* 过期券数（9.23左右过期了几张券） */}
          <div className="mb-8 mt-6">
            <label className="block text-sm font-medium text-gray-700 mb-4">
              您9.23号左右过期了几张券？
            </label>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {Array.from({ length: 20 }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  onClick={() => setExpiredTicketInfo(String(n))}
                  className={`py-2 rounded-lg text-sm font-medium border ${
                    expiredTicketInfo === String(n)
                      ? 'border-blue-500 bg-blue-50 text-blue-600'
                      : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <button
              onClick={() => setExpiredTicketInfo('不记得')}
              className={`w-full py-2.5 rounded-lg text-sm font-medium border mb-3 ${
                expiredTicketInfo === '不记得'
                  ? 'border-blue-500 bg-blue-50 text-blue-600'
                  : 'border-gray-200 text-gray-600'
              }`}
            >
              不记得
            </button>
            <input
              type="number"
              min={0}
              max={99}
              value={expiredTicketInfo === '其他' ? expiredOtherValue : ''}
              onChange={(e) => {
                const v = e.target.value;
                setExpiredOtherValue(v);
                setExpiredTicketInfo(v === '' ? '' : `其他:${v}`);
              }}
              placeholder="以上数字都不是"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 placeholder-gray-400"
            />
          </div>

          <button
            onClick={() => handleSubmit(false)}
            disabled={submitting}
            className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium text-base disabled:bg-gray-300 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {submitting ? '提交中...' : '提交反馈'}
          </button>
        </div>
      </div>
    );
  }

  // 步骤4：评估中转圈（5秒）
  if (step === 4) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto flex items-center justify-center">
        <div className="bg-white p-8 rounded-2xl text-center max-w-sm w-full mx-4">
          <Loader2 className="w-16 h-16 text-blue-500 mx-auto mb-6 animate-spin" />
          <h2 className="text-lg font-bold text-gray-800 mb-2">收到您的反馈</h2>
          <p className="text-gray-500">系统正在评估...</p>
        </div>
      </div>
    );
  }

  // 步骤5：评估结果 + 同意/不同意
  if (step === 5) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-lg mx-auto">
        <div className="bg-white p-8 rounded-t-2xl min-h-screen">
          <div className="flex items-center justify-center mb-2">
            <img src="/logo.jpg" alt="logo" className="h-10 w-10 object-contain mr-2" />
            <h1 className="text-xl font-bold text-gray-800">卡迪高洗鞋服务反馈</h1>
          </div>

          <div className="mt-8 p-6 bg-blue-50 rounded-2xl mb-8">
            <p className="text-base text-gray-700 mb-4">
              根据您的反馈，预估给您补发 <span className="text-3xl font-bold text-blue-600">{estimatedTickets}</span> 张洗鞋券
            </p>
            <div className="text-sm text-gray-500 leading-relaxed border-t border-blue-100 pt-4">
              <p className="mb-2">我们会结合您提报的过期张数，同时核实您的券包，有多少张洗鞋券过期就会给您补发多少张</p>
              <p className="mb-2">补发的洗鞋券，每月生效一张，有效期30天，有多少张生效多少个月</p>
              <p className="text-gray-400 leading-relaxed">
                温馨提示：由于目前反馈人数太多，我们的售后服务电话通知客户过多已被封停，正在解封的过程中，我们现在无法通过电话、短信告知您补发进度，一般情况3个工作日内就可以收到卡迪高为您补发的洗鞋券，您可以登录卡迪高的小程序直接查看您的券包，本公司不在单独以短信或者电话的方式告知，敬请谅解！
              </p>
            </div>
          </div>

          {agree === null ? (
            <>
              <p className="text-base font-medium text-gray-700 mb-4 text-center">您是否同意？</p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleDecide(true)}
                  className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-medium text-base flex items-center justify-center gap-2"
                >
                  <CheckCircle2 size={20} /> 同意
                </button>
                <button
                  onClick={() => setShowDisagreeModal(true)}
                  className="flex-1 py-4 bg-gray-100 text-gray-700 rounded-xl font-medium text-base flex items-center justify-center gap-2"
                >
                  <XCircle size={20} /> 不同意
                </button>
              </div>
              <p className="text-sm text-red-600 mt-3 text-center leading-relaxed font-medium">
                您如果不同意可以备注原因，我们会有专人与您取得联系，协商解决，感谢您的信任。
              </p>
            </>
          ) : (
            <div className="text-center py-8">
              <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <p className="text-gray-700 font-medium">
                {agree
                  ? '收到您的反馈，我们尽快核实，为您补发，以实际核实之后的张数为准'
                  : '收到您的反馈，我们尽快核实，感谢您的反馈'}
              </p>
              <p className="text-xs text-gray-400 mt-4">反馈编号：{feedbackNo}</p>
              <button
                onClick={() => { setStep(7); loadFeedback(feedbackNo); }}
                className="mt-6 px-6 py-2.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium"
              >
                查看处理状态
              </button>
            </div>
          )}
        </div>

        {/* 不同意弹窗 */}
        {showDisagreeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl mx-4 w-full max-w-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-gray-800">请您描述您的需求</h3>
                <button
                  onClick={() => { setShowDisagreeModal(false); setDisagreeDesc(''); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle size={20} />
                </button>
              </div>
              <textarea
                value={disagreeDesc}
                onChange={(e) => setDisagreeDesc(e.target.value)}
                rows={4}
                autoFocus
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                placeholder="请描述您的需求和意见..."
              />
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => { setShowDisagreeModal(false); setDisagreeDesc(''); }}
                  className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium text-sm"
                >
                  取消
                </button>
                <button
                  onClick={() => { setShowDisagreeModal(false); handleDecide(false); }}
                  disabled={!disagreeDesc.trim()}
                  className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-medium text-sm disabled:bg-gray-300"
                >
                  提交
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 步骤6：提交完成（不在受理范围 / 直接完成）
  if (step === 6) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto flex items-center justify-center">
        <div className="bg-white p-8 rounded-2xl text-center max-w-sm w-full mx-4">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-6" />
          <h2 className="text-lg font-bold text-gray-800 mb-3">
            {outOfRange ? '感谢您的反馈' : '提交成功'}
          </h2>
          <p className="text-gray-500 text-sm mb-2">
            {outOfRange
              ? '对不起，您的充值礼包时间不在受理范围内，感谢您的反馈'
              : '收到您的反馈，我们尽快核实'}
          </p>
          <p className="text-xs text-gray-400 mt-4">反馈编号：{feedbackNo}</p>
          {/* 二维码 */}
          <div className="mt-6 flex flex-col items-center">
            <div
              onClick={() => setQrPreview(true)}
              className="cursor-pointer"
            >
              <img
                src="/shoe-feedback-qr.png"
                alt="查询二维码"
                className="w-40 h-40 rounded-lg border border-gray-200"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
            <p className="text-sm text-gray-600 mt-3 text-center">请保存好登录的二维码方便您查询进度</p>
            <p className="text-xs text-blue-500 mt-1">点击二维码可放大保存</p>
            <p className="text-sm text-red-500 font-bold mt-3 text-center">请注意接听卡迪高售后电话：13384024034</p>
          </div>
          {feedbackNo && (
            <button
              onClick={() => { setStep(7); loadFeedback(feedbackNo); }}
              className="mt-6 px-6 py-2.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium"
            >
              查看处理状态
            </button>
          )}
        </div>

        {/* 二维码放大预览弹窗 */}
        {qrPreview && (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
            onClick={() => setQrPreview(false)}
          >
            <button
              className="absolute top-4 right-4 p-2 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors"
              onClick={() => setQrPreview(false)}
              aria-label="关闭"
            >
              <XCircle size={28} />
            </button>
            <div className="flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
              <img
                src="/shoe-feedback-qr.png"
                alt="查询二维码"
                className="w-72 h-72 rounded-lg"
              />
              <p className="text-white text-sm mt-4">长按二维码图片可保存到手机</p>
              <p className="text-sm text-red-400 font-bold mt-2">请注意接听卡迪高售后电话：13384024034</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 步骤7：查看状态
  if (step === 7) {
    return (
      <div className="min-h-screen bg-gray-50 max-w-md mx-auto">
        <div className="bg-white p-6 rounded-t-2xl min-h-screen">
          <button
            onClick={() => {
              // 如果有多条记录且当前在查看明细，返回到列表
              if (queryResults.length > 1 && !showResultList && queryResult && !queryResult?.error) {
                setShowResultList(true);
                setQueryResult(null);
              } else if (view === 'query') {
                // 从查询入口进来的，返回查询输入页
                setStep(-1);
              } else {
                // 其他情况返回主界面
                setView('home');
                setStep(0);
              }
            }}
            className="flex items-center text-gray-500 mb-4"
          >
            <ArrowLeft size={18} className="mr-1" /> 返回
          </button>
          <div className="flex items-center justify-center mb-2">
            <img src="/logo.jpg" alt="logo" className="h-8 w-8 object-contain mr-2" />
            <h1 className="text-lg font-bold text-gray-800">卡迪高洗鞋服务反馈</h1>
          </div>

          {/* 多条记录列表 */}
          {showResultList && queryResults.length > 0 ? (
            <div className="mt-6 space-y-3">
              <p className="text-sm text-gray-500 mb-3">找到 {queryResults.length} 条记录，请选择查看：</p>
              {queryResults.map((item: any, idx: number) => (
                <button
                  key={idx}
                  onClick={() => { setQueryResult(item); setShowResultList(false); }}
                  className="w-full p-4 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium text-gray-700">反馈编号：{item.feedbackNo}</p>
                      <p className="text-xs text-gray-400 mt-1">充值时间：{item.rechargeDate || '-'}</p>
                      <p className="text-xs text-gray-400">充值金额：{item.rechargeAmount ? `¥${item.rechargeAmount}` : '-'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold" style={{ color: item.status === 'completed' ? '#22c55e' : '#3b82f6' }}>
                        {STATUS_LABELS[item.status] || item.status}
                      </p>
                      {item.estimatedTickets > 0 && (
                        <p className="text-xs text-blue-600 mt-1">预估补发 {item.estimatedTickets} 张</p>
                      )}
                      {typeof item.actualTickets === 'number' && (
                        <p className="text-xs text-green-600 mt-0.5">实际补发 {item.actualTickets} 张</p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : queryResult?.error ? (
            <div className="mt-8 text-center">
              <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
              <p className="text-gray-500">{queryResult.error}</p>
            </div>
          ) : queryResult ? (
            <div className="mt-6 space-y-4">
              {/* 反馈基本信息 */}
              <div className="p-4 rounded-xl border border-gray-200 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">反馈编号</span>
                  <span className="text-gray-700 font-medium">{queryResult.feedbackNo}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">充值时间</span>
                  <span className="text-gray-700">{queryResult.rechargeDate || '-'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">充值金额</span>
                  <span className="text-gray-700">{queryResult.rechargeAmount ? `¥${queryResult.rechargeAmount}` : '-'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">已用券数</span>
                  <span className="text-gray-700">{queryResult.usedTicketCount} 张</span>
                </div>
                {queryResult.estimatedTickets > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">预估补发</span>
                    <span className="text-blue-600 font-bold">{queryResult.estimatedTickets} 张</span>
                  </div>
                )}
                {typeof queryResult.actualTickets === 'number' && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">实际补发</span>
                    <span className="text-green-600 font-bold">{queryResult.actualTickets} 张</span>
                  </div>
                )}
                {queryResult.agreeStatus && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">同意情况</span>
                    <span className="text-gray-700">{queryResult.agreeStatus === 'agree' ? '同意' : '不同意'}</span>
                  </div>
                )}
                {queryResult.disagreeDesc && (
                  <div className="text-sm">
                    <span className="text-gray-400">需求描述</span>
                    <p className="text-gray-700 mt-1 p-2 bg-gray-50 rounded">{queryResult.disagreeDesc}</p>
                  </div>
                )}
                {queryResult.handlerRemark && (
                  <div className="text-sm">
                    <span className="text-gray-400">备注</span>
                    <p className="text-gray-700 mt-1 p-2 bg-gray-50 rounded">{queryResult.handlerRemark}</p>
                  </div>
                )}
              </div>

              {/* 处理流程 - 按状态分步显示 */}
              <div className="p-4 rounded-xl border border-gray-200 space-y-3">
                <p className="text-sm font-medium text-gray-600 mb-2">处理进度</p>

                {/* 范围外提交：直接显示不在受理范围内（作废；兼容历史数据 status=completed 且无处理时间） */}
                {((queryResult.status === 'voided' || (queryResult.status === 'completed' && !queryResult.handledAt && !queryResult.completedAt)) && isOutOfRangeDate(queryResult.rechargeDate)) ? (
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <XCircle size={14} className="text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">已作废</p>
                      <p className="text-xs text-gray-400 mt-1">
                        提交时间：{queryResult.createdAt ? new Date(queryResult.createdAt).toLocaleString('zh-CN') : '-'}
                      </p>
                      <p className="text-sm text-orange-600 mt-2 font-medium">
                        对不起，您的充值礼包时间不在受理范围内，感谢您的反馈
                      </p>
                    </div>
                  </div>
                ) : (
                <>
                {/* 已作废：用户未决策就离开页面 */}
                {queryResult.status === 'voided' ? (
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-gray-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <XCircle size={14} className="text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">已作废</p>
                      <p className="text-xs text-gray-400 mt-1">
                        提交时间：{queryResult.createdAt ? new Date(queryResult.createdAt).toLocaleString('zh-CN') : '-'}
                      </p>
                      <p className="text-sm text-gray-500 mt-2 font-medium">
                        您未完成评估确认，该反馈已自动作废，如有疑问请重新提交
                      </p>
                    </div>
                  </div>
                ) : (
                <>
                {['submitted', 'accepted', 'completed'].includes(queryResult.status) && (
                  <div className="flex items-start gap-3 pb-3 border-b border-gray-100">
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle2 size={14} className="text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">已提交</p>
                      <p className="text-xs text-gray-400 mt-1">
                        提交时间：{queryResult.createdAt ? new Date(queryResult.createdAt).toLocaleString('zh-CN') : '-'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">请您耐心等待客服受理，预计三个工作日内处理</p>
                    </div>
                  </div>
                )}

                {/* 步骤2: 已受理 */}
                {['accepted', 'completed'].includes(queryResult.status) && (
                  <div className="flex items-start gap-3 pb-3 border-b border-gray-100">
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle2 size={14} className="text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">已受理</p>
                      <p className="text-xs text-gray-400 mt-1">
                        受理时间：{queryResult.handledAt ? new Date(queryResult.handledAt).toLocaleString('zh-CN') : '-'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        工号{queryResult.handlerId || '0001'}正在核实手机号及使用情况，请您耐心等待，预计三个工作日内处理
                      </p>
                    </div>
                  </div>
                )}

                {/* 步骤3: 已完成 */}
                {queryResult.status === 'completed' && (
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle2 size={14} className="text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">已完成</p>
                      <p className="text-xs text-gray-400 mt-1">
                        完成时间：{queryResult.completedAt ? new Date(queryResult.completedAt).toLocaleString('zh-CN') : '-'}
                      </p>
                      <p className="text-sm text-gray-700 mt-2 font-medium">感谢您的反馈，请您为我的服务评价</p>
                      {ratedValue || queryResult.rating ? (
                        <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-lg">
                          <CheckCircle2 size={16} className="text-green-500" />
                          <span className="text-sm text-green-600 font-medium">
                            已评价：{ratedValue || queryResult.rating}
                          </span>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowRating(true)}
                          className="mt-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
                        >
                          评价
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* 未到完成阶段时的占位提示 */}
                {queryResult.status !== 'completed' && !['accepted', 'completed'].includes(queryResult.status) && (
                  <div className="flex items-start gap-3 opacity-40">
                    <div className="w-6 h-6 rounded-full bg-gray-200 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-400">已受理</p>
                    </div>
                  </div>
                )}
                {queryResult.status !== 'completed' && (
                  <div className="flex items-start gap-3 opacity-40">
                    <div className="w-6 h-6 rounded-full bg-gray-200 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-400">已完成</p>
                    </div>
                  </div>
                )}
                </>
                )}
                </>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-8 text-center">
              <Loader2 className="w-8 h-8 text-blue-400 mx-auto mb-3 animate-spin" />
              <p className="text-gray-500 text-sm">查询中...</p>
            </div>
          )}
        </div>

        {/* 评价弹窗 */}
        {showRating && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl mx-4 w-full max-w-sm p-6">
              <h3 className="text-base font-bold text-gray-800 text-center mb-4">为我的服务评价</h3>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={async () => {
                    setRatingSubmitting(true);
                    try {
                      await rateShoeFeedback(queryResult.feedbackNo, '很好');
                      setRatedValue('很好');
                      setShowRating(false);
                    } catch (e) {
                      alert('评价失败，请重试');
                    }
                    setRatingSubmitting(false);
                  }}
                  disabled={ratingSubmitting}
                  className="px-6 py-3 bg-green-50 text-green-600 rounded-xl font-medium text-base hover:bg-green-100 transition-colors disabled:opacity-50"
                >
                  很好
                </button>
                <button
                  onClick={async () => {
                    setRatingSubmitting(true);
                    try {
                      await rateShoeFeedback(queryResult.feedbackNo, '一般');
                      setRatedValue('一般');
                      setShowRating(false);
                    } catch (e) {
                      alert('评价失败，请重试');
                    }
                    setRatingSubmitting(false);
                  }}
                  disabled={ratingSubmitting}
                  className="px-6 py-3 bg-yellow-50 text-yellow-600 rounded-xl font-medium text-base hover:bg-yellow-100 transition-colors disabled:opacity-50"
                >
                  一般
                </button>
                <button
                  onClick={async () => {
                    setRatingSubmitting(true);
                    try {
                      await rateShoeFeedback(queryResult.feedbackNo, '差');
                      setRatedValue('差');
                      setShowRating(false);
                    } catch (e) {
                      alert('评价失败，请重试');
                    }
                    setRatingSubmitting(false);
                  }}
                  disabled={ratingSubmitting}
                  className="px-6 py-3 bg-red-50 text-red-600 rounded-xl font-medium text-base hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  差
                </button>
              </div>
              <button
                onClick={() => setShowRating(false)}
                className="w-full mt-4 py-2 text-gray-400 text-sm"
              >
                稍后评价
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

export default ShoeFeedbackPage;
