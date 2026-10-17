// ============================================================
// 自动补货 - 纯函数计算引擎（无 DB 依赖，可单测）
// 总仓→门店、SKC（商品+颜色+尺码）粒度调拨补货建议
// ============================================================

export const MAIN_SIZES = ['31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46'];

// ==================== 类型定义 ====================

export interface ReplenishParams {
  计划销售天数: number;
  日均销统计天数: number;
  单码最大深度: number;
  总仓留仓比例: number;
  是否节假日放大: boolean;
  节假日前开始?: string;
  节假日前结束?: string;
  节假日后开始?: string;
  节假日后结束?: string;
  新品判定天数: number;
  滞销冻结天数: number;
  本店权重: number;
  区域权重: number;
}

export interface WarehouseRow { 商品代码: string; 颜色名称: string; 颜色代码: string; 尺码代码: string; 可配: number; }
export interface StoreStockRow { 店铺名称: string; 商品代码: string; 颜色名称: string; 颜色代码: string; 性别: string; 尺码代码: string; 现库存: number; 在途数: number; }
export interface SalesRow { 店铺名称: string; 商品代码: string; 颜色名称: string; 颜色代码: string; 性别: string; 尺码代码: string; 销量: number; 最近销售日期: string; }
export interface AreaSalesRow { 小区域: string; 商品代码: string; 颜色名称: string; 性别: string; 尺码代码: string; 区域销量: number; 有销店数: number; }
export interface SizeRatioRow { 店铺名称: string; 性别: string; 尺码代码: string; 销量: number; }
export interface FirstShipRow { 商品代码: string; 颜色名称: string; 首配日期: string; }
export interface StoreArchiveRow {
  店铺名称: string; 店铺代码: string; 店铺等级: string; 区域: string; 大区域: string; 小区域: string;
  最大库存: number; 最大SKU: number; 开业日期?: string; 店铺状态: string; 可用状态: string;
}
export interface HolidayRow { 小区域: string; 商品代码: string; 颜色名称: string; 销量: number; }

export interface EngineInput {
  params: ReplenishParams;
  warehouses: WarehouseRow[];
  storeStock: StoreStockRow[];
  storeSales: SalesRow[];
  areaSales: AreaSalesRow[];
  sizeRatios: SizeRatioRow[];
  firstShip: FirstShipRow[];
  storeArchive: StoreArchiveRow[];
  sizeGroups: Map<string, string[]>;
  holidayBefore: HolidayRow[];
  holidayAfter: HolidayRow[];
  warnings: string[];
}

export interface SizePlan { size: string; 现库存: number; 在途数: number; 可用库存: number; 目标库存: number; 理论补货: number; 实际补货: number; 预测日均: number; 日均销量: number; }

export interface SkuPlan {
  店铺名称: string; 店铺等级: string; 小区域: string; 性别: string;
  商品代码: string; 颜色名称: string; 颜色代码: string; sku: string;
  齐码率: number; 存销比: number; 周转天数: number; 满足率: number;
  是否新品: boolean; 是否滞销: boolean; 是否季末: boolean;
  状态: string;
  sizes: SizePlan[];
}

export interface ComputeSummary {
  涉及店铺数: number;
  涉及款色数: number;
  理论补货总量: number;
  实际补货总量: number;
  总仓消耗: number;
  停补滞销: number;
  停补季末: number;
  停补超铺: number;
  停补冗余: number;
  无库存款色: number;
}

// ==================== 工具函数 ====================

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// 复合键：避免分隔符冲突
const SEP = '\x1f';
export function keyOf(...parts: any[]): string {
  return parts.map(p => (p === null || p === undefined ? '' : String(p))).join(SEP);
}

// 解析尺码组字符串：支持 逗号/顿号/空格/区间(36-42) 混合
export function parseSizeGroup(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const tokens = raw.split(/[,，、\s;；/|]+/).map(t => t.trim()).filter(Boolean);
  const out: string[] = [];
  for (const tk of tokens) {
    const range = tk.match(/^(\d{2,3})\s*[-~至到]\s*(\d{2,3})$/);
    if (range) {
      const [a, b] = [parseInt(range[1]), parseInt(range[2])];
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (let s = lo; s <= hi; s++) out.push(String(s));
    } else if (/^\d{2,3}$/.test(tk)) {
      out.push(tk);
    }
  }
  return Array.from(new Set(out));
}

export function defaultParams(): ReplenishParams {
  return {
    计划销售天数: 7,
    日均销统计天数: 7,
    单码最大深度: 3,
    总仓留仓比例: 0,
    是否节假日放大: false,
    节假日前开始: '', 节假日前结束: '', 节假日后开始: '', 节假日后结束: '',
    新品判定天数: 15,
    滞销冻结天数: 14,
    本店权重: 0.7,
    区域权重: 0.3,
  };
}

// ==================== 数据清洗 ====================

