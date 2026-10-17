import { useState, useEffect, useCallback, Fragment } from 'react';
import Layout from '../../components/Layout';
import { vehicleApplicationApi, vehicleApi, authorizedPersonApi } from '../../../api/assetManagement';
import { useAuthStore } from '../../../store/authStore';
import * as XLSX from 'xlsx';
import { Plus, Check, X, Truck, Download, Search, Loader2, Car, Fuel, AlertTriangle, Clock, Image as ImageIcon, User } from 'lucide-react';

// ============================================================
// 权限判断：仅管理员/行政人事可派车
// ============================================================
const DISPATCH_ROLES = ['super_admin', 'data_admin', 'it', 'boss', 'hr', 'hr_staff', 'admin_staff'];

function canDispatch(user: any): boolean {
  if (!user) return false;
  if (user.isAdmin === '是') return true;
  const codes = user.roleCodes || (user.roleCode ? [user.roleCode] : []);
  return Array.isArray(codes) && codes.some((c: string) => DISPATCH_ROLES.includes(c));
}

// 油箱低预警阈值（低于此值红色预警）
const LOW_FUEL_THRESHOLD = 10;

// ============================================================
// 状态配置
// ============================================================
const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: '待审批', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  dept_approved: { label: '已通过', color: 'text-blue-700 bg-blue-50 border-blue-200' },
  dispatched: { label: '已派车', color: 'text-cyan-700 bg-cyan-50 border-cyan-200' },
  departed: { label: '已出车', color: 'text-orange-700 bg-orange-50 border-orange-200' },
  returned: { label: '已归还', color: 'text-green-700 bg-green-50 border-green-200' },
  rejected: { label: '已驳回', color: 'text-red-700 bg-red-50 border-red-200' },
  cancelled: { label: '已取消', color: 'text-gray-600 bg-gray-100 border-gray-200' },
  waiting: { label: '请等待', color: 'text-purple-700 bg-purple-50 border-purple-200' },
};

const FILTER_TABS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审批' },
  { key: 'waiting', label: '请等待' },
  { key: 'departed', label: '已出车' },
  { key: 'returned', label: '已归还' },
  { key: 'rejected', label: '已驳回' },
  { key: 'cancelled', label: '已取消' },
];

// 可取消的状态（审批派车之前）
const CANCELLABLE_STATUSES = ['pending', 'waiting'];

// 判断当前用户是否为该申请的申请人本人（仅本人可取消自己的申请）
function isSelfApplicant(item: any): boolean {
  if (!item) return false;
  return String(item.applicantId) === String(currentUserId());
}

function currentUserId(): string {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    if (u) return u.userCode || u.userId || '';
  } catch { /* ignore */ }
  return '';
}

// ============================================================
// 辅助函数
// ============================================================
function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '-';
  }
}

