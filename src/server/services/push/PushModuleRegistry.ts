// ============================================================
// 推送模块注册中心
// 管理所有模块的 SchemaProvider，提供服务启动时注册、字段同步、
// 运行时按 moduleCode 获取 Provider 等能力。
// ============================================================

import sql from 'mssql';
import { getPool } from '../../../config/db';

// 模板字段描述
export interface PushTemplateField {
  fieldKey: string;       // {supervisor}
  fieldName: string;      // 督导
  fieldType: 'text' | 'date' | 'number' | 'image' | 'list' | 'datetime';
  category: 'basic' | 'detail' | 'calculated';
  sourceColumn?: string;  // 数据库列名
  sourceTable?: string;   // 子表专用
  sortOrder?: number;
  description?: string;
}

// 模块字段提供者接口
export interface IPushSchemaProvider {
  moduleCode: string;
  moduleName: string;
  portalCode: string;
  portalName: string;
  sourceTable: string;
  sourceIdField: string;
  sourceFilter?: string;   // 触发器圈选数据的过滤条件（写库到 WechatPushModules.sourceFilter）
  dedupColumn?: string;    // 触发器按该列去重（写库到 WechatPushModules.dedupColumn）
  allowRepush?: boolean;   // 允许重复推送：圈选与分发不再排除已推送历史（有数据就推，直到查无数据）
  summaryGroupedByField?: boolean; // 汇总推送按字段分组去重聚合（商品代码、年份等各列合并去重），而非逐条渲染
  dataExtractionKey?: string; // 数据提取台账 fieldName：取值时优先执行 DataExtraction 表中该台账的最新 SQL（保证推送与数据提取页面一致），台账缺失/失败时回退 sourceFilter
  getAvailableFields(): PushTemplateField[];
  loadRenderData(sourceId: number | string, pool: any): Promise<Record<string, any>>;
}

// 注册的模块元数据（与 WechatPushModules 表对应）
export interface RegisteredModule {
  moduleCode: string;
  moduleName: string;
  portalCode: string;
  portalName: string;
  sourceTable: string;
  sourceIdField: string;
  statusField?: string;
  statusTriggerValue?: string;
  recipientStrategy: string;
  isActive: boolean;
  pollingEnabled: boolean;
}

class PushModuleRegistry {
  private providers: Map<string, IPushSchemaProvider> = new Map();

  /** 注册一个模块的 SchemaProvider */
  register(provider: IPushSchemaProvider): void {
    if (this.providers.has(provider.moduleCode)) {
      console.warn(`[PushModuleRegistry] 模块 ${provider.moduleCode} 已注册，将被覆盖`);
    }
    this.providers.set(provider.moduleCode, provider);
  }

  /** 批量注册 */
  registerAll(providers: IPushSchemaProvider[]): void {
    for (const p of providers) {
      this.register(p);
    }
  }

  /** 获取指定模块的 Provider */
  getProvider(moduleCode: string): IPushSchemaProvider | undefined {
    return this.providers.get(moduleCode);
  }

  /** 列出所有已注册模块 */
  listModules(): RegisteredModule[] {
    const result: RegisteredModule[] = [];
    for (const [code, p] of this.providers) {
      result.push({
        moduleCode: code,
        moduleName: p.moduleName,
        portalCode: p.portalCode,
        portalName: p.portalName,
        sourceTable: p.sourceTable,
        sourceIdField: p.sourceIdField,
        recipientStrategy: 'permission_group',
        isActive: true,
        pollingEnabled: true,
      });
    }
    return result;
  }

  /** 将已注册的模块同步到 WechatPushModules 表（UPSERT） */
  async syncModulesToDatabase(): Promise<number> {
    try {
      const pool = await getPool();
      let count = 0;
      for (const [code, provider] of this.providers) {
        const exists = await pool.request()
          .input('code', sql.NVarChar, code)
          .query('SELECT id FROM WechatPushModules WHERE moduleCode = @code');
        if (exists.recordset.length > 0) {
          await pool.request()
            .input('code', sql.NVarChar, code)
            .input('name', sql.NVarChar, provider.moduleName)
            .input('portal', sql.NVarChar, provider.portalCode)
            .input('portalName', sql.NVarChar, provider.portalName)
            .input('tbl', sql.NVarChar, provider.sourceTable)
            .input('idf', sql.NVarChar, provider.sourceIdField || null)
            .input('sf', sql.NVarChar, provider.sourceFilter || null)
            .input('dc', sql.NVarChar, provider.dedupColumn || null)
            .query(`UPDATE WechatPushModules SET moduleName=@name, portalCode=@portal, portalName=@portalName, sourceTable=@tbl, sourceIdField=@idf, sourceFilter=@sf, dedupColumn=@dc, updatedAt=GETDATE() WHERE moduleCode=@code`);
        } else {
          await pool.request()
            .input('code', sql.NVarChar, code)
            .input('name', sql.NVarChar, provider.moduleName)
            .input('portal', sql.NVarChar, provider.portalCode)
            .input('portalName', sql.NVarChar, provider.portalName)
            .input('tbl', sql.NVarChar, provider.sourceTable)
            .input('idf', sql.NVarChar, provider.sourceIdField)
            .input('sf', sql.NVarChar, provider.sourceFilter || null)
            .input('dc', sql.NVarChar, provider.dedupColumn || null)
            .query(`INSERT INTO WechatPushModules (moduleCode, moduleName, portalCode, portalName, sourceTable, sourceIdField, sourceFilter, dedupColumn) VALUES (@code, @name, @portal, @portalName, @tbl, @idf, @sf, @dc)`);
          count++;
        }
      }
      console.log(`[PushModuleRegistry] 模块同步完成，新增 ${count} 个`);
      return count;
    } catch (err) {
      console.error('[PushModuleRegistry] 同步模块失败:', (err as Error).message);
      return 0;
    }
  }

