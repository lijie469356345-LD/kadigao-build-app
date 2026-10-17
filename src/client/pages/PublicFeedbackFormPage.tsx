import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Eraser, AlertCircle, CheckCircle, X } from 'lucide-react';
import { getFeedbackTask, generateFeedbackDetail, submitFeedbackDetail, deleteFeedbackDetail } from '../../api/feedback';

function PublicFeedbackFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();

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
  const hasSignatureRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const t = await getFeedbackTask(id);
        setTask(t);
        // 生成默认反馈表（draft）
        const d = await generateFeedbackDetail({ taskId: id as string });
        setDetail(d);
      } catch (err: any) {
        setErrorMsg(err.message || '加载任务信息失败');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (task) {
      setTimeout(initCanvas, 0);
    }
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
    hasSignatureRef.current = false;
  };

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    hasSignatureRef.current = true;
  };

  const onPointerUp = () => {
    drawingRef.current = false;
  };

  const clearCanvas = () => initCanvas();

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

  const isComplete = () => {
    if (detail?.status === 'submitted') return true;
    if (!userName.trim()) return false;
    if (!shopName.trim()) return false;
    if (!phone.trim()) return false;
    if (!/^\d{6,20}$/.test(phone.replace(/[-\s]/g, ''))) return false;
    if (!detail?.answers || detail.answers.length === 0) return false;
    for (let i = 0; i < detail.answers.length; i++) {
      if (!detail.answers[i].answer || !detail.answers[i].answer.trim()) return false;
    }
    if (!hasSignatureRef.current) return false;
    return true;
  };

  const validate = () => {
    if (!userName.trim()) return '请填写用户名';
    if (!shopName.trim()) return '请填写所属店铺';
    if (!phone.trim()) return '请填写手机号';
    if (!/^\d{6,20}$/.test(phone.replace(/[-\s]/g, ''))) return '手机号格式不正确';
    if (!detail?.answers || detail.answers.length === 0) return '该任务没有需要回答的问题';
    for (let i = 0; i < detail.answers.length; i++) {
      if (!detail.answers[i].answer || !detail.answers[i].answer.trim()) {
        return `请回答第 ${i + 1} 题：${detail.answers[i].question}`;
      }
    }
    if (!hasSignatureRef.current) return '请在签名板进行签字';
    return '';
  };

  const handleBack = () => {
    if (detail?.status === 'submitted') { navigate('/public-feedback/details'); return; }
    if (isComplete()) { navigate('/public-feedback/details'); return; }
    setShowLeaveDialog(true);
  };

  const confirmLeave = async () => {
    setShowLeaveDialog(false);
    if (detail?.id) {
      try { await deleteFeedbackDetail(detail.id); } catch (_e) { /* ignore */ }
    }
    setSuccessMsg('请重新填写');
    setTimeout(() => navigate('/public-feedback/details'), 500);
  };

  const onSubmit = async () => {
    if (!detail?.id) return;
    setErrorMsg('');
    setSuccessMsg('');
    const err = validate();
    if (err) {
      setErrorMsg(err);
      return;
    }
    setSubmitting(true);
    try {
      const canvas = canvasRef.current!;
      const signature = hasSignatureRef.current ? canvas.toDataURL('image/png') : '';
      await submitFeedbackDetail(detail.id, {
        userName, shopName, phone, answers: detail.answers, remark, signature,
      });
      setSuccessMsg('反馈提交成功！感谢您的参与');
      setTimeout(() => {
        navigate('/public-feedback/details');
      }, 1500);
    } catch (err: any) {
      setErrorMsg('提交失败: ' + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-6 flex items-center justify-center">
        <div className="text-sm text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-6 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-6 shadow border border-gray-100 text-center max-w-md">
          <AlertCircle className="mx-auto text-red-400 mb-3" size={48} />
          <p className="text-gray-700 mb-4">{errorMsg || '任务不存在'}</p>
          <button
            onClick={() => navigate('/public-feedback')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white text-sm rounded-lg hover:bg-emerald-600"
          >
            <ArrowLeft size={16} /> 返回
          </button>
        </div>
      </div>
    );
  }

  if (isExpired()) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-6 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 shadow border border-gray-100 text-center max-w-md">
          <AlertCircle className="mx-auto text-amber-500 mb-4" size={64} />
          <h2 className="text-2xl font-bold text-amber-700">敬请期待</h2>
          <p className="text-sm text-gray-600 mt-3">
            该反馈任务的截止时间 {task.endTime} 已过，不再接受提交。
          </p>
          <button
            onClick={() => navigate('/public-feedback/details')}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white text-sm rounded-lg hover:bg-emerald-600"
          >
            <ArrowLeft size={16} /> 返回明细
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            <ArrowLeft size={16} /> 返回
          </button>
          <div className="text-xs text-gray-500">任务编号：{task.taskNo}</div>
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

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
          <h1 className="text-2xl font-bold text-gray-800">{task.title}</h1>
          {task.remark && <p className="text-sm text-gray-600 mt-2 leading-relaxed">{task.remark}</p>}
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
            <span>开始时间：{task.startTime || '-'}</span>
            <span>截止时间：{task.endTime || '-'}</span>
            <span>问题数：{task.items?.length || 0}</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
          <h2 className="font-bold text-gray-800 mb-3">基础信息</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">用户名 <span className="text-red-500">*</span></label>
              <input
                type="text" value={userName} onChange={(e) => setUserName(e.target.value)}
                placeholder="请输入您的姓名"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">所属店铺 <span className="text-red-500">*</span></label>
              <input
                type="text" value={shopName} onChange={(e) => setShopName(e.target.value)}
                placeholder="请输入店铺名称"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">手机号 <span className="text-red-500">*</span></label>
              <input
                type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="请输入手机号"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
          <h2 className="font-bold text-gray-800 mb-3">问题与反馈 <span className="text-xs text-gray-500 font-normal">（按管理员问题逐一作答）</span></h2>
          {task.items?.length === 0 && (
            <div className="py-8 text-center text-sm text-gray-500">该任务未配置问题</div>
          )}
          {task.items?.map((q: any, idx: number) => {
            const qType: string = q.type || 'text';
            const typeLabel = qType === 'choice' ? '选择题' : qType === 'tf' ? '判断题' : '问答题';
            return (
            <div key={q.id || idx} className="mb-4 p-4 border border-gray-200 rounded-xl">
              <label className="block text-sm font-medium text-gray-800 mb-3">
                <span className="inline-flex w-6 h-6 items-center justify-center bg-emerald-100 text-emerald-700 rounded-full text-xs mr-2">
                  {idx + 1}
                </span>
                <span className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded mr-2">{typeLabel}</span>
                {q.question}
                <span className="text-red-500 ml-1">*</span>
              </label>

              {qType === 'text' && (
                <textarea
                  rows={3}
                  value={detail?.answers?.[idx]?.answer || ''}
                  onChange={(e) => handleAnswerChange(idx, e.target.value)}
                  placeholder="请输入您的反馈..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none resize-none"
                />
              )}

              {qType === 'choice' && (
                <div className="space-y-2">
                  {(q.options || []).map((opt: string, optIdx: number) => (
                    <label key={optIdx} className="flex items-center gap-3 px-3 py-2 border border-gray-200 rounded-lg cursor-pointer hover:bg-emerald-50 hover:border-emerald-300">
                      <input
                        type="radio"
                        name={`q-${idx}`}
                        value={opt}
                        checked={detail?.answers?.[idx]?.answer === opt}
                        onChange={() => handleAnswerChange(idx, opt)}
                        className="w-4 h-4 accent-emerald-600"
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
                    <label key={opt} className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg cursor-pointer hover:bg-emerald-50 hover:border-emerald-300">
                      <input
                        type="radio"
                        name={`q-${idx}`}
                        value={opt}
                        checked={detail?.answers?.[idx]?.answer === opt}
                        onChange={() => handleAnswerChange(idx, opt)}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      <span className="text-sm font-medium text-gray-700">{opt}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            );
          })}

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-800 mb-2">备注（选填）</label>
            <textarea
              rows={2} value={remark} onChange={(e) => setRemark(e.target.value)}
              placeholder="其他补充说明"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none resize-none"
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800">签名确认 <span className="text-red-500 text-sm">*</span></h2>
            <button
              onClick={clearCanvas}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              <Eraser size={14} /> 清除重签
            </button>
          </div>
          <div className="border-2 border-dashed border-gray-200 rounded-xl bg-white p-1">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              className="w-full rounded-lg touch-none"
              style={{ height: '180px', cursor: 'crosshair' }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-2">请在上方签名区手写签名</p>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 shadow-sm disabled:opacity-50"
          >
            <Save size={16} /> {submitting ? '提交中...' : '签字提交'}
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
      </div>
    </div>
  );
}

export default PublicFeedbackFormPage;
