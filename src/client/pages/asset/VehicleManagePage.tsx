import { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/Layout';
import { vehicleApi, assetOrgApi } from '../../../api/assetManagement';
import * as XLSX from 'xlsx';
import {
  CarFront, Plus, Edit, Trash2, Search, Download, AlertTriangle,
  Wrench, Fuel, Clock, Wallet, RefreshCw, X, FileText, CheckCircle2,
  Loader2, CalendarClock, Upload, ImageIcon, FileCheck,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================
interface Vehicle {
  id: number;
  plateNo: string;
  vehicleType: string;
  energyType: string;
  frameNo: string;
  vin: string;
  licenseNo: string;
  totalMileage: number;
  fuelConsumption: number;
  inspectionPhotoPath: string;
  insuranceFilePath: string;
  orgId: number | null;
  purchaseDate: string;
  status: string;
  insuranceExpiryDate: string;
  inspectionExpiryDate: string;
  maintenanceExpiryDate: string;
  remark: string;
}

interface OrgItem {
  id: number;
  parentId: number | null;
  name: string;
  level: number;
  type: string;
}

interface MaintenanceRecord {
  id: number;
  vehicleId: number;
  maintenanceType: string;
  maintenanceDate: string;
  amount: number;
  fuelLiters: number;
  mileage: number;
  supplier: string;
  remark: string;
}

interface Violation {
  id: number;
  vehicleId: number;
  violationType: string;
  violationDate: string;
  location: string;
  description: string;
  penaltyAmount: number;
  demeritPoints: number;
  responsibleParty: string;
  handlingResult: string;
  status: string;
}

interface ExpiryReminder {
  id: number;
  plateNo: string;
  vehicleType: string;
  licenseNo: string;
  orgId: number | null;
  insuranceExpiryDate: string;
  inspectionExpiryDate: string;
  maintenanceExpiryDate: string;
  insuranceWarning: number;
  inspectionWarning: number;
  maintenanceWarning: number;
}

interface CostLedgerItem {
  id: number;
  vehicleId: number;
  maintenanceType: string;
  maintenanceDate: string;
  amount: number;
  fuelLiters: number;
  mileage: number;
  supplier: string;
  remark: string;
  plateNo: string;
  vehicleType: string;
}

// ============================================================
// Constants
// ============================================================
const VEHICLE_STATUS_OPTIONS = [
  { value: 'inuse', label: '在用' },
  { value: 'idle', label: '空闲' },
  { value: 'dispatched', label: '已出车' },
  { value: 'repairing', label: '维修' },
  { value: 'inspection', label: '年检' },
  { value: 'stopped', label: '停用' },
];

const VEHICLE_STATUS_MAP: Record<string, string> = {
  inuse: '在用',
  idle: '空闲',
  dispatched: '已出车',
  repairing: '维修',
  inspection: '年检',
  stopped: '停用',
};

const VEHICLE_STATUS_STYLE: Record<string, string> = {
  inuse: 'bg-green-100 text-green-700',
  idle: 'bg-teal-100 text-teal-700',
  dispatched: 'bg-amber-100 text-amber-700',
  repairing: 'bg-orange-100 text-orange-700',
  inspection: 'bg-blue-100 text-blue-700',
  stopped: 'bg-gray-100 text-gray-500',
};

const MAINTENANCE_TYPE_OPTIONS = [
  { value: 'fuel', label: '加油' },
  { value: 'repair', label: '维修' },
  { value: 'maintenance', label: '保养' },
  { value: 'wash', label: '洗车' },
  { value: 'inspection', label: '年检' },
  { value: 'insurance', label: '保险续费' },
];

const MAINTENANCE_TYPE_MAP: Record<string, string> = {
  fuel: '加油',
  repair: '维修',
  maintenance: '保养',
  wash: '洗车',
  inspection: '年检',
  insurance: '保险续费',
};

const VIOLATION_TYPE_OPTIONS = [
  { value: 'violation', label: '违章' },
  { value: 'accident', label: '事故' },
];

const VIOLATION_TYPE_MAP: Record<string, string> = {
  violation: '违章',
  accident: '事故',
};

const VIOLATION_STATUS_MAP: Record<string, string> = {
  unprocessed: '未处理',
  processing: '处理中',
  processed: '已处理',
};

const VIOLATION_STATUS_STYLE: Record<string, string> = {
  unprocessed: 'bg-red-100 text-red-700',
  processing: 'bg-yellow-100 text-yellow-700',
  processed: 'bg-green-100 text-green-700',
};

const TABS = [
  { key: 'archive', label: '车辆档案', icon: CarFront },
  { key: 'maintenance', label: '运维记录', icon: Wrench },
  { key: 'violations', label: '违章事故', icon: AlertTriangle },
  { key: 'reminders', label: '到期提醒', icon: Clock },
  { key: 'cost', label: '费用台账', icon: Wallet },
];

const inputClass =
  'w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none text-sm transition-colors';

// ============================================================
// Helper functions
// ============================================================

/** Extract the data payload from the API response (backend wraps in { ok, data }) */
function unwrap(res: any): any {
  const body = res?.data ?? res;
  if (!body) throw new Error('响应为空');
  if (body.ok === false) throw new Error(body.error || '操作失败');
  return body.data;
}

/** Format a date string as YYYY-MM-DD */
function formatDate(d?: string | null): string {
  if (!d) return '-';
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try {
    const date = new Date(s);
    if (isNaN(date.getTime())) return '-';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '-';
  }
}

/** Format a number as currency with CNY symbol */
function formatCurrency(n?: number | string | null): string {
  const num = Number(n) || 0;
return `\u00a5${num.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  })}`;
}

/** Days from today until the given date (negative = already expired) */
function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** True if the date is within 30 days from today (inclusive, also true if already expired) */
function isExpiringSoon(d?: string | null): boolean {
  const days = daysUntil(d);
  return days !== null && days <= 30;
}

/** True if the date has already passed */
function isExpired(d?: string | null): boolean {
  const days = daysUntil(d);
  return days !== null && days < 0;
}

// ============================================================
// Small reusable presentational helpers
// ============================================================

function StatusBadge({ status }: { status: string }) {
  const label = VEHICLE_STATUS_MAP[status] || status;
  const style = VEHICLE_STATUS_STYLE[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}

function ExpiryCell({ date }: { date?: string | null }) {
  const text = formatDate(date);
  const soon = isExpiringSoon(date);
  return (
    <span className={soon ? 'text-red-600 font-medium' : 'text-gray-700'}>
      {text}
    </span>
  );
}

function WarningBadge({ date }: { date?: string | null }) {
  if (!date) return <span className="text-gray-400">-</span>;
  const expired = isExpired(date);
  const soon = isExpiringSoon(date);
  if (expired) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
        <AlertTriangle size={12} /> {formatDate(date)} (已过期)
      </span>
    );
  }
  if (soon) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">
        <AlertTriangle size={12} /> {formatDate(date)} (即将到期)
      </span>
    );
  }
  return <span className="text-gray-700 text-xs">{formatDate(date)}</span>;
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-gray-400">
        {text}
      </td>
    </tr>
  );
}