export interface CleanedData {
  storeMap: Map<string, StoreArchiveRow>;
  stockMap: Map<string, { 现库存: number; 在途数: number }>;
  salesMap: Map<string, { 销量: number; 最近销售日期: string }>;
  areaSalesMap: Map<string, { 区域销量: number; 有销店数: number }>;
  sizeRatioMap: Map<string, number>;
  genderRatioMap: Map<string, Map<string, number>>;
  firstShipMap: Map<string, string>;
  warehouseMap: Map<string, number>;
  sizeGroupMap: Map<string, string[]>;
  skuGenderMap: Map<string, string>;
  holidayFactorMap: Map<string, number>;
}

export function cleanData(input: EngineInput): CleanedData {
  const { params } = input;
  const c: CleanedData = {
    storeMap: new Map(),
    stockMap: new Map(),
    salesMap: new Map(),
    areaSalesMap: new Map(),
    sizeRatioMap: new Map(),
    genderRatioMap: new Map(),
    firstShipMap: new Map(),
    warehouseMap: new Map(),
    sizeGroupMap: new Map(),
    skuGenderMap: new Map(),
    holidayFactorMap: new Map(),
  };

  // 店铺档案：仅保留正常营业店铺（可用状态/店铺状态 非闭店装修）
  const badState = (s: string) => /闭店|装修|停业|注销|暂停/.test(s);
  for (const s of input.storeArchive) {
    const state = String(s.店铺状态 || '');
    const avail = String(s.可用状态 || '');
    if (badState(state) || badState(avail)) continue;
    if (s.店铺名称 === '总仓' || /仓库$|大仓|仓储/.test(s.店铺名称)) continue;
    c.storeMap.set(s.店铺名称, { ...s, 店铺等级: String(s.店铺等级 || '').trim() });
  }

  // 门店库存 + 在途
  for (const r of input.storeStock) {
    const k = keyOf(r.店铺名称, r.商品代码, r.颜色名称, r.尺码代码);
    c.stockMap.set(k, { 现库存: num(r.现库存), 在途数: num(r.在途数) });
    if (r.性别 && !c.skuGenderMap.has(keyOf(r.商品代码, r.颜色名称))) {
      c.skuGenderMap.set(keyOf(r.商品代码, r.颜色名称), String(r.性别));
    }
  }

  // 门店销售（尺码粒度 + 最近销售日期）
  for (const r of input.storeSales) {
    const k = keyOf(r.店铺名称, r.商品代码, r.颜色名称, r.尺码代码);
    const prev = c.salesMap.get(k);
    const date = r.最近销售日期;
    c.salesMap.set(k, {
      销量: (prev?.销量 || 0) + num(r.销量),
      最近销售日期: !prev?.最近销售日期 ? date : (prev.最近销售日期 < date ? date : prev.最近销售日期),
    });
    const sku = keyOf(r.商品代码, r.颜色名称);
    if (r.性别 && !c.skuGenderMap.has(sku)) c.skuGenderMap.set(sku, String(r.性别));
  }

  // 区域销售（小区域 + SKC + 尺码）
  for (const r of input.areaSales) {
    const k = keyOf(r.小区域, r.商品代码, r.颜色名称, r.尺码代码);
    c.areaSalesMap.set(k, { 区域销量: num(r.区域销量), 有销店数: Math.max(1, num(r.有销店数)) });
    const sku = keyOf(r.商品代码, r.颜色名称);
    if (r.性别 && !c.skuGenderMap.has(sku)) c.skuGenderMap.set(sku, String(r.性别));
  }

  // 店铺尺码占比（店+性别内）+ 性别尺码占比（跨店）
  const byStoreGender = new Map<string, Map<string, number>>();
  const byGender = new Map<string, Map<string, number>>();
  for (const r of input.sizeRatios) {
    const sg = keyOf(r.店铺名称, r.性别);
    if (!byStoreGender.has(sg)) byStoreGender.set(sg, new Map());
    byStoreGender.get(sg)!.set(r.尺码代码, (byStoreGender.get(sg)!.get(r.尺码代码) || 0) + num(r.销量));
    if (!byGender.has(r.性别)) byGender.set(r.性别, new Map());
    byGender.get(r.性别)!.set(r.尺码代码, (byGender.get(r.性别)!.get(r.尺码代码) || 0) + num(r.销量));
  }
  for (const [sg, m] of byStoreGender) {
    const total = Array.from(m.values()).reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    for (const [size, v] of m) c.sizeRatioMap.set(keyOf(sg, size), v / total);
  }
  for (const [g, m] of byGender) {
    const total = Array.from(m.values()).reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    c.genderRatioMap.set(g, new Map());
    for (const [size, v] of m) c.genderRatioMap.get(g)!.set(size, v / total);
  }

  // 发货上货（新品判定）
  for (const r of input.firstShip) {
    c.firstShipMap.set(keyOf(r.商品代码, r.颜色名称), String(r.首配日期 || ''));
  }

  // 总仓库存（扣除留仓比例）
  const keepRatio = clamp(num(params.总仓留仓比例), 0, 0.9);
  for (const r of input.warehouses) {
    const k = keyOf(r.商品代码, r.颜色名称, r.尺码代码);
    c.warehouseMap.set(k, Math.max(0, Math.round(num(r.可配) * (1 - keepRatio))));
  }

  // 标准尺码组
  for (const [sku, sizes] of input.sizeGroups) {
    const parsed = parseSizeGroup(sizes.join(','));
    if (parsed.length > 0) c.sizeGroupMap.set(sku, parsed);
  }

  // 节假日放大倍数（小区域 + SKC），clamp 0.5~3
  if (params.是否节假日放大) {
    const after = new Map<string, number>();
    for (const r of input.holidayAfter) {
      const k = keyOf(r.小区域, r.商品代码, r.颜色名称);
      after.set(k, (after.get(k) || 0) + num(r.销量));
    }
    const before = new Map<string, number>();
    for (const r of input.holidayBefore) {
      const k = keyOf(r.小区域, r.商品代码, r.颜色名称);
      before.set(k, (before.get(k) || 0) + num(r.销量));
    }
    const allKeys = new Set([...after.keys(), ...before.keys()]);
    for (const k of allKeys) {
      const a = after.get(k) || 0, b = before.get(k) || 0;
      c.holidayFactorMap.set(k, b > 0 ? clamp(a / b, 0.5, 3) : 1);
    }
  }

  return c;
}

