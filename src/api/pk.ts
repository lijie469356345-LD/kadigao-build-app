import axios from './axios';

// ============================================================
// PK管理 API 客户端
// ============================================================

// ---------- PK任务单 ----------
export interface PkTaskOrder {
  id: number;
  orderName: string;
  docDate: string;
  pkStartDate: string;
  pkEndDate: string;
  remark: string;
  /** 店铺目标维度列模板（如 ["维度一","维度二","维度三","维度四","维度五"]） */
  dimColumns: string[];
  createdBy: string;
  createdAt: string;
  targetCount: number;
  dimCount: number;
}

export const getPkTaskOrders = () => axios.get('/pk/task-orders');
export const createPkTaskOrder = (data: {
  orderName: string;
  docDate?: string;
  pkStartDate?: string;
  pkEndDate?: string;
  remark?: string;
  dimColumns?: string[];
}) => axios.post('/pk/task-orders', data);
export const updatePkTaskOrder = (id: number, data: {
  orderName?: string;
  docDate?: string;
  pkStartDate?: string;
  pkEndDate?: string;
  remark?: string;
  dimColumns?: string[];
}) => axios.put(`/pk/task-orders/${id}`, data);
export const deletePkTaskOrder = (id: number) => axios.delete(`/pk/task-orders/${id}`);

// ---------- PK维度设定 ----------
/** PK组别：组名 + 从该维度聚合值中勾选的值 + 每个值的PK颜色（值→hex，可选） */
export interface PkDimensionGroup {
  groupName: string;
  values: string[];
  colorMap?: Record<string, string>;
}
export interface PkDimension {
  id: number;
  dimName: string;
  /** 用户自定义的报表展示名称（PK报表赛区标题居中放大显示；空则回退 dimName） */
  displayName?: string;
  values: string[];
  /** 用户自定义 PK组别（[{ groupName, values }]），报表按组别展示 */
  groups: PkDimensionGroup[];
  sortOrder: number;
  taskOrderId?: number | null;
}

export const getPkDimensions = (params?: { taskOrderId?: number }) => axios.get('/pk/dimensions', { params });
export const createPkDimension = (data: { dimName?: string; displayName?: string; values?: string[]; groups?: PkDimensionGroup[]; taskOrderId?: number }) =>
  axios.post('/pk/dimensions', data);
export const updatePkDimension = (id: number, data: { dimName?: string; displayName?: string; values?: string[]; groups?: PkDimensionGroup[]; sortOrder?: number }) =>
  axios.put(`/pk/dimensions/${id}`, data);
export const deletePkDimension = (id: number) => axios.delete(`/pk/dimensions/${id}`);
/** 维度确认（店铺目标 → 维度设定）：先清后插，覆盖该任务单参与PK的维度及组别 */
export const confirmPkDimensions = (data: {
  taskOrderId: number;
  dims: { dimName: string; displayName?: string; groups: PkDimensionGroup[] }[];
}) => axios.post('/pk/dimensions/confirm', data);
/** 导出当前任务单 PK维度组别为 xlsx（浏览器下载） */
export const exportPkDimensions = (params: { taskOrderId: number }) =>
  axios.get('/pk/dimensions/export', { params, responseType: 'blob' });
