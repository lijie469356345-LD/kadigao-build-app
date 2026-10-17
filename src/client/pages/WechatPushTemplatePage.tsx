import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from './_WechatPageHeader';
import WechatPushSidebar from './_WechatPushSidebar';
import {
  PushModule, PushTemplateField, PushTemplate,
  getModules, getModuleFields, getTemplates, getAllTemplates, createTemplate,
  updateTemplate, deleteTemplate, previewTemplate,
  getRecipientOptions, searchRecipients, RecipientUser,
} from '../../api/wechatPushV2';
import { Plus, Trash2, Save, Eye, Copy, Check, UserPlus, Search, X, AlertCircle, List, BarChart3, Clock, Zap, Hash, Paperclip, Send, Loader2, FileArchive, Video, RefreshCw } from 'lucide-react';
import { uploadWechatMedia, sendWechatMedia, getShipinVideos } from '../../api/wechatPush';

const MODULE_NAMES: Record<string, string> = {
  inspection_log: '巡店日志', direct_sales_summary: '运营工作汇报',
  daily_shop_target: '日常指标上传', feedback_task: '培训反馈任务',
  feedback_detail: '培训反馈明细', coaching_store: '陪跑跟进',
  daily_score: '评分体系', monthly_target: '月目标分解',
  inspection_task: '巡店任务',
  custom_notification: '自定义通知',
  finance_field: '财务字段',
  no_cost_price_product: '无成本价商品',
  register: '注册管理',
  hourly_performance: '时段业绩播报',
  shoe_feedback: '洗鞋服务反馈',
  xixie_feedback: '修鞋服务反馈',
};
const CATEGORY_NAMES: Record<string, string> = {
  basic: '基本信息字段', detail: '明细列表字段', calculated: '计算字段',
};