// ==================== 基础指标计算 ====================

export interface BaseMetrics {
  // key = store|sku → 款色级指标
  skuMetrics: Map<string, {
    店铺等级: string; 小区域: string; 性别: string;
    SKC日均: number; SKC总库存: number; 齐码率: number; 存销比: number; 周转天数: number; 满足率: number;
    标准尺码数: number; 有库存尺码数: number; 陈列容量: number; 主力码: string;
  }>;
}

export function computeBaseMetrics(c: CleanedData, params: ReplenishParams): BaseMetrics {
  const skuMetrics = new Map<string, any>();
  const statDays = Math.max(1, num(params.日均销统计天数));
  const mainSizeFallback = ['38', '39', '40'];

  // 店铺×SKC 集合
  const storeSkuSet = new Set<string>();
  for (const k of c.salesMap.keys()) {
    const [shop, code, color] = k.split(SEP);
    storeSkuSet.add(keyOf(shop, code, color));
  }
  for (const k of c.stockMap.keys()) {
    const [shop, code, color] = k.split(SEP);
    storeSkuSet.add(keyOf(shop, code, color));
  }

  for (const sk of storeSkuSet) {
    const [shop, code, color] = sk.split(SEP);
    const store = c.storeMap.get(shop);
    if (!store) continue;

    const sku = keyOf(code, color);
    const gender = c.skuGenderMap.get(sku) || '';
    const sizeGroup = c.sizeGroupMap.get(sku) || MAIN_SIZES;
    const sizeGroupSet = new Set(sizeGroup);

    // 款色级汇总
    let 总库存 = 0, 总销量 = 0;
    const 有库存尺码 = new Set<string>();
    for (const size of sizeGroup) {
      const stockK = keyOf(shop, code, color, size);
      const st = c.stockMap.get(stockK);
      if (st && (st.现库存 + st.在途数) > 0) 有库存尺码.add(size);
      const avail = (st?.现库存 || 0) + (st?.在途数 || 0);
      const salesK = keyOf(shop, code, color, size);
      const sale = c.salesMap.get(salesK);
      const qty = sale ? sale.销量 : 0;
      总库存 += avail;
      总销量 += qty;
    }

    const SKC日均 = round1(总销量 / statDays);
    const 齐码率 = sizeGroup.length > 0 ? 有库存尺码.size / sizeGroup.length : 0;
    const 存销比 = SKC日均 > 0 ? round1(总库存 / SKC日均) : (总库存 > 0 ? 999 : 0);
    const 周转天数 = 存销比;
    const 满足率 = 1; // 【DB预留】历史补货履约占位

    // 陈列容量：店仓全.最大库存；0 时回退 单码深度×标准尺码数
    const maxStock = num(store.最大库存);
    const 陈列容量 = maxStock > 0 ? maxStock : (num(params.单码最大深度) * sizeGroup.length);

    // 主力码：店+性别占比最大，缺省 38/39/40
    let 主力码 = mainSizeFallback[0];
    if (gender && c.sizeRatioMap.size > 0) {
      let best = 0, bestSize = '';
      for (const size of sizeGroup) {
        const r = c.sizeRatioMap.get(keyOf(shop, gender, size)) || 0;
        if (r > best) { best = r; bestSize = size; }
      }
      if (bestSize) 主力码 = bestSize;
    }

    skuMetrics.set(sk, {
      店铺等级: store.店铺等级, 小区域: store.小区域, 性别: gender,
      SKC日均, SKC总库存: 总库存, 齐码率, 存销比, 周转天数, 满足率,
      标准尺码数: sizeGroup.length, 有库存尺码数: 有库存尺码.size, 陈列容量, 主力码,
    });
  }

  return { skuMetrics };
}

// ==================== 销量预测（三分支） ====================

