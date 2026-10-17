// 自定义通知 SchemaProvider
// 不绑定任何数据表，用户自由编辑消息内容，推送给指定/全部用户
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class CustomNotificationProvider implements IPushSchemaProvider {
  moduleCode = 'custom_notification';
  moduleName = '自定义通知';
  portalCode = 'system';
  portalName = '系统管理';
  sourceTable = '(无)';
  sourceIdField = 'id';

  getAvailableFields(): PushTemplateField[] {
    return [
      { fieldKey: '{time}', fieldName: '发送时间', fieldType: 'datetime', category: 'basic',
        sourceColumn: '(系统自动填充)', sortOrder: 1,
        description: '推送时的当前时间，自动替换为实际时间' },
      { fieldKey: '{sender}', fieldName: '发送人', fieldType: 'text', category: 'basic',
        sourceColumn: '(系统自动填充)', sortOrder: 2,
        description: '自动替换为当前用户名' },
    ];
  }

  async loadRenderData(_sourceId: number, _pool: any): Promise<Record<string, any>> {
    // 自定义通知无需从数据库加载数据
    return {
      _title: '自定义通知',
      time: new Date().toLocaleString('zh-CN'),
      sender: '系统管理员',
      destination: '',
    };
  }
}

export const customNotificationProvider = new CustomNotificationProvider();
