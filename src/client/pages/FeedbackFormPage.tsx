import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eraser, AlertCircle, CheckCircle, X } from 'lucide-react';
import {
  getFeedbackTask, generateFeedbackDetail, submitFeedbackDetail, deleteFeedbackDetail,
} from '../../api/feedback';
import { useAuthStore } from '../../store/authStore';
import Layout from '../components/Layout';

function FeedbackFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [task, setTask] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [userName, setUserName] = useState('');
  const [shopName, setShopName] = useState('');
  const [phone, setPhone] = useState('');
  const [remark, setRemark] = useState('');
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasSignRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const t = await getFeedbackTask(id);
        setTask(t);
        const d = await generateFeedbackDetail({
          taskId: id as string,
          userName: user?.userName || '',
          shopName: (user as any)?.shopName || '',
          phone: (user as any)?.phone || '',
        });
        setDetail(d);
        setUserName(user?.userName || '');
        setShopName((user as any)?.shopName || '');
        setPhone((user as any)?.phone || '');
      } catch (err: any) {
        setErrorMsg(err.message || '加载任务信息失败');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, [id]);

  useEffect(() => {
    if (task) { setTimeout(() => initCanvas(), 0); }
    // eslint-disable-next-line
  }, [task]);

  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1f2937';
    }
    hasSignRef.current = false;
  };
  const clearCanvas = () => initCanvas();

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    hasSignRef.current = true;
  };
  const onUp = () => { drawingRef.current = false; };

  const handleAnswerChange = (idx: number, val: string) => {
    setDetail((prev: any) => {
      if (!prev) return prev;
      const answers = prev.answers.slice();
      answers[idx] = { ...answers[idx], answer: val };
      return { ...prev, answers };
    });
  };

  const isExpired = () => {
    if (!task?.endTime) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(task.endTime); end.setHours(23, 59, 59, 999);
    return today.getTime() > end.getTime();
  };

  const isSubmitted = detail?.status === 'submitted';

  // 是否完成所有必填项
  const isComplete = () => {
    if (detail?.status === 'submitted') return true;
    if (!userName.trim()) return false;
    if (!shopName.trim()) return false;
    if (!phone.trim()) return false;
    if (!detail?.answers) return false;
    for (let i = 0; i < detail.answers.length; i++) {
      if (!detail.answers[i]?.answer || !String(detail.answers[i].answer).trim()) return false;
    }
    if (!hasSignRef.current) return false;
    return true;
  };

  const validate = () => {
    if (!userName.trim()) return '请填写用户名';
    if (!shopName.trim()) return '请填写所属店铺';
    if (!phone.trim()) return '请填写手机号';
    if (!detail?.answers) return '请等待数据加载';
    for (let i = 0; i < detail.answers.length; i++) {
      if (!detail.answers[i]?.answer || !String(detail.answers[i].answer).trim()) {
        return `请回答第 ${i + 1} 题：${detail.answers[i].question}`;
      }
    }
    if (!hasSignRef.current) return '请在签名板进行签字';
    return '';
  };

  const handleBack = () => {
    if (detail?.status === 'submitted') { navigate('/staff-channel/details'); return; }
    if (isComplete()) { navigate('/staff-channel/details'); return; }
    setShowLeaveDialog(true);
  };

  const confirmLeave = async () => {
    setShowLeaveDialog(false);
    if (detail?.id) {
      try { await deleteFeedbackDetail(detail.id); } catch (_e) { /* ignore */ }
    }
    setSuccessMsg('请重新填写');
    setTimeout(() => navigate('/staff-channel/details'), 500);
  };

  const onSubmit = async () => {
    if (!detail?.id) return;
    setErrorMsg('');
    setSuccessMsg('');
    const err = validate();
    if (err) { setErrorMsg(err); return; }
    setSubmitting(true);
    try {
      const canvas = canvasRef.current!;
      const signature = canvas.toDataURL('image/png');
      await submitFeedbackDetail(detail.id, {
        userName, shopName, phone, answers: detail.answers, remark, signature,
      });
      setSuccessMsg('反馈提交成功！感谢您的参与');
      setTimeout(() => navigate('/staff-channel/details'), 1500);
    } catch (err: any) {
      setErrorMsg('提交失败: ' + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <Layout title="填写反馈"><div className="p-12 text-center text-sm text-gray-500">加载中...</div></Layout>;
  }
  if (!task) {
    return (
      <Layout title="填写反馈">
        <div className="p-8 bg-white rounded-2xl shadow border border-gray-100 text-center max-w-md mx-auto">
          <AlertCircle className="mx-auto text-red-400 mb-3" size={48} />
          <p className="text-gray-700 mb-4">{errorMsg || '任务不存在'}</p>
          <button onClick={() => navigate('/staff-channel/details')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary-dark">
            <ArrowLeft size={16} /> 返回
          </button>
        </div>
      </Layout>
    );
  }
  if (isExpired()) {
    return (
      <Layout title="填写反馈">
        <div className="p-8 bg-white rounded-2xl shadow border border-gray-100 text-center max-w-md mx-auto">
          <AlertCircle className="mx-auto text-amber-500 mb-3" size={48} />
          <h2 className="text-2xl font-bold text-amber-700">敬请期待</h2>
          <p className="text-sm text-gray-600 mt-3">该反馈任务已过截止时间 {task.endTime}，不再接受提交</p>
          <button onClick={() => navigate('/staff-channel/details')}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary-dark">
            <ArrowLeft size={16} /> 返回明细
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="培训反馈 · 填写反馈" subtitle={`${task.taskNo} - ${task.title}`}>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={handleBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50">
          <ArrowLeft size={16} /> 返回明细
        </button>
      </div>

      {errorMsg && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm flex items-center gap-2">
          <CheckCircle size={16} /> {successMsg}
        </div>
      )}
      {isSubmitted && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
          该反馈已签字提交，不允许再修改。如需修改请联系管理员删除后重新填写。
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
        <div className="text-xs font-mono text-gray-500">任务编号: {task.taskNo}</div>
        <h1 className="text-xl font-bold text-gray-800 mt-1">{task.title}</h1>
        {task.remark && <p className="text-sm text-gray-600 mt-2 leading-relaxed">{task.remark}</p>}
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
          <span>开始: {task.startTime || '-'}</span>
          <span>截止: {task.endTime || '-'}</span>
          <span>问题数: {task.items?.length || 0}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
        <h2 className="font-bold text-gray-800 mb-3">基础信息</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">用户名 <span className="text-red-500">*</span></label>
            <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)}
              disabled={isSubmitted}
              placeholder="请输入您的姓名"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/40 focus:border-primary outline-none disabled:bg-gray-100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">所属店铺 <span className="text-red-500">*</span></label>
            <input type="text" value={shopName} onChange={(e) => setShopName(e.target.value)}
              disabled={isSubmitted}
              placeholder="请输入店铺名称"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/40 focus:border-primary outline-none disabled:bg-gray-100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">手机号 <span className="text-red-500">*</span></label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              disabled={isSubmitted}
              placeholder="请输入手机号"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/40 focus:border-primary outline-none disabled:bg-gray-100" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
        <h2 className="font-bold text-gray-800 mb-3">问题与反馈</h2>
        {task.items?.map((q: any, idx: number) => {
          const qType: string = q.type || 'text';
          const typeLabel = qType === 'choice' ? '选择题' : qType === 'tf' ? '判断题' : '问答题';
          return (
          <div key={q.id || idx} className="mb-4 p-4 border border-gray-200 rounded-xl">
            <label className="block text-sm font-medium text-gray-800 mb-3">
              <span className="inline-flex w-6 h-6 items-center justify-center bg-primary/10 text-primary rounded-full text-xs mr-2 font-bold">{idx + 1}</span>
              <span className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded mr-2">{typeLabel}</span>
              {q.question}
              <span className="text-red-500 ml-1">*</span>
            </label>

            {qType === 'text' && (
              <textarea rows={3}
                value={detail?.answers?.[idx]?.answer || ''}
                onChange={(e) => handleAnswerChange(idx, e.target.value)}
                disabled={isSubmitted}
                placeholder="请输入您的反馈..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/40 focus:border-primary outline-none resize-none disabled:bg-gray-100" />
            )}

            {qType === 'choice' && (
              <div className="space-y-2">
                {(q.options || []).map((opt: string, optIdx: number) => (
                  <label key={optIdx} className={`flex items-center gap-3 px-3 py-2 border border-gray-200 rounded-lg ${isSubmitted ? 'cursor-default' : 'cursor-pointer hover:bg-primary/5 hover:border-primary/40'}`}>
                    <input
                      type="radio"
                      name={`q-${idx}`}
                      value={opt}
                      checked={detail?.answers?.[idx]?.answer === opt}
                      onChange={() => handleAnswerChange(idx, opt)}
                      disabled={isSubmitted}
                      className="w-4 h-4 accent-primary"
                    />
                    <span className="text-sm text-gray-700">
                      <span className="font-medium text-gray-500 mr-1">{String.fromCharCode(65 + optIdx)}.</span>
                      {opt || `选项${optIdx + 1}`}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {qType === 'tf' && (
              <div className="flex gap-3">
                {['正确', '错误'].map((opt: string) => (
                  <label key={opt} className={`flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg ${isSubmitted ? 'cursor-default' : 'cursor-pointer hover:bg-primary/5 hover:border-primary/40'}`}>
                    <input
                      type="radio"
                      name={`q-${idx}`}
                      value={opt}
                      checked={detail?.answers?.[idx]?.answer === opt}
                      onChange={() => handleAnswerChange(idx, opt)}
                      disabled={isSubmitted}
                      className="w-4 h-4 accent-primary"
                    />
                    <span className="text-sm font-medium text-gray-700">{opt}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          );
        })}
        <div>
          <label className="block text-sm font-medium text-gray-800 mb-2">备注（选填）</label>
          <textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)}
            disabled={isSubmitted}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/40 focus:border-primary outline-none resize-none disabled:bg-gray-100" />
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800">签名确认 <span className="text-red-500 text-sm">*</span></h2>
          <button onClick={clearCanvas} disabled={isSubmitted}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-60">
            <Eraser size={14} /> 清除重签
          </button>
        </div>
        <div className={`border-2 border-dashed border-gray-200 rounded-xl bg-white p-1 ${isSubmitted ? 'pointer-events-none opacity-80' : ''}`}>
          <canvas
            ref={canvasRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            className="w-full rounded-lg"
            style={{ height: '180px', cursor: 'crosshair' }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-2">请在上方签名板手写签名</p>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button onClick={onSubmit} disabled={submitting || isSubmitted}
          className="inline-flex items-center gap-2 px-6 py-2.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark shadow-sm disabled:opacity-50">
          {submitting ? '提交中...' : '签字提交'}
        </button>
      </div>

      {showLeaveDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <AlertCircle className="text-amber-600" size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-gray-800">提示</h3>
                  <p className="text-sm text-gray-500">问卷未完成</p>
                </div>
              </div>
              <button onClick={() => setShowLeaveDialog(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>
            <p className="text-gray-700 mb-6">问卷未答完，离开失效，是否确认离开？</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowLeaveDialog(false)}
                className="px-5 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">取消</button>
              <button onClick={confirmLeave}
                className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-sm">确认离开</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

export default FeedbackFormPage;