function formatDateTime(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  } catch {
    return '-';
  }
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowLocalDateTime(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

function getStatusBadge(status: string) {
  const config = STATUS_CONFIG[status] || { label: status, color: 'text-gray-600 bg-gray-100 border-gray-200' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${config.color}`}>
      {config.label}
    </span>
  );
}

// ============================================================
// 通用模态框组件
// ============================================================
function Modal({
  title,
  onClose,
  children,
  footer,
  maxWidth = 'max-w-lg',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-xl shadow-xl w-full ${maxWidth} max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-lg font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition" title="关闭">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );
}

// 表单输入组件
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition';

// ============================================================
// 续航计算：剩余油数(L) ÷ 百公里油耗(L/100km) × 100 = 可行驶里程(km)
// ============================================================
const DEFAULT_FUEL_CONSUMPTION = 8; // L/100km
const MIN_DISPATCH_RANGE = 80; // km：续航低于该值禁止派车

function calcRemainingRange(returnFuelLevel: string | number | null | undefined, fuelConsumption: number | null | undefined): number | null {
  if (returnFuelLevel === null || returnFuelLevel === undefined || returnFuelLevel === '') return null;
  const fuel = Number(returnFuelLevel);
  const consumption = fuelConsumption && fuelConsumption > 0 ? fuelConsumption : DEFAULT_FUEL_CONSUMPTION;
  if (isNaN(fuel) || fuel < 0) return null;
  return Math.round((fuel / consumption) * 100);
}

// 判断当前车辆是否因续航过低而禁止派车（油车当前剩余油量估算续航 < 80km 即禁止）
function isFuelRangeBlocked(returnFuelLevel: string | number | null | undefined, fuelConsumption: number | null | undefined): boolean {
  const range = calcRemainingRange(returnFuelLevel, fuelConsumption);
  if (range === null) return false;
  return range < MIN_DISPATCH_RANGE;
}

// 电车：电量低于 30% 禁止派车
const MIN_DISPATCH_BATTERY = 30;
function isElectricBlocked(energyType: string | null | undefined, returnBatteryLevel: number | null | undefined): boolean {
  if (energyType !== 'electric') return false;
  if (returnBatteryLevel === null || returnBatteryLevel === undefined) return true; // 无电量记录时禁止，避免盲目出车
  return Number(returnBatteryLevel) < MIN_DISPATCH_BATTERY;
}

// 图片上传控件（用于归还登记现场照片）
function PhotoUploadField({
  label,
  value,
  uploading,
  disabled,
  required,
  onUpload,
}: {
  label: string;
  value: string;
  uploading: boolean;
  disabled?: boolean;
  required?: boolean;
  onUpload: (file: File) => void;
}) {
  const missing = required && !value;
  return (
    <Field label={label} required={required}>
      <div className={`flex items-center gap-2 w-full border border-dashed rounded-lg px-2 py-1.5 bg-white ${missing ? 'border-red-400 bg-red-50/30' : 'border-gray-300'}`}>
        {value ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-green-600 hover:underline min-w-0 flex-1 truncate"
            title="查看图片"
          >
            <ImageIcon className="w-4 h-4 flex-shrink-0" /> 已上传
          </a>
        ) : (
          <span className={`text-xs flex-1 truncate ${missing ? 'text-red-500' : 'text-gray-400'}`}>{missing ? '未上传（必填）' : '未上传'}</span>
        )}
        <label className={`flex items-center gap-1 px-2 py-1 text-xs rounded cursor-pointer transition-colors shrink-0 ${disabled ? 'opacity-50 cursor-not-allowed' : 'text-blue-600 hover:bg-blue-50'}`}>
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
          {uploading ? '上传中...' : value ? '更换' : '上传'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={disabled}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </Field>
  );
}

// ============================================================
// 主组件
// ============================================================
function VehicleApplyPage() {
  const { user } = useAuthStore();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 新建申请表单
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    usageDate: todayStr(),
    returnDate: '',
    destination: '',
    purpose: '',
    passengers: '',
    driver: '',
    remainingFuel: '',
    department: user?.orgName || '',
  });

  // 驾驶员列表（自动获取授权人管理中的人员）
  const [drivers, setDrivers] = useState<any[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);

  // 审批/驳回弹窗
  const [approveModal, setApproveModal] = useState<{ id: number; mode: 'approve' | 'reject'; remark: string } | null>(null);

  // 审批派车合并弹窗（选车 → 审批通过+派车一步完成）
  const [approveDispatchModal, setApproveDispatchModal] = useState<{
    id: number;
    vehicleId: string;
    remark: string;
    lastStatus: { returnMileage: number | null; returnFuelLevel: string | null; returnBatteryLevel: number | null; returnTime: string | null; actualMileage: number | null; fuelConsumption: number | null; energyType: string | null } | null;
    availableVehicles: any[];
    dispatchedVehicles: any[];
    loading: boolean;
  } | null>(null);

  // 请等待提示弹窗（无车时展示最近两辆已出车车辆预计归还时间）
  const [waitInfoModal, setWaitInfoModal] = useState<{
    dispatchedVehicles: any[];
    loading: boolean;
  } | null>(null);

  // 派车弹窗
  const [dispatchModal, setDispatchModal] = useState<{ id: number; vehicleId: string; remark: string; lastStatus: { returnMileage: number | null; returnFuelLevel: string | null; returnBatteryLevel: number | null; returnTime: string | null; actualMileage: number | null; fuelConsumption: number | null; energyType: string | null } | null } | null>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);

  // 归还登记弹窗（强制填实际里程和油箱剩余数，归还时间由系统自动记录；支持上传里程照片、油箱照片、车辆四维图）
  const [returnModal, setReturnModal] = useState<{
    id: number;
    vehicleEnergyType: string;
    returnMileage: string;
    returnFuelLevel: string;
    returnBattery: string;
    remark: string;
    returnMileagePhoto: string;
    returnFuelPhoto: string;
    vehiclePhotoFront: string;
    vehiclePhotoBack: string;
    vehiclePhotoLeft: string;
    vehiclePhotoRight: string;
  } | null>(null);
  // 归还照片上传中状态
  const [returnPhotoUploading, setReturnPhotoUploading] = useState(false);

  // 用车申请详情弹窗
  const [detailModal, setDetailModal] = useState<any | null>(null);

  // ============================================================
  // 数据加载
  // ============================================================
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (activeTab !== 'all') params.status = activeTab;
      const res = await vehicleApplicationApi.list(params);
      if (res.data?.ok) {
        setList(res.data.data || []);
      } else {
        alert(res.data?.error || '加载用车申请列表失败');
        setList([]);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || '网络错误，加载失败');
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 加载可用车辆（派车时使用，排除已出车的）
  const loadVehicles = useCallback(async () => {
    setVehiclesLoading(true);
    try {
      const res = await vehicleApi.getAvailableList();
      if (res.data?.ok) {
        setVehicles(res.data.data || []);
      } else {
        setVehicles([]);
      }
    } catch {
      setVehicles([]);
    } finally {
      setVehiclesLoading(false);
    }
  }, []);

  // ============================================================
  // 操作处理
  // ============================================================

  // 新建用车申请
  const handleCreate = async () => {
    if (!createForm.usageDate) { alert('请选择用车日期'); return; }
    if (createForm.usageDate < todayStr()) { alert('用车日期必须选择今天及以后的日期'); return; }
    if (createForm.returnDate && createForm.returnDate < createForm.usageDate) { alert('归还日期不能早于用车日期'); return; }
    if (!createForm.destination.trim()) { alert('请填写目的地'); return; }
    if (!createForm.purpose.trim()) { alert('请填写用车事由'); return; }
    setSubmitting(true);
    try {
      const res = await vehicleApplicationApi.create({
        usageDate: createForm.usageDate,
        returnDate: createForm.returnDate || null,
        destination: createForm.destination.trim(),
        purpose: createForm.purpose.trim(),
        passengers: createForm.passengers.trim(),
        driver: createForm.driver.trim(),
        remainingFuel: Number(createForm.remainingFuel) || 0,
        department: createForm.department.trim(),
      });
      if (res.data?.ok) {
        alert('用车申请提交成功');
        setShowCreate(false);
        setCreateForm({
          usageDate: todayStr(),
          returnDate: '',
          destination: '',
          purpose: '',
          passengers: '',
          driver: '',
          remainingFuel: '',
          department: user?.orgName || '',
        });
        loadData();
      } else {
        alert(res.data?.error || '提交失败');
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || '网络错误，提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 部门审批 / 驳回
  const handleApprove = async () => {
    if (!approveModal) return;
    if (approveModal.mode === 'reject' && !approveModal.remark.trim()) {
      alert('驳回时请填写备注说明');
      return;
    }
    setSubmitting(true);
    try {
      const res = await vehicleApplicationApi.deptApprove(
        approveModal.id,
        approveModal.mode === 'approve',
        approveModal.remark.trim(),
      );
      if (res.data?.ok) {
        alert(approveModal.mode === 'approve' ? '审批通过' : '已驳回');
        setApproveModal(null);
        loadData();
      } else {
        alert(res.data?.error || '操作失败');
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || '网络错误，操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 行政派车（派车即出车，无需出车登记）
  const handleDispatch = async () => {
    if (!dispatchModal) return;
    if (!dispatchModal.vehicleId) { alert('请选择车辆'); return; }
    setSubmitting(true);
    try {
      const res = await vehicleApplicationApi.dispatch(dispatchModal.id, {
        vehicleId: Number(dispatchModal.vehicleId),
        remark: dispatchModal.remark.trim(),
        departureBattery: dispatchModal.lastStatus?.energyType === 'electric' && dispatchModal.lastStatus.returnBatteryLevel != null ? Number(dispatchModal.lastStatus.returnBatteryLevel) : undefined,
      });
      if (res.data?.ok) {
        alert('派车成功，已自动出车');
        setDispatchModal(null);
        loadData();
      } else {
        alert(res.data?.error || '派车失败');
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || '网络错误，派车失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 打开审批派车合并弹窗：先查可用车辆和已出车车辆
  const openApproveDispatchModal = async (id: number) => {
    setApproveDispatchModal({
      id, vehicleId: '', remark: '', lastStatus: null,
      availableVehicles: [], dispatchedVehicles: [], loading: true,
    });
    try {
      const res = await vehicleApplicationApi.checkVehicles(id);
      if (res.data?.ok && res.data.data) {
        const d = res.data.data;
        setApproveDispatchModal({
          id, vehicleId: '', remark: '', lastStatus: null,
          availableVehicles: d.availableVehicles || [],
          dispatchedVehicles: d.dispatchedVehicles || [],
          loading: false,
        });
      } else {
        setApproveDispatchModal(prev => prev ? { ...prev, loading: false } : null);
        alert(res.data?.error || '查询车辆信息失败');
      }
    } catch (err: any) {
      setApproveDispatchModal(prev => prev ? { ...prev, loading: false } : null);
      alert(err.response?.data?.error || err.message || '网络错误');
    }
  };

  // 审批派车弹窗中选择车辆后获取最后归还状态
  const handleApproveDispatchVehicleChange = async (vehicleId: string) => {
    if (!approveDispatchModal) return;
    if (!vehicleId) {
      setApproveDispatchModal({ ...approveDispatchModal, vehicleId: '', lastStatus: null });
      return;
    }
    try {
      const res = await vehicleApi.getLastStatus(Number(vehicleId));
      if (res.data?.ok && res.data.data) {
        const d = res.data.data;
        setApproveDispatchModal({
          ...approveDispatchModal,
          vehicleId,
          lastStatus: {
            returnMileage: d.returnMileage ?? null,
            returnFuelLevel: d.returnFuelLevel ?? null,
            returnBatteryLevel: d.returnBatteryLevel != null ? Number(d.returnBatteryLevel) : null,
            returnTime: d.returnTime ?? null,
            actualMileage: d.actualMileage ?? null,
            fuelConsumption: d.fuelConsumption != null ? Number(d.fuelConsumption) : null,
            energyType: d.energyType || 'fuel',
          },
        });
      } else {
        setApproveDispatchModal({ ...approveDispatchModal, vehicleId, lastStatus: null });
      }
    } catch {
      setApproveDispatchModal({ ...approveDispatchModal, vehicleId, lastStatus: null });
    }
  };

  // 审批派车合并提交：审批通过 + 派车一步完成
  const handleApproveDispatch = async () => {
    if (!approveDispatchModal) return;
    if (!approveDispatchModal.vehicleId) { alert('请选择车辆'); return; }
    setSubmitting(true);
    try {
      const res = await vehicleApplicationApi.approveDispatch(approveDispatchModal.id, {
        approved: true,
        vehicleId: Number(approveDispatchModal.vehicleId),
        remark: approveDispatchModal.remark.trim(),
        departureBattery: approveDispatchModal.lastStatus?.energyType === 'electric' && approveDispatchModal.lastStatus.returnBatteryLevel != null ? Number(approveDispatchModal.lastStatus.returnBatteryLevel) : undefined,
      });
      if (res.data?.ok) {
        alert('审批通过并派车成功，已自动出车');
        setApproveDispatchModal(null);
        loadData();
      } else {
        alert(res.data?.error || '审批派车失败');
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || '网络错误，审批派车失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 设置"请等待"提示（无车时审批人点击，写入 waitRemark 供申请人查看）
  const handleSetWait = async (id: number, dispatchedVehicles: any[]) => {
    // 构造提示文案：列出最近两辆已出车车辆及预计归还时间
    let waitText = '';
    if (dispatchedVehicles.length > 0) {
      const parts = dispatchedVehicles.map((v, i) =>
        `${v.plateNo || v.assignedVehiclePlate || '车辆'}${v.returnDate ? `，预计 ${formatDate(v.returnDate)} 归还` : ''}`
      );
      waitText = `暂无可用车辆，请等待。最近出车车辆：${parts.join('；')}。待车辆归还后将在审批派车中处理。`;
    } else {
      waitText = '暂无可用车辆且无出车记录，请等待车辆到位后再审批派车。';
    }
    setSubmitting(true);
    try {
      const res = await vehicleApplicationApi.setWait(id, waitText);
      if (res.data?.ok) {
        alert('已设置请等待提示，申请人可查看');
        setApproveDispatchModal(null);
        loadData();
      } else {
        alert(res.data?.error || '设置失败');
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 归还登记（强制填实际里程和油箱剩余数，归还时间由系统自动记录；支持上传里程照片、油箱照片、车辆四维图）
  const handleReturn = async () => {
    if (!returnModal) return;
    if (!returnModal.returnMileage) { alert('请填写归还里程'); return; }
    if (returnModal.vehicleEnergyType === 'electric') {
      if (!returnModal.returnBattery) { alert('请填写归还电量'); return; }
    } else {
      if (!returnModal.returnFuelLevel.trim()) { alert('请填写油箱剩余数'); return; }
    }
    // 归还登记所有上传图片必填：行驶里程照片、油箱照片、车辆四维图（前/后/左/右）
    const requiredPhotos: Array<[string, string]> = [
      ['returnMileagePhoto', '行驶里程照片'],
      ['returnFuelPhoto', '油箱照片'],
      ['vehiclePhotoFront', '车辆正面'],
      ['vehiclePhotoBack', '车辆背面'],
      ['vehiclePhotoLeft', '车辆左侧'],
      ['vehiclePhotoRight', '车辆右侧'],
    ];
    const missingPhotos = requiredPhotos.filter(([k]) => !(returnModal as any)[k]).map(([, label]) => label);
    if (missingPhotos.length) {
      alert(`归还登记必须上传以下图片：${missingPhotos.join('、')}`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await vehicleApplicationApi.return(returnModal.id, {
        returnMileage: Number(returnModal.returnMileage) || 0,
        returnFuelLevel: returnModal.returnFuelLevel.trim(),
        returnBattery: returnModal.returnBattery ? Number(returnModal.returnBattery) : undefined,
        remark: returnModal.remark.trim(),
        returnMileagePhoto: returnModal.returnMileagePhoto || '',
        returnFuelPhoto: returnModal.returnFuelPhoto || '',
        vehiclePhotoFront: returnModal.vehiclePhotoFront || '',
        vehiclePhotoBack: returnModal.vehiclePhotoBack || '',
        vehiclePhotoLeft: returnModal.vehiclePhotoLeft || '',
        vehiclePhotoRight: returnModal.vehiclePhotoRight || '',
      });
      if (res.data?.ok) {
        alert('归还登记成功');
        setReturnModal(null);
        loadData();
      } else {
        alert(res.data?.error || '登记失败');
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || '网络错误，登记失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 归还现场图片上传（里程照片/油箱照片/车辆四维图）
  const handleReturnPhotoUpload = async (field: 'returnMileagePhoto' | 'returnFuelPhoto' | 'vehiclePhotoFront' | 'vehiclePhotoBack' | 'vehiclePhotoLeft' | 'vehiclePhotoRight', file: File) => {
    if (!returnModal) return;
    setReturnPhotoUploading(true);
    try {
      const res = await vehicleApplicationApi.uploadReturnPhoto(file);
      if (res.data?.ok && res.data.url) {
        setReturnModal({ ...returnModal, [field]: res.data.url });
      } else {
        alert(res.data?.error || '图片上传失败');
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || '网络错误，图片上传失败');
    } finally {
      setReturnPhotoUploading(false);
    }
  };

  // 取消申请
  const handleCancel = async (id: number) => {
    if (!confirm('确认取消此用车申请？取消后不可恢复。')) return;
    setSubmitting(true);
    try {
      const res = await vehicleApplicationApi.cancel(id);
      if (res.data?.ok) {
        alert('已取消');
        loadData();
      } else {
        alert(res.data?.error || '取消失败');
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || '网络错误，取消失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 导出台账
  const handleExport = async () => {
    try {
      const res = await vehicleApplicationApi.export();
      if (res.data?.ok && Array.isArray(res.data.data)) {
        const rows: any[][] = [];
        rows.push([
          '申请单号', '申请人', '部门', '用车日期', '归还日期',
          '目的地', '事由', '随行人员', '驾驶员', '剩余油数(L)', '状态',
          '审批人', '审批日期', '派车人', '派车日期', '车牌号',
        ]);
        for (const item of res.data.data) {
          rows.push([
            item.applicationNo || '',
            item.applicantName || '',
            item.department || '',
            formatDate(item.usageDate),
            formatDate(item.returnDate),
            item.destination || '',
            item.purpose || '',
            item.passengers || '',
            item.driver || '',
            item.remainingFuel ?? '',
            (STATUS_CONFIG[item.status] || { label: item.status }).label,
            item.deptApproverName || '',
            formatDateTime(item.deptApprovalDate),
            item.adminDispatcherName || '',
            formatDateTime(item.dispatchDate),
            item.assignedVehiclePlate || '',
          ]);
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [
          { wch: 18 }, { wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 12 },
          { wch: 20 }, { wch: 25 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
          { wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 18 }, { wch: 12 },
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '用车台账');
        XLSX.writeFile(wb, `用车申请台账_${todayStr()}.xlsx`);
      } else {
        alert(res.data?.error || '导出失败');
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || '网络错误，导出失败');
    }
  };

  // 打开派车弹窗时加载可用车辆
  const openDispatchModal = (id: number) => {
    setDispatchModal({ id, vehicleId: '', remark: '', lastStatus: null });
    loadVehicles();
  };

  // 打开新增用车申请弹窗：加载驾驶员列表
  const openCreateModal = async () => {
    setCreateForm({
      usageDate: todayStr(),
      returnDate: '',
      destination: '',
      purpose: '',
      passengers: '',
      driver: '',
      remainingFuel: '',
      department: user?.orgName || '',
    });
    setShowCreate(true);
    // 并行加载：①授权人管理中的驾驶员 ②我的默认信息（真实姓名/组织/最近归还剩余油数）
    setDriversLoading(true);
    try {
      const [drRes, defRes] = await Promise.all([
        authorizedPersonApi.list(),
        vehicleApplicationApi.myApplyDefaults(),
      ]);
      if (drRes.data?.ok) setDrivers(drRes.data.data || []);
      else setDrivers([]);
      if (defRes.data?.ok && defRes.data.data) {
        const d = defRes.data.data;
        setCreateForm((prev) => ({
          ...prev,
          department: prev.department || d.orgName || '',
          remainingFuel: d.lastReturnFuel != null && d.lastReturnFuel !== '' ? String(d.lastReturnFuel) : '',
        }));
      }
    } catch {
      setDrivers([]);
    } finally {
      setDriversLoading(false);
    }
  };

  // 派车弹窗选择车辆后获取最后一次归还状态
  const handleDispatchVehicleChange = async (vehicleId: string) => {
    if (!dispatchModal) return;
    if (!vehicleId) {
      setDispatchModal({ ...dispatchModal, vehicleId: '', lastStatus: null });
      return;
    }
    try {
      const res = await vehicleApi.getLastStatus(Number(vehicleId));
      if (res.data?.ok && res.data.data) {
        const d = res.data.data;
        setDispatchModal({
          ...dispatchModal,
          vehicleId,
          lastStatus: {
            returnMileage: d.returnMileage ?? null,
            returnFuelLevel: d.returnFuelLevel ?? null,
            returnBatteryLevel: d.returnBatteryLevel != null ? Number(d.returnBatteryLevel) : null,
            returnTime: d.returnTime ?? null,
            actualMileage: d.actualMileage ?? null,
            fuelConsumption: d.fuelConsumption != null ? Number(d.fuelConsumption) : null,
            energyType: d.energyType || 'fuel',
          },
        });
      } else {
        setDispatchModal({ ...dispatchModal, vehicleId, lastStatus: null });
      }
    } catch {
      setDispatchModal({ ...dispatchModal, vehicleId, lastStatus: null });
    }
  };

  // 客户端搜索过滤
  const filteredList = list.filter((item) => {
    if (!searchKeyword) return true;
    const kw = searchKeyword.toLowerCase();
    return (
      (item.applicationNo || '').toLowerCase().includes(kw) ||
      (item.applicantName || '').toLowerCase().includes(kw) ||
      (item.destination || '').toLowerCase().includes(kw) ||
      (item.purpose || '').toLowerCase().includes(kw) ||
      (item.department || '').toLowerCase().includes(kw)
    );
  });

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <Layout title="申请用车" subtitle="公务用车申请审批全流程">
      <div className="p-4 max-w-[1600px] mx-auto space-y-4">
        {/* 顶部工具栏：状态筛选 + 操作按钮 */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* 状态筛选 Tab */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                  activeTab === tab.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 搜索框 + 操作按钮 */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索单号/申请人/目的地..."
                className="pl-10 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition"
            >
              <Download className="w-4 h-4" />导出台账
            </button>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition"
            >
              <Plus className="w-4 h-4" />新增用车申请
            </button>
          </div>
        </div>

        {/* 主表格 */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              <span className="ml-2 text-gray-400 text-sm">加载中...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-3 text-left font-medium">申请单号</th>
                    <th className="px-3 py-3 text-left font-medium">申请人</th>
                    <th className="px-3 py-3 text-left font-medium">部门</th>
                    <th className="px-3 py-3 text-left font-medium">用车日期</th>
                    <th className="px-3 py-3 text-left font-medium">归还日期</th>
                    <th className="px-3 py-3 text-left font-medium">目的地</th>
                    <th className="px-3 py-3 text-left font-medium">事由</th>
                    <th className="px-3 py-3 text-left font-medium">随行人员</th>
                    <th className="px-3 py-3 text-left font-medium">驾驶员</th>
                    <th className="px-3 py-3 text-right font-medium">剩余油数(L)</th>
                    <th className="px-3 py-3 text-center font-medium">状态</th>
                    <th className="px-3 py-3 text-left font-medium">车牌号</th>
                    <th className="px-3 py-3 text-left font-medium">审批人</th>
                    <th className="px-3 py-3 text-center font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredList.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="px-4 py-12 text-center text-gray-400">
                        暂无用车申请记录
                      </td>
                    </tr>
                  ) : (
                    filteredList.map((item) => (
                      <Fragment key={item.id}>
                        <tr className="hover:bg-gray-50 transition">
                          <td className="px-3 py-3 font-mono text-xs text-gray-700">{item.applicationNo || '-'}</td>
                          <td className="px-3 py-3 text-gray-700">{item.applicantName || '-'}</td>
                          <td className="px-3 py-3 text-gray-600">{item.department || '-'}</td>
                          <td className="px-3 py-3 text-gray-600">{formatDate(item.usageDate)}</td>
                          <td className="px-3 py-3 text-gray-600">{formatDate(item.returnDate)}</td>
                          <td className="px-3 py-3 text-gray-700 max-w-[200px] truncate" title={item.destination}>{item.destination || '-'}</td>
                          <td className="px-3 py-3 text-gray-600 max-w-[200px] truncate" title={item.purpose}>{item.purpose || '-'}</td>
                          <td className="px-3 py-3 text-gray-600 max-w-[150px] truncate" title={item.passengers}>{item.passengers || '-'}</td>
                          <td className="px-3 py-3 text-gray-600">{item.driver || '-'}</td>
                          <td className="px-3 py-3 text-right text-gray-600">{item.remainingFuel != null ? `${Number(item.remainingFuel)} L` : '-'}</td>
                          <td className="px-3 py-3 text-center">{getStatusBadge(item.status)}</td>
                          <td className="px-3 py-3 text-gray-600">{item.assignedVehiclePlate || '-'}</td>
                          <td className="px-3 py-3 text-gray-600">{item.deptApproverName || '-'}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              {/* 详情按钮：所有状态均可查看 */}
                              <button
                                onClick={() => setDetailModal(item)}
                                disabled={submitting}
                                className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition disabled:opacity-50"
                              >
                                <Search className="w-3.5 h-3.5" />详情
                              </button>
                              {/* 待审批：审批派车（合并） + 驳回 */}
                              {item.status === 'pending' && canDispatch(user) && (
                                <>
                                  <button
                                    onClick={() => openApproveDispatchModal(item.id)}
                                    disabled={submitting}
                                    className="flex items-center gap-1 px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 transition disabled:opacity-50"
                                  >
                                    <Truck className="w-3.5 h-3.5" />审批派车
                                  </button>
                                  <button
                                    onClick={() => setApproveModal({ id: item.id, mode: 'reject', remark: '' })}
                                    disabled={submitting}
                                    className="flex items-center gap-1 px-2 py-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition disabled:opacity-50"
                                  >
                                    <X className="w-3.5 h-3.5" />驳回
                                  </button>
                                </>
                              )}

                              {/* 请等待状态：可再次审批派车 */}
                              {item.status === 'waiting' && canDispatch(user) && (
                                <button
                                  onClick={() => openApproveDispatchModal(item.id)}
                                  disabled={submitting}
                                  className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition disabled:opacity-50"
                                >
                                  <Truck className="w-3.5 h-3.5" />审批派车
                                </button>
                              )}

                              {/* 已出车：归还登记 */}
                              {item.status === 'departed' && (
                                <button
                                  onClick={() => setReturnModal({
                                    id: item.id,
                                    vehicleEnergyType: item.vehicleEnergyType || 'fuel',
                                    returnMileage: '',
                                    returnFuelLevel: '',
                                    returnBattery: '',
                                    remark: '',
                                    returnMileagePhoto: '',
                                    returnFuelPhoto: '',
                                    vehiclePhotoFront: '',
                                    vehiclePhotoBack: '',
                                    vehiclePhotoLeft: '',
                                    vehiclePhotoRight: '',
                                  })}
                                  disabled={submitting}
                                  className="flex items-center gap-1 px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 transition disabled:opacity-50"
                                >
                                  <Check className="w-3.5 h-3.5" />归还登记
                                </button>
                              )}

                              {/* 可取消状态：取消按钮（仅申请人本人可见可操作） */}
                              {CANCELLABLE_STATUSES.includes(item.status) && isSelfApplicant(item) && (
                                <button
                                  onClick={() => handleCancel(item.id)}
                                  disabled={submitting}
                                  className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-50 text-gray-600 border border-gray-200 rounded hover:bg-gray-100 transition disabled:opacity-50"
                                >
                                  <X className="w-3.5 h-3.5" />取消
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {/* 等待提示行：申请人和审批人都可见 */}
                        {item.waitRemark && (
                          <tr className="bg-purple-50/50">
                            <td colSpan={14} className="px-4 py-2">
                              <div className="flex items-start gap-2 text-xs text-purple-700">
                                <Clock className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <span>{item.waitRemark}</span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))
                   )}
                </tbody>
              </table>
            </div>
          )}

          {/* 列表底部统计 */}
          {!loading && filteredList.length > 0 && (
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
              共 {filteredList.length} 条记录
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* 新建用车申请弹窗 */}
      {/* ============================================================ */}
      {showCreate && (
        <Modal
          title="新增用车申请"
          onClose={() => setShowCreate(false)}
          maxWidth="max-w-2xl"
          footer={
            <>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                提交申请
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 申请人：显示当前登录用户，自动获取，不可修改 */}
            <Field label="申请人">
              <div className="flex items-center gap-2 w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700">
                <User className="w-4 h-4 text-gray-400" />
                {user?.userName || user?.userCode || '当前用户'}
              </div>
            </Field>
            <Field label="部门" required>
              <div className="flex items-center gap-2 w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700">
                {createForm.department || '未绑定组织'}
              </div>
            </Field>
            <Field label="用车日期" required>
              <input
                type="date"
                value={createForm.usageDate}
                min={todayStr()}
                onChange={(e) => setCreateForm({ ...createForm, usageDate: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="归还日期">
              <input
                type="date"
                value={createForm.returnDate}
                min={createForm.usageDate || todayStr()}
                onChange={(e) => setCreateForm({ ...createForm, returnDate: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="驾驶员" required>
              {driversLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />正在加载驾驶员...
                </div>
              ) : drivers.length === 0 ? (
                <input
                  type="text"
                  value={createForm.driver}
                  onChange={(e) => setCreateForm({ ...createForm, driver: e.target.value })}
                  placeholder="暂无授权人，可手动输入驾驶员"
                  className={inputClass}
                />
              ) : (
                <select
                  value={createForm.driver}
                  onChange={(e) => setCreateForm({ ...createForm, driver: e.target.value })}
                  className={inputClass}
                >
                  <option value="">请选择驾驶员</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.personName}>
                      {d.personName}{d.dept ? `（${d.dept}）` : ''}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="剩余油数(L)" required>
              <input
                type="number"
                step="0.1"
                min="0"
                value={createForm.remainingFuel}
                onChange={(e) => setCreateForm({ ...createForm, remainingFuel: e.target.value })}
                placeholder="自动带出上次归还剩余油数，可修改"
                className={inputClass}
              />
            </Field>
            <Field label="目的地" required>
              <input
                type="text"
                value={createForm.destination}
                onChange={(e) => setCreateForm({ ...createForm, destination: e.target.value })}
                placeholder="请输入目的地"
                className={inputClass}
              />
            </Field>
            <Field label="随行人员">
              <input
                type="text"
                value={createForm.passengers}
                onChange={(e) => setCreateForm({ ...createForm, passengers: e.target.value })}
                placeholder="如：张三、李四"
                className={inputClass}
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="用车事由" required>
                <textarea
                  value={createForm.purpose}
                  onChange={(e) => setCreateForm({ ...createForm, purpose: e.target.value })}
                  rows={3}
                  placeholder="请输入用车事由"
                  className={`${inputClass} resize-none`}
                />
              </Field>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================ */}
      {/* 审批/驳回弹窗 */}
      {/* ============================================================ */}
      {approveModal && (
        <Modal
          title={approveModal.mode === 'approve' ? '审批通过' : '驳回申请'}
          onClose={() => setApproveModal(null)}
          footer={
            <>
              <button
                onClick={() => setApproveModal(null)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition"
              >
                取消
              </button>
              <button
                onClick={handleApprove}
                disabled={submitting}
                className={`flex items-center gap-1.5 px-4 py-2 text-white rounded-lg text-sm transition disabled:opacity-50 ${
                  approveModal.mode === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : approveModal.mode === 'approve' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                确认{approveModal.mode === 'approve' ? '通过' : '驳回'}
              </button>
            </>
          }
        >
          <div>
            <Field label={approveModal.mode === 'approve' ? '审批备注' : '驳回原因'} required={approveModal.mode === 'reject'}>
              <textarea
                value={approveModal.remark}
                onChange={(e) => setApproveModal({ ...approveModal, remark: e.target.value })}
                rows={4}
                placeholder={approveModal.mode === 'approve' ? '可填写审批备注（选填）' : '请填写驳回原因（必填）'}
                className={`${inputClass} resize-none`}
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* ============================================================ */}
      {/* 派车弹窗 */}
      {/* ============================================================ */}
      {dispatchModal && (
        <Modal
          title="行政派车"
          onClose={() => setDispatchModal(null)}
          footer={
            <>
              <button
                onClick={() => setDispatchModal(null)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition"
              >
                取消
              </button>
              <button
                onClick={handleDispatch}
                disabled={submitting || isFuelRangeBlocked(dispatchModal.lastStatus?.returnFuelLevel, dispatchModal.lastStatus?.fuelConsumption) || isElectricBlocked(dispatchModal.lastStatus?.energyType, dispatchModal.lastStatus?.returnBatteryLevel)}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                确认派车
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="指派车辆" required>
              {vehiclesLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />正在加载可用车辆...
                </div>
              ) : vehicles.length === 0 ? (
                <div className="text-sm text-gray-400 py-2">暂无可用车辆，请先在车辆管理中添加车辆</div>
              ) : (
                <select
                  value={dispatchModal.vehicleId}
                  onChange={(e) => handleDispatchVehicleChange(e.target.value)}
                  className={inputClass}
                >
                  <option value="">请选择车辆</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plateNo} - {v.vehicleType || '未知车型'}{v.licenseNo ? `（行驶证：${v.licenseNo}）` : ''}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            {/* 出车信息：出车时间、初始里程、油量/电量、预计行使公里 */}
            {dispatchModal.vehicleId && dispatchModal.lastStatus && (
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium text-gray-700">
                  {dispatchModal.lastStatus.energyType === 'electric' ? '出车信息（电车）' : '出车信息（油车）'}
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">出车时间</p>
                      <p className="font-medium text-gray-700">{formatDateTime(new Date().toISOString())}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Car className="w-4 h-4 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">出车初始里程</p>
                      <p className={`font-medium ${dispatchModal.lastStatus.returnMileage != null ? 'text-gray-700' : 'text-gray-400'}`}>
                        {dispatchModal.lastStatus.returnMileage != null ? `${dispatchModal.lastStatus.returnMileage} km` : '无记录'}
                      </p>
                    </div>
                  </div>
                  {dispatchModal.lastStatus.energyType === 'electric' ? (
                    <div className="flex items-center gap-2">
                      <Fuel className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500">出车电量</p>
                        <p className={`font-medium ${
                          dispatchModal.lastStatus.returnBatteryLevel != null && Number(dispatchModal.lastStatus.returnBatteryLevel) < 50
                            ? 'text-amber-600'
                            : 'text-gray-700'
                        }`}>
                          {dispatchModal.lastStatus.returnBatteryLevel != null ? `${Number(dispatchModal.lastStatus.returnBatteryLevel)}%` : '无记录'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Fuel className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500">出车油量</p>
                        <p className={`font-medium ${
                          dispatchModal.lastStatus.returnFuelLevel != null &&
                          Number(dispatchModal.lastStatus.returnFuelLevel) < LOW_FUEL_THRESHOLD
                            ? 'text-red-600'
                            : 'text-gray-700'
                        }`}>
                          {dispatchModal.lastStatus.returnFuelLevel != null ? `${dispatchModal.lastStatus.returnFuelLevel} L` : '无记录'}
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">申请剩余油数</p>
                      <p className="font-medium text-gray-700">
                        {(() => {
                          const rf = (list.find((x) => x.id === dispatchModal.id) || {}).remainingFuel;
                          const n = Number(rf);
                          return rf != null && !isNaN(n) && n > 0 ? `${n} L` : '未填写';
                        })()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 电车：电量阈值提示（<50% 提醒，<30% 禁止） */}
                {dispatchModal.lastStatus.energyType === 'electric' && dispatchModal.lastStatus.returnBatteryLevel != null && (
                  (() => {
                    const battery = Number(dispatchModal.lastStatus.returnBatteryLevel);
                    if (battery < 30) {
                      return (
                        <div className="flex items-center gap-1.5 text-red-600 text-xs bg-red-50 border border-red-200 rounded px-2 py-1">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                          电量低于 30%（当前 {battery}%），禁止派车，请先充电再出车！
                        </div>
                      );
                    }
                    if (battery < 50) {
                      return (
                        <div className="flex items-center gap-1.5 text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                          电量低于 50%（当前 {battery}%），请注意电量，必要时先充电再出车！
                        </div>
                      );
                    }
                    return null;
                  })()
                )}

                {/* 油车：按当前剩余油量估算续航，<80km 禁止派车 */}
                {(!dispatchModal.lastStatus.energyType || dispatchModal.lastStatus.energyType === 'fuel') && (
                  (() => {
                    const MIN_DISPATCH_RANGE = 80;
                    const range = calcRemainingRange(dispatchModal.lastStatus.returnFuelLevel, dispatchModal.lastStatus.fuelConsumption);
                    if (range === null) {
                      return (
                        <p className="text-xs text-gray-400">无剩余油数记录，无法估算续航。</p>
                      );
                    }
                    if (range < MIN_DISPATCH_RANGE) {
                      return (
                        <div className="flex items-start gap-1.5 text-red-600 text-xs bg-red-50 border border-red-200 rounded px-2 py-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          <span>
                            续航不足且低于 80 公里，<b>禁止派车</b>：当前剩余油量 <b>{dispatchModal.lastStatus.returnFuelLevel} L</b>，估算续航约 <b>{range} km</b>（剩余油 ÷ 百公里油耗 {dispatchModal.lastStatus.fuelConsumption || DEFAULT_FUEL_CONSUMPTION} L）<br />
                            <b>请先充电或加油后再派车！</b>
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div className="flex items-center gap-1.5 text-green-700 text-xs bg-green-50 border border-green-200 rounded px-2 py-1.5">
                        <Check className="w-3.5 h-3.5 flex-shrink-0" />
                        当前剩余油量 {dispatchModal.lastStatus.returnFuelLevel} L，估算续航约 {range} km，可正常派车（低于 80 公里将禁止派车）。
                      </div>
                    );
                  })()
                )}
                {dispatchModal.lastStatus.returnTime && (
                  <p className="text-xs text-gray-400">上次归还时间：{formatDateTime(dispatchModal.lastStatus.returnTime)}</p>
                )}
              </div>
            )}

            <Field label="派车备注">
              <textarea
                value={dispatchModal.remark}
                onChange={(e) => setDispatchModal({ ...dispatchModal, remark: e.target.value })}
                rows={3}
                placeholder="可填写派车说明（选填）"
                className={`${inputClass} resize-none`}
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* ============================================================ */}
      {/* 审批派车合并弹窗：有车选车审批派车，无车提示请等待 */}
      {/* ============================================================ */}
      {approveDispatchModal && (
        <Modal
          title="审批派车"
          onClose={() => setApproveDispatchModal(null)}
          footer={
            <>
              <button
                onClick={() => setApproveDispatchModal(null)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition"
              >
                取消
              </button>
              {approveDispatchModal.availableVehicles.length > 0 ? (
                <button
                  onClick={handleApproveDispatch}
                  disabled={submitting || !approveDispatchModal.vehicleId || isFuelRangeBlocked(approveDispatchModal.lastStatus?.returnFuelLevel, approveDispatchModal.lastStatus?.fuelConsumption) || isElectricBlocked(approveDispatchModal.lastStatus?.energyType, approveDispatchModal.lastStatus?.returnBatteryLevel)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                  审批通过并派车
                </button>
              ) : !approveDispatchModal.loading ? (
                <button
                  onClick={() => handleSetWait(approveDispatchModal.id, approveDispatchModal.dispatchedVehicles)}
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                  通知申请人请等待
                </button>
              ) : null}
            </>
          }
        >
          <div className="space-y-4">
            {approveDispatchModal.loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
                <Loader2 className="w-5 h-5 animate-spin" /> 正在查询可用车辆...
              </div>
            ) : approveDispatchModal.availableVehicles.length > 0 ? (
              <>
                <Field label="指派车辆" required>
                  <select
                    value={approveDispatchModal.vehicleId}
                    onChange={(e) => handleApproveDispatchVehicleChange(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">请选择车辆</option>
                    {approveDispatchModal.availableVehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plateNo} - {v.vehicleType || '未知车型'}{v.licenseNo ? `（行驶证：${v.licenseNo}）` : ''}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* 出车信息：出车时间、初始里程、油量/电量、预计行使公里 */}
                {approveDispatchModal.vehicleId && approveDispatchModal.lastStatus && (
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <p className="text-sm font-medium text-gray-700">
                      {approveDispatchModal.lastStatus.energyType === 'electric' ? '出车信息（电车）' : '出车信息（油车）'}
                    </p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">出车时间</p>
                          <p className="font-medium text-gray-700">{formatDateTime(new Date().toISOString())}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Car className="w-4 h-4 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">出车初始里程</p>
                          <p className={`font-medium ${approveDispatchModal.lastStatus.returnMileage != null ? 'text-gray-700' : 'text-gray-400'}`}>
                            {approveDispatchModal.lastStatus.returnMileage != null ? `${approveDispatchModal.lastStatus.returnMileage} km` : '无记录'}
                          </p>
                        </div>
                      </div>
                      {approveDispatchModal.lastStatus.energyType === 'electric' ? (
                        <div className="flex items-center gap-2">
                          <Fuel className="w-4 h-4 text-gray-400" />
                          <div>
                            <p className="text-xs text-gray-500">出车电量</p>
                            <p className={`font-medium ${
                              approveDispatchModal.lastStatus.returnBatteryLevel != null && Number(approveDispatchModal.lastStatus.returnBatteryLevel) < 50
                                ? 'text-amber-600'
                                : 'text-gray-700'
                            }`}>
                              {approveDispatchModal.lastStatus.returnBatteryLevel != null ? `${Number(approveDispatchModal.lastStatus.returnBatteryLevel)}%` : '无记录'}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Fuel className="w-4 h-4 text-gray-400" />
                          <div>
                            <p className="text-xs text-gray-500">出车油量</p>
                            <p className={`font-medium ${
                              approveDispatchModal.lastStatus.returnFuelLevel != null &&
                              Number(approveDispatchModal.lastStatus.returnFuelLevel) < LOW_FUEL_THRESHOLD
                                ? 'text-red-600'
                                : 'text-gray-700'
                            }`}>
                              {approveDispatchModal.lastStatus.returnFuelLevel != null ? `${approveDispatchModal.lastStatus.returnFuelLevel} L` : '无记录'}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Truck className="w-4 h-4 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">申请剩余油数</p>
                          <p className="font-medium text-gray-700">
                            {(() => {
                              const rf = (list.find((x) => x.id === approveDispatchModal.id) || {}).remainingFuel;
                              const n = Number(rf);
                              return rf != null && !isNaN(n) && n > 0 ? `${n} L` : '未填写';
                            })()}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* 电车：电量阈值提示（<50% 提醒，<30% 禁止） */}
                    {approveDispatchModal.lastStatus.energyType === 'electric' && approveDispatchModal.lastStatus.returnBatteryLevel != null && (
                      (() => {
                        const battery = Number(approveDispatchModal.lastStatus.returnBatteryLevel);
                        if (battery < 30) {
                          return (
                            <div className="flex items-center gap-1.5 text-red-600 text-xs bg-red-50 border border-red-200 rounded px-2 py-1">
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                              电量低于 30%（当前 {battery}%），禁止派车，请先充电再出车！
                            </div>
                          );
                        }
                        if (battery < 50) {
                          return (
                            <div className="flex items-center gap-1.5 text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1">
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                              电量低于 50%（当前 {battery}%），请注意电量，必要时先充电再出车！
                            </div>
                          );
                        }
                        return null;
                      })()
                    )}

                    {/* 油车：按当前剩余油量估算续航，<80km 禁止派车 */}
                    {(!approveDispatchModal.lastStatus.energyType || approveDispatchModal.lastStatus.energyType === 'fuel') && (
                      (() => {
                        const MIN_DISPATCH_RANGE = 80;
                        const range = calcRemainingRange(approveDispatchModal.lastStatus.returnFuelLevel, approveDispatchModal.lastStatus.fuelConsumption);
                        if (range === null) {
                          return (
                            <p className="text-xs text-gray-400">无剩余油数记录，无法估算续航。</p>
                          );
                        }
                        if (range < MIN_DISPATCH_RANGE) {
                          return (
                            <div className="flex items-start gap-1.5 text-red-600 text-xs bg-red-50 border border-red-200 rounded px-2 py-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                              <span>
                                续航不足且低于 80 公里，<b>禁止派车</b>：当前剩余油量 <b>{approveDispatchModal.lastStatus.returnFuelLevel} L</b>，估算续航约 <b>{range} km</b>（剩余油 ÷ 百公里油耗 {approveDispatchModal.lastStatus.fuelConsumption || DEFAULT_FUEL_CONSUMPTION} L）<br />
                                <b>请先充电或加油后再派车！</b>
                              </span>
                            </div>
                          );
                        }
                        return (
                          <div className="flex items-center gap-1.5 text-green-700 text-xs bg-green-50 border border-green-200 rounded px-2 py-1.5">
                            <Check className="w-3.5 h-3.5 flex-shrink-0" />
                            当前剩余油量 {approveDispatchModal.lastStatus.returnFuelLevel} L，估算续航约 {range} km，可正常派车（低于 80 公里将禁止派车）。
                          </div>
                        );
                      })()
                    )}
                  </div>
                )}

                <Field label="审批/派车备注">
                  <textarea
                    value={approveDispatchModal.remark}
                    onChange={(e) => setApproveDispatchModal({ ...approveDispatchModal, remark: e.target.value })}
                    rows={3}
                    placeholder="可填写审批派车说明（选填）"
                    className={`${inputClass} resize-none`}
                  />
                </Field>
              </>
            ) : (
              /* 无可用车辆：展示最近两辆已出车车辆预计归还时间 */
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm font-medium">当前暂无可用车辆</span>
                </div>
                {approveDispatchModal.dispatchedVehicles.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-600 font-medium">最近出车车辆预计归还时间：</p>
                    {approveDispatchModal.dispatchedVehicles.map((v, i) => (
                      <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-3">
                        <Car className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-800">
                            {v.plateNo || v.assignedVehiclePlate || '未知车牌'}
                            {v.vehicleType ? `（${v.vehicleType}）` : ''}
                          </p>
                          <p className="text-xs text-gray-500">
                            申请人：{v.applicantName || '-'} | 目的地：{v.destination || '-'}
                          </p>
                          <p className="text-xs text-blue-600 font-medium mt-1">
                            预计归还日期：{formatDate(v.returnDate)}
                          </p>
                        </div>
                      </div>
                    ))}
                    <p className="text-xs text-purple-600 bg-purple-50 rounded px-3 py-2">
                      点击「通知申请人请等待」将设置等待提示，申请人可看到等待信息。待车辆归还后可再次点击「审批派车」。
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 py-4 text-center">暂无出车记录，请等待车辆到位后再审批派车。</p>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ============================================================ */}
      {/* 归还登记弹窗（强制填实际里程和油箱剩余数；支持上传车辆行驶里程照片、油箱照片、车辆四维图） */}
      {/* ============================================================ */}
      {returnModal && (
        <Modal
          title="归还登记"
          onClose={() => setReturnModal(null)}
          maxWidth="max-w-2xl"
          footer={
            <>
              <button
                onClick={() => setReturnModal(null)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition"
              >
                取消
              </button>
              <button
                onClick={handleReturn}
                disabled={submitting || returnPhotoUploading}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                确认归还
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="归还里程(km)" required>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={returnModal.returnMileage}
                  onChange={(e) => setReturnModal({ ...returnModal, returnMileage: e.target.value })}
                  placeholder="如：12400.6"
                  className={inputClass}
                />
              </Field>
              {returnModal.vehicleEnergyType === 'electric' ? (
                <Field label="归还电量(%)" required>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={returnModal.returnBattery}
                    onChange={(e) => setReturnModal({ ...returnModal, returnBattery: e.target.value })}
                    placeholder="如：70"
                    className={inputClass}
                  />
                </Field>
              ) : (
                <Field label="油箱剩余数(L)" required>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={returnModal.returnFuelLevel}
                    onChange={(e) => setReturnModal({ ...returnModal, returnFuelLevel: e.target.value })}
                    placeholder="如：25.5"
                    className={inputClass}
                  />
                </Field>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <Clock className="w-4 h-4 flex-shrink-0" />
              <span>归还时间将由系统在确认归还时自动记录，无需手动填写。</span>
            </div>
            {/* 现场照片上传：行驶里程照片 + 油箱照片（必填） */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <PhotoUploadField
                label="行驶里程照片"
                value={returnModal.returnMileagePhoto}
                uploading={returnPhotoUploading}
                disabled={submitting}
                required
                onUpload={(f) => handleReturnPhotoUpload('returnMileagePhoto', f)}
              />
              <PhotoUploadField
                label="油箱照片"
                value={returnModal.returnFuelPhoto}
                uploading={returnPhotoUploading}
                disabled={submitting}
                required
                onUpload={(f) => handleReturnPhotoUpload('returnFuelPhoto', f)}
              />
            </div>
            {/* 车辆四维图（前/后/左/右）*/}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">车辆四维图（前后左右）<span className="text-red-500 ml-0.5">*</span></p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <PhotoUploadField
                  label="车辆正面"
                  value={returnModal.vehiclePhotoFront}
                  uploading={returnPhotoUploading}
                  disabled={submitting}
                  required
                  onUpload={(f) => handleReturnPhotoUpload('vehiclePhotoFront', f)}
                />
                <PhotoUploadField
                  label="车辆背面"
                  value={returnModal.vehiclePhotoBack}
                  uploading={returnPhotoUploading}
                  disabled={submitting}
                  required
                  onUpload={(f) => handleReturnPhotoUpload('vehiclePhotoBack', f)}
                />
                <PhotoUploadField
                  label="车辆左侧"
                  value={returnModal.vehiclePhotoLeft}
                  uploading={returnPhotoUploading}
                  disabled={submitting}
                  required
                  onUpload={(f) => handleReturnPhotoUpload('vehiclePhotoLeft', f)}
                />
                <PhotoUploadField
                  label="车辆右侧"
                  value={returnModal.vehiclePhotoRight}
                  uploading={returnPhotoUploading}
                  disabled={submitting}
                  required
                  onUpload={(f) => handleReturnPhotoUpload('vehiclePhotoRight', f)}
                />
              </div>
            </div>
            <Field label="登记备注">
              <textarea
                value={returnModal.remark}
                onChange={(e) => setReturnModal({ ...returnModal, remark: e.target.value })}
                rows={3}
                placeholder="可填写归还说明（选填）"
                className={`${inputClass} resize-none`}
              />
            </Field>
          </div>
        </Modal>
      )}
      {/* ============================================================ */}
      {/* 用车申请详情弹窗（展示整条链路信息） */}
      {/* ============================================================ */}
      {detailModal && (
        <Modal
          title={`用车申请详情 - ${detailModal.applicationNo || ''}`}
          onClose={() => setDetailModal(null)}
          maxWidth="max-w-3xl"
          footer={
            <button
              onClick={() => setDetailModal(null)}
              className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition"
            >
              关闭
            </button>
          }
        >
          <div className="space-y-6">
            {/* 申请信息 */}
            <div>
              <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5 border-l-4 border-blue-500 pl-2">
                <Car className="w-4 h-4" />申请信息
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm bg-gray-50 rounded-lg p-4">
                <div><span className="text-gray-500">申请单号：</span><span className="font-mono text-gray-800">{detailModal.applicationNo || '-'}</span></div>
                <div><span className="text-gray-500">申请人：</span><span className="text-gray-800">{detailModal.applicantName || '-'}</span></div>
                <div><span className="text-gray-500">部门：</span><span className="text-gray-800">{detailModal.department || '-'}</span></div>
                <div><span className="text-gray-500">提交时间：</span><span className="text-gray-800">{formatDateTime(detailModal.createdAt)}</span></div>
                <div><span className="text-gray-500">用车日期：</span><span className="text-gray-800">{formatDate(detailModal.usageDate)}</span></div>
                <div><span className="text-gray-500">预计归还：</span><span className="text-gray-800">{formatDate(detailModal.returnDate)}</span></div>
                <div className="md:col-span-2"><span className="text-gray-500">目的地：</span><span className="text-gray-800">{detailModal.destination || '-'}</span></div>
                <div><span className="text-gray-500">随行人员：</span><span className="text-gray-800">{detailModal.passengers || '-'}</span></div>
                <div><span className="text-gray-500">驾驶员：</span><span className="text-gray-800">{detailModal.driver || '-'}</span></div>
                <div><span className="text-gray-500">剩余油数：</span><span className="text-gray-800">{detailModal.remainingFuel != null ? `${Number(detailModal.remainingFuel)} L` : '-'}</span></div>
                <div className="md:col-span-2"><span className="text-gray-500">用车事由：</span><span className="text-gray-800">{detailModal.purpose || '-'}</span></div>
                <div><span className="text-gray-500">当前状态：</span>{getStatusBadge(detailModal.status)}</div>
              </div>
            </div>

            {/* 审批派车信息 */}
            <div>
              <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5 border-l-4 border-green-500 pl-2">
                <Truck className="w-4 h-4" />审批与派车
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm bg-gray-50 rounded-lg p-4">
                <div><span className="text-gray-500">审批人：</span><span className="text-gray-800">{detailModal.deptApproverName || '-'}</span></div>
                <div><span className="text-gray-500">审批时间：</span><span className="text-gray-800">{formatDateTime(detailModal.deptApprovalDate)}</span></div>
                <div><span className="text-gray-500">审批备注：</span><span className="text-gray-800">{detailModal.deptApprovalRemark || '-'}</span></div>
                <div><span className="text-gray-500">派车人：</span><span className="text-gray-800">{detailModal.adminDispatcherName || '-'}</span></div>
                <div><span className="text-gray-500">派车时间：</span><span className="text-gray-800">{formatDateTime(detailModal.dispatchDate)}</span></div>
                <div><span className="text-gray-500">派车备注：</span><span className="text-gray-800">{detailModal.dispatchRemark || '-'}</span></div>
                <div><span className="text-gray-500">指派车牌：</span><span className="text-gray-800">{detailModal.assignedVehiclePlate || '-'}</span></div>
                <div><span className="text-gray-500">车型：</span><span className="text-gray-800">{detailModal.vehicleType || '-'}</span></div>
              </div>
            </div>

            {/* 出车归还信息 */}
            {detailModal.departureTime && (
              <div>
                <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5 border-l-4 border-orange-500 pl-2">
                  <Fuel className="w-4 h-4" />出车与归还
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm bg-gray-50 rounded-lg p-4">
                  <div><span className="text-gray-500">出车时间：</span><span className="text-gray-800">{formatDateTime(detailModal.departureTime)}</span></div>
                  <div><span className="text-gray-500">出车里程：</span><span className="text-gray-800">{detailModal.departureMileage != null ? `${Number(detailModal.departureMileage)} km` : '-'}</span></div>
                  <div><span className="text-gray-500">出车油量：</span><span className="text-gray-800">{detailModal.departureFuelLevel || '-'}</span></div>
                  {detailModal.returnTime && (
                    <>
                      <div><span className="text-gray-500">归还时间：</span><span className="text-gray-800">{formatDateTime(detailModal.returnTime)}</span></div>
                      <div><span className="text-gray-500">归还里程：</span><span className="text-gray-800">{detailModal.returnMileage != null ? `${Number(detailModal.returnMileage)} km` : '-'}</span></div>
                      <div><span className="text-gray-500">实际里程：</span><span className="text-gray-800">{detailModal.actualMileage != null ? `${Number(detailModal.actualMileage)} km` : '-'}</span></div>
                      <div><span className="text-gray-500">归还油量：</span><span className="text-gray-800">{detailModal.returnFuelLevel || '-'}</span></div>
                    </>
                  )}
                  {detailModal.departureReturnRemark && (
                    <div className="md:col-span-3"><span className="text-gray-500">出归还备注：</span><span className="text-gray-800">{detailModal.departureReturnRemark}</span></div>
                  )}
                  {[
                    { label: '行驶里程照片', value: detailModal.returnMileagePhoto },
                    { label: '油箱照片', value: detailModal.returnFuelPhoto },
                  ].filter((p) => p.value).map((p) => (
                    <div key={p.label}>
                      <span className="text-gray-500 block text-xs mb-1">{p.label}：</span>
                      <a href={p.value} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-green-600 hover:underline">
                        <ImageIcon className="w-4 h-4" /> 查看图片
                      </a>
                    </div>
                  ))}
                  {[['vehiclePhotoFront', '车辆正面'], ['vehiclePhotoBack', '车辆背面'], ['vehiclePhotoLeft', '车辆左侧'], ['vehiclePhotoRight', '车辆右侧']].filter(([k]) => detailModal[k]).length > 0 && (
                    <div className="md:col-span-3">
                      <span className="text-gray-500 block text-xs mb-1">车辆四维图：</span>
                      <div className="flex flex-wrap gap-2">
                        {[['vehiclePhotoFront', '正面'], ['vehiclePhotoBack', '背面'], ['vehiclePhotoLeft', '左侧'], ['vehiclePhotoRight', '右侧']].map(([k, label]) => detailModal[k] ? (
                          <a key={k} href={detailModal[k]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-green-600 hover:underline">
                            <ImageIcon className="w-4 h-4" /> {label}
                          </a>
                        ) : null)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 等待提示 */}
            {detailModal.waitRemark && (
              <div>
                <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5 border-l-4 border-purple-500 pl-2">
                  <Clock className="w-4 h-4" />等待提示
                </h4>
                <div className="text-sm bg-purple-50 rounded-lg p-4 text-purple-700 flex items-start gap-2">
                  <Clock className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{detailModal.waitRemark}</span>
                </div>
              </div>
            )}

            {/* 时间线概览 */}
            <div>
              <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5 border-l-4 border-gray-400 pl-2">
                <Clock className="w-4 h-4" />流程时间线
              </h4>
              <div className="space-y-2">
                {[
                  { label: '提交申请', time: detailModal.createdAt, icon: '📝', color: 'bg-blue-50 border-blue-200' },
                  { label: '部门审批', time: detailModal.deptApprovalDate, icon: '✅', color: 'bg-green-50 border-green-200' },
                  { label: '行政派车', time: detailModal.dispatchDate, icon: '🚗', color: 'bg-cyan-50 border-cyan-200' },
                  { label: '出车登记', time: detailModal.departureTime, icon: '🚙', color: 'bg-orange-50 border-orange-200' },
                  { label: '归还登记', time: detailModal.returnTime, icon: '🏁', color: 'bg-green-50 border-green-200' },
                ].filter((step) => step.time).map((step, i) => (
                  <div key={i} className={`flex items-center gap-3 border rounded-lg px-4 py-2.5 ${step.color}`}>
                    <span className="text-lg">{step.icon}</span>
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-700">{step.label}</span>
                    </div>
                    <span className="text-sm text-gray-600">{formatDateTime(step.time)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

export default VehicleApplyPage;
