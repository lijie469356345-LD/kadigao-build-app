// 巡店任务 SchemaProvider
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class InspectionTaskProvider implements IPushSchemaProvider {
  moduleCode = 'inspection_task';
  moduleName = '巡店任务';
  portalCode = 'inspection';
  portalName = '巡店管理';
  sourceTable = 'InspectionTasks';
  sourceIdField = 'id';

  getAvailableFields(): PushTemplateField[] {
    return [
      { fieldKey: '{title}', fieldName: '任务名称', fieldType: 'text', category: 'basic', sourceColumn: 'InspectionTasks.title', sortOrder: 1 },
      { fieldKey: '{description}', fieldName: '任务描述', fieldType: 'text', category: 'basic', sourceColumn: 'InspectionTasks.description', sortOrder: 2 },
      { fieldKey: '{assignedToName}', fieldName: '负责人', fieldType: 'text', category: 'basic', sourceColumn: 'InspectionTasks.assignedToName', sortOrder: 3 },
      { fieldKey: '{status}', fieldName: '状态', fieldType: 'text', category: 'basic', sourceColumn: 'InspectionTasks.status', sortOrder: 4, description: 'pending/in_progress/completed' },
      { fieldKey: '{deadline}', fieldName: '截止日期', fieldType: 'date', category: 'basic', sourceColumn: 'InspectionTasks.deadline', sortOrder: 5 },
      { fieldKey: '{shopCount}', fieldName: '店铺数量', fieldType: 'number', category: 'basic', sourceColumn: 'InspectionTasks.shops', sortOrder: 6, description: '任务包含的店铺数' },
    ];
  }

  async loadRenderData(sourceId: number, pool: any): Promise<Record<string, any>> {
    const result = await pool.request().input('id', sql.Int, sourceId)
      .query('SELECT title, description, assignedToName, status, deadline, shops FROM InspectionTasks WHERE id = @id');
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];
    let shopCount = 0;
    try { const s = JSON.parse(r.shops || '[]'); shopCount = Array.isArray(s) ? s.length : 0; } catch {}
    return {
      _title: `巡店任务: ${String(r.title || '')}`,
      title: String(r.title || ''), description: String(r.description || ''),
      assignedToName: String(r.assignedToName || ''),
      status: String(r.status || ''),
      deadline: r.deadline ? String(r.deadline).split('T')[0] : '',
      shopCount: String(shopCount),
    };
  }
}

export const inspectionTaskProvider = new InspectionTaskProvider();