export default function WechatPushTemplatePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlModule = searchParams.get('module') || '';

  const [modules, setModules] = useState<PushModule[]>([]);
  const [selectedModule, setSelectedModule] = useState(urlModule);
  const [fields, setFields] = useState<PushTemplateField[]>([]);
  const [groupedFields, setGroupedFields] = useState<Record<string, PushTemplateField[]>>({});
  const [templates, setTemplates] = useState<PushTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PushTemplate | null>(null);

  // 编辑态
  const [editing, setEditing] = useState(false);
  const [checkedFields, setCheckedFields] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState('');

  // 接收人设置（新：可搜索筛选 + 选人；角色/组织维度，岗位已下线）
  const [roleOptions, setRoleOptions] = useState<{ roleId: number; roleName: string }[]>([]);
  const [orgOptions, setOrgOptions] = useState<{ orgId: number; orgName: string }[]>([]);
  const [filterRoleId, setFilterRoleId] = useState('');
  const [filterOrgId, setFilterOrgId] = useState('');
  const [recipientUsers, setRecipientUsers] = useState<RecipientUser[]>([]);
  const [recipientNoWechat, setRecipientNoWechat] = useState<RecipientUser[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientKeyword, setRecipientKeyword] = useState('');

  // 推送模式：明细 / 汇总
  const [pushMode, setPushMode] = useState<'detail' | 'summary'>('detail');

  // 数据源策略：realtime=实时查询数据再推（需先查询源数据勾选） / skip_query=不查询数据源，有数据就推（自动圈选）
  const [dataSourceMode, setDataSourceMode] = useState<'skip_query' | 'realtime'>('realtime');

  // 触发器设置
  const [triggerType, setTriggerType] = useState('manual');
  const [triggerCron, setTriggerCron] = useState('');
  const [triggerCount, setTriggerCount] = useState(10);

  // 生效时间范围
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  // 全部模板（未选模块时展示）
  const [allTemplates, setAllTemplates] = useState<PushTemplate[]>([]);

  // 预览
  const [preview, setPreview] = useState('');
  const [previewSourceId, setPreviewSourceId] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // 自定义通知的发送人
  const [customSender, setCustomSender] = useState('系统管理员');

  // 媒体文件推送（自定义通知）
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaUploaded, setMediaUploaded] = useState<{ media_id: string; type: string; filename: string } | null>(null);
  const [mediaSending, setMediaSending] = useState(false);
  const [mediaResult, setMediaResult] = useState<string>('');

  // 服务器视频列表（自定义通知：视频从服务器文件夹选择，不上传）
  const [shipinVideos, setShipinVideos] = useState<{ index: number; name: string; sizeMB: string; url: string }[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const [videoPushResult, setVideoPushResult] = useState<string>('');

  useEffect(() => {
    loadModules().then(() => {
      if (urlModule) {
        selectModule(urlModule);
      } else {
        loadAllTemplates();
      }
    });
  }, []);

  // 进入自定义通知模块时自动加载服务器视频列表
  useEffect(() => {
    if (selectedModule === 'custom_notification') {
      loadShipinVideos();
      setSelectedVideos(new Set());
    }
  }, [selectedModule]);

  const loadAllTemplates = async () => {
    try { setAllTemplates(await getAllTemplates()); } catch { setAllTemplates([]); }
  };

  const loadModules = async () => {
    try { setModules((await getModules()).filter(m => m.isActive)); } catch {}
  };

  const selectModule = async (code: string) => {
    setSelectedModule(code); setSelectedTemplate(null); setEditing(false);
    setSearchParams(code ? { module: code } : {});
    try {
      const [fd, tpls] = await Promise.all([getModuleFields(code), getTemplates(code)]);
      setFields(fd.fields || []); setGroupedFields(fd.grouped || {}); setTemplates(tpls || []);
      setCheckedFields(new Set<string>());
    } catch { setFields([]); setGroupedFields({}); setTemplates([]); }
  };

  // 选模板编辑
  const editTemplate = (tpl: any) => {
    setSelectedTemplate(tpl); setEditing(true);
    setTitle(tpl.title || '');
    setHeaderText(tpl.headerTemplate || '');
    setFooterText(tpl.footerTemplate || '');
    const keys = Array.isArray(tpl.selectedFields) ? tpl.selectedFields : [];
    setCheckedFields(new Set<string>(keys));
    setPushMode(tpl.pushMode || 'detail');
    setDataSourceMode(tpl.dataSourceMode === 'skip_query' ? 'skip_query' : 'realtime');
    setTriggerType(tpl.triggerType || 'manual');
    const tcfg = tpl.triggerConfig || {};
    setTriggerCron(tcfg.cron || '');
    setTriggerCount(tcfg.count || 10);
    setCustomSender(tcfg.senderName || '系统管理员');
    // 恢复生效时间范围
    setStartTime(tpl.startTime ? String(tpl.startTime).split('T')[0] : '');
    setEndTime(tpl.endTime ? String(tpl.endTime).split('T')[0] : '');
    // 恢复已保存的接收人
    const savedRecipients = tpl.selectedRecipients ? (Array.isArray(tpl.selectedRecipients) ? tpl.selectedRecipients : []) : [];
    setSelectedRecipients(new Set(savedRecipients));
    // 如果模板有保存接收人，自动加载这些用户的信息以便确认区显示
    if (savedRecipients.length > 0) {
      setRecipientUsers((Array.isArray(savedRecipients) ? savedRecipients : []).map((acc: string) => ({
        userCode: '', userName: acc, groupName: '', position: '', wechatAccount: acc
      })));
    }
    setFilterRoleId(''); setFilterOrgId(''); setRecipientNoWechat([]);
    loadRecipientOptions();
    setPreview('');
  };

  // 新建模板
  const newTemplate = () => {
    if (!Array.isArray(fields) || fields.length === 0) {
      alert('字段尚未加载完成，请稍后再试');
      return;
    }
    setSelectedTemplate(null); setEditing(true);
    const modName = MODULE_NAMES[selectedModule] || selectedModule;
    setTitle(`【${modName}】`);
    // 默认全选基本信息字段
    const basicKeys = fields.filter(f => f.category === 'basic').map(f => f.fieldKey);
    setCheckedFields(new Set(basicKeys));
    // 生成初始模板
    const header = fields
      .filter(f => f.category === 'basic')
      .map(f => `${f.fieldName}：{${f.fieldKey.replace(/[{}]/g, '')}}`)
      .join('\n');
    setHeaderText(header);
    setFooterText('\n————系统自动推送，无需回复————');
    setPushMode('detail');
    setDataSourceMode('realtime');
    // 重置生效时间
    setStartTime(''); setEndTime('');
    // 重置接收人
    setFilterRoleId(''); setFilterOrgId(''); setSelectedRecipients(new Set());
    setRecipientUsers([]); setRecipientNoWechat([]);
    loadRecipientOptions();
    setPreview('');
  };

  // 加载可选角色/组织（岗位维度已下线）
  const loadRecipientOptions = async () => {
    try {
      const r = await getRecipientOptions();
      setRoleOptions((r.roles || []).map(x => ({ roleId: x.roleId, roleName: x.roleName })));
      setOrgOptions((r.orgs || []).map(x => ({ orgId: x.orgId, orgName: x.orgName })));
    } catch {}
  };

  // 搜索可推送用户（按角色/组织/关键字）
  const doSearchRecipients = async () => {
    setRecipientLoading(true);
    try {
      const r = await searchRecipients({
        roleId: filterRoleId || undefined,
        orgId: filterOrgId || undefined,
        keyword: recipientKeyword || undefined,
      });
      setRecipientUsers(r.withWechat || []);
      setRecipientNoWechat(r.withoutWechat || []);
    } catch {
      setRecipientUsers([]); setRecipientNoWechat([]);
    } finally {
      setRecipientLoading(false);
    }
  };

  // 切换字段勾选
  const toggleField = (key: string) => {
    const next = new Set(checkedFields);
    if (next.has(key)) next.delete(key); else next.add(key);
    setCheckedFields(next);
    // 仅在新建（无模板ID）时自动重建模板；编辑已有模板时不覆盖用户手写内容
    if (!selectedTemplate?.id) {
      rebuildTemplate(next);
    }
  };

  // 根据勾选的字段生成模板
  const rebuildTemplate = (keys: Set<string>) => {
    const selectedFields = fields.filter(f => keys.has(f.fieldKey));
    const basic = selectedFields.filter(f => f.category === 'basic');
    const detail = selectedFields.filter(f => f.category === 'detail');
    const calc = selectedFields.filter(f => f.category === 'calculated');

    const lines: string[] = [];
    // 标题
    const modName = MODULE_NAMES[selectedModule] || selectedModule;
    lines.push(`【${modName}】`);
    lines.push('');

    // 基本信息
    for (const f of basic) {
      lines.push(`${f.fieldName}：{${f.fieldKey.replace(/[{}]/g, '')}}`);
    }

    // 明细
    for (const f of detail) {
      lines.push('');
      lines.push(`${f.fieldName}：`);
      lines.push(`{${f.fieldKey.replace(/[{}]/g, '')}}`);
    }

    // 计算字段
    if (calc.length > 0) {
      lines.push('');
      for (const f of calc) {
        lines.push(`${f.fieldName}：{${f.fieldKey.replace(/[{}]/g, '')}}`);
      }
    }

    setHeaderText(lines.join('\n'));
  };

  // 快捷插入字段到编辑器
  const insertField = (key: string) => {
    const varName = key.replace(/[{}]/g, '');
    setHeaderText(prev => prev + `{${varName}}`);
  };

  // 预览（发送勾选的字段到后端）
  const buildPreview = async () => {
    if (!selectedModule) return;
    setPreviewLoading(true);
    try {
      const r = await previewTemplate({
        moduleCode: selectedModule,
        sourceId: previewSourceId ? Number(previewSourceId) : undefined,
        selectedFields: Array.from(checkedFields),
        templateTitle: title,
        templateHeader: headerText,
        templateFooter: footerText,
        senderName: customSender,
      });
      setPreview(r.message);
    } catch (err: any) {
      setPreview('预览失败：' + (err?.response?.data?.error || err.message));
    } finally { setPreviewLoading(false); }
  };

  // 保存
  const save = async () => {
    if (!selectedModule) return;
    if (!title.trim()) { alert('请输入模板名称/标题'); return; }
    setSaving(true);
    try {
      // 勾选了视频时，把视频链接并入消息正文，确保任何推送方式都带链接
      let bodyText = headerText;
      if (selectedVideos.size > 0) {
        const base = `${window.location.protocol}//${window.location.host}`;
        const vLines = shipinVideos
          .filter(v => selectedVideos.has(v.url))
          .map(v => `${v.index}. ${v.name}（${v.sizeMB}MB） ${base}${v.url}`);
        bodyText = headerText + (headerText ? '\n\n' : '') + '📺 培训视频：\n' + vLines.join('\n');
      }
      const payload: any = {
        moduleCode: selectedModule,
        templateName: title.replace(/【|】/g, '') || '默认模板',
        title,
        headerTemplate: bodyText,
        bodyTemplate: '',
        footerTemplate: footerText,
        selectedFields: Array.from(checkedFields),
        isDefault: selectedTemplate?.isDefault || false,
        pushMode: pushMode,
        dataSourceMode: dataSourceMode,
        triggerType: triggerType,
        triggerConfig: triggerType === 'scheduled' ? { cron: triggerCron, senderName: customSender }
          : triggerType === 'on_threshold' ? { count: triggerCount, senderName: customSender }
          : { senderName: customSender },
        selectedRecipients: Array.from(selectedRecipients),
        startTime: startTime || null,
        endTime: endTime || null,
      };
      if (filterRoleId) {
        const role = roleOptions.find(x => String(x.roleId) === String(filterRoleId));
        if (role) payload.recipientPosition = `角色:${role.roleName}`;
      }
      if (filterOrgId) {
        const org = orgOptions.find(x => String(x.orgId) === String(filterOrgId));
        if (org) payload.recipientGroup = `组织:${org.orgName}`;
      }

      if (selectedTemplate?.id) {
        await updateTemplate(selectedTemplate.id, payload);
      } else {
        await createTemplate(selectedModule, payload);
      }
      alert('保存成功');
      selectModule(selectedModule);
    } catch (err: any) {
      alert('保存失败: ' + (err?.response?.data?.error || err.message));
    } finally { setSaving(false); }
  };

  const del = async (id: number) => {
    if (!confirm('确定删除此模板？')) return;
    try { await deleteTemplate(id); selectModule(selectedModule); } catch {}
  };

  const copyFields = () => {
    const lines = fields.map(f => `${f.fieldKey}  — ${f.fieldName}`);
    navigator.clipboard.writeText(lines.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  // ===== 媒体文件推送 =====
  const handleMediaFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setMediaFile(f);
      setMediaUploaded(null);
      setMediaResult('');
    }
  };

  const handleUploadMedia = async () => {
    if (!mediaFile) return;
    setMediaUploading(true);
    setMediaResult('');
    try {
      const r = await uploadWechatMedia(mediaFile);
      if (r.ok) {
        setMediaUploaded({ media_id: r.media_id, type: r.type, filename: r.filename });
        setMediaResult(`上传成功：${r.filename}（${(r.size / 1024).toFixed(1)}KB）`);
      } else {
        setMediaResult('上传失败：' + (r.error || '未知错误'));
      }
    } catch (err: any) {
      setMediaResult('上传失败：' + (err?.response?.data?.error || err.message));
    } finally { setMediaUploading(false); }
  };

  const handleSendMedia = async () => {
    if (!mediaUploaded) { alert('请先上传文件'); return; }
    if (selectedRecipients.size === 0) { alert('请先选择接收人'); return; }
    setMediaSending(true);
    setMediaResult('');
    try {
      // 正文作为说明文字一并发送（含发送人署名替换）
      let text = headerText
        .replace(/\{time\}/g, new Date().toLocaleString('zh-CN'))
        .replace(/\{sender\}/g, customSender);
      const r = await sendWechatMedia({
        recipients: Array.from(selectedRecipients),
        mediaId: mediaUploaded.media_id,
        msgtype: (mediaUploaded.type === 'image' || mediaUploaded.type === 'video') ? mediaUploaded.type : 'file',
        text,
      });
      setMediaResult(`推送完成：共 ${r.total} 人，成功 ${r.success} 人${r.success < r.total ? '\n失败明细：' + JSON.stringify(r.detail.filter((x: any) => !x.ok)) : ''}`);
    } catch (err: any) {
      setMediaResult('推送失败：' + (err?.response?.data?.error || err.message));
    } finally { setMediaSending(false); }
  };

  // ===== 服务器视频列表 =====
  const loadShipinVideos = async () => {
    setVideoLoading(true);
    try {
      const r = await getShipinVideos();
      setShipinVideos(r.files || []);
    } catch { setShipinVideos([]); }
    setVideoLoading(false);
  };

  const toggleVideo = (url: string) => {
    const next = new Set(selectedVideos);
    next.has(url) ? next.delete(url) : next.add(url);
    setSelectedVideos(next);
    setVideoPushResult('');
  };

  // 推送选中的服务器视频链接（按选择顺序）
  const handlePushVideos = async () => {
    if (selectedVideos.size === 0) { setVideoPushResult('请先选择要推送的视频'); return; }
    if (selectedRecipients.size === 0) { setVideoPushResult('请先选择接收人'); return; }
    setMediaSending(true); setVideoPushResult('');
    try {
      // 生成正文：标题 + 逐个视频的播放链接（保留选择顺序）
      const base = `${window.location.protocol}//${window.location.host}`;
      const selected = shipinVideos.filter(v => selectedVideos.has(v.url));
      const lines = [
        headerText ? headerText.replace(/\{time\}/g, new Date().toLocaleString('zh-CN')).replace(/\{sender\}/g, customSender) : '',
        '',
        '📹 培训视频：',
        ...selected.map(v => `${v.index}. ${v.name}（${v.sizeMB}MB）\n   ${base}${v.url}`),
      ].filter(l => l !== '');
      const content = lines.join('\n');

      const r = await sendWechatMedia({
        recipients: Array.from(selectedRecipients),
        mediaId: '', // 视频走链接，不做媒体上传
        msgtype: 'file',
        text: content,
      });
      setVideoPushResult(`推送完成：共 ${r.total} 人，成功 ${r.success} 人${r.success < r.total ? '\n失败明细：' + JSON.stringify(r.detail.filter((x: any) => !x.ok)) : ''}`);
    } catch (err: any) {
      setVideoPushResult('推送失败：' + (err?.response?.data?.error || err.message));
    } finally { setMediaSending(false); }
  };

  const checkedCount = checkedFields.size;
  const basicChecked = fields.filter(f => f.category === 'basic' && checkedFields.has(f.fieldKey)).length;
  const detailChecked = fields.filter(f => f.category === 'detail' && checkedFields.has(f.fieldKey)).length;
  const calcChecked = fields.filter(f => f.category === 'calculated' && checkedFields.has(f.fieldKey)).length;

  return (
    <div className="min-h-screen bg-gray-100">
      <PageHeader title="消息模板生成器" subtitle="选择模块 → 勾选字段 → 编辑模板 → 选推送人 → 保存" />
      <div className="max-w-7xl mx-auto px-4 py-4 flex gap-4" style={{ minHeight: 'calc(100vh - 120px)' }}>
        <WechatPushSidebar />
        {/* 左：模块 + 模板列表 */}
        <div className="w-64 shrink-0 space-y-3">
          <div className="bg-white rounded-lg shadow-sm p-3">
            <label className="text-xs text-gray-500 font-semibold">选择推送模块</label>
            <select className="w-full border rounded px-2 py-1.5 text-sm mt-1"
              value={selectedModule} onChange={e => selectModule(e.target.value)}>
              <option value="">-- 请选择 --</option>
              {modules.map(m => (
                <option key={m.moduleCode} value={m.moduleCode}>{m.moduleName} ({m.fieldCount}个字段)</option>
              ))}
            </select>
          </div>
          {selectedModule && (
            <div className="bg-white rounded-lg shadow-sm p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-sm">已有模板</h3>
                <button onClick={newTemplate} className="p-1 bg-blue-500 text-white rounded hover:bg-blue-600"><Plus size={14} /></button>
              </div>
              <div className="space-y-1 max-h-[300px] overflow-auto">
                {templates.length === 0 && <p className="text-xs text-gray-400">暂无模板</p>}
                {(Array.isArray(templates) ? templates : []).map(t => (
                  <div key={t.id}
                    className={`px-2 py-1.5 rounded cursor-pointer text-xs flex items-center justify-between ${selectedTemplate?.id === t.id ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
                    onClick={() => editTemplate(t)}>
                    <span className="truncate">{t.title || t.templateName}{t.isDefault ? ' ⭐' : ''}</span>
                    <button onClick={e => { e.stopPropagation(); t.id && del(t.id); }}
                      className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 中：字段选择 */}
        {selectedModule && (
          <div className="w-64 shrink-0 bg-white rounded-lg shadow-sm p-3 overflow-auto" style={{ maxHeight: 'calc(100vh - 160px)' }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-sm">可用字段（已选{checkedCount}）</h3>
              <button onClick={copyFields}
                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? '已复制' : '复制全部'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3">勾选要包含在推送消息中的字段，模板自动更新</p>
            {Object.entries(groupedFields instanceof Object ? groupedFields : {}).map(([cat, flds]) => {
              if (flds.length === 0) return null;
              const catChecked = flds.filter(f => checkedFields.has(f.fieldKey)).length;
              return (
                <div key={cat} className="mb-3">
                  <div className="text-xs font-semibold text-gray-500 mb-1 border-b pb-1 flex justify-between">
                    <span>{CATEGORY_NAMES[cat] || cat}</span>
                    <span className="text-blue-500">{catChecked}/{flds.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {flds.map(f => {
                      const isChecked = checkedFields.has(f.fieldKey);
                      return (
                        <label key={f.fieldKey}
                          className={`flex items-start gap-2 py-1 px-1.5 rounded cursor-pointer text-xs ${isChecked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                          <input type="checkbox" className="mt-0.5 w-3.5 h-3.5"
                            checked={isChecked} onChange={() => toggleField(f.fieldKey)} />
                          <div className="flex-1">
                            <div className={`font-mono ${isChecked ? 'text-blue-700 font-semibold' : 'text-gray-600'}`}>
                              {f.fieldKey}
                            </div>
                            <div className="text-gray-500">{f.fieldName}</div>
                            {f.description && <div className="text-gray-400 text-[10px]">{f.description}</div>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 右：编辑区 */}
        {selectedModule && editing && (
          <div className="flex-1 bg-white rounded-lg shadow-sm p-4 overflow-auto space-y-3" style={{ maxHeight: 'calc(100vh - 160px)' }}>
            {/* 操作栏 */}
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-sm">
                {selectedTemplate ? '编辑模板' : '新建模板'}
                <span className="text-gray-400 font-normal ml-2 text-xs">
                  （基本{basicChecked} + 明细{detailChecked} + 计算{calcChecked} = {checkedCount}字段）
                </span>
              </h3>
              <div className="flex items-center gap-2">
                <input type="number" placeholder="源数据ID" className="w-20 border rounded px-2 py-1 text-xs"
                  value={previewSourceId} onChange={e => setPreviewSourceId(e.target.value)} />
                <button onClick={buildPreview} disabled={previewLoading}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm flex items-center gap-1">
                  <Eye size={14} /> {previewLoading ? '预览中...' : '预览'}
                </button>
                <button onClick={save} disabled={saving}
                  className="px-4 py-1 bg-blue-600 text-white rounded text-sm flex items-center gap-1 disabled:opacity-50">
                  <Save size={14} /> {saving ? '保存中' : '保存'}
                </button>
              </div>
            </div>

            {/* 推送模式 + 标题 */}
            <div className="flex gap-3 items-start">
              <div className="shrink-0">
                <label className="text-xs text-gray-500 font-semibold block mb-1">取值方式</label>
                <div className="flex rounded border overflow-hidden">
                  <button type="button"
                    onClick={() => setPushMode('detail')}
                    className={`px-3 py-1.5 text-xs flex items-center gap-1 ${pushMode === 'detail' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    <List size={14} /> 明细
                  </button>
                  <button type="button"
                    onClick={() => setPushMode('summary')}
                    className={`px-3 py-1.5 text-xs flex items-center gap-1 ${pushMode === 'summary' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    <BarChart3 size={14} /> 汇总
                  </button>
                </div>
                <div className="text-[10px] text-gray-400 mt-1">
                  {pushMode === 'detail' ? '每条记录单独推送' : '多条聚合为1条'}
                </div>
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-semibold">消息标题</label>
                <input className="w-full border rounded px-3 py-2 text-sm mt-1" value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="例如：【巡店自动通知】" />
              </div>
            </div>

            {/* 数据源策略 */}
            {selectedModule !== 'custom_notification' && (
              <div className="border-t pt-3">
                <label className="text-xs text-gray-500 font-semibold mb-2 block">数据源策略</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    { value: 'skip_query' as const, label: '不查询数据源，有数据就推', desc: '推送时自动按模块条件圈选全部数据，无需手动勾选（无数据自动跳过）' },
                    { value: 'realtime' as const, label: '实时查询数据再推', desc: '手动推送前需先在推送页查询源数据并勾选记录' },
                  ].map(opt => (
                    <label key={opt.value}
                      className={`flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition ${dataSourceMode === opt.value ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      <input type="radio" name="dataSourceMode" value={opt.value} className="mt-0.5"
                        checked={dataSourceMode === opt.value} onChange={() => setDataSourceMode(opt.value)} />
                      <span>
                        <span className="font-medium block">{opt.label}</span>
                        <span className="text-gray-400 block text-[10px] mt-0.5">{opt.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* 自定义通知：发送人设置 */}
            {selectedModule === 'custom_notification' && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3">
                <label className="text-xs text-blue-700 font-semibold">发送人署名（{'{sender}'} 的值）</label>
                <input className="w-full border rounded px-2 py-1.5 text-sm mt-1"
                  value={customSender} onChange={e => setCustomSender(e.target.value)}
                  placeholder="例如：总部通知 / 张经理" />
                <p className="text-[10px] text-gray-400 mt-1">在正文中用 {'{sender}'} 引用这个署名，发送时会自动替换</p>
              </div>
            )}

            {/* 自定义通知：视频推送（从服务器列表选择） */}
            {selectedModule === 'custom_notification' && (
              <div className="bg-purple-50 border border-purple-200 rounded p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Video size={14} className="text-purple-600" />
                  <span className="text-xs text-purple-700 font-semibold">服务器视频推送（从已上传视频中选择）</span>
                  <button onClick={loadShipinVideos} disabled={videoLoading}
                    className="ml-auto px-2 py-1 bg-white border border-purple-300 rounded text-xs text-purple-700 hover:bg-purple-100 flex items-center gap-1">
                    <RefreshCw size={12} /> {videoLoading ? '加载中...' : '刷新视频列表'}
                  </button>
                </div>

                {/* 视频选择列表 */}
                {shipinVideos.length === 0 && !videoLoading && (
                  <div className="text-xs text-gray-500 bg-white rounded p-2 border border-purple-100">
                    服务器暂无视频。请先将视频放入服务器的 <b>shipin</b> 文件夹，再点"刷新视频列表"。
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-auto">
                  {shipinVideos.map(v => {
                    const checked = selectedVideos.has(v.url);
                    return (
                      <label key={v.url} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs border ${checked ? 'bg-purple-100 ring-1 ring-purple-300' : 'bg-white hover:bg-purple-50'}`}>
                        <input type="checkbox" className="w-3.5 h-3.5" checked={checked} onChange={() => toggleVideo(v.url)} />
                        <span className="font-medium text-purple-700">#{v.index}</span>
                        <span className="flex-1 truncate text-gray-700">{v.name}</span>
                        <span className="text-[10px] text-gray-400">{v.sizeMB}MB</span>
                      </label>
                    );
                  })}
                </div>

                {/* 实时链接预览：勾选后立即显示生成的视频链接 */}
                {selectedVideos.size > 0 && (
                  <div className="bg-white border border-purple-200 rounded p-2">
                    <div className="text-[10px] text-purple-600 font-semibold mb-1">✅ 已生成视频链接（将随正文推送给用户）：</div>
                    <div className="text-xs text-gray-700 font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">
                      {(() => {
                        const base = `${window.location.protocol}//${window.location.host}`;
                        return shipinVideos
                          .filter(v => selectedVideos.has(v.url))
                          .map(v => `${v.index}. ${v.name}\n   ${base}${v.url}`)
                          .join('\n');
                      })()}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <button onClick={handlePushVideos} disabled={mediaSending || selectedVideos.size === 0 || selectedRecipients.size === 0}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs disabled:opacity-50 flex items-center gap-1">
                    <Send size={12} /> {mediaSending ? '群发中...' : `群发（${selectedVideos.size}个视频链接，自动批量发给已选${selectedRecipients.size}人）`}
                  </button>
                  <span className="text-[10px] text-green-600 font-medium">多人时自动批量群发，几秒内完成</span>
                </div>
                <p className="text-[10px] text-gray-400">大视频无法直接作为企微文件发送（上限20MB），故用服务器视频列表+下载链接方式推送（2个人选接收人，再选视频，推送）。</p>
                {videoPushResult && <div className="mt-2 text-xs bg-white rounded p-2 text-green-700 border border-green-200 whitespace-pre-wrap">{videoPushResult}</div>}
              </div>
            )}

            {/* 模板正文 + 快捷插入字段 */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-semibold">
                  {selectedModule === 'custom_notification'
                    ? '通知正文（直接写你要发送的内容，可用 {time} 和 {sender}）'
                    : `消息正文（可用 {'{变量}'} 占位符，推送时替换为真实数据）`}
                </label>
                <textarea rows={selectedModule === 'custom_notification' ? 10 : 14}
                  className="w-full border rounded px-3 py-2 text-sm font-mono mt-1"
                  value={headerText}
                  onChange={e => setHeaderText(e.target.value)}
                  placeholder={selectedModule === 'custom_notification'
                    ? '各位同事：\n\n接总部通知，明天下午2点进行月度会议。\n请各部门准时参加。\n\n发送时间：{time}\n发送人：{sender}'
                    : '督导：{supervisor}\n巡店日期：{date}\n目的地：{destination}\n...'} />
                {selectedModule === 'custom_notification' && (
                  <div className="mt-1 text-[10px] text-gray-400">
                    点击右侧「快捷插入」可将 {'{time}'} 和 {'{sender}'} 插入光标位置，发送时自动替换
                  </div>
                )}
              </div>
              {/* 快捷插入按钮 */}
              <div className="w-32 shrink-0">
                <label className="text-xs text-gray-500 font-semibold">快捷插入</label>
                <div className="mt-1 space-y-0.5 max-h-[300px] overflow-auto">
                  {fields.filter(f => checkedFields.has(f.fieldKey)).map(f => (
                    <button key={f.fieldKey}
                      onClick={() => insertField(f.fieldKey)}
                      className="w-full text-left px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-xs font-mono border border-blue-200 truncate block"
                      title={f.fieldName}>
                      {f.fieldKey}
                    </button>
                  ))}
                  {checkedCount === 0 && <p className="text-xs text-gray-400 p-2">请在左侧勾选字段</p>}
                </div>
              </div>
            </div>

            {/* 尾部 */}
            <div>
              <label className="text-xs text-gray-500 font-semibold">消息尾部</label>
              <textarea rows={2}
                className="w-full border rounded px-3 py-2 text-sm mt-1"
                value={footerText}
                onChange={e => setFooterText(e.target.value)} />
            </div>

            {/* 接收人设置 */}
            <div className="border-t pt-3">
              <label className="text-xs text-gray-500 font-semibold flex items-center gap-1">
                <UserPlus size={14} /> 推送接收人设置
              </label>

              {/* 筛选区 */}
              <div className="grid grid-cols-4 gap-2 mt-2 mb-2">
                <div>
                  <label className="text-[10px] text-gray-500">角色</label>
                  <select className="w-full border rounded px-2 py-1 text-xs mt-0.5"
                    value={filterRoleId} onChange={e => setFilterRoleId(e.target.value)}>
                    <option value="">全部角色</option>
                    {roleOptions.map(r => <option key={r.roleId} value={r.roleId}>{r.roleName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">组织（含下级）</label>
                  <select className="w-full border rounded px-2 py-1 text-xs mt-0.5"
                    value={filterOrgId} onChange={e => setFilterOrgId(e.target.value)}>
                    <option value="">全部组织</option>
                    {orgOptions.map(o => <option key={o.orgId} value={o.orgId}>{o.orgName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">姓名/工号搜索</label>
                  <input className="w-full border rounded px-2 py-1 text-xs mt-0.5"
                    value={recipientKeyword} onChange={e => setRecipientKeyword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && doSearchRecipients()}
                    placeholder="输入搜索..." />
                </div>
                <div className="flex items-end gap-1">
                  <button onClick={doSearchRecipients} disabled={recipientLoading}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-xs flex items-center gap-1">
                    <Search size={12} /> {recipientLoading ? '搜索中' : '搜索'}
                  </button>
                  {(filterRoleId || filterOrgId || recipientKeyword) && (
                    <button onClick={() => { setFilterRoleId(''); setFilterOrgId(''); setRecipientKeyword(''); setRecipientUsers([]); setRecipientNoWechat([]); }}
                      className="px-2 py-1 bg-gray-100 rounded text-xs"><X size={12} /></button>
                  )}
                </div>
              </div>

              {/* 选择区：搜索出来的用户列表 */}
              {(recipientUsers.length > 0 || recipientNoWechat.length > 0) && (
                <div className="border rounded max-h-56 overflow-auto mb-2">
                  {recipientUsers.length > 0 && (
                    <div className="p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-green-600 font-semibold">可推送用户（勾选即加入确认区）</span>
                        <button onClick={() => {
                          const all = new Set(recipientUsers.map(u => u.wechatAccount));
                          setSelectedRecipients(all);
                        }} className="text-[10px] text-blue-600 hover:text-blue-700 underline">全选</button>
                      </div>
                      <div className="grid grid-cols-2 gap-0.5">
                        {recipientUsers.map(u => {
                          const key = u.wechatAccount;
                          const isChecked = selectedRecipients.has(key);
                          return (
                            <label key={key}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-xs ${isChecked ? 'bg-blue-100 ring-1 ring-blue-300' : 'hover:bg-gray-50'}`}>
                              <input type="checkbox" className="w-3 h-3" checked={isChecked}
                                onChange={() => {
                                  const next = new Set(selectedRecipients);
                                  isChecked ? next.delete(key) : next.add(key);
                                  setSelectedRecipients(next);
                                }} />
                              <span className="font-medium truncate">{u.userName}</span>
                              <span className="text-gray-400 text-[10px] truncate">{u.position}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {recipientNoWechat.length > 0 && (
                    <div className="p-2 border-t bg-gray-50">
                      <div className="text-[10px] text-orange-500 font-semibold mb-1 flex items-center gap-1">
                        <AlertCircle size={10} /> 未绑定企微账号（不可选 — 共{recipientNoWechat.length}人）
                      </div>
                      <div className="grid grid-cols-2 gap-0.5">
                        {recipientNoWechat.slice(0, 20).map(u => (
                          <div key={u.userCode} className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400">
                            <input type="checkbox" className="w-3 h-3" disabled />
                            <span className="line-through truncate">{u.userName}</span>
                            <span className="text-gray-300 text-[10px]">无企微</span>
                          </div>
                        ))}
                        {recipientNoWechat.length > 20 && (
                          <div className="text-xs text-gray-400 px-2">...还有{recipientNoWechat.length - 20}人</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 确认区：已选接收人 */}
              {selectedRecipients.size > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-green-700 font-semibold">已确认推送人选（{selectedRecipients.size}人）</span>
                    <button onClick={() => setSelectedRecipients(new Set())}
                      className="text-xs text-green-600 hover:text-red-500">清空全部</button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Array.from(selectedRecipients).map(acc => {
                      // 从 recipientUsers 中找到名字
                      const u = recipientUsers.find(r => r.wechatAccount === acc);
                      return (
                        <span key={acc} className="inline-flex items-center gap-1 bg-white border border-green-300 rounded-full px-2 py-0.5 text-xs">
                          {u?.userName || acc}
                          <button onClick={() => {
                            const next = new Set(selectedRecipients);
                            next.delete(acc);
                            setSelectedRecipients(next);
                          }} className="text-gray-400 hover:text-red-500 ml-0.5"><X size={10} /></button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedRecipients.size === 0 && (recipientUsers.length > 0 || recipientNoWechat.length > 0) && (
                <div className="text-xs text-gray-400 mb-2">未选择具体用户：推送时将按系统默认策略匹配（接收人角色/组织 → 店铺权限组）</div>
              )}
            </div>

            {/* 生效时间范围 */}
            <div className="border-t pt-3">
              <label className="text-xs text-gray-500 font-semibold mb-2 block">生效时间范围（可选）</label>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">开始</span>
                  <input type="date" className="border rounded px-2 py-1 text-xs w-36"
                    value={startTime} onChange={e => setStartTime(e.target.value)} />
                </div>
                <span className="text-gray-300">~</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">结束</span>
                  <input type="date" className="border rounded px-2 py-1 text-xs w-36"
                    value={endTime} onChange={e => setEndTime(e.target.value)} />
                </div>
                {(startTime || endTime) && (
                  <button onClick={() => { setStartTime(''); setEndTime(''); }}
                    className="text-xs text-gray-400 hover:text-red-500 ml-1">清除</button>
                )}
                <span className="text-xs text-gray-400">留空表示永久生效</span>
              </div>
            </div>

            {/* 触发器设置 */}
            <div className="border-t pt-3">
              <label className="text-xs text-gray-500 font-semibold mb-2 block">触发条件</label>
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { value: 'manual', label: '手动', icon: null, desc: '仅手动点击推送' },
                  { value: 'scheduled', label: '定时', icon: Clock, desc: '按时间自动推送' },
                  { value: 'on_create', label: '新增', icon: Zap, desc: '源表有新数据即推送' },
                  { value: 'on_threshold', label: '定量', icon: Hash, desc: '累积N条后推送' },
                ].map(opt => (
                  <label key={opt.value}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-xs transition ${triggerType === opt.value ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    <input type="radio" name="triggerType" value={opt.value} className="sr-only"
                      checked={triggerType === opt.value} onChange={() => setTriggerType(opt.value)} />
                    {opt.icon && <opt.icon size={12} />}
                    <span className="font-medium">{opt.label}</span>
                    <span className="text-gray-400 text-[10px] hidden sm:inline">{opt.desc}</span>
                  </label>
                ))}
              </div>

              {triggerType === 'scheduled' && (
                <div className="mt-2 p-3 bg-purple-50 border border-purple-200 rounded text-xs">
                  <label className="text-gray-600 font-medium">定时规则</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input className="border rounded px-2 py-1 text-xs w-48 font-mono"
                      value={triggerCron} onChange={e => setTriggerCron(e.target.value)}
                      placeholder="每天的执行时间" />
                    <span className="text-gray-400">例如：<code className="bg-purple-100 px-1 rounded">09:00</code>（每天9点）、<code className="bg-purple-100 px-1 rounded">* 9 * * *</code>（cron）</span>
                  </div>
                </div>
              )}

              {triggerType === 'on_threshold' && (
                <div className="mt-2 p-3 bg-cyan-50 border border-cyan-200 rounded text-xs">
                  <label className="text-gray-600 font-medium">累计数量阈值</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="number" className="border rounded px-2 py-1 text-xs w-24"
                      value={triggerCount} onChange={e => setTriggerCount(Number(e.target.value))} min={1} />
                    <span className="text-gray-400">条新记录后自动推送</span>
                  </div>
                </div>
              )}
            </div>

            {/* 预览 */}
            {preview && (
              <div className="bg-gray-50 border rounded p-4">
                <div className="text-xs text-gray-500 mb-2 font-semibold">预览效果（{previewSourceId ? '真实数据' : '模拟数据'}）：</div>
                <pre className="whitespace-pre-wrap font-mono text-xs max-h-60 overflow-auto">{preview}</pre>
              </div>
            )}
          </div>
        )}

        {/* 未进入编辑 */}
        {selectedModule && !editing && (
          <div className="flex-1 bg-white rounded-lg shadow-sm p-8 flex items-center justify-center">
            <div className="text-center max-w-md">
              <p className="text-lg font-semibold text-gray-700 mb-2">选择已有模板编辑，或点击 <Plus className="inline w-4 h-4 text-blue-500" /> 新建</p>
              <div className="text-left text-xs text-gray-500 space-y-1 bg-gray-50 p-4 rounded-lg border mt-4">
                <div className="font-semibold mb-1">各模块包含的字段类型：</div>
                <div><b>巡店日志</b> — 督导、目的地、核心事项、店铺问题...</div>
                <div><b>运营工作汇报</b> — 月度目标、达成率、金额、连带率、订单量...</div>
                <div><b>日常指标上传</b> — 订单量指标、礼品率、新会员、连带率...</div>
                <div><b>陪跑跟进</b> — 店铺、月销售额、月目标、达成率、订单量、客单价...</div>
                <div><b>培训反馈</b> — 任务编号、标题、提交人、店铺...</div>
                <div><b>评分体系</b> — 总分、排名、销售增长分...</div>
                <div><b>月目标分解</b> — 月度目标、月目标金额、督导...</div>
                <div><b>巡店任务</b> — 任务名称、负责人、截止日期...</div>
                <div><b>财务字段</b> — 商品代码、品名、财务性别、大类、风格、款式...</div>
                <div><b>无成本价商品</b> — 商品代码、品名、预估成本、年份、季节、大类...</div>
                <div><b>注册管理</b> — 申请编号、姓名、工号、手机号、仓库类别、所属组织、申请状态...</div>
              </div>
            </div>
          </div>
        )}

        {!selectedModule && (
          <div className="flex-1 bg-white rounded-lg shadow-sm p-4 overflow-auto" style={{ maxHeight: 'calc(100vh - 160px)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm">全部已建模板（{allTemplates.length}）</h3>
              <span className="text-xs text-gray-400">选择左侧模块可新建模板 / 点击模板可编辑</span>
            </div>
            {allTemplates.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p className="mb-2">暂无模板，请先选择模块并新建</p>
                <div className="text-xs text-left max-w-md mx-auto space-y-1 bg-gray-50 p-4 rounded-lg">
                  <div><b>巡店日志</b> — 督导、目的地、核心事项...</div>
                  <div><b>运营工作汇报</b> — 月度目标、达成率、金额...</div>
                  <div><b>陪跑跟进</b> — 销售额、目标、达成率...</div>
                  <div><b>评分体系</b> — 总分、排名...</div>
                </div>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">模块</th>
                    <th className="text-left px-3 py-2">模板名称</th>
                    <th className="text-left px-3 py-2">推送模式</th>
                    <th className="text-left px-3 py-2">触发方式</th>
                    <th className="text-left px-3 py-2">生效时间</th>
                    <th className="text-left px-3 py-2">创建时间</th>
                    <th className="text-left px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {allTemplates.map(tpl => (
                    <tr key={tpl.id} className="border-t hover:bg-gray-50 cursor-pointer"
                      onClick={() => { setSelectedModule(tpl.moduleCode); setTimeout(() => editTemplate(tpl), 50); }}>
                      <td className="px-3 py-2 text-gray-500 text-xs">{MODULE_NAMES[tpl.moduleCode] || tpl.moduleCode}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{tpl.title || tpl.templateName}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${tpl.pushMode === 'summary' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                          {tpl.pushMode === 'summary' ? '汇总' : '明细'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <TriggerBadge type={tpl.triggerType} />
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {tpl.startTime || tpl.endTime
                          ? `${tpl.startTime ? String(tpl.startTime).split('T')[0] : '∞'} ~ ${tpl.endTime ? String(tpl.endTime).split('T')[0] : '∞'}`
                          : <span className="text-gray-400">永久</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-400 text-xs">{tpl.createdAt?.split('T')[0]}</td>
                      <td className="px-3 py-2">
                        <button onClick={e => { e.stopPropagation(); tpl.id && del(tpl.id); loadAllTemplates(); }}
                          className="text-red-400 hover:text-red-600 text-xs">删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TriggerBadge({ type }: { type?: string }) {
  switch (type) {
    case 'scheduled': return <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 flex items-center gap-0.5 w-fit"><Clock size={10} />定时</span>;
    case 'on_create': return <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 flex items-center gap-0.5 w-fit"><Zap size={10} />新增</span>;
    case 'on_threshold': return <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700 flex items-center gap-0.5 w-fit"><Hash size={10} />定量</span>;
    default: return <span className="text-xs text-gray-400">手动</span>;
  }
}
