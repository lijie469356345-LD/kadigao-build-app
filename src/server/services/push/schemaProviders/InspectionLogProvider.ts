// ============================================================
// 巡店日志 SchemaProvider
// 为模板生成器和推送调度器提供字段定义 + 数据加载
// ============================================================

import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class InspectionLogProvider implements IPushSchemaProvider {
  moduleCode = 'inspection_log';
  moduleName = '巡店日志';
  portalCode = 'inspection';
  portalName = '巡店管理';
  sourceTable = 'StoreInspectionLogs';
  sourceIdField = 'id';

  getAvailableFields(): PushTemplateField[] {
    return [
      // 基本字段
      { fieldKey: '{supervisor}', fieldName: '督导', fieldType: 'text', category: 'basic', sourceColumn: 'StoreInspectionLogs.supervisor', sortOrder: 1, description: '巡店督导姓名' },
      { fieldKey: '{date}', fieldName: '巡店日期', fieldType: 'date', category: 'basic', sourceColumn: 'StoreInspectionLogs.date', sortOrder: 2, description: '巡店日期' },
      { fieldKey: '{departure}', fieldName: '出发地', fieldType: 'text', category: 'basic', sourceColumn: 'StoreInspectionLogs.departure', sortOrder: 3, description: '出发地点' },
      { fieldKey: '{destination}', fieldName: '目的地', fieldType: 'text', category: 'basic', sourceColumn: 'StoreInspectionLogs.destination', sortOrder: 4, description: '巡店目标店铺' },
      { fieldKey: '{arrivalTime}', fieldName: '到店时间', fieldType: 'datetime', category: 'basic', sourceColumn: 'StoreInspectionLogs.arrivalTime', sortOrder: 5, description: '到达店铺时间' },
      { fieldKey: '{departureTime}', fieldName: '离店时间', fieldType: 'datetime', category: 'basic', sourceColumn: 'StoreInspectionLogs.departureTime', sortOrder: 6, description: '离开店铺时间' },
      { fieldKey: '{remarks}', fieldName: '巡店结论', fieldType: 'text', category: 'basic', sourceColumn: 'StoreInspectionLogs.remarks', sortOrder: 7, description: '巡店总结备注' },
      { fieldKey: '{userName}', fieldName: '提交人', fieldType: 'text', category: 'basic', sourceColumn: 'StoreInspectionLogs.userName', sortOrder: 8, description: '日志提交人姓名' },
      { fieldKey: '{signature}', fieldName: '签名', fieldType: 'text', category: 'basic', sourceColumn: 'StoreInspectionLogs.signature', sortOrder: 9, description: '电子签名数据' },

      // 明细字段（7大类核查项，来自子表 StoreInspectionLogItems）
      { fieldKey: '{coreItems}', fieldName: '核心事项', fieldType: 'list', category: 'detail', sourceColumn: 'StoreInspectionLogItems(moduleType=coreItems)', sourceTable: 'StoreInspectionLogItems', sortOrder: 10, description: '核心事项核查清单' },
      { fieldKey: '{shopIssues}', fieldName: '店铺问题', fieldType: 'list', category: 'detail', sourceColumn: 'StoreInspectionLogItems(moduleType=shopIssues)', sourceTable: 'StoreInspectionLogItems', sortOrder: 11, description: '店铺问题核查清单' },
      { fieldKey: '{teachingTraining}', fieldName: '带教培训', fieldType: 'list', category: 'detail', sourceColumn: 'StoreInspectionLogItems(moduleType=teachingTraining)', sourceTable: 'StoreInspectionLogItems', sortOrder: 12, description: '带教培训核查清单' },
      { fieldKey: '{competitorInfo}', fieldName: '竞品信息', fieldType: 'list', category: 'detail', sourceColumn: 'StoreInspectionLogItems(moduleType=competitorInfo)', sourceTable: 'StoreInspectionLogItems', sortOrder: 13, description: '竞品信息核查清单' },
      { fieldKey: '{marketResearch}', fieldName: '市场调研', fieldType: 'list', category: 'detail', sourceColumn: 'StoreInspectionLogItems(moduleType=marketResearch)', sourceTable: 'StoreInspectionLogItems', sortOrder: 14, description: '市场调研核查清单' },
      { fieldKey: '{staffCollection}', fieldName: '外部人员收集', fieldType: 'list', category: 'detail', sourceColumn: 'StoreInspectionLogItems(moduleType=staffCollection)', sourceTable: 'StoreInspectionLogItems', sortOrder: 15, description: '外部人员收集清单' },
      { fieldKey: '{marketChanges}', fieldName: '市场变化', fieldType: 'list', category: 'detail', sourceColumn: 'StoreInspectionLogItems(moduleType=marketChanges)', sourceTable: 'StoreInspectionLogItems', sortOrder: 16, description: '市场变化核查清单' },
    ];
  }

  async loadRenderData(sourceId: number, pool: any): Promise<Record<string, any>> {
    const logResult = await pool.request()
      .input('id', sql.Int, sourceId)
      .query(`
        SELECT id, supervisor, date, departure, destination,
               arrivalTime, departureTime, remarks, status,
               signature, userName
        FROM StoreInspectionLogs WHERE id = @id
      `);
    if (!logResult.recordset || logResult.recordset.length === 0) {
      return {};
    }
    const log = logResult.recordset[0];

    // 格式化时间
    const fmt = (v: any) => {
      if (!v) return '';
      if (v instanceof Date) {
        const y = v.getFullYear();
        const M = String(v.getMonth() + 1).padStart(2, '0');
        const d = String(v.getDate()).padStart(2, '0');
        const h = String(v.getHours()).padStart(2, '0');
        const m = String(v.getMinutes()).padStart(2, '0');
        return `${y}-${M}-${d} ${h}:${m}`;
      }
      return String(v);
    };

    const fmtDate = (v: any) => {
      if (!v) return '';
      if (v instanceof Date) {
        return v.toISOString().split('T')[0];
      }
      return String(v).split('T')[0] || String(v);
    };

    // 检测是否为「未巡店 / 调休不巡店」日志
    const isNoInspection =
      String(log.departure || '').includes('未巡店') ||
      String(log.destination || '').includes('未巡店') ||
      String(log.remarks || '').includes('调休') ||
      String(log.remarks || '').includes('不巡店');

    const data: Record<string, any> = {
      _title: `巡店日志 #${sourceId} — ${String(log.destination || '')}`,
      _isNoInspection: isNoInspection,
      supervisor: String(log.supervisor || ''),
      date: fmtDate(log.date),
      departure: String(log.departure || ''),
      destination: String(log.destination || ''),
      arrivalTime: fmt(log.arrivalTime),
      departureTime: fmt(log.departureTime),
      remarks: String(log.remarks || ''),
      userName: String(log.userName || ''),
      signature: String(log.signature || ''),
    };

    // 加载子表检查项
    const itemsResult = await pool.request()
      .input('id', sql.Int, sourceId)
      .query(`
        SELECT moduleType, itemContent, itemResult
        FROM StoreInspectionLogItems
        WHERE logId = @id
        ORDER BY moduleType, itemIndex
      `);

    const moduleNames: Record<string, string> = {
      coreItems: '核心事项',
      shopIssues: '店铺问题',
      teachingTraining: '带教培训',
      competitorInfo: '竞品信息',
      marketResearch: '市场调研',
      staffCollection: '外部人员收集',
      marketChanges: '市场变化',
    };

    for (const modKey of Object.keys(moduleNames)) {
      const items = (itemsResult.recordset || [])
        .filter((r: any) => r.moduleType === modKey)
        .map((r: any) => ({
          item: String(r.itemContent || ''),
          result: String(r.itemResult || ''),
        }))
        .filter((x: any) => x.item || x.result);

      data[modKey] = items.length > 0 ? items : null;
    }

    return data;
  }
}

// 单例
export const inspectionLogProvider = new InspectionLogProvider();