export function forecast(c: CleanedData, m: BaseMetrics, params: ReplenishParams): Map<string, number> {
  const statDays = Math.max(1, num(params.日均销统计天数));
  const out = new Map<string, number>(); // key = store|sku|size → 预测日均
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // 区域尺码日均：小区域|sku|size → 日均（区域销量/天数/有销店数）
  const areaSizeDaily = new Map<string, number>();
  for (const [k, v] of c.areaSalesMap) {
    const parts = k.split(SEP);
    const [area, code, color, size] = parts;
    areaSizeDaily.set(keyOf(area, code, color, size), round1(v.区域销量 / statDays / v.有销店数));
  }
  // 区域SKC日均：小区域|sku → 全尺码销量日均
  const areaSkuDaily = new Map<string, number>();
  for (const [k, v] of c.areaSalesMap) {
    const parts = k.split(SEP);
    areaSkuDaily.set(keyOf(parts[0], parts[1], parts[2]), (areaSkuDaily.get(keyOf(parts[0], parts[1], parts[2])) || 0) + round1(v.区域销量 / statDays));
  }
  // 全区域尺码日均（弱店回退）: sku|size → 所有小区域销量总和/天数/总店数
  const globalSizeDaily = new Map<string, number>();
  for (const [k, v] of c.areaSalesMap) {
    const parts = k.split(SEP);
    const sk = keyOf(parts[1], parts[2], parts[3]);
    globalSizeDaily.set(sk, (globalSizeDaily.get(sk) || 0) + v.区域销量);
  }
  // 有销店数：按小区域+店铺等级 统计该尺码有销店铺日均均值
  // 同小区域+同店铺等级：小区域|等级|sku|size → 日均均值
  const areaGradeSizeDaily = new Map<string, number>();
  const areaGradeSizeCount = new Map<string, number>();
  for (const [k, v] of c.salesMap) {
    const parts = k.split(SEP);
    const [shop, code, color, size] = parts;
    const store = c.storeMap.get(shop);
    if (!store) continue;
    const akg = keyOf(store.小区域, store.店铺等级, code, color, size);
    areaGradeSizeDaily.set(akg, (areaGradeSizeDaily.get(akg) || 0) + v.销量);
    areaGradeSizeCount.set(akg, (areaGradeSizeCount.get(akg) || 0) + 1);
  }
  const areaGradeDaily = new Map<string, number>();
  for (const [k, v] of areaGradeSizeDaily) {
    areaGradeDaily.set(k, round1(v / statDays / Math.max(1, areaGradeSizeCount.get(k) || 1)));
  }

  for (const [sk, metric] of m.skuMetrics) {
    const [shop, code, color] = sk.split(SEP);
    const sku = keyOf(code, color);
    const gender = metric.性别;
    const area = metric.小区域;
    const sizeGroup = c.sizeGroupMap.get(sku) || MAIN_SIZES;

    // 该店该SKC的款色日均
    const 本店SKC日均 = metric.SKC日均;
    const 区域SKC日均 = areaSkuDaily.get(keyOf(area, code, color)) || 0;

    // 上市天数判定新品
    const firstDate = c.firstShipMap.get(sku);
    let isNew = false;
    if (firstDate) {
      const days = Math.max(0, Math.round((new Date(todayStr).getTime() - new Date(firstDate).getTime()) / 86400000));
      isNew = days <= num(params.新品判定天数);
    }

    for (const size of sizeGroup) {
      const key = keyOf(shop, code, color, size);
      const sale = c.salesMap.get(key);
      const 本店尺码销量 = sale ? sale.销量 : 0;
      const 本店尺码日均 = 本店尺码销量 / statDays;
      const 区域尺码日均 = areaSizeDaily.get(keyOf(area, code, color, size));
      let pred = 0;

      // 分支1：新品（无本店历史，按尺码占比拆分）
      if (isNew) {
        const base = 本店SKC日均 > 0 ? 本店SKC日均 : 区域SKC日均;
        let ratio = 0;
        if (gender) {
          ratio = c.sizeRatioMap.get(keyOf(shop, gender, size)) || 0;
          if (ratio <= 0) ratio = c.genderRatioMap.get(gender)?.get(size) || 0;
        }
        if (ratio <= 0) ratio = 1 / Math.max(1, sizeGroup.length);
        pred = round1(base * ratio);
      }
      // 分支2：老品有销量（本店该尺码有销）
      else if (本店尺码销量 > 0) {
        pred = round1(本店尺码日均 * num(params.本店权重) + (区域尺码日均 || 0) * num(params.区域权重));
      }
      // 分支3：弱店/弱尺码（本店该尺码 0 销）→ 同区域同等级 → 同区域 → 全区域 → 0
      else {
        const g1 = areaGradeDaily.get(keyOf(area, metric.店铺等级, code, color, size));
        if (g1) pred = round1(g1);
        else if (区域尺码日均) pred = round1(区域尺码日均);
        else pred = round1((globalSizeDaily.get(keyOf(code, color, size)) || 0) / statDays);
      }

      // 节假日放大
      const hf = c.holidayFactorMap.get(keyOf(area, code, color)) || 1;
      pred = round1(pred * hf);

      out.set(key, pred);
    }
  }

  return out;
}

// ==================== 目标库存（系数修正 + 硬性兜底） ====================

