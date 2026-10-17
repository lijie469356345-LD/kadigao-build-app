// 日常指标上传 SchemaProvider
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class DailyShopTargetProvider implements IPushSchemaProvider {
  moduleCode = 'daily_shop_target';
  moduleName = '日常指标上传';
  portalCode = 'directSales';
  portalName = '运营工作汇报';
  sourceTable = 'DailyShopTargets';
  sourceIdField = 'id';

  getAvailableFields(): PushTemplateField[] {
    return [
      { fieldKey: '{shopName}', fieldName: '店铺名称', fieldType: 'text', category: 'basic', sourceColumn: 'DailyShopTargets.shopName', sortOrder: 1 },
      { fieldKey: '{monthYear}', fieldName: '月份', fieldType: 'text', category: 'basic', sourceColumn: 'DailyShopTargets.monthYear', sortOrder: 2 },
      { fieldKey: '{districtManager}', fieldName: '区经', fieldType: 'text', category: 'basic', sourceColumn: 'DailyShopTargets.districtManager', sortOrder: 3 },
      { fieldKey: '{supervisor}', fieldName: '督导', fieldType: 'text', category: 'basic', sourceColumn: 'DailyShopTargets.supervisor', sortOrder: 4 },
      { fieldKey: '{orderCountTarget}', fieldName: '订单量指标', fieldType: 'text', category: 'detail', sourceColumn: 'DailyShopTargets.orderCountTarget', sortOrder: 10 },
      { fieldKey: '{giftRatioTarget}', fieldName: '礼品率指标', fieldType: 'text', category: 'detail', sourceColumn: 'DailyShopTargets.giftRatioTarget', sortOrder: 11 },
      { fieldKey: '{newMemberTarget}', fieldName: '新会员指标', fieldType: 'text', category: 'detail', sourceColumn: 'DailyShopTargets.newMemberTarget', sortOrder: 12 },
      { fieldKey: '{attachmentRateTarget}', fieldName: '连带率指标', fieldType: 'text', category: 'detail', sourceColumn: 'DailyShopTargets.attachmentRateTarget', sortOrder: 13 },
      { fieldKey: '{mainProductTarget}', fieldName: '主推品指标', fieldType: 'text', category: 'detail', sourceColumn: 'DailyShopTargets.mainProductTarget', sortOrder: 14 },
      { fieldKey: '{oldMemberTarget}', fieldName: '老会员指标', fieldType: 'text', category: 'detail', sourceColumn: 'DailyShopTargets.oldMemberTarget', sortOrder: 15 },
      { fieldKey: '{birthdayTarget}', fieldName: '生日维护指标', fieldType: 'text', category: 'detail', sourceColumn: 'DailyShopTargets.birthdayTarget', sortOrder: 16 },
    ];
  }

  async loadRenderData(sourceId: number, pool: any): Promise<Record<string, any>> {
    const result = await pool.request().input('id', sql.Int, sourceId)
      .query('SELECT * FROM DailyShopTargets WHERE id = @id');
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];
    return {
      _title: `日常指标 ${String(r.shopName || '')}`,
      shopName: String(r.shopName || ''), monthYear: String(r.monthYear || ''),
      districtManager: String(r.districtManager || ''), supervisor: String(r.supervisor || ''),
      orderCountTarget: String(r.orderCountTarget || ''),
      giftRatioTarget: String(r.giftRatioTarget || ''),
      newMemberTarget: String(r.newMemberTarget || ''),
      attachmentRateTarget: String(r.attachmentRateTarget || ''),
      mainProductTarget: String(r.mainProductTarget || ''),
      oldMemberTarget: String(r.oldMemberTarget || ''),
      birthdayTarget: String(r.birthdayTarget || ''),
      destination: String(r.shopName || ''),
    };
  }
}

export const dailyShopTargetProvider = new DailyShopTargetProvider();