/** 导入 xlsx 覆盖当前任务单 PK维度组别（全量覆盖，返回 { ok, saved, dims, warnings, covered }） */
export const importPkDimensions = (taskOrderId: number, file: File) => {
  const form = new FormData();
  form.append('taskOrderId', String(taskOrderId));
  form.append('file', file);
  return axios.post('/pk/dimensions/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

// ---------- PK店铺目标 ----------
export interface PkTargetRow {
  id?: number;
  pkName: string;
  pkStartTime: string;
  shopName: string;
  target: number;
  heroMark?: string;
  dims: { name: string; value: string }[];
  taskOrderId?: number | null;
}

export const getPkTargets = (params?: { taskOrderId?: number; pkName?: string }) =>
  axios.get('/pk/targets', { params });
export const getPkNames = (params?: { taskOrderId?: number }) => axios.get('/pk/targets/pk-names', { params });
export const createPkTarget = (data: PkTargetRow) => axios.post('/pk/targets', data);
export const updatePkTarget = (id: number, data: PkTargetRow) => axios.put(`/pk/targets/${id}`, data);
export const deletePkTarget = (id: number) => axios.delete(`/pk/targets/${id}`);
/** 清空店铺目标：传 taskOrderId 仅清空该任务单，不传则清空全部 */
export const clearPkTargets = (params?: { taskOrderId?: number }) =>
  axios.delete('/pk/targets/clear', { params });

// ---------- PK报表 ----------
/** 组内单个值的达成明细（组内值对决/各值达成率展示用） */
export interface PkReportValueDetail {
  value: string;
  target: number;
  actual: number;
  rate: number;
  shops: number;
}
export interface PkReportGroup {
  groupName: string;
  values: string[];
  /** 值的PK颜色（值→hex，报表按此渲染；旧数据无颜色时降级红蓝绿循环） */
  colorMap?: Record<string, string>;
  target: number;
  actual: number;
  rate: number;
  shops: number;
  /** 组内各值达成明细（值对决用） */
  valuesDetail: PkReportValueDetail[];
  /** 组内胜出值（达成率最高者；无业绩时为空） */
  valueWinner: string;
}
export interface PkReportDim {
  dimName: string;
  /** 用户自定义报表展示名称（赛区标题居中放大展示；空则回退 dimName） */
  displayName?: string;
  groups: PkReportGroup[];
  winner: string;
}
export interface PkReportResult {
  pkName: string;
  startDate: string;
  endDate: string;
  storeCount: number;
  dims: PkReportDim[];
  /** PK 尚未开始 → true（「业绩统计至」为昨日，页面展示模拟数据）；开始后 false（真实业绩） */
  isMock?: boolean;
  /** 任务单 PK 开始时间 YYYY-MM-DD */
  pkStartDate?: string;
  /** 任务单 PK 结束时间 YYYY-MM-DD（未设置时为空） */
  pkEndDate?: string;
  /** 状态说明文案（PK 尚未开始 / PK 已结束等） */
  statusText?: string;
  /** 是否为组织视角过滤（true=仅当前用户相关组；false=管理员看全量） */
  scoped?: boolean;
  /** 组织视角过滤：当前用户关联的店铺名 */
  scopeShops?: string[];
  /** 组织视角过滤：当前用户在各维度的取值（如冠军军团/商品值班人等） */
  scopeValues?: string[];
}

export const getPkReport = (params: { taskOrderId?: number; pkName?: string; endDate?: string }) =>
  axios.get('/pk/report', { params });

/** 导出 PK报表为 xlsx（浏览器下载，与页面展示同参数同口径） */
export const exportPkReport = (params: { taskOrderId?: number; pkName?: string; endDate?: string }) =>
  axios.get('/pk/report/export', { params, responseType: 'blob' });

// ---------- PK 范围筛选（全部/本区/本店/仓库/经销商/督导/区经/店铺） ----------
export interface PkScopeFilterParam { scope: string; value: string }
export interface PkScopeMeta {
  warehouses: string[];
  dealers: string[];
  /** 督导列表（可见∩任务单店铺） */
  supervisors: string[];
  /** 区经列表（可见∩任务单店铺） */
  districtManagers: string[];
  /** 店铺名称候选（可见∩任务单店铺） */
  shops: string[];
  /** 「本区」可用时返回当前登录用户名称（命中店仓全.区经），否则为空字符串 */
  areaName: string;
  areaShopCount: number;
  myShopCount: number;
  /** 「本店」：当前登录用户绑定组织在 org_shop_bind 中直接绑定的店铺 */
  myShops: string[];
  scopeShopCount: number;
}
export const getPkScopeMeta = (params: { taskOrderId?: number }) =>
  axios.get('/pk/scope-meta', { params });

// ---------- PK数据表 ----------
/** 第一区 直营/加盟 业绩达成（按仓库类别聚合） */
export interface PkDataZone1Row {
  warehouseType: string;
  target: number;
  actual: number;
  rate: number;
  /** 英雄标（PK_StoreTargets.heroMark 聚合求和；未设置/非数字视为 0） */
  heroMark?: number;
  /** 英雄达成率 = 实际业绩 / 英雄标；未参与英雄招募（英雄标=0）时为 null */
  heroAchieveRate?: number | null;
  shops: number;
}
/** 第二区 督导 业绩达成（按仓库类别+区经+督导聚合） */
export interface PkDataZone2Row {
  warehouseType: string;
  districtManager: string;
  supervisor: string;
  target: number;
  actual: number;
  rate: number;
  heroMark?: number;
  heroAchieveRate?: number | null;
  shops: number;
}
/** 第三区 商品 业绩达成（按仓库类别+商品聚合） */
export interface PkDataZoneProductRow {
  warehouseType: string;
  product: string;
  target: number;
  actual: number;
  rate: number;
  heroMark?: number;
  heroAchieveRate?: number | null;
  shops: number;
}
/** 第四区 经销商 业绩达成（按仓库类别+督导+经销商聚合） */
export interface PkDataZone3Row {
  warehouseType: string;
  supervisor: string;
  dealer: string;
  target: number;
  actual: number;
  rate: number;
  heroMark?: number;
  heroAchieveRate?: number | null;
  shops: number;
}
/** 第五区 门店 业绩达成（按仓库类别+区经+督导+店铺名称） */
export interface PkDataZone4Row {
  warehouseType: string;
  districtManager: string;
  supervisor: string;
  shopName: string;
  target: number;
  actual: number;
  rate: number;
  /** 英雄标（PK_StoreTargets.heroMark，数值化；未设置/非数字视为 0） */
  heroMark?: number;
  /** 英雄达成率 = 实际业绩 / 英雄标；未参与英雄招募（英雄标=0）时为 null */
  heroAchieveRate?: number | null;
}
/**
 * 七维筛选（仓库类别/督导/区经/经销商/店铺名称/月可比/年可比）
 * 五维字段：单选页面传 string；多选页面（PK数据表）传 string[]。
 */
export interface PkDataDimFilter {
  warehouse: string | string[];
  supervisor: string | string[];
  districtManager: string | string[];
  dealer: string | string[];
  shopName: string | string[];
  /** 月可比性候选（多选：可比/不可比等） */
  monthComparables?: string[];
  /** 年可比性候选（多选：可比/不可比等） */
  yearComparables?: string[];
}
export interface PkDataTableResult {
  pkName: string;
  startDate: string;
  endDate: string;
  isMock?: boolean;
  pkStartDate?: string;
  pkEndDate?: string;
  statusText?: string;
  storeCount: number;
  scoped?: boolean;
  scopeShops?: string[];
  /** 当前生效的范围筛选（服务端过滤） */
  filter?: PkScopeFilterParam;
/** 当前生效的五维筛选（服务端过滤） */
  dimFilter?: PkDataDimFilter;
  /** 月可比/年可比 候选值（当前可见店铺去重） */
  comparableOptions?: { month: string[]; year: string[] };
  zone1: PkDataZone1Row[];
  zone2: PkDataZone2Row[];
  zone3: PkDataZoneProductRow[];
  zone4: PkDataZone3Row[];
  zone5: PkDataZone4Row[];
}

export const getPkDataTable = (params: {
  taskOrderId?: number; pkName?: string; startDate?: string; endDate?: string; filter?: string;
  warehouse?: string; supervisor?: string; districtManager?: string; dealer?: string; shopName?: string;
  /** 月可比性（逗号分隔多选） */
  monthComparable?: string;
  /** 年可比性（逗号分隔多选） */
  yearComparable?: string;
  /** 是否参与英雄招募：yes=英雄标≠0；no=英雄标=0；不传=不限 */
  announced?: string;
}) =>
  axios.get('/pk/data-table', { params });

// ---------- PK日目标上传 ----------
export interface PkDailyTargetRow {
  id: number;
  targetDate: string;
  supervisor: string;
  shopName: string;
  dailyTarget: number;
}
/** 日目标列表响应（v3：包装为 { rows, filter, dimFilter }，服务端支持范围筛选 + 五维筛选） */
export interface PkDailyTargetListResult {
  rows: PkDailyTargetRow[];
  filter?: PkScopeFilterParam;
  /** 当前生效的五维筛选（服务端过滤） */
  dimFilter?: PkDataDimFilter;
}

export const getPkDailyTargets = (params: {
  taskOrderId?: number; targetDate?: string; filter?: string;
  warehouse?: string; supervisor?: string; districtManager?: string; dealer?: string; shopName?: string;
}) =>
  axios.get('/pk/daily-targets', { params });

export const uploadPkDailyTargets = (taskOrderId: number, file: File) => {
  const form = new FormData();
  form.append('taskOrderId', String(taskOrderId));
  form.append('file', file);
  return axios.post('/pk/daily-targets/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const clearPkDailyTargets = (params: { taskOrderId?: number; targetDate?: string }) =>
  axios.delete('/pk/daily-targets/clear', { params });

export const exportPkDailyTargets = (params: { taskOrderId?: number; targetDate?: string }) =>
  axios.get('/pk/daily-targets/export', { params, responseType: 'blob' });

// ---------- PK日目标跟进 ----------
export interface PkDailyRow {
  date: string;
  target: number;
  actual: number;
  rate: number;
}
export interface PkDailyFollowupRow {
  totalTarget: number;
  /** 展示日期序列内的每日 目标/业绩/达成（按 showDates 排列） */
  daily: PkDailyRow[];
  totalActual: number;
  /** 同比 = 业绩金额/同期金额-1（比率，0.05=+5%）；同期金额（去年同期）为 0/缺省时 null */
  yoy: number | null;
  /** 去年同期业绩金额（同比基期，用于合计行派生） */
  lastYearAmt: number;
  totalRate: number;
  salesQty: number;
  orderCount: number;
  attachmentRate: number;
  giftAmount: number;
  giftRatio: number;
  avgItemPrice: number;
  avgOrderValue: number;
  shops: number;
  warehouseType?: string;
  supervisor?: string;
  dealer?: string;
  shopName?: string;
  product?: string;
  // 去年同期指标（往前一年）
  lyTotalActual: number;
  lySalesQty: number;
  lyOrderCount: number;
  lyAttachmentRate: number;
  lyGiftAmount: number;
  lyGiftRatio: number;
  lyAvgItemPrice: number;
  lyAvgOrderValue: number;
  // 「店铺均价_开单数_连带率」台账分子分母（本期/同期）：单店行=该店台账值，汇总行=所属店铺台账累加
  dxAmount: number;
  dxQty: number;
  dxOrder: number;
  lyDxAmount: number;
  lyDxQty: number;
  lyDxOrder: number;
  // 店效（店均业绩）：本期店效/同期店效/店效同比；activeShops/lyActiveShops 为 业绩>0 才计的店铺数（供合计行派生）
  storeSales: number | null;
  lyStoreSales: number | null;
  storeSalesYoy: number | null;
  activeShops: number;
  lyActiveShops: number;
}
export interface PkDailyFollowupResult {
  pkName: string;
  startDate: string;
  endDate: string;
  /** 日期筛选器：总目标/业绩金额/达成率/销售数量/开单数/连带率/礼包/客单价/件单价 的时间范围 */
  dateFrom: string;
  dateTo: string;
  /** 展示日期筛选器：每日 目标/业绩/达成 列的展示范围 */
  showFrom: string;
  showTo: string;
  showDates: string[];
  isMock?: boolean;
  statusText?: string;
  storeCount: number;
  scoped?: boolean;
  scopeShops?: string[];
  /** 当前生效的范围筛选（服务端过滤） */
  filter?: PkScopeFilterParam;
  /** 当前生效的五维筛选（服务端过滤） */
  dimFilter?: PkDataDimFilter;
  /** 月可比/年可比 候选值（当前可见店铺的档案可比性去重） */
  comparableOptions?: { month: string[]; year: string[] };
zone1: (PkDailyFollowupRow & { supervisor: string })[];
  zoneProduct: (PkDailyFollowupRow & { product: string })[];
  zone2: (PkDailyFollowupRow & { dealer: string; product: string; dealerGrade?: string })[];
  zone3: (PkDailyFollowupRow & { supervisor: string; shopName: string; product: string; shopGrade?: string })[];
}

export const getPkDailyFollowup = (params: {
  taskOrderId?: number;
  /** 日期筛选器：区间指标时间范围 */
  dateFrom?: string; dateTo?: string;
  /** 展示日期筛选器：每日列展示范围 */
  showFrom?: string; showTo?: string;
  filter?: string;
  warehouse?: string; supervisor?: string; districtManager?: string; dealer?: string; shopName?: string;
  /** 月可比性（多选，逗号分隔） */
  monthComparable?: string;
  /** 年可比性（多选，逗号分隔） */
  yearComparable?: string;
}) =>
  axios.get('/pk/daily-followup', { params });