function Spinner({ text }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-primary animate-spin mb-2" />
      {text && <p className="text-gray-500 text-sm">{text}</p>}
    </div>
  );
}

// ============================================================
// Main component
// ============================================================
function VehicleManagePage() {
  // --- Tab & vehicle list state ---
  const [activeTab, setActiveTab] = useState('archive');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');

  // --- Per-vehicle data state ---
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | ''>('');
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([]);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [violationsLoading, setViolationsLoading] = useState(false);
  const [reminders, setReminders] = useState<ExpiryReminder[]>([]);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [costLedger, setCostLedger] = useState<CostLedgerItem[]>([]);
  const [costLedgerLoading, setCostLedgerLoading] = useState(false);

  // --- Vehicle modal state ---
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [vehicleForm, setVehicleForm] = useState({
    plateNo: '',
    vehicleType: '',
    energyType: 'fuel',
    frameNo: '',
    vin: '',
    licenseNo: '',
    totalMileage: '',
    fuelConsumption: '',
    inspectionPhotoPath: '',
    insuranceFilePath: '',
    orgId: '' as string | number,
    purchaseDate: '',
    status: 'inuse',
    insuranceExpiryDate: '',
    inspectionExpiryDate: '',
    maintenanceExpiryDate: '',
    remark: '',
  });

  // --- Org list for cascading dropdown ---
  const [orgList, setOrgList] = useState<OrgItem[]>([]);
  const [orgLevel1, setOrgLevel1] = useState<number | ''>('');
  const [orgLevel2, setOrgLevel2] = useState<number | ''>('');

  // --- Maintenance modal state ---
  const [maintenanceModalOpen, setMaintenanceModalOpen] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState({
    maintenanceType: 'fuel',
    maintenanceDate: '',
    amount: '',
    fuelLiters: '',
    mileage: '',
    supplier: '',
    remark: '',
  });

  // --- Violation modal state ---
  const [violationModalOpen, setViolationModalOpen] = useState(false);
  const [violationForm, setViolationForm] = useState({
    violationType: 'violation',
    violationDate: '',
    location: '',
    description: '',
    penaltyAmount: '',
    demeritPoints: '',
    responsibleParty: '',
  });

  // --- Violation edit modal state ---
  const [violationEditModalOpen, setViolationEditModalOpen] = useState(false);
  const [editingViolationId, setEditingViolationId] = useState<number | null>(null);
  const [violationEditForm, setViolationEditForm] = useState({
    handlingResult: '',
    status: 'unprocessed',
  });

  const [submitting, setSubmitting] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) || null;

  // ============================================================
  // Data loading
  // ============================================================
  const loadVehicles = useCallback(async () => {
    try {
      setVehicleLoading(true);
      const data = unwrap(await vehicleApi.list());
      setVehicles(Array.isArray(data) ? data : []);
    } catch (e: any) {
      alert('获取车辆列表失败: ' + (e.message || e));
    } finally {
      setVehicleLoading(false);
    }
  }, []);

  const loadMaintenance = useCallback(async (id: number) => {
    try {
      setMaintenanceLoading(true);
      const data = unwrap(await vehicleApi.getMaintenance(id));
      setMaintenanceRecords(Array.isArray(data) ? data : []);
    } catch (e: any) {
      alert('获取维保记录失败: ' + (e.message || e));
    } finally {
      setMaintenanceLoading(false);
    }
  }, []);

  const loadViolations = useCallback(async (id: number) => {
    try {
      setViolationsLoading(true);
      const data = unwrap(await vehicleApi.getViolations(id));
      setViolations(Array.isArray(data) ? data : []);
    } catch (e: any) {
      alert('获取违章记录失败: ' + (e.message || e));
    } finally {
      setViolationsLoading(false);
    }
  }, []);

  const loadReminders = useCallback(async () => {
    try {
      setRemindersLoading(true);
      const data = unwrap(await vehicleApi.getExpiryReminders());
      setReminders(Array.isArray(data) ? data : []);
    } catch (e: any) {
      alert('获取到期提醒失败: ' + (e.message || e));
    } finally {
      setRemindersLoading(false);
    }
  }, []);

  const loadCostLedger = useCallback(async (id: number) => {
    try {
      setCostLedgerLoading(true);
      const data = unwrap(await vehicleApi.getCostLedger(id));
      setCostLedger(Array.isArray(data) ? data : []);
    } catch (e: any) {
      alert('获取费用台账失败: ' + (e.message || e));
    } finally {
      setCostLedgerLoading(false);
    }
  }, []);

  // ============================================================
  // Effects
  // ============================================================
  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  // Load org levels for cascading dropdown
  useEffect(() => {
    (async () => {
      try {
        const data = unwrap(await assetOrgApi.getLevels());
        setOrgList(Array.isArray(data) ? data : []);
      } catch {
        // silently ignore
      }
    })();
  }, []);

  useEffect(() => {
    if (activeTab === 'reminders') {
      loadReminders();
    } else if (activeTab === 'maintenance' && selectedVehicleId) {
      loadMaintenance(selectedVehicleId);
    } else if (activeTab === 'violations' && selectedVehicleId) {
      loadViolations(selectedVehicleId);
    } else if (activeTab === 'cost' && selectedVehicleId) {
      loadCostLedger(selectedVehicleId);
    }
  }, [activeTab, selectedVehicleId, loadReminders, loadMaintenance, loadViolations, loadCostLedger]);

  // ============================================================
  // Filtered vehicles (client-side)
  // ============================================================
  const filteredVehicles = vehicles.filter((v) => {
    if (filterStatus && v.status !== filterStatus) return false;
    if (filterKeyword) {
      const kw = filterKeyword.toLowerCase();
      return (
        (v.plateNo || '').toLowerCase().includes(kw) ||
        (v.vehicleType || '').toLowerCase().includes(kw) ||
        (v.licenseNo || '').toLowerCase().includes(kw)
      );
    }
    return true;
  });

  // ============================================================
  // Summary computations for Tab 2
  // ============================================================
  const fuelCost = maintenanceRecords
    .filter((r) => r.maintenanceType === 'fuel')
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const maintenanceCost = maintenanceRecords
    .filter((r) => r.maintenanceType === 'repair' || r.maintenanceType === 'maintenance')
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const totalMaintenanceAmount = maintenanceRecords.reduce(
    (sum, r) => sum + (Number(r.amount) || 0),
    0,
  );

  // ============================================================
  // Summary computations for Tab 5
  // ============================================================
  const totalCostAmount = costLedger.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const totalFuelLiters = costLedger.reduce((sum, r) => sum + (Number(r.fuelLiters) || 0), 0);
  const totalMileage = costLedger.reduce((sum, r) => sum + (Number(r.mileage) || 0), 0);

  // ============================================================
  // Row click: select vehicle and switch to maintenance tab
  // ============================================================
  const handleRowClick = (v: Vehicle) => {
    setSelectedVehicleId(v.id);
    setActiveTab('maintenance');
  };

  // ============================================================
  // Vehicle form handlers
  // ============================================================
  const openVehicleModal = (vehicle?: Vehicle) => {
    if (vehicle) {
      setEditingVehicle(vehicle);
      // Determine org cascade levels
      const org = orgList.find((o) => o.id === vehicle.orgId);
      if (org && org.level === 2) {
        setOrgLevel1(org.parentId || '');
        setOrgLevel2(org.id);
      } else if (org && org.level === 1) {
        setOrgLevel1(org.id);
        setOrgLevel2('');
      } else {
        setOrgLevel1('');
        setOrgLevel2('');
      }
      setVehicleForm({
        plateNo: vehicle.plateNo || '',
        vehicleType: vehicle.vehicleType || '',
        energyType: vehicle.energyType || 'fuel',
        frameNo: vehicle.frameNo || '',
        vin: vehicle.vin || '',
        licenseNo: vehicle.licenseNo || '',
        totalMileage: vehicle.totalMileage != null ? String(vehicle.totalMileage) : '',
        fuelConsumption: vehicle.fuelConsumption != null ? String(vehicle.fuelConsumption) : '',
        inspectionPhotoPath: vehicle.inspectionPhotoPath || '',
        insuranceFilePath: vehicle.insuranceFilePath || '',
        orgId: vehicle.orgId || '',
        purchaseDate: vehicle.purchaseDate ? formatDate(vehicle.purchaseDate) : '',
        status: vehicle.status || 'inuse',
        insuranceExpiryDate: vehicle.insuranceExpiryDate ? formatDate(vehicle.insuranceExpiryDate) : '',
        inspectionExpiryDate: vehicle.inspectionExpiryDate ? formatDate(vehicle.inspectionExpiryDate) : '',
        maintenanceExpiryDate: vehicle.maintenanceExpiryDate ? formatDate(vehicle.maintenanceExpiryDate) : '',
        remark: vehicle.remark || '',
      });
    } else {
      setEditingVehicle(null);
      setOrgLevel1('');
      setOrgLevel2('');
      setVehicleForm({
        plateNo: '',
        vehicleType: '',
        energyType: 'fuel',
        frameNo: '',
        vin: '',
        licenseNo: '',
        totalMileage: '',
        fuelConsumption: '',
        inspectionPhotoPath: '',
        insuranceFilePath: '',
        orgId: '',
        purchaseDate: '',
        status: 'inuse',
        insuranceExpiryDate: '',
        inspectionExpiryDate: '',
        maintenanceExpiryDate: '',
        remark: '',
      });
    }
    setVehicleModalOpen(true);
  };

  const handleVehicleSubmit = async () => {
    if (!vehicleForm.plateNo.trim()) {
      alert('请输入车牌号');
      return;
    }
    if (!vehicleForm.vin.trim()) {
      alert('请输入车架号（VIN）');
      return;
    }
    if (!vehicleForm.licenseNo.trim()) {
      alert('请输入行驶证号');
      return;
    }
    try {
      setSubmitting(true);
      // Determine final orgId: level2 > level1
      const finalOrgId = orgLevel2 || orgLevel1 || null;
      const payload = {
        ...vehicleForm,
        totalMileage: vehicleForm.totalMileage ? Number(vehicleForm.totalMileage) : 0,
        fuelConsumption: vehicleForm.fuelConsumption ? Number(vehicleForm.fuelConsumption) : 8,
        orgId: finalOrgId,
      };
      if (editingVehicle) {
        unwrap(await vehicleApi.update(editingVehicle.id, payload));
        alert('车辆信息已更新');
      } else {
        unwrap(await vehicleApi.create(payload));
        alert('车辆已新增');
      }
      setVehicleModalOpen(false);
      await loadVehicles();
    } catch (e: any) {
      alert('保存车辆失败: ' + (e.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVehicleDelete = async (v: Vehicle) => {
    if (!window.confirm(`确认删除车辆「${v.plateNo}」吗？`)) return;
    try {
      unwrap(await vehicleApi.remove(v.id));
      alert('车辆已删除');
      await loadVehicles();
    } catch (e: any) {
      alert('删除车辆失败: ' + (e.message || e));
    }
  };

  // 文件上传（年检照片 / 保险PDF）
  const handleFileUpload = async (vehicleId: number, file: File, type: 'inspection' | 'insurance') => {
    try {
      setSubmitting(true);
      const res = unwrap(await vehicleApi.uploadFile(vehicleId, file, type));
      // 更新表单中的路径（编辑模式）或列表数据
      if (type === 'inspection') {
        setVehicleForm((prev) => ({ ...prev, inspectionPhotoPath: res.url }));
      } else {
        setVehicleForm((prev) => ({ ...prev, insuranceFilePath: res.url }));
      }
      alert(res.name ? `${type === 'inspection' ? '年检照片' : '保险资料'}上传成功：${res.name}` : '上传成功');
      await loadVehicles();
    } catch (e: any) {
      alert('上传失败: ' + (e.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // Maintenance form handlers
  // ============================================================
  const openMaintenanceModal = () => {
    setMaintenanceForm({
      maintenanceType: 'fuel',
      maintenanceDate: '',
      amount: '',
      fuelLiters: '',
      mileage: '',
      supplier: '',
      remark: '',
    });
    setMaintenanceModalOpen(true);
  };

  const handleMaintenanceSubmit = async () => {
    if (!selectedVehicleId) {
      alert('请先选择车辆');
      return;
    }
    if (!maintenanceForm.maintenanceDate) {
      alert('请选择维保日期');
      return;
    }
    try {
      setSubmitting(true);
      const payload = {
        maintenanceType: maintenanceForm.maintenanceType,
        maintenanceDate: maintenanceForm.maintenanceDate,
        amount: maintenanceForm.amount ? Number(maintenanceForm.amount) : 0,
        fuelLiters: maintenanceForm.fuelLiters ? Number(maintenanceForm.fuelLiters) : 0,
        mileage: maintenanceForm.mileage ? Number(maintenanceForm.mileage) : 0,
        supplier: maintenanceForm.supplier,
        remark: maintenanceForm.remark,
      };
      unwrap(await vehicleApi.createMaintenance(selectedVehicleId, payload));
      alert('维保记录已新增');
      setMaintenanceModalOpen(false);
      await loadMaintenance(selectedVehicleId);
      // Refresh vehicle list in case status/expiry changed
      await loadVehicles();
    } catch (e: any) {
      alert('保存维保记录失败: ' + (e.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // Violation form handlers
  // ============================================================
  const openViolationModal = () => {
    setViolationForm({
      violationType: 'violation',
      violationDate: '',
      location: '',
      description: '',
      penaltyAmount: '',
      demeritPoints: '',
      responsibleParty: '',
    });
    setViolationModalOpen(true);
  };

  const handleViolationSubmit = async () => {
    if (!selectedVehicleId) {
      alert('请先选择车辆');
      return;
    }
    if (!violationForm.violationDate) {
      alert('请选择违章/事故日期');
      return;
    }
    try {
      setSubmitting(true);
      const payload = {
        violationType: violationForm.violationType,
        violationDate: violationForm.violationDate,
        location: violationForm.location,
        description: violationForm.description,
        penaltyAmount: violationForm.penaltyAmount ? Number(violationForm.penaltyAmount) : 0,
        demeritPoints: violationForm.demeritPoints ? Number(violationForm.demeritPoints) : 0,
        responsibleParty: violationForm.responsibleParty,
      };
      unwrap(await vehicleApi.createViolation(selectedVehicleId, payload));
      alert('违章/事故记录已新增');
      setViolationModalOpen(false);
      await loadViolations(selectedVehicleId);
    } catch (e: any) {
      alert('保存违章/事故记录失败: ' + (e.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // Violation edit handlers
  // ============================================================
  const openViolationEditModal = (v: Violation) => {
    setEditingViolationId(v.id);
    setViolationEditForm({
      handlingResult: v.handlingResult || '',
      status: v.status || 'unprocessed',
    });
    setViolationEditModalOpen(true);
  };

  const handleViolationEditSubmit = async () => {
    if (editingViolationId == null) return;
    try {
      setSubmitting(true);
      unwrap(
        await vehicleApi.updateViolation(editingViolationId, {
          handlingResult: violationEditForm.handlingResult,
          status: violationEditForm.status,
        }),
      );
      alert('违章处理状态已更新');
      setViolationEditModalOpen(false);
      if (selectedVehicleId) await loadViolations(selectedVehicleId);
    } catch (e: any) {
      alert('更新违章处理状态失败: ' + (e.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // Cost ledger export
  // ============================================================
  const handleExportCostLedger = () => {
    if (!costLedger.length) {
      alert('暂无数据可导出');
      return;
    }
    const headers = [
      '车牌号',
      '维保类型',
      '维保日期',
      '金额',
      '加油量(升)',
      '里程(公里)',
      '供应商',
      '备注',
    ];
    const rows: (string | number)[][] = [headers];
    costLedger.forEach((item) => {
      rows.push([
        item.plateNo || '',
        MAINTENANCE_TYPE_MAP[item.maintenanceType] || item.maintenanceType || '',
        formatDate(item.maintenanceDate),
        Number(item.amount) || 0,
        Number(item.fuelLiters) || 0,
        Number(item.mileage) || 0,
        item.supplier || '',
        item.remark || '',
      ]);
    });
    rows.push([]);
    rows.push(['合计', '', '', totalCostAmount, totalFuelLiters, totalMileage, '', '']);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '费用台账');
    const plateNo = selectedVehicle?.plateNo || '';
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `费用台账_${plateNo}_${dateStr}.xlsx`);
  };

  // ============================================================
  // Vehicle selector dropdown (shared by tabs 2, 3, 5)
  // ============================================================
  const VehicleSelector = ({ label }: { label: string }) => (
    <div className="flex items-center gap-3 mb-4">
      <label className="text-sm font-medium text-gray-600 whitespace-nowrap">{label}</label>
      <select
        value={selectedVehicleId}
        onChange={(e) =>
          setSelectedVehicleId(e.target.value ? Number(e.target.value) : '')
        }
        className={`${inputClass} max-w-xs`}
      >
        <option value="">请选择车辆</option>
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.plateNo}
            {v.vehicleType ? ` (${v.vehicleType})` : ''}
            {v.licenseNo ? ` - ${v.licenseNo}` : ''}
          </option>
        ))}
      </select>
      {selectedVehicle && (
        <span className="text-sm text-gray-500">
          当前车辆：
          <span className="font-medium text-gray-700">{selectedVehicle.plateNo}</span>
          {selectedVehicle.licenseNo ? ` | 行驶证号: ${selectedVehicle.licenseNo}` : ''}
        </span>
      )}
    </div>
  );

  // ============================================================
  // Render
  // ============================================================
  return (
    <Layout title="车辆管理" subtitle="公务车辆全流程管控">
      <div className="max-w-7xl mx-auto">
        {/* Tab navigation */}
        <div className="bg-white rounded-xl shadow-sm mb-4">
          <div className="flex flex-wrap border-b border-gray-200">
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 sm:px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    active
                      ? 'border-primary text-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <tab.icon size={18} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ===================== Tab 1: 车辆档案 ===================== */}
        {activeTab === 'archive' && (
          <div className="bg-white rounded-xl shadow-sm">
            {/* Filter bar */}
            <div className="p-4 flex flex-wrap items-center gap-3 border-b border-gray-100">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className={`${inputClass} w-32`}
              >
                <option value="">全部状态</option>
                {VEHICLE_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={filterKeyword}
                  onChange={(e) => setFilterKeyword(e.target.value)}
                  placeholder="搜索车牌号 / 车型 / 驾驶员..."
                  className={`${inputClass} pl-10`}
                />
              </div>
              <button
                onClick={() => {
                  setFilterStatus('');
                  setFilterKeyword('');
                }}
                className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <RefreshCw size={16} />
                重置
              </button>
              <button
                onClick={() => openVehicleModal()}
                className="flex items-center gap-1 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors ml-auto"
              >
                <Plus size={16} />
                新增车辆
              </button>
            </div>

            {/* Table */}
            {vehicleLoading ? (
              <Spinner text="加载车辆数据..." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">车牌号</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">车型</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600 whitespace-nowrap">能源类型</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">车架号</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">行驶证号</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600 whitespace-nowrap">总里程(km)</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600 whitespace-nowrap">油耗(L/100km)</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">购置时间</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600 whitespace-nowrap">状态</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">归属组织</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">保险到期</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">年检到期</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600 whitespace-nowrap">附件</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600 whitespace-nowrap">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVehicles.length === 0 ? (
                      <EmptyRow colSpan={15} text="暂无车辆数据" />
                    ) : (
                      filteredVehicles.map((v) => (
                        <tr
                          key={v.id}
                          className="border-b border-gray-100 hover:bg-blue-50/50 cursor-pointer transition-colors"
                          onClick={() => handleRowClick(v)}
                        >
                          <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-800">{v.plateNo}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600">{v.vehicleType || '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${v.energyType === 'electric' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                              {v.energyType === 'electric' ? '电车' : '油车'}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-500">{v.vin || v.frameNo || '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600">{v.licenseNo || '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-gray-600">{v.totalMileage != null ? `${Number(v.totalMileage).toLocaleString('zh-CN', { useGrouping: false })}` : '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-gray-600">{v.fuelConsumption != null ? Number(v.fuelConsumption) : '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(v.purchaseDate)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-center"><StatusBadge status={v.status} /></td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600">{orgList.find(o => o.id === v.orgId)?.name || '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap"><ExpiryCell date={v.insuranceExpiryDate} /></td>
                          <td className="px-4 py-3 whitespace-nowrap"><ExpiryCell date={v.inspectionExpiryDate} /></td>
                          <td className="px-4 py-3 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-1">
                              {v.inspectionPhotoPath && (
                                <a href={v.inspectionPhotoPath} target="_blank" rel="noopener noreferrer" title="查看年检照片" className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors">
                                  <ImageIcon size={15} />
                                </a>
                              )}
                              {v.insuranceFilePath && (
                                <a href={v.insuranceFilePath} target="_blank" rel="noopener noreferrer" title="查看保险资料" className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors">
                                  <FileCheck size={15} />
                                </a>
                              )}
                              {!v.inspectionPhotoPath && !v.insuranceFilePath && <span className="text-gray-300 text-xs">-</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openVehicleModal(v);
                                }}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                title="编辑"
                              >
                                <Edit size={16} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleVehicleDelete(v);
                                }}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                                title="删除"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-3 text-sm text-gray-500 border-t border-gray-100">
              共 {filteredVehicles.length} 辆车
            </div>
          </div>
        )}

        {/* ===================== Tab 2: 运维记录 ===================== */}
        {activeTab === 'maintenance' && (
          <div>
            <VehicleSelector label="选择车辆" />
            {selectedVehicleId ? (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div className="bg-white rounded-xl shadow-sm p-4">
                    <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                      <Fuel size={16} /> 加油费用合计
                    </div>
                    <p className="text-2xl font-bold text-orange-600">{formatCurrency(fuelCost)}</p>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm p-4">
                    <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                      <Wrench size={16} /> 维修保养费用
                    </div>
                    <p className="text-2xl font-bold text-blue-600">{formatCurrency(maintenanceCost)}</p>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm p-4">
                    <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                      <Wallet size={16} /> 费用总计
                    </div>
                    <p className="text-2xl font-bold text-gray-800">{formatCurrency(totalMaintenanceAmount)}</p>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm">
                  <div className="p-4 flex items-center justify-between border-b border-gray-100">
                    <h3 className="font-medium text-gray-700">运维记录</h3>
                    <button
                      onClick={openMaintenanceModal}
                      className="flex items-center gap-1 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
                    >
                      <Plus size={16} />
                      新增维保记录
                    </button>
                  </div>
                  {maintenanceLoading ? (
                    <Spinner text="加载维保记录..." />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">维保类型</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">维保日期</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600 whitespace-nowrap">金额</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600 whitespace-nowrap">加油量(升)</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600 whitespace-nowrap">里程(公里)</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">供应商</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">备注</th>
                          </tr>
                        </thead>
                        <tbody>
                          {maintenanceRecords.length === 0 ? (
                            <EmptyRow colSpan={7} text="该车辆暂无维保记录" />
                          ) : (
                            maintenanceRecords.map((r) => (
                              <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                                    {MAINTENANCE_TYPE_MAP[r.maintenanceType] || r.maintenanceType}
                                  </span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(r.maintenanceDate)}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-right text-gray-700">{formatCurrency(r.amount)}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-right text-gray-500">{Number(r.fuelLiters) ? r.fuelLiters : '-'}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-right text-gray-500">{Number(r.mileage) ? r.mileage : '-'}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-gray-600">{r.supplier || '-'}</td>
                                <td className="px-4 py-3 text-gray-500 max-w-xs truncate" title={r.remark || ''}>{r.remark || '-'}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400">
                请先在上方选择车辆
              </div>
            )}
          </div>
        )}

        {/* ===================== Tab 3: 违章事故 ===================== */}
        {activeTab === 'violations' && (
          <div>
            <VehicleSelector label="选择车辆" />
            {selectedVehicleId ? (
              <div className="bg-white rounded-xl shadow-sm">
                <div className="p-4 flex items-center justify-between border-b border-gray-100">
                  <h3 className="font-medium text-gray-700">违章 / 事故记录</h3>
                  <button
                    onClick={openViolationModal}
                    className="flex items-center gap-1 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    <Plus size={16} />
                    新增违章/事故
                  </button>
                </div>
                {violationsLoading ? (
                  <Spinner text="加载违章记录..." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="px-4 py-3 text-center font-medium text-gray-600 whitespace-nowrap">类型</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">日期</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">地点</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">描述</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-600 whitespace-nowrap">罚款金额</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-600 whitespace-nowrap">扣分</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">责任人</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">处理结果</th>
                          <th className="px-4 py-3 text-center font-medium text-gray-600 whitespace-nowrap">状态</th>
                          <th className="px-4 py-3 text-center font-medium text-gray-600 whitespace-nowrap">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {violations.length === 0 ? (
                          <EmptyRow colSpan={10} text="该车辆暂无违章/事故记录" />
                        ) : (
                          violations.map((v) => (
                            <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="px-4 py-3 whitespace-nowrap text-center">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                    v.violationType === 'accident'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-orange-100 text-orange-700'
                                  }`}
                                >
                                  {VIOLATION_TYPE_MAP[v.violationType] || v.violationType}
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(v.violationDate)}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-gray-600">{v.location || '-'}</td>
                              <td className="px-4 py-3 text-gray-500 max-w-xs truncate" title={v.description || ''}>{v.description || '-'}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-right text-gray-700">{formatCurrency(v.penaltyAmount)}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-right text-gray-600">{v.demeritPoints ? `${v.demeritPoints} 分` : '-'}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-gray-600">{v.responsibleParty || '-'}</td>
                              <td className="px-4 py-3 text-gray-500 max-w-xs truncate" title={v.handlingResult || ''}>{v.handlingResult || '-'}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-center">
                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${VIOLATION_STATUS_STYLE[v.status] || 'bg-gray-100 text-gray-600'}`}>
                                  {VIOLATION_STATUS_MAP[v.status] || v.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-center">
                                {(v.status === 'unprocessed' || v.status === 'processing') && (
                                  <button
                                    onClick={() => openViolationEditModal(v)}
                                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                    title="更新处理状态"
                                  >
                                    <Edit size={16} />
                                  </button>
                                )}
                                {v.status === 'processed' && (
                                  <CheckCircle2 size={16} className="text-green-500 mx-auto" />
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400">
                请先在上方选择车辆
              </div>
            )}
          </div>
        )}

        {/* ===================== Tab 4: 到期提醒 ===================== */}
        {activeTab === 'reminders' && (
          <div className="bg-white rounded-xl shadow-sm">
            <div className="p-4 flex items-center gap-2 border-b border-gray-100">
              <CalendarClock className="text-orange-500" size={20} />
              <div>
                <h3 className="font-medium text-gray-700">到期提醒</h3>
                <p className="text-xs text-gray-400 mt-0.5">展示 30 天内即将到期或已过期的车辆</p>
              </div>
            </div>
            {remindersLoading ? (
              <Spinner text="加载到期提醒..." />
            ) : reminders.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
                <p>暂无到期提醒，所有在用车辆证件均在有效期内</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">车牌号</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">车型</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">行驶证号</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">归属组织</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">保险到期</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">年检到期</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">保养到期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reminders.map((r) => (
                      <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-800">{r.plateNo}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{r.vehicleType || '-'}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{r.licenseNo || '-'}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{orgList.find(o => o.id === r.orgId)?.name || '-'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {r.insuranceWarning ? <WarningBadge date={r.insuranceExpiryDate} /> : <span className="text-gray-400 text-xs">{formatDate(r.insuranceExpiryDate)}</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {r.inspectionWarning ? <WarningBadge date={r.inspectionExpiryDate} /> : <span className="text-gray-400 text-xs">{formatDate(r.inspectionExpiryDate)}</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {r.maintenanceWarning ? <WarningBadge date={r.maintenanceExpiryDate} /> : <span className="text-gray-400 text-xs">{formatDate(r.maintenanceExpiryDate)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {reminders.length > 0 && (
              <div className="px-4 py-3 text-sm text-gray-500 border-t border-gray-100">
                共 {reminders.length} 辆车有到期提醒
              </div>
            )}
          </div>
        )}

        {/* ===================== Tab 5: 费用台账 ===================== */}
        {activeTab === 'cost' && (
          <div>
            <VehicleSelector label="选择车辆" />
            {selectedVehicleId ? (
              <div className="bg-white rounded-xl shadow-sm">
                <div className="p-4 flex items-center justify-between border-b border-gray-100">
                  <h3 className="font-medium text-gray-700">费用台账</h3>
                  <button
                    onClick={handleExportCostLedger}
                    className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Download size={16} />
                    导出费用台账
                  </button>
                </div>
                {costLedgerLoading ? (
                  <Spinner text="加载费用台账..." />
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">维保类型</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">维保日期</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600 whitespace-nowrap">金额</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600 whitespace-nowrap">加油量(升)</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600 whitespace-nowrap">里程(公里)</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">供应商</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">备注</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">车牌号</th>
                          </tr>
                        </thead>
                        <tbody>
                          {costLedger.length === 0 ? (
                            <EmptyRow colSpan={8} text="该车辆暂无费用记录" />
                          ) : (
                            costLedger.map((item) => (
                              <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                                    {MAINTENANCE_TYPE_MAP[item.maintenanceType] || item.maintenanceType}
                                  </span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(item.maintenanceDate)}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-right text-gray-700">{formatCurrency(item.amount)}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-right text-gray-500">{Number(item.fuelLiters) ? item.fuelLiters : '-'}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-right text-gray-500">{Number(item.mileage) ? item.mileage : '-'}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-gray-600">{item.supplier || '-'}</td>
                                <td className="px-4 py-3 text-gray-500 max-w-xs truncate" title={item.remark || ''}>{item.remark || '-'}</td>
                                <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-700">{item.plateNo || '-'}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Summary at bottom */}
                    <div className="p-4 border-t border-gray-100 bg-gray-50">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="flex items-center gap-2">
                          <Wallet size={18} className="text-gray-400" />
                          <div>
                            <p className="text-xs text-gray-500">费用总计</p>
                            <p className="text-lg font-bold text-gray-800">{formatCurrency(totalCostAmount)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Fuel size={18} className="text-gray-400" />
                          <div>
                            <p className="text-xs text-gray-500">加油量合计</p>
                            <p className="text-lg font-bold text-orange-600">{totalFuelLiters.toLocaleString('zh-CN', { useGrouping: false })} 升</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <FileText size={18} className="text-gray-400" />
                          <div>
                            <p className="text-xs text-gray-500">里程合计</p>
                            <p className="text-lg font-bold text-blue-600">{totalMileage.toLocaleString('zh-CN', { useGrouping: false })} 公里</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400">
                请先在上方选择车辆
              </div>
            )}
          </div>
        )}

        {/* ===================== Modals ===================== */}

        {/* Vehicle create/edit modal */}
        {vehicleModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-xl">
                <h3 className="text-lg font-bold text-gray-800">
                  {editingVehicle ? '编辑车辆' : '新增车辆'}
                </h3>
                <button
                  onClick={() => setVehicleModalOpen(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="车牌号" required>
                  <input
                    type="text"
                    value={vehicleForm.plateNo}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, plateNo: e.target.value })}
                    className={inputClass}
                    placeholder="如：粤B12345"
                  />
                </FormField>
                <FormField label="车型">
                  <input
                    type="text"
                    value={vehicleForm.vehicleType}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, vehicleType: e.target.value })}
                    className={inputClass}
                    placeholder="如：五菱宏光S"
                  />
                </FormField>
                <FormField label="能源类型" required>
                  <select
                    value={vehicleForm.energyType}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, energyType: e.target.value })}
                    className={inputClass}
                  >
                    <option value="fuel">油车</option>
                    <option value="electric">电车</option>
                  </select>
                </FormField>
                <FormField label="车架号(VIN)" required>
                  <input
                    type="text"
                    value={vehicleForm.vin}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, vin: e.target.value })}
                    className={inputClass}
                    placeholder="VIN码（必填）"
                  />
                </FormField>
                <FormField label="行驶证号" required>
                  <input
                    type="text"
                    value={vehicleForm.licenseNo}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, licenseNo: e.target.value })}
                    className={inputClass}
                    placeholder="行驶证号码（必填）"
                  />
                </FormField>
                <FormField label="总行驶公里数(期初)">
                  <input
                    type="number"
                    step="0.1"
                    value={vehicleForm.totalMileage}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, totalMileage: e.target.value })}
                    className={inputClass}
                    placeholder="建档时当前总里程"
                  />
                </FormField>
                <FormField label="百公里油耗(L/100km)">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={vehicleForm.fuelConsumption}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, fuelConsumption: e.target.value })}
                    className={inputClass}
                    placeholder="如：8（派车时估算续航用）"
                  />
                </FormField>
                <FormField label="状态" required>
                  <select
                    value={vehicleForm.status}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, status: e.target.value })}
                    className={inputClass}
                  >
                    {VEHICLE_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="购置时间">
                  <input
                    type="date"
                    value={vehicleForm.purchaseDate}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, purchaseDate: e.target.value })}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="归属组织（第一层）">
                  <select
                    value={orgLevel1}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : '';
                      setOrgLevel1(val);
                      setOrgLevel2('');
                    }}
                    className={inputClass}
                  >
                    <option value="">请选择</option>
                    {orgList.filter((o) => o.level === 1).map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="归属组织（第二层）">
                  <select
                    value={orgLevel2}
                    onChange={(e) => setOrgLevel2(e.target.value ? Number(e.target.value) : '')}
                    className={inputClass}
                    disabled={!orgLevel1}
                  >
                    <option value="">{orgLevel1 ? '请选择（可不选）' : '请先选择第一层'}</option>
                    {orgList.filter((o) => o.level === 2 && o.parentId === orgLevel1).map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="保险到期日">
                  <input
                    type="date"
                    value={vehicleForm.insuranceExpiryDate}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, insuranceExpiryDate: e.target.value })}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="年检到期日">
                  <input
                    type="date"
                    value={vehicleForm.inspectionExpiryDate}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, inspectionExpiryDate: e.target.value })}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="保养到期日">
                  <input
                    type="date"
                    value={vehicleForm.maintenanceExpiryDate}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, maintenanceExpiryDate: e.target.value })}
                    className={inputClass}
                  />
                </FormField>
                <div className="sm:col-span-2">
                  <FormField label="备注">
                    <textarea
                      value={vehicleForm.remark}
                      onChange={(e) => setVehicleForm({ ...vehicleForm, remark: e.target.value })}
                      className={`${inputClass} min-h-[80px] resize-y`}
                      placeholder="车辆备注信息"
                    />
                  </FormField>
                </div>
                {/* 文件上传区域：年检照片 + 保险PDF */}
                {editingVehicle && (
                  <div className="sm:col-span-2 border-t border-gray-100 pt-3">
                    <p className="text-sm font-medium text-gray-700 mb-2">附件资料</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* 年检照片 */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">年检照片</label>
                        {vehicleForm.inspectionPhotoPath ? (
                          <div className="flex items-center gap-2">
                            <a href={vehicleForm.inspectionPhotoPath} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-green-600 hover:underline">
                              <ImageIcon size={16} /> 查看照片
                            </a>
                            <label className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded cursor-pointer transition-colors">
                              <Upload size={14} /> 更换
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleFileUpload(editingVehicle.id, f, 'inspection');
                                }}
                              />
                            </label>
                          </div>
                        ) : (
                          <label className="flex items-center gap-1 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:bg-gray-50 cursor-pointer transition-colors w-fit">
                            <Upload size={16} /> 上传年检照片
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleFileUpload(editingVehicle.id, f, 'inspection');
                              }}
                            />
                          </label>
                        )}
                      </div>
                      {/* 保险PDF/照片 */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">保险资料(PDF/照片)</label>
                        {vehicleForm.insuranceFilePath ? (
                          <div className="flex items-center gap-2">
                            <a href={vehicleForm.insuranceFilePath} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-blue-600 hover:underline">
                              <FileCheck size={16} /> 查看资料
                            </a>
                            <label className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded cursor-pointer transition-colors">
                              <Upload size={14} /> 更换
                              <input
                                type="file"
                                accept=".pdf,image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleFileUpload(editingVehicle.id, f, 'insurance');
                                }}
                              />
                            </label>
                          </div>
                        ) : (
                          <label className="flex items-center gap-1 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:bg-gray-50 cursor-pointer transition-colors w-fit">
                            <Upload size={16} /> 上传保险资料
                            <input
                              type="file"
                              accept=".pdf,image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleFileUpload(editingVehicle.id, f, 'insurance');
                              }}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 sticky bottom-0 bg-white rounded-b-xl">
                <button
                  onClick={() => setVehicleModalOpen(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleVehicleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-1 px-6 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {editingVehicle ? '保存' : '新增'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Maintenance create modal */}
        {maintenanceModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-xl">
                <h3 className="text-lg font-bold text-gray-800">新增维保记录</h3>
                <button
                  onClick={() => setMaintenanceModalOpen(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="维保类型" required>
                  <select
                    value={maintenanceForm.maintenanceType}
                    onChange={(e) =>
                      setMaintenanceForm({ ...maintenanceForm, maintenanceType: e.target.value })
                    }
                    className={inputClass}
                  >
                    {MAINTENANCE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="维保日期" required>
                  <input
                    type="date"
                    value={maintenanceForm.maintenanceDate}
                    onChange={(e) =>
                      setMaintenanceForm({ ...maintenanceForm, maintenanceDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </FormField>
                <FormField label="金额">
                  <input
                    type="number"
                    step="0.01"
                    value={maintenanceForm.amount}
                    onChange={(e) =>
                      setMaintenanceForm({ ...maintenanceForm, amount: e.target.value })
                    }
                    className={inputClass}
                    placeholder="0.00"
                  />
                </FormField>
                {maintenanceForm.maintenanceType === 'fuel' ? (
                  <FormField label="加油量(升)">
                    <input
                      type="number"
                      step="0.01"
                      value={maintenanceForm.fuelLiters}
                      onChange={(e) =>
                        setMaintenanceForm({ ...maintenanceForm, fuelLiters: e.target.value })
                      }
                      className={inputClass}
                      placeholder="0.00"
                    />
                  </FormField>
                ) : (
                  <div />
                )}
                <FormField label="里程(公里)">
                  <input
                    type="number"
                    step="0.1"
                    value={maintenanceForm.mileage}
                    onChange={(e) =>
                      setMaintenanceForm({ ...maintenanceForm, mileage: e.target.value })
                    }
                    className={inputClass}
                    placeholder="0.0"
                  />
                </FormField>
                <FormField label="供应商">
                  <input
                    type="text"
                    value={maintenanceForm.supplier}
                    onChange={(e) =>
                      setMaintenanceForm({ ...maintenanceForm, supplier: e.target.value })
                    }
                    className={inputClass}
                    placeholder="加油站 / 维修店"
                  />
                </FormField>
                <div className="sm:col-span-2">
                  <FormField label="备注">
                    <textarea
                      value={maintenanceForm.remark}
                      onChange={(e) =>
                        setMaintenanceForm({ ...maintenanceForm, remark: e.target.value })
                      }
                      className={`${inputClass} min-h-[80px] resize-y`}
                      placeholder="备注信息"
                    />
                  </FormField>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 sticky bottom-0 bg-white rounded-b-xl">
                <button
                  onClick={() => setMaintenanceModalOpen(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleMaintenanceSubmit}
                  disabled={submitting}
                  className="flex items-center gap-1 px-6 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  确认新增
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Violation create modal */}
        {violationModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-xl">
                <h3 className="text-lg font-bold text-gray-800">新增违章 / 事故</h3>
                <button
                  onClick={() => setViolationModalOpen(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="类型" required>
                  <select
                    value={violationForm.violationType}
                    onChange={(e) =>
                      setViolationForm({ ...violationForm, violationType: e.target.value })
                    }
                    className={inputClass}
                  >
                    {VIOLATION_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="日期" required>
                  <input
                    type="date"
                    value={violationForm.violationDate}
                    onChange={(e) =>
                      setViolationForm({ ...violationForm, violationDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </FormField>
                <div className="sm:col-span-2">
                  <FormField label="地点">
                    <input
                      type="text"
                      value={violationForm.location}
                      onChange={(e) =>
                        setViolationForm({ ...violationForm, location: e.target.value })
                      }
                      className={inputClass}
                      placeholder="违章/事故发生地点"
                    />
                  </FormField>
                </div>
                <div className="sm:col-span-2">
                  <FormField label="描述">
                    <textarea
                      value={violationForm.description}
                      onChange={(e) =>
                        setViolationForm({ ...violationForm, description: e.target.value })
                      }
                      className={`${inputClass} min-h-[80px] resize-y`}
                      placeholder="违章/事故详细描述"
                    />
                  </FormField>
                </div>
                <FormField label="罚款金额">
                  <input
                    type="number"
                    step="0.01"
                    value={violationForm.penaltyAmount}
                    onChange={(e) =>
                      setViolationForm({ ...violationForm, penaltyAmount: e.target.value })
                    }
                    className={inputClass}
                    placeholder="0.00"
                  />
                </FormField>
                <FormField label="扣分">
                  <input
                    type="number"
                    step="1"
                    value={violationForm.demeritPoints}
                    onChange={(e) =>
                      setViolationForm({ ...violationForm, demeritPoints: e.target.value })
                    }
                    className={inputClass}
                    placeholder="0"
                  />
                </FormField>
                <div className="sm:col-span-2">
                  <FormField label="责任人">
                    <input
                      type="text"
                      value={violationForm.responsibleParty}
                      onChange={(e) =>
                        setViolationForm({ ...violationForm, responsibleParty: e.target.value })
                      }
                      className={inputClass}
                      placeholder="责任人姓名"
                    />
                  </FormField>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 sticky bottom-0 bg-white rounded-b-xl">
                <button
                  onClick={() => setViolationModalOpen(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleViolationSubmit}
                  disabled={submitting}
                  className="flex items-center gap-1 px-6 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  确认新增
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Violation edit modal */}
        {violationEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h3 className="text-lg font-bold text-gray-800">更新处理状态</h3>
                <button
                  onClick={() => setViolationEditModalOpen(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <FormField label="处理状态" required>
                  <select
                    value={violationEditForm.status}
                    onChange={(e) =>
                      setViolationEditForm({ ...violationEditForm, status: e.target.value })
                    }
                    className={inputClass}
                  >
                    <option value="unprocessed">未处理</option>
                    <option value="processing">处理中</option>
                    <option value="processed">已处理</option>
                  </select>
                </FormField>
                <FormField label="处理结果">
                  <textarea
                    value={violationEditForm.handlingResult}
                    onChange={(e) =>
                      setViolationEditForm({ ...violationEditForm, handlingResult: e.target.value })
                    }
                    className={`${inputClass} min-h-[100px] resize-y`}
                    placeholder="填写处理结果说明"
                  />
                </FormField>
              </div>
              <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200">
                <button
                  onClick={() => setViolationEditModalOpen(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleViolationEditSubmit}
                  disabled={submitting}
                  className="flex items-center gap-1 px-6 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default VehicleManagePage;