export function applyCoefficients(
  c: CleanedData, m: BaseMetrics, forecastMap: Map<string, number>, params: ReplenishParams,
): Map<string, number> {
  const out = new Map<string, number>(); // key = store|sku|size → 修正目标库存
  const planDays = Math.max(1, num(params.计划销售天数));

  const gradeCoef = (g: string) => {
    const g0 = g.trim().toUpperCase();
    if (g0.startsWith('A')) return 1.2;
    if (g0.startsWith('B')) return 1.0;
    if (g0.startsWith('C')) return 0.8;
    return 1.0;
  };

  for (const [sk, metric] of m.skuMetrics) {
    const [shop, code, color] = sk.split(SEP);
    const sku = keyOf(code, color);
    const sizeGroup = c.sizeGroupMap.get(sku) || MAIN_SIZES;

    const 存销比 = metric.存销比;
    const 周转天数 = metric.周转天数;
    const 齐码率 = metric.齐码率;
    // 存销比系数：高存销比(积压)→降；低→抬
    const 存销比系数 = clamp(planDays / Math.max(存销比, 0.001), 0.5, 1.5);
    // 周转系数：同构
    const 周转系数 = clamp(planDays / Math.max(周转天数, 0.5), 0.5, 1.5);
    // 满足率系数：【DB预留】占位 1.0（低满足率未来应抬升安全系数）
    const 满足率系数 = clamp(metric.满足率 >= 1 ? 1 : 1 + (1 - metric.满足率) * 0.5, 1, 1.5);
    // 齐码率系数：齐码率低→优先补足中段码
    const 齐码率系数 = clamp(1 + (1 - 齐码率) * 0.5, 1, 1.5);
    const gCoef = gradeCoef(metric.店铺等级);

    for (const size of sizeGroup) {
      const key = keyOf(shop, code, color, size);
      const pred = forecastMap.get(key) || 0;
      const target = round1(pred * planDays * gCoef * 存销比系数 * 周转系数 * 满足率系数 * 齐码率系数);
      out.set(key, target);
    }
  }
  return out;
}

export function applyHardCaps(
  c: CleanedData, m: BaseMetrics, targetMap: Map<string, number>, params: ReplenishParams,
): Map<string, number> {
  const out = new Map<string, number>();
  const maxDepth = Math.max(1, num(params.单码最大深度));

  for (const [sk, metric] of m.skuMetrics) {
    const [shop, code, color] = sk.split(SEP);
    const sku = keyOf(code, color);
    const sizeGroup = c.sizeGroupMap.get(sku) || MAIN_SIZES;

    const capped = new Map<string, number>();
    let sum = 0;
    for (const size of sizeGroup) {
      const key = keyOf(shop, code, color, size);
      let t = Math.max(0, Math.round(targetMap.get(key) || 0));
      t = Math.min(t, maxDepth); // 单码上限
      capped.set(size, t);
      sum += t;
    }

    // 门店款色上限：超陈列容量按比例缩放截断
    const 陈列容量 = Math.max(1, metric.陈列容量);
    if (sum > 陈列容量 && sum > 0) {
      const scale = 陈列容量 / sum;
      let rescaledSum = 0;
      const rescaled = new Map<string, number>();
      for (const [size, t] of capped) {
        const v = Math.round(t * scale);
        rescaled.set(size, Math.min(v, maxDepth));
        rescaledSum += Math.min(v, maxDepth);
      }
      // 最后一轮兜底：若缩得不够，再扣一次
      if (rescaledSum > 陈列容量) {
        const s2 = 陈列容量 / Math.max(1, rescaledSum);
        let s3 = 0;
        const final = new Map<string, number>();
        for (const [size, t] of rescaled) {
          const v = Math.round(t * s2);
          final.set(size, v);
          s3 += v;
        }
        for (const [size, v] of final) capped.set(size, v);
      } else {
        for (const [size, v] of rescaled) capped.set(size, v);
      }
    }

    // 陈列保底：主力码最低1（仅当该款色有预测需求）
    const 主力码 = metric.主力码;
    const skuForecast = c.salesMap.get(keyOf(shop, code, color, 主力码))?.销量 || 0;
    const anyPred = sizeGroup.some(size => (targetMap.get(keyOf(shop, code, color, size)) || 0) > 0);
    if (anyPred && capped.get(主力码) === 0 && c.sizeGroupMap.has(sku)) {
      capped.set(主力码, 1);
    }

    for (const [size, t] of capped) out.set(keyOf(shop, code, color, size), t);
  }
  return out;
}

// ==================== 理论调拨量 ====================

export function calcTheoreticalTransfer(
  c: CleanedData, m: BaseMetrics, targetMap: Map<string, number>,
): { 理论补货: Map<string, number>; 冗余: Set<string> } {
  const 理论补货 = new Map<string, number>();
  const 冗余 = new Set<string>();

  for (const sk of m.skuMetrics.keys()) {
    const [shop, code, color] = sk.split(SEP);
    const sku = keyOf(code, color);
    const sizeGroup = c.sizeGroupMap.get(sku) || MAIN_SIZES;
    let any = false;
    for (const size of sizeGroup) {
      const key = keyOf(shop, code, color, size);
      const st = c.stockMap.get(key);
      const 可用 = (st?.现库存 || 0) + (st?.在途数 || 0);
      const target = Math.round(targetMap.get(key) || 0);
      const diff = target - 可用;
      const t = diff > 0 ? diff : 0;
      理论补货.set(key, t);
      if (t > 0) any = true;
    }
    if (!any) 冗余.add(sk);
  }
  return { 理论补货, 冗余 };
}

