// 陪跑跟进-时段业绩播报 SchemaProvider
// 让模板编辑器能展示字段，推送时走模板渲染
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class HourlyPerformanceProvider implements IPushSchemaProvider {
  moduleCode = 'hourly_performance';
  moduleName = '时段业绩播报';
  portalCode = 'coaching';
  portalName = '陪跑跟进';
  sourceTable = '有效业绩全';
  sourceIdField = 'id';
  // 无实体表，sourceId 用当天日期标识
  allowRepush = true;

  getAvailableFields(): PushTemplateField[] {
    return [
      // 基本信息
      { fieldKey: '{queryTime}', fieldName: '查询时间', fieldType: 'text', category: 'basic', sortOrder: 1, description: '当前推送时间' },
      { fieldKey: '{todayTarget}', fieldName: '今日业绩目标', fieldType: 'text', category: 'basic', sortOrder: 2, description: '今日业绩目标金额' },
      { fieldKey: '{totalAmount}', fieldName: '合计金额', fieldType: 'text', category: 'basic', sortOrder: 3, description: '所有店铺合计金额' },
      { fieldKey: '{shopCount}', fieldName: '店铺数量', fieldType: 'text', category: 'basic', sortOrder: 4, description: '有业绩的店铺数' },

      // 明细：时段业绩列表
      { fieldKey: '{hourlyList}', fieldName: '时段业绩列表', fieldType: 'list', category: 'detail', sourceTable: '时段业绩', sortOrder: 10, description: '各时段累计业绩（10:00/12:00/14:00/16:00/18:00/20:00/22:00）' },

      // 明细：店铺业绩列表
      { fieldKey: '{shopList}', fieldName: '店铺业绩列表', fieldType: 'list', category: 'detail', sourceTable: '店铺业绩', sortOrder: 11, description: '各店铺累计业绩明细' },
    ];
  }

  async loadRenderData(sourceId: number | string, pool: any): Promise<Record<string, any>> {
    // sourceId 用作占位，实际数据来自实时查询
    // 复用 hourlyPerformance 路由的查询逻辑
    const COACHING_SHOPS = [
      '洛阳宜阳二店_ZY', '巩义市新兴路店_ZY', '信阳固始踏月寺街店_ZY',
      '南阳方城卡迪高六店_ZY', '焦作万达广场店_ZY', '南阳内乡卡迪高四店_ZY',
      '洛阳景华路店_ZY', '郑州惠济万达店_ZY', '郑州工人路二店_ZY', '南阳邓州八店_ZY',
    ];

    const TIME_SLOTS: { label: string; hours: number[] }[] = [
      { label: '10:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { label: '12:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
      { label: '14:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
      { label: '16:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
      { label: '18:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] },
      { label: '20:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] },
      { label: '22:00', hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21] },
    ];

    function fmtMoney(n: number): string {
      return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
    }

    // 查询原始数据
    const shopParams = COACHING_SHOPS.map((_, i) => `@shop${i}`).join(',');
    const request = pool.request();
    COACHING_SHOPS.forEach((shop, i) => {
      request.input(`shop${i}`, shop);
    });

    const result = await request.query(`
      SELECT DATEPART(HOUR, 创建时间) AS hourField,
             店铺名称 AS shopName,
             SUM(业绩金额) AS amount
      FROM 有效业绩全
      WHERE 日期 >= GETDATE() - 1
        AND 店铺名称 IN (${shopParams})
      GROUP BY DATEPART(HOUR, 创建时间), 店铺名称
    `);

    const rows: { hourField: number; shopName: string; amount: number }[] =
      (result.recordset || []).map((r: any) => ({
        hourField: Number(r.hourField),
        shopName: String(r.shopName),
        amount: Number(r.amount),
      }));

    if (rows.length === 0) return {};

    // 按小时聚合
    const hourMap = new Map<number, number>();
    for (const r of rows) {
      hourMap.set(r.hourField, (hourMap.get(r.hourField) || 0) + r.amount);
    }

    // 按店铺聚合
    const shopMap = new Map<string, number>();
    for (const r of rows) {
      shopMap.set(r.shopName, (shopMap.get(r.shopName) || 0) + r.amount);
    }

    const currentHour = new Date().getHours();

    // 时段列表
    const hourlyList = TIME_SLOTS.map((slot) => {
      const slotHour = parseInt(slot.label.split(':')[0], 10);
      if (currentHour < slotHour) {
        return slot.label;
      }
      const slotSum = slot.hours.reduce((s, h) => s + (hourMap.get(h) || 0), 0);
      return slotSum > 0 ? `${slot.label}  ${fmtMoney(slotSum)}元` : slot.label;
    });

    // 店铺列表
    const byShop = Array.from(shopMap.entries()).sort((a, b) => b[1] - a[1]);
    const shopList = byShop.map(([shop, amt]) =>
      `${shop.replace(/_ZY$/, '')}  ${fmtMoney(amt)}元`
    );

    const totalAmount = byShop.reduce((s, [, amt]) => s + amt, 0);

    // 今日目标
    let todayTarget = 0;
    try {
      const targetRes = await pool.request()
        .input('targetDate', String(new Date().toISOString().slice(0, 10)))
        .query('SELECT TOP 1 targetAmount FROM FA_HourlyTarget WHERE targetDate = @targetDate');
      if (targetRes.recordset.length > 0) {
        todayTarget = Number(targetRes.recordset[0].targetAmount);
      }
    } catch { /* FA_HourlyTarget 可能不存在 */ }

    return {
      queryTime: new Date().toLocaleString('zh-CN'),
      todayTarget: todayTarget > 0 ? fmtMoney(todayTarget) : '未设置',
      totalAmount: fmtMoney(totalAmount) + '元',
      shopCount: String(byShop.length),
      hourlyList,
      shopList,
    };
  }
}

export const hourlyPerformanceProvider = new HourlyPerformanceProvider();