  /** 将已注册模块的字段同步到 WechatPushTemplateFields 表（先清后插） */
  async syncFieldsToDatabase(): Promise<void> {
    try {
      const pool = await getPool();
      for (const [code, provider] of this.providers) {
        const fields = provider.getAvailableFields();
        // 先清除该模块旧字段
        await pool.request()
          .input('code', sql.NVarChar, code)
          .query('DELETE FROM WechatPushTemplateFields WHERE moduleCode = @code');

        // 批量插入新字段
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          await pool.request()
            .input('code', sql.NVarChar, code)
            .input('key', sql.NVarChar, f.fieldKey)
            .input('name', sql.NVarChar, f.fieldName)
            .input('type', sql.NVarChar, f.fieldType)
            .input('col', sql.NVarChar, f.sourceColumn || '')
            .input('tbl', sql.NVarChar, f.sourceTable || '')
            .input('cat', sql.NVarChar, f.category)
            .input('ord', sql.Int, f.sortOrder ?? i)
            .input('desc', sql.NVarChar, f.description || '')
            .query(`
              INSERT INTO WechatPushTemplateFields
                (moduleCode, fieldKey, fieldName, fieldType, sourceColumn, sourceTable, category, sortOrder, description)
              VALUES (@code, @key, @name, @type, @col, @tbl, @cat, @ord, @desc)
            `);
        }
        console.log(`[PushModuleRegistry] 模块 ${code} 同步了 ${fields.length} 个字段`);
      }
    } catch (err) {
      console.error('[PushModuleRegistry] 同步字段失败:', (err as Error).message);
    }
  }

  /** 从数据库获取指定模块的可用字段列表 */
  async getModuleFields(moduleCode: string): Promise<PushTemplateField[]> {
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('code', sql.NVarChar, moduleCode)
        .query(`
          SELECT fieldKey, fieldName, fieldType, sourceColumn, sourceTable, category, sortOrder, description
          FROM WechatPushTemplateFields
          WHERE moduleCode = @code
          ORDER BY category, sortOrder
        `);
      return (result.recordset || []).map((r: any) => ({
        fieldKey: r.fieldKey,
        fieldName: r.fieldName,
        fieldType: r.fieldType,
        sourceColumn: r.sourceColumn || undefined,
        sourceTable: r.sourceTable || undefined,
        category: r.category,
        sortOrder: r.sortOrder,
        description: r.description || undefined,
      }));
    } catch {
      return [];
    }
  }

  /** 从数据库获取所有活跃模块列表 */
  async getModulesFromDb(): Promise<any[]> {
    try {
      const pool = await getPool();
      const result = await pool.request().query(`
        SELECT moduleCode, moduleName, portalCode, portalName, sourceTable,
               sourceIdField, statusField, statusTriggerValue, recipientStrategy,
               isActive, pollingEnabled, description
        FROM WechatPushModules
        WHERE isActive = 1
        ORDER BY portalCode, moduleCode
      `);
      return result.recordset || [];
    } catch {
      return [];
    }
  }

  /**
   * 按数据提取台账执行模块取值：
   * 模块配置了 dataExtractionKey（如无成本价商品 = DataExtraction.noCostPriceProduct）时，
   * 读取台账中最新 sqlQuery 并执行返回全部行（推送圈选/手动查询均走该 SQL，保证与数据提取页面一致）。
   * 台账不存在、SQL 为空或执行失败时返回 null（调用方回退模块原有 sourceFilter 逻辑）。
   */
  async queryModuleRowsByDataExtraction(moduleCode: string, pool: any): Promise<any[] | null> {
    const provider = this.providers.get(moduleCode);
    if (!provider || !provider.dataExtractionKey) return null;
    try {
      const r = await pool.request()
        .input('name', sql.NVarChar, provider.dataExtractionKey)
        .query('SELECT sqlQuery FROM DataExtraction WHERE fieldName = @name');
      const q = r.recordset?.[0]?.sqlQuery;
      if (!q || !String(q).trim()) return null;
      const rows = await pool.request().query(String(q));
      return rows.recordset || [];
    } catch (err) {
      console.error(`[PushModuleRegistry] 执行台账SQL失败 ${moduleCode}:`, (err as Error).message);
      return null;
    }
  }
}

// 全局单例
export const pushModuleRegistry = new PushModuleRegistry();