// ==================== 业务拦截规则 ====================

export interface GateResult {
  理论补货: Map<string, number>;
  blocked: { skuKey: string; reason: string }[];
}

export function applyBusinessGates(
  c: CleanedData, m: BaseMetrics, transfer: Map<string, number>, params: ReplenishParams,
): GateResult {
  const out = new Map<string, number>();
  const blocked: { skuKey: string; reason: string }[] = [];
  const freezeDays = Math.max(1, num(params.滞销冻结天数));
  const today = new Date();
  const todayMs = today.setHours(0, 0, 0, 0);

  // 季末判定：季节性过时 → 清版/往年款
  function isSeasonEnd(sku: string): boolean {
    return false; // 【DB预留】商品生命周期字段未接入，默认非季末
  }

  for (const sk of m.skuMetrics.keys()) {
    const [shop, code, color] = sk.split(SEP);
    const sku = keyOf(code, color);
    const metric = m.skuMetrics.get(sk)!;
    const sizeGroup = c.sizeGroupMap.get(sku) || MAIN_SIZES;

    let skuBlockedReason = '';
    let 滞销 = false, 季末 = isSeasonEnd(sku), 超铺 = false;

    // 闭店/装修已在上游过滤

    // 门店款色已达陈列上限 → 停补
    let 可用合计 = 0;
    for (const size of sizeGroup) {
      const st = c.stockMap.get(keyOf(shop, code, color, size));
      可用合计 += (st?.现库存 || 0) + (st?.在途数 || 0);
    }
    if (可用合计 >= metric.陈列容量 && 可用合计 > 0) {
      超铺 = true;
      skuBlockedReason = '超铺';
    }

    // 尺码滞销：现库存>0 且 最近销售距今 >= 冻结天数 → 停补该尺码
    for (const size of sizeGroup) {
      const key = keyOf(shop, code, color, size);
      const sale = c.salesMap.get(key);
      const st = c.stockMap.get(key);
      const hasStock = (st?.现库存 || 0) > 0;
      let sizeSlow = false;
      if (hasStock && !sale) {
        sizeSlow = true;
      } else if (hasStock && sale?.最近销售日期) {
        const last = new Date(sale.最近销售日期).setHours(0, 0, 0, 0);
        const days = Math.round((todayMs - last) / 86400000);
        if (days >= freezeDays) sizeSlow = true;
      }
      if (sizeSlow) 滞销 = true;

      let t = transfer.get(key) || 0;
      if (skuBlockedReason) t = 0;                       // 超铺整款停补
      else if (sizeSlow) t = 0;                          // 滞销尺码停补
      else if (季末) {                                   // 季末仅主力断码可补
        const 主力码 = metric.主力码;
        const avail = (st?.现库存 || 0) + (st?.在途数 || 0);
        if (size !== 主力码 || avail > 0) t = 0;
      }
      out.set(key, t);
    }

    const blockedKey = keyOf(shop, code, color);
    if (超铺) blocked.push({ skuKey: blockedKey, reason: '超铺' });
    else if (滞销) blocked.push({ skuKey: blockedKey, reason: '滞销' });
  }

  return { 理论补货: out, blocked };
}

// ==================== 总仓分配优先级 ====================

export function allocateWarehouse(
  c: CleanedData, m: BaseMetrics, transfer: Map<string, number>, params: ReplenishParams,
): { 实际补货: Map<string, number>; 总仓消耗: number } {
  const 实际补货 = new Map<string, number>();
  const remain = new Map<string, number>(); // sku|size → 剩余可配
  for (const [k, v] of c.warehouseMap) remain.set(k, v);

  const gradeOrder: Record<string, number> = { A: 0, B: 1, C: 2 };
  const gradeRank = (g: string) => {
    const g0 = g.trim().toUpperCase();
    if (gradeOrder[g0] !== undefined) return gradeOrder[g0];
    if (g0.startsWith('A')) return 0;
    if (g0.startsWith('B')) return 1;
    if (g0.startsWith('C')) return 2;
    return 3;
  };

  // 按 SKC 分组
  const groups = new Map<string, string[]>(); // sku → storeSkuKeys
  for (const sk of m.skuMetrics.keys()) {
    const [shop, code, color] = sk.split(SEP);
    const sku = keyOf(code, color);
    if (!groups.has(sku)) groups.set(sku, []);
    groups.get(sku)!.push(sk);
  }

  let 总仓消耗 = 0;
  for (const [sku, storeSkuKeys] of groups) {
    const code = storeSkuKeys[0].split(SEP)[1];
    const color = storeSkuKeys[0].split(SEP)[2];
    const sizeGroup = c.sizeGroupMap.get(sku) || MAIN_SIZES;

    // 排序：店铺等级A→B→C → 满足率升序 → 齐码率升序 → 存销比升序
    const sorted = [...storeSkuKeys].sort((a, b) => {
      const ma = m.skuMetrics.get(a)!, mb = m.skuMetrics.get(b)!;
      return gradeRank(ma.店铺等级) - gradeRank(mb.店铺等级)
        || ma.满足率 - mb.满足率
        || ma.齐码率 - mb.齐码率
        || ma.存销比 - mb.存销比;
    });

    for (const sk of sorted) {
      const [shop] = sk.split(SEP);
      for (const size of sizeGroup) {
        const key = keyOf(shop, code, color, size);
        const need = transfer.get(key) || 0;
        const avail = remain.get(keyOf(code, color, size)) || 0;
        const take = Math.min(need, avail);
        实际补货.set(key, take);
        if (take > 0) {
          remain.set(keyOf(code, color, size), avail - take);
          总仓消耗 += take;
        }
      }
    }
  }

  return { 实际补货, 总仓消耗 };
}

