// 运营工作汇报 SchemaProvider
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class DirectSalesSummaryProvider implements IPushSchemaProvider {
  moduleCode = 'direct_sales_summary';
  moduleName = '运营工作汇报';
  portalCode = 'directSales';
  portalName = '运营工作汇报';
  sourceTable = 'DirectSalesSummary';
  sourceIdField = 'id';

  getAvailableFields(): PushTemplateField[] {
    return [
      { fieldKey: '{monthYear}', fieldName: '月份', fieldType: 'text', category: 'basic', sourceColumn: 'DirectSalesSummary.monthYear', sortOrder: 1, description: '汇报月份' },
      { fieldKey: '{dealer}', fieldName: '经销商', fieldType: 'text', category: 'basic', sourceColumn: 'DirectSalesSummary.dealer', sortOrder: 2, description: '经销商名称' },
      { fieldKey: '{supervisor}', fieldName: '负责人', fieldType: 'text', category: 'basic', sourceColumn: 'DirectSalesSummary.supervisor', sortOrder: 3, description: '区经/督导姓名' },
      { fieldKey: '{monthlyTarget}', fieldName: '月度目标', fieldType: 'text', category: 'basic', sourceColumn: 'DirectSalesSummary.monthlyTarget', sortOrder: 4, description: '月度销售目标金额' },
      { fieldKey: '{monthlyAchieved}', fieldName: '月度达成', fieldType: 'text', category: 'basic', sourceColumn: 'DirectSalesSummary.monthlyAchieved', sortOrder: 5, description: '月度实际达成金额' },
      { fieldKey: '{achievementRate}', fieldName: '达成率', fieldType: 'text', category: 'basic', sourceColumn: 'DirectSalesSummary.achievementRate', sortOrder: 6, description: '月度达成率' },
      { fieldKey: '{coefficientRatio}', fieldName: '系数比', fieldType: 'text', category: 'basic', sourceColumn: 'DirectSalesSummary.coefficientRatio', sortOrder: 7, description: '系数比率' },
      { fieldKey: '{areaTarget}', fieldName: '区域目标', fieldType: 'text', category: 'basic', sourceColumn: 'DirectSalesSummary.areaTarget', sortOrder: 8, description: '区域总目标' },
      { fieldKey: '{areaAchieved}', fieldName: '区域达成', fieldType: 'text', category: 'basic', sourceColumn: 'DirectSalesSummary.areaAchieved', sortOrder: 9, description: '区域实际达成' },
      { fieldKey: '{areaAchievementRate}', fieldName: '区域达成率', fieldType: 'text', category: 'basic', sourceColumn: 'DirectSalesSummary.areaAchievementRate', sortOrder: 10, description: '区域达成比率' },
      { fieldKey: '{orderCountDone}', fieldName: '订单量完成', fieldType: 'text', category: 'detail', sourceColumn: 'DirectSalesSummary.orderCountDone', sortOrder: 20, description: '订单量完成情况' },
      { fieldKey: '{giftRatioDone}', fieldName: '礼品率完成', fieldType: 'text', category: 'detail', sourceColumn: 'DirectSalesSummary.giftRatioDone', sortOrder: 21, description: '礼品率完成情况' },
      { fieldKey: '{newMemberDone}', fieldName: '新会员完成', fieldType: 'text', category: 'detail', sourceColumn: 'DirectSalesSummary.newMemberDone', sortOrder: 22, description: '新会员开发完成数' },
      { fieldKey: '{attachmentRateDone}', fieldName: '连带率完成', fieldType: 'text', category: 'detail', sourceColumn: 'DirectSalesSummary.attachmentRateDone', sortOrder: 23, description: '连带率完成情况' },
      { fieldKey: '{mainProductDone}', fieldName: '主推品完成', fieldType: 'text', category: 'detail', sourceColumn: 'DirectSalesSummary.mainProductDone', sortOrder: 24, description: '主推产品完成情况' },
      { fieldKey: '{oldMemberDone}', fieldName: '老会员完成', fieldType: 'text', category: 'detail', sourceColumn: 'DirectSalesSummary.oldMemberDone', sortOrder: 25, description: '老会员维护完成情况' },
      { fieldKey: '{birthdayDone}', fieldName: '生日维护完成', fieldType: 'text', category: 'detail', sourceColumn: 'DirectSalesSummary.birthdayDone', sortOrder: 26, description: '生日维护完成情况' },
      { fieldKey: '{workItems}', fieldName: '工作事项', fieldType: 'list', category: 'detail', sourceColumn: 'DirectSalesSummary.workItems', sortOrder: 30, description: '工作事项明细(JSON)' },
    ];
  }

  async loadRenderData(sourceId: number, pool: any): Promise<Record<string, any>> {
    const result = await pool.request().input('id', sql.Int, sourceId)
      .query('SELECT * FROM DirectSalesSummary WHERE id = @id');
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];
    return {
      _title: `运营工作汇报 #${sourceId} — ${String(r.supervisor || '')} ${String(r.monthYear || '')}`,
      monthYear: String(r.monthYear || ''),
      dealer: String(r.dealer || ''),
      supervisor: String(r.supervisor || ''),
      monthlyTarget: String(r.monthlyTarget || ''),
      monthlyAchieved: String(r.monthlyAchieved || ''),
      achievementRate: String(r.achievementRate || ''),
      coefficientRatio: String(r.coefficientRatio || ''),
      areaTarget: String(r.areaTarget || ''),
      areaAchieved: String(r.areaAchieved || ''),
      areaAchievementRate: String(r.areaAchievementRate || ''),
      orderCountDone: String(r.orderCountDone || ''),
      giftRatioDone: String(r.giftRatioDone || ''),
      newMemberDone: String(r.newMemberDone || ''),
      attachmentRateDone: String(r.attachmentRateDone || ''),
      mainProductDone: String(r.mainProductDone || ''),
      oldMemberDone: String(r.oldMemberDone || ''),
      birthdayDone: String(r.birthdayDone || ''),
      workItems: String(r.workItems || ''),
    };
  }
}

export const directSalesSummaryProvider = new DirectSalesSummaryProvider();
