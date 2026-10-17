// 月目标分解 SchemaProvider
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class MonthlyTargetProvider implements IPushSchemaProvider {
  moduleCode = 'monthly_target';
  moduleName = '月目标分解';
  portalCode = 'sales';
  portalName = '销售管理';
  sourceTable = 'MonthlyTargetDecomposition';
  sourceIdField = 'id';

  getAvailableFields(): PushTemplateField[] {
    return [
      { fieldKey: '{monthYear}', fieldName: '月份', fieldType: 'text', category: 'basic', sourceColumn: 'MonthlyTargetDecomposition.year+month', sortOrder: 1 },
      { fieldKey: '{shopName}', fieldName: '店铺名称', fieldType: 'text', category: 'basic', sourceColumn: 'MonthlyTargetDecomposition.shopName', sortOrder: 2 },
      { fieldKey: '{districtManager}', fieldName: '区经', fieldType: 'text', category: 'basic', sourceColumn: 'MonthlyTargetDecomposition.districtManager', sortOrder: 3 },
      { fieldKey: '{supervisor}', fieldName: '督导', fieldType: 'text', category: 'basic', sourceColumn: 'MonthlyTargetDecomposition.supervisor', sortOrder: 4 },
      { fieldKey: '{monthlyTarget}', fieldName: '月度目标', fieldType: 'number', category: 'basic', sourceColumn: 'MonthlyTargetDecomposition.monthlyTarget', sortOrder: 5 },
      { fieldKey: '{dailyTarget}', fieldName: '当日目标', fieldType: 'number', category: 'basic', sourceColumn: 'MonthlyTargetDaily.dailyTarget', sortOrder: 6 },
    ];
  }

  async loadRenderData(sourceId: number, pool: any): Promise<Record<string, any>> {
    const result = await pool.request().input('id', sql.Int, sourceId)
      .query('SELECT * FROM MonthlyTargetDecomposition WHERE id = @id');
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];
    return {
      _title: `月目标 ${String(r.shopName || '')} ${String(r.year || '')}-${String(r.month || '')}`,
      monthYear: `${String(r.year || '')}-${String(r.month || '')}`,
      shopName: String(r.shopName || ''),
      districtManager: String(r.districtManager || ''),
      supervisor: String(r.supervisor || ''),
      monthlyTarget: String(r.monthlyTarget || ''),
      dailyTarget: String(r.dailyTarget || ''),
      destination: String(r.shopName || ''),
    };
  }
}

export const monthlyTargetProvider = new MonthlyTargetProvider();