// ==================== 结果行构建 ====================

export interface ResultRow {
  店铺名称: string; 商品代码: string; 颜色名称: string; 颜色代码: string; 性别: string;
  店铺等级: string; 小区域: string;
  齐码率: number; 存销比: number; 周转天数: number; 满足率: number;
  是否新品: string; 是否滞销: string; 是否季末: string; 状态: string;
  现库存合计: number; 在途合计: number; 可用合计: number; 目标合计: number;
  理论补货合计: number; 实际补货合计: number;
  sizes: Record<string, number>; // size → 实际补货
}

export function buildResultRows(
  c: CleanedData, m: BaseMetrics, forecastMap: Map<string, number>,
  targetMap: Map<string, number>, transfer: Map<string, number>,
  actual: Map<string, number>, gates: GateResult, 冗余: Set<string>,
  params: ReplenishParams,
): ResultRow[] {
  const rows: ResultRow[] = [];
  const gateReason = new Map<string, string>();
  for (const b of gates.blocked) gateReason.set(b.skuKey, b.reason);
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const sk of m.skuMetrics.keys()) {
    const [shop, code, color] = sk.split(SEP);
    const sku = keyOf(code, color);
    const metric = m.skuMetrics.get(sk)!;
    const sizeGroup = c.sizeGroupMap.get(sku) || MAIN_SIZES;

    // 是否新品：上货天数 <= 新品判定天数
    const firstDate = c.firstShipMap.get(sku);
    let 是否新品 = '否';
    if (firstDate) {
      const days = Math.max(0, Math.round((new Date(todayStr).getTime() - new Date(firstDate).getTime()) / 86400000));
      是否新品 = days <= num(params.新品判定天数) ? '是' : '否';
    }
    // 是否滞销：有库存但最近销售距今 >= 冻结天数
    let 是否滞销 = '否';
    for (const size of sizeGroup) {
      const sale = c.salesMap.get(keyOf(shop, code, color, size));
      const st = c.stockMap.get(keyOf(shop, code, color, size));
      const hasStock = (st?.现库存 || 0) > 0;
      if (!hasStock) continue;
      if (!sale) { 是否滞销 = '是'; break; }
      const last = new Date(sale.最近销售日期).setHours(0, 0, 0, 0);
      if (Math.round((Date.now() - last) / 86400000) >= num(params.滞销冻结天数)) { 是否滞销 = '是'; break; }
    }
    // 是否季末：【DB预留】商品生命周期未接入，默认否
    const 是否季末 = '否';

    const row: ResultRow = {
      店铺名称: shop, 商品代码: code, 颜色名称: color,
      颜色代码: '', 性别: metric.性别, 店铺等级: metric.店铺等级, 小区域: metric.小区域,
      齐码率: metric.齐码率, 存销比: metric.存销比, 周转天数: metric.周转天数, 满足率: metric.满足率,
      是否新品, 是否滞销, 是否季末, 状态: '正常',
      现库存合计: 0, 在途合计: 0, 可用合计: 0, 目标合计: 0, 理论补货合计: 0, 实际补货合计: 0,
      sizes: {},
    };

    for (const size of sizeGroup) {
      const key = keyOf(shop, code, color, size);
      const st = c.stockMap.get(key);
      const 现 = st?.现库存 || 0, 在途 = st?.在途数 || 0;
      const 可用 = 现 + 在途;
      const 目标 = Math.round(targetMap.get(key) || 0);
      const 理论 = transfer.get(key) || 0;
      const 实际 = actual.get(key) || 0;
      row.sizes[size] = 实际;
      row.现库存合计 += 现;
      row.在途合计 += 在途;
      row.可用合计 += 可用;
      row.目标合计 += 目标;
      row.理论补货合计 += 理论;
      row.实际补货合计 += 实际;
    }

    // 状态/标记：仅当该行完全无补货时才标记拦截/冗余原因
    const reason = gateReason.get(sk);
    const hasAction = row.理论补货合计 > 0 || row.实际补货合计 > 0;
    if (reason === '超铺') row.状态 = '超铺停补';
    else if (reason === '滞销' && !hasAction) row.状态 = '滞销停补';
    else if (冗余.has(sk) && !hasAction) row.状态 = '库存冗余';
    else if (hasAction) row.状态 = '正常';
    else row.状态 = '无需补货';

    rows.push(row);
  }

  return rows;
}

