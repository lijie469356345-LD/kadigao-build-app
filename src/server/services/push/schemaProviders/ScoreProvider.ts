// 评分体系 SchemaProvider
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class ScoreProvider implements IPushSchemaProvider {
  moduleCode = 'daily_score';
  moduleName = '评分体系';
  portalCode = 'inspection';
  portalName = '巡店管理';
  sourceTable = 'DailyScores';
  sourceIdField = 'id';

  getAvailableFields(): PushTemplateField[] {
    return [
      { fieldKey: '{userName}', fieldName: '用户', fieldType: 'text', category: 'basic', sourceColumn: 'DailyScores.userName', sortOrder: 1 },
      { fieldKey: '{scoreDate}', fieldName: '评分日期', fieldType: 'date', category: 'basic', sourceColumn: 'DailyScores.date', sortOrder: 2 },
      { fieldKey: '{totalScore}', fieldName: '总分', fieldType: 'number', category: 'basic', sourceColumn: 'DailyScores.totalScore', sortOrder: 3 },
      { fieldKey: '{finalScore}', fieldName: '最终得分', fieldType: 'number', category: 'basic', sourceColumn: 'DailyScores.finalScore', sortOrder: 4, description: '加权后的最终评分' },
      { fieldKey: '{salesGrowthScore}', fieldName: '销售增长分', fieldType: 'number', category: 'calculated', sourceColumn: 'DailyScores.salesGrowthScore', sortOrder: 10 },
      { fieldKey: '{quantityGrowthScore}', fieldName: '数量增长分', fieldType: 'number', category: 'calculated', sourceColumn: 'DailyScores.quantityGrowthScore', sortOrder: 11 },
      { fieldKey: '{rank}', fieldName: '排名', fieldType: 'text', category: 'calculated', sourceColumn: 'DailyScores.rank', sortOrder: 20, description: '当日评分排名' },
    ];
  }

  async loadRenderData(sourceId: number, pool: any): Promise<Record<string, any>> {
    const result = await pool.request().input('id', sql.Int, sourceId)
      .query('SELECT * FROM DailyScores WHERE id = @id');
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];
    return {
      _title: `评分 #${sourceId}`,
      userName: String(r.userName || ''),
      scoreDate: r.date ? String(r.date).split('T')[0] : '',
      totalScore: String(r.totalScore || ''),
      finalScore: String(r.finalScore || ''),
      salesGrowthScore: String(r.salesGrowthScore || ''),
      quantityGrowthScore: String(r.quantityGrowthScore || ''),
      rank: String(r.rank || ''),
    };
  }
}

export const scoreProvider = new ScoreProvider();
