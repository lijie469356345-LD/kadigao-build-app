// 培训反馈任务 SchemaProvider
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class FeedbackTaskProvider implements IPushSchemaProvider {
  moduleCode = 'feedback_task';
  moduleName = '培训反馈任务';
  portalCode = 'staffChannel';
  portalName = '培训反馈';
  sourceTable = 'FeedbackTasks';
  sourceIdField = 'id';

  getAvailableFields(): PushTemplateField[] {
    return [
      { fieldKey: '{taskNo}', fieldName: '任务编号', fieldType: 'text', category: 'basic', sourceColumn: 'FeedbackTasks.taskNo', sortOrder: 1, description: '反馈任务编号' },
      { fieldKey: '{title}', fieldName: '任务标题', fieldType: 'text', category: 'basic', sourceColumn: 'FeedbackTasks.title', sortOrder: 2, description: '反馈任务标题' },
      { fieldKey: '{startTime}', fieldName: '开始时间', fieldType: 'datetime', category: 'basic', sourceColumn: 'FeedbackTasks.startTime', sortOrder: 3, description: '任务开始时间' },
      { fieldKey: '{endTime}', fieldName: '结束时间', fieldType: 'datetime', category: 'basic', sourceColumn: 'FeedbackTasks.endTime', sortOrder: 4, description: '任务结束时间' },
      { fieldKey: '{status}', fieldName: '状态', fieldType: 'text', category: 'basic', sourceColumn: 'FeedbackTasks.status', sortOrder: 5, description: '任务状态(draft/running/submitted/closed)' },
      { fieldKey: '{createdByName}', fieldName: '创建人', fieldType: 'text', category: 'basic', sourceColumn: 'FeedbackTasks.createdByName', sortOrder: 6, description: '任务创建人' },
      { fieldKey: '{remark}', fieldName: '备注', fieldType: 'text', category: 'basic', sourceColumn: 'FeedbackTasks.remark', sortOrder: 7, description: '任务备注说明' },
    ];
  }

  async loadRenderData(sourceId: number, pool: any): Promise<Record<string, any>> {
    const result = await pool.request().input('id', sql.Int, sourceId)
      .query('SELECT taskNo, title, startTime, endTime, status, createdByName, remark FROM FeedbackTasks WHERE id = @id');
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];
    const fmt = (v: any) => v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')} ${String(v.getHours()).padStart(2,'0')}:${String(v.getMinutes()).padStart(2,'0')}` : String(v || '');
    return {
      _title: `反馈任务 ${String(r.taskNo || '')} — ${String(r.title || '')}`,
      taskNo: String(r.taskNo || ''),
      title: String(r.title || ''),
      startTime: fmt(r.startTime),
      endTime: fmt(r.endTime),
      status: String(r.status || ''),
      createdByName: String(r.createdByName || ''),
      remark: String(r.remark || ''),
    };
  }
}

export const feedbackTaskProvider = new FeedbackTaskProvider();
