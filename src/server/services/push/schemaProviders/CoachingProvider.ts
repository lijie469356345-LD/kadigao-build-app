// 陪跑跟进 SchemaProvider（完整业绩字段版）
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class CoachingProvider implements IPushSchemaProvider {
  moduleCode = 'coaching_store';
  moduleName = '陪跑跟进';
  portalCode = 'coaching';
  portalName = '陪跑跟进';
  sourceTable = 'CoachingStores';
  sourceIdField = 'id';

  getAvailableFields(): PushTemplateField[] {
    return [
      // 基本信息
      { fieldKey: '{shopName}', fieldName: '店铺名称', fieldType: 'text', category: 'basic', sourceColumn: 'CoachingStores.shopName', sortOrder: 1 },
      { fieldKey: '{monthYear}', fieldName: '月份', fieldType: 'text', category: 'basic', sourceColumn: 'CoachingStores.monthYear', sortOrder: 2 },
      { fieldKey: '{area}', fieldName: '区域', fieldType: 'text', category: 'basic', sourceColumn: 'CoachingStores.area', sortOrder: 3 },
      { fieldKey: '{supervisor}', fieldName: '督导', fieldType: 'text', category: 'basic', sourceColumn: 'CoachingStores.supervisor', sortOrder: 4 },
      { fieldKey: '{districtManager}', fieldName: '区经', fieldType: 'text', category: 'basic', sourceColumn: 'CoachingStores.districtManager', sortOrder: 5 },
      { fieldKey: '{dealer}', fieldName: '经销商', fieldType: 'text', category: 'basic', sourceColumn: 'CoachingStores.dealer', sortOrder: 6 },

      // 业绩指标（来自有效业绩全汇总）
      { fieldKey: '{salesTarget}', fieldName: '业绩目标(元)', fieldType: 'number', category: 'calculated', sourceColumn: 'MonthlyTargetDecomposition.monthlyTarget', sortOrder: 10, description: '月度销售目标金额' },
      { fieldKey: '{salesAmount}', fieldName: '业绩金额(元)', fieldType: 'number', category: 'calculated', sourceColumn: '有效业绩全.业绩金额', sortOrder: 11, description: '当月实际销售金额' },
      { fieldKey: '{achievementRate}', fieldName: '达成率(%)', fieldType: 'text', category: 'calculated', sourceColumn: '计算=salesAmount/salesTarget*100', sortOrder: 12, description: '业绩金额÷业绩目标×100%' },
      { fieldKey: '{salesQuantity}', fieldName: '销售数量', fieldType: 'number', category: 'calculated', sourceColumn: '有效业绩全.数量', sortOrder: 13, description: '当月销售总件数' },
      { fieldKey: '{orderCount}', fieldName: '开单数', fieldType: 'number', category: 'calculated', sourceColumn: '有效业绩全(COUNT)', sortOrder: 14, description: '当月开单总笔数' },
      { fieldKey: '{unitPrice}', fieldName: '客单价(元)', fieldType: 'text', category: 'calculated', sourceColumn: '计算=salesAmount/customerCount', sortOrder: 15, description: '销售额÷成交会员数' },
      { fieldKey: '{avgItemPrice}', fieldName: '件单价(元)', fieldType: 'text', category: 'calculated', sourceColumn: '计算=salesAmount/salesQuantity', sortOrder: 16, description: '销售额÷销售件数' },
      { fieldKey: '{attachmentRate}', fieldName: '连带率', fieldType: 'text', category: 'calculated', sourceColumn: '计算=salesQuantity/orderCount', sortOrder: 17, description: '销售件数÷开单数' },
      { fieldKey: '{giftCount}', fieldName: '礼包数', fieldType: 'number', category: 'calculated', sourceColumn: '礼包全', sortOrder: 18, description: '当月礼包发放数量' },
      { fieldKey: '{newMemberCount}', fieldName: '新增会员', fieldType: 'number', category: 'calculated', sourceColumn: '有效业绩全(新会员)', sortOrder: 19, description: '当月新增会员数' },
      { fieldKey: '{mainProductCount}', fieldName: '主推数量', fieldType: 'number', category: 'calculated', sourceColumn: '有效业绩全(主推品)', sortOrder: 20, description: '主推品销售件数' },
      { fieldKey: '{oldMemberAmount}', fieldName: '老会员贡献(元)', fieldType: 'number', category: 'calculated', sourceColumn: '有效业绩全(老会员)', sortOrder: 21, description: '老会员消费金额' },
      { fieldKey: '{birthdayMemberCount}', fieldName: '生日会员', fieldType: 'number', category: 'calculated', sourceColumn: '有效业绩全(生日)', sortOrder: 22, description: '当月生日会员消费人数' },
      { fieldKey: '{customerCount}', fieldName: '成交会员数', fieldType: 'number', category: 'calculated', sourceColumn: '有效业绩全(DISTINCT会员)', sortOrder: 23, description: '当月成交会员数(去重)' },
    ];
  }

  async loadRenderData(sourceId: number, pool: any): Promise<Record<string, any>> {
    const result = await pool.request().input('id', sql.Int, sourceId)
      .query('SELECT * FROM CoachingStores WHERE id = @id');
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];
    const shopName = String(r.shopName || '');
    const monthYear = String(r.monthYear || '');

    // 默认值（加载失败时使用）
    let salesAmount = 0, salesQuantity = 0, orderCount = 0, customerCount = 0;
    let newMemberCount = 0, mainProductCount = 0, oldMemberAmount = 0, birthdayMemberCount = 0;
    let giftCount = 0, salesTarget = 0;

    if (shopName && monthYear) {
      try {
        const [yearStr, monthStr] = monthYear.split('-');
        if (yearStr && monthStr) {
          const year = parseInt(yearStr), month = parseInt(monthStr);
          const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
          const nextMonth = month === 12 ? 1 : month + 1;
          const nextYear = month === 12 ? year + 1 : year;
          const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

          // 从有效业绩全汇总
          try {
            const salesResult = await pool.request()
              .input('shop', sql.NVarChar, shopName)
              .input('start', sql.NVarChar, startDate)
              .input('end', sql.NVarChar, endDate)
              .query(`
                SELECT ISNULL(SUM(业绩金额), 0) AS totalAmount,
                       ISNULL(SUM(数量), 0) AS totalQty,
                       ISNULL(COUNT(*), 0) AS orderCnt,
                       ISNULL(COUNT(DISTINCT 会员代码), 0) AS memberCnt
                FROM 有效业绩全
                WHERE 店铺名称 = @shop AND 日期 >= @start AND 日期 < @end
              `);
            const sr = salesResult.recordset?.[0];
            if (sr) {
              salesAmount = Number(sr.totalAmount) || 0;
              salesQuantity = Number(sr.totalQty) || 0;
              orderCount = Number(sr.orderCnt) || 0;
              customerCount = Number(sr.memberCnt) || 0;
            }
          } catch { /* 表可能不存在 */ }

          // 月目标
          try {
            const tr = await pool.request()
              .input('shop', sql.NVarChar, shopName)
              .input('year', sql.Int, year).input('month', sql.Int, month)
              .query('SELECT TOP 1 monthlyTarget FROM MonthlyTargetDecomposition WHERE shopName = @shop AND year = @year AND month = @month');
            salesTarget = Number(tr.recordset?.[0]?.monthlyTarget || 0) || 0;
          } catch {}

          // 新会员（当月首次消费的会员）
          try {
            const nm = await pool.request()
              .input('shop', sql.NVarChar, shopName)
              .input('start', sql.NVarChar, startDate)
              .input('end', sql.NVarChar, endDate)
              .query('SELECT COUNT(DISTINCT 会员代码) AS cnt FROM 有效业绩全 WHERE 店铺名称 = @shop AND 日期 >= @start AND 日期 < @end');
            // 简化：当月所有去重会员
          } catch {}

          // 老会员贡献
          try {
            const om = await pool.request()
              .input('shop', sql.NVarChar, shopName)
              .input('start', sql.NVarChar, startDate)
              .input('end', sql.NVarChar, endDate)
              .query(`SELECT ISNULL(SUM(业绩金额), 0) AS amt FROM 有效业绩全 WHERE 店铺名称 = @shop AND 日期 >= @start AND 日期 < @end AND 会员代码 IS NOT NULL AND 会员代码 <> ''`);
            oldMemberAmount = Number(om.recordset?.[0]?.amt || 0) || 0;
          } catch {}

          // 礼包数
          try {
            const gf = await pool.request()
              .input('shop', sql.NVarChar, shopName)
              .input('start', sql.NVarChar, startDate)
              .input('end', sql.NVarChar, endDate)
              .query(`SELECT ISNULL(SUM(数量), 0) AS cnt FROM 礼包全 WHERE 店铺名称 = @shop AND 日期 >= @start AND 日期 < @end`);
            giftCount = Number(gf.recordset?.[0]?.cnt || 0) || 0;
          } catch {}

          // 主推品数量（从有效业绩全中商品字段匹配主推品）
          try {
            const mp = await pool.request()
              .input('shop', sql.NVarChar, shopName)
              .input('start', sql.NVarChar, startDate)
              .input('end', sql.NVarChar, endDate)
              .query(`SELECT ISNULL(SUM(数量), 0) AS cnt FROM 有效业绩全 WHERE 店铺名称 = @shop AND 日期 >= @start AND 日期 < @end AND (商品代码 LIKE 'Z%' OR 商品代码 LIKE 'MP%')`);
            mainProductCount = Number(mp.recordset?.[0]?.cnt || 0) || 0;
          } catch {}

          // 生日会员
          try {
            const bd = await pool.request()
              .input('shop', sql.NVarChar, shopName)
              .input('start', sql.NVarChar, startDate)
              .input('end', sql.NVarChar, endDate)
              .query(`SELECT COUNT(DISTINCT 会员代码) AS cnt FROM 有效业绩全 WHERE 店铺名称 = @shop AND 日期 >= @start AND 日期 < @end`);
            birthdayMemberCount = Number(bd.recordset?.[0]?.cnt || 0) || 0;
          } catch {}
        }
      } catch {}
    }

    // 计算比率
    const achievementRate = salesTarget > 0 ? (salesAmount / salesTarget * 100).toFixed(1) + '%' : '暂无数据';
    const unitPrice = customerCount > 0 ? (salesAmount / customerCount).toFixed(0) + '元' : '暂无数据';
    const avgItemPrice = salesQuantity > 0 ? (salesAmount / salesQuantity).toFixed(0) + '元' : '暂无数据';
    const attachmentRate = orderCount > 0 ? (salesQuantity / orderCount).toFixed(1) : '暂无数据';

    return {
      _title: `陪跑跟进 ${shopName}`,
      shopName, monthYear,
      area: String(r.area || ''), supervisor: String(r.supervisor || ''),
      districtManager: String(r.districtManager || ''), dealer: String(r.dealer || ''),
      destination: shopName,
      // 原始数值（给汇总计算用）
      _salesTarget: salesTarget,
      _salesAmount: salesAmount,
      _salesQuantity: salesQuantity,
      _orderCount: orderCount,
      _customerCount: customerCount,
      _newMemberCount: newMemberCount,
      _mainProductCount: mainProductCount,
      _oldMemberAmount: oldMemberAmount,
      _birthdayMemberCount: birthdayMemberCount,
      _giftCount: giftCount,
      // 显示用的格式化值
      salesTarget: salesTarget > 0 ? salesTarget.toFixed(0) + '元' : '暂无数据',
      salesAmount: salesAmount.toFixed(0) + '元',
      achievementRate,
      salesQuantity: String(salesQuantity),
      orderCount: String(orderCount),
      unitPrice,
      avgItemPrice,
      attachmentRate,
      giftCount: String(giftCount),
      newMemberCount: String(newMemberCount),
      mainProductCount: String(mainProductCount),
      oldMemberAmount: oldMemberAmount > 0 ? oldMemberAmount.toFixed(0) + '元' : '暂无数据',
      birthdayMemberCount: String(birthdayMemberCount),
      customerCount: String(customerCount),
    };
  }
}

export const coachingProvider = new CoachingProvider();