// ==================== Summary ====================

export function buildSummary(
  rows: ResultRow[], 冗余数: number, 总仓消耗: number, 款色数: number, 店数: number,
): ComputeSummary {
  let 理论 = 0, 实际 = 0;
  let 停补滞销 = 0, 停补季末 = 0, 停补超铺 = 0, 停补冗余 = 0, 无库存款色 = 0;
  const shopSet = new Set<string>();
  for (const r of rows) {
    理论 += r.理论补货合计;
    实际 += r.实际补货合计;
    shopSet.add(r.店铺名称);
    if (r.状态 === '滞销停补') 停补滞销++;
    else if (r.状态 === '季末停补') 停补季末++;
    else if (r.状态 === '超铺停补') 停补超铺++;
    else if (r.状态 === '库存冗余') 停补冗余++;
  }
  return {
    涉及店铺数: shopSet.size || 店数,
    涉及款色数: 款色数,
    理论补货总量: 理论,
    实际补货总量: 实际,
    总仓消耗,
    停补滞销, 停补季末, 停补超铺, 停补冗余, 无库存款色,
  };
}

export interface DetailRow {
  店铺名称: string; 店铺等级: string; 小区域: string;
  商品代码: string; 颜色名称: string; 颜色代码: string; 性别: string; 尺码代码: string;
  现库存: number; 在途数: number; 可用库存: number; 目标库存: number;
  理论补货: number; 实际补货: number;
  日均销量: number; 预测日均: number; 存销比: number; 齐码率: number;
  是否新品: string; 是否滞销: string; 是否季末: string; 状态: string;
}

export interface EngineResult {
  rows: ResultRow[];
  detailRows: DetailRow[];
  summary: ComputeSummary;
}

// ==================== 主流程 ====================

export function runEngine(input: EngineInput): EngineResult {
  const c = cleanData(input);
  const m = computeBaseMetrics(c, input.params);
  const f = forecast(c, m, input.params);
  const t = applyCoefficients(c, m, f, input.params);
  const h = applyHardCaps(c, m, t, input.params);
  const { 理论补货, 冗余 } = calcTheoreticalTransfer(c, m, h);
  const gates = applyBusinessGates(c, m, 理论补货, input.params);
  const { 实际补货, 总仓消耗 } = allocateWarehouse(c, m, gates.理论补货, input.params);

  const rows = buildResultRows(c, m, f, h, gates.理论补货, 实际补货, gates, 冗余, input.params);
  const actionable = rows.filter(r => r.实际补货合计 > 0 || r.理论补货合计 > 0);
  const summary = buildSummary(rows, 冗余.size, 总仓消耗, c.sizeGroupMap.size, c.storeMap.size);

  // 尺码粒度明细（仅理论补货 > 0，用于持久化留档）
  const statDays = Math.max(1, num(input.params.日均销统计天数));
  const gateReason = new Map<string, string>();
  for (const b of gates.blocked) gateReason.set(b.skuKey, b.reason);
  const detailRows: DetailRow[] = [];
  for (const sk of m.skuMetrics.keys()) {
    const [shop, code, color] = sk.split(SEP);
    const sku = keyOf(code, color);
    const metric = m.skuMetrics.get(sk)!;
    const sizeGroup = c.sizeGroupMap.get(sku) || MAIN_SIZES;
    const reason = gateReason.get(sk);
    for (const size of sizeGroup) {
      const key = keyOf(shop, code, color, size);
      const st = c.stockMap.get(key);
      const 现库存 = st?.现库存 || 0, 在途数 = st?.在途数 || 0;
      const 可用库存 = 现库存 + 在途数;
      const 目标库存 = Math.round(h.get(key) || 0);
      const 理论补货v = gates.理论补货.get(key) || 0;
      const 实际补货v = 实际补货.get(key) || 0;
      if (理论补货v <= 0) continue;
      const sale = c.salesMap.get(key);
      const 状态 = reason === '超铺' ? '超铺停补' : reason === '滞销' ? '滞销停补' : (理论补货v > 0 && 实际补货v === 0 ? '总仓不足' : '正常');
      detailRows.push({
        店铺名称: shop, 店铺等级: metric.店铺等级, 小区域: metric.小区域,
        商品代码: code, 颜色名称: color, 颜色代码: '', 性别: metric.性别, 尺码代码: size,
        现库存, 在途数, 可用库存, 目标库存, 理论补货: 理论补货v, 实际补货: 实际补货v,
        日均销量: round1((sale?.销量 || 0) / statDays),
        预测日均: round1(f.get(key) || 0),
        存销比: metric.存销比, 齐码率: metric.齐码率,
        是否新品: rows.find(r => r.店铺名称 === shop && r.商品代码 === code && r.颜色名称 === color)?.是否新品 || '否',
        是否滞销: rows.find(r => r.店铺名称 === shop && r.商品代码 === code && r.颜色名称 === color)?.是否滞销 || '否',
        是否季末: '否', 状态,
      });
    }
  }

  return { rows: actionable, detailRows, summary };
}
