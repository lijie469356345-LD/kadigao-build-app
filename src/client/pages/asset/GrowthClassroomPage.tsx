import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../../components/Layout';
import { growthClassroomApi } from '../../../api/growthClassroom';
import {
  Upload, Search, Loader2, X, Play, Download, FileText, Film,
  Presentation, Table, File, Image as ImageIcon, Eye, BarChart3,
  Clock, AlertCircle, CheckCircle2, BookOpen, GraduationCap, Trash2, Folder, FolderInput, FolderCog, Pencil, Plus,
} from 'lucide-react';
import { renderAsync as renderDocxAsync } from 'docx-preview';
import { init as initPptxPreview } from 'pptx-preview';
import * as XLSX from 'xlsx';

// ============================================================
// 类型定义
// ============================================================
interface Category {
  catCode: string;
  catName: string;
  materialCount: number;
}

interface Material {
  id: number;
  categoryCode: string;
  subCategory: string;
  catName: string;
  title: string;
  summary: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string;
  uploaderCode: string;
  uploaderName: string;
  createdAt: string;
  viewUsers: number;
  viewSeconds: number;
  downloadUsers: number;
  downloadCount: number;
}

interface LogDetail {
  userCode: string;
  userName: string;
  watchTimes?: number;
  totalSeconds?: number;
  firstTime?: string;
  lastTime?: string;
  downloadTimes?: number;
  createdAt?: string;
  watchSeconds?: number;
}

interface LogsData {
  watchSummary: { users: number; totalSeconds: number };
  watchAgg: LogDetail[];
  watchDetails: LogDetail[];
  downloadSummary: { users: number; totalCount: number };
  downloadAgg: LogDetail[];
  downloadDetails: LogDetail[];
}

// ============================================================
// 常量
// ============================================================
const ALLOWED_EXTS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.flv', '.wmv', '.ppt', '.pptx', '.doc', '.docx', '.xls', '.xlsx', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.txt'];

// 每个分类下的文件类型分区：文档区 / EXCEL区 / PPT区 / 视频区
const FILE_ZONES: { key: string; label: string; icon: any; types: string[] }[] = [
  { key: 'doc', label: '文档区', icon: FileText, types: ['word', 'pdf', 'image', 'other'] },
  { key: 'excel', label: 'EXCEL区', icon: Table, types: ['excel'] },
  { key: 'ppt', label: 'PPT区', icon: Presentation, types: ['ppt'] },
  { key: 'video', label: '视频区', icon: Film, types: ['video'] },
];

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function formatDuration(seconds: number): string {
  const s = Math.floor(seconds || 0);
  if (s < 60) return s + ' 秒';
  if (s < 3600) return Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒';
  return Math.floor(s / 3600) + ' 小时 ' + Math.floor((s % 3600) / 60) + ' 分';
}

function formatDate(d: string | undefined | null): string {
  if (!d) return '-';
  const s = String(d);
  return s.length >= 19 ? s.slice(0, 19).replace('T', ' ') : (s.length >= 10 ? s.slice(0, 10) : s);
}

function FileTypeIcon({ fileType, className }: { fileType: string; className?: string }) {
  const cls = className || 'w-10 h-10';
  switch (fileType) {
    case 'video': return <Film className={`${cls} text-blue-500`} />;
    case 'ppt': return <Presentation className={`${cls} text-orange-500`} />;
    case 'word': return <FileText className={`${cls} text-blue-600`} />;
    case 'excel': return <Table className={`${cls} text-green-600`} />;
    case 'pdf': return <FileText className={`${cls} text-red-500`} />;
    case 'image': return <ImageIcon className={`${cls} text-purple-500`} />;
    default: return <File className={`${cls} text-blue-400`} />;
  }
}

// 受保护文档扩展名：下载走服务端水印接口，uploads 静态直出已被后端拦截
const PROTECTED_DOC_EXTS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'];

// 预览水印层：文档/PPT/PDF/Excel 预览时叠加斜排半透明水印（视频、图片不叠加）
function WatermarkGrid({ text }: { text: string }) {
  const COLS = 4;
  const ROWS = 10;
  const cells = Array.from({ length: COLS * ROWS });
  return (
    <div className="absolute inset-0 z-10 select-none pointer-events-none overflow-hidden" aria-hidden>
      {cells.map((_, i) => (
        <span
          key={i}
          className="absolute flex items-center justify-center text-gray-500 font-semibold whitespace-nowrap"
          style={{
            left: `${(i % COLS) * (100 / COLS)}%`,
            top: `${Math.floor(i / COLS) * (100 / ROWS)}%`,
            width: `${100 / COLS}%`,
            height: `${100 / ROWS}%`,
            transform: 'rotate(-30deg)',
            fontSize: '14px',
            opacity: 0.18,
          }}
        >
          {text}
        </span>
      ))}
    </div>
  );
}

// ============================================================
// 页面组件
// ============================================================
export default function GrowthClassroomPage() {
  const [searchParams] = useSearchParams();
  const gcCat = searchParams.get('gcCat');
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<{ id: number; categoryCode: string; subName: string }[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [keyword, setKeyword] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');
  const [loading, setLoading] = useState(false);
  // 「上传资料」菜单授权：授权后才显示上传/删除入口（初始 undefined=加载中，不显示）
  const [canManage, setCanManage] = useState<boolean | undefined>(undefined);

  // 查询当前用户是否被授予「上传资料」菜单权限（侧边栏同源：/api/permissions/my-menus）
  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch('/api/permissions/my-menus', { headers: { 'Authorization': `Bearer ${token || ''}` } })
      .then(r => r.json())
      .then((data) => {
        const menuEns = new Set<string>();
        (data?.portals || []).forEach((p: any) => (p.menus || []).forEach((m: any) => { if (m.menuEn) menuEns.add(m.menuEn); }));
        setCanManage(menuEns.has('gcUpload'));
      })
      .catch(() => setCanManage(false));
  }, []);

  // 上传弹窗
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploadSubCategory, setUploadSubCategory] = useState('');
  const [uploadNewSub, setUploadNewSub] = useState(false);
  const [uploadSummary, setUploadSummary] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 移动资料到子区弹窗
  const [moveTarget, setMoveTarget] = useState<Material | null>(null);
  const [moveSub, setMoveSub] = useState('');
  const [moving, setMoving] = useState(false);

  // 子区管理弹窗（新增/改名/删除）
  const [showSubManage, setShowSubManage] = useState(false);
  const [subNewCat, setSubNewCat] = useState('');
  const [subNewName, setSubNewName] = useState('');
  const [subEditingId, setSubEditingId] = useState<number | null>(null);
  const [subEditName, setSubEditName] = useState('');
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState('');

  // 在线观看弹窗
  const [playing, setPlaying] = useState<Material | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastReported = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 在线预览弹窗（视频以外的全部类型）
const [preview, setPreview] = useState<Material | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const previewBodyRef = useRef<HTMLDivElement>(null);
  // PDF 预览改用 blob URL（服务端收口后不能直接 iframe 静态路径）
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const previewPdfUrlRef = useRef<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewOpenedAt = useRef(0);
  const previewReported = useRef(0);

  // 当前登录用户（预览水印显示）
  const [me] = useState<any>(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch { return null; }
  });

  // 预览水印文案（当前登录用户，展示在文档/PPT/PDF/Excel 预览层上）
  const previewWatermarkText = [me?.userName, me?.userCode].filter(Boolean).join(' ') || '';

  // 日志明细弹窗
  const [logTarget, setLogTarget] = useState<Material | null>(null);
  const [logs, setLogs] = useState<LogsData | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logTab, setLogTab] = useState<'watch' | 'download'>('watch');

  // ============================================================
  // 数据加载
  // ============================================================
  const loadCategories = useCallback(async () => {
    try {
      const res = await growthClassroomApi.getCategories();
      if (res.data?.ok) {
        setCategories(res.data.data || []);
        if (!activeCategory && res.data.data?.length) {
          setActiveCategory('');
        }
      }
    } catch { /* 忽略 */ }
  }, [activeCategory]);

  const loadSubCategories = useCallback(async () => {
    try {
      const res = await growthClassroomApi.getSubCategories();
      if (res.data?.ok) setSubCategories(res.data.data || []);
    } catch { /* 忽略 */ }
  }, []);

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (activeCategory) params.category = activeCategory;
      if (keyword) params.keyword = keyword;
      const res = await growthClassroomApi.list(params);
      if (res.data?.ok) {
        setMaterials(res.data.data || []);
      }
    } catch { /* 忽略 */ }
    finally { setLoading(false); }
  }, [activeCategory, keyword]);

  useEffect(() => {
    loadCategories();
    loadSubCategories();
  }, [loadCategories, loadSubCategories]);

  // 侧边菜单分类参数联动：gcCat 切换当前分类（空=全部）；gcAction=upload 保持"上传资料"视图，弹窗外层由页面按钮触发
  useEffect(() => {
    setActiveCategory(gcCat || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcCat, searchParams]);

  useEffect(() => {
    const debounce = setTimeout(() => setKeyword(searchInput.trim()), 400);
    return () => clearTimeout(debounce);
  }, [searchInput]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  const refreshAll = useCallback(() => {
    loadCategories();
    loadSubCategories();
    loadMaterials();
  }, [loadCategories, loadSubCategories, loadMaterials]);

  // ============================================================
  // 上传逻辑
  // ============================================================
  const handleUpload = async () => {
    setUploadError('');
    const title = uploadTitle.trim();
    const summary = uploadSummary.trim();
    if (!title) { setUploadError('标题不能为空'); return; }
    if (!uploadCategory) { setUploadError('请选择所属分类'); return; }
    if (!summary) { setUploadError('内容概述为必填项'); return; }
    if (!uploadFile) { setUploadError('请选择要上传的文件'); return; }
    const ext = '.' + (uploadFile.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) { setUploadError('不支持该文件类型（支持视频/PPT/Word/Excel/PDF/图片/TXT）'); return; }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('title', title);
      fd.append('category', uploadCategory);
      fd.append('subCategory', uploadSubCategory.trim());
      fd.append('summary', summary);
      fd.append('file', uploadFile);
      const res = await growthClassroomApi.upload(fd);
      if (res.data?.ok) {
        setShowUpload(false);
        setUploadTitle(''); setUploadCategory(''); setUploadSubCategory(''); setUploadNewSub(false); setUploadSummary(''); setUploadFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        refreshAll();
      } else {
        setUploadError(res.data?.error || '上传失败');
      }
    } catch (e: any) {
      setUploadError(e.response?.data?.error || '上传失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  // ============================================================
  // 视频在线观看 + 观看时长上报
  // ============================================================
  const flushWatchReport = useCallback((materialId: number) => {
    const elapsed = Math.floor(videoRef.current?.currentTime || 0);
    const delta = elapsed - lastReported.current;
    if (delta >= 1) {
      growthClassroomApi.reportWatch(materialId, delta).catch(() => {});
      lastReported.current = elapsed;
    }
  }, []);

  const openPlayer = (m: Material) => {
    setPlaying(m);
    lastReported.current = 0;
  };

  const closePlayer = () => {
    if (playing) flushWatchReport(playing.id);
    if (flushTimer.current) { clearInterval(flushTimer.current); flushTimer.current = null; }
    setPlaying(null);
    if (videoRef.current) videoRef.current.pause();
  };

  // video 起播后挂定时上报（每 10 秒刷一次）
  const onVideoPlay = () => {
    if (!playing) return;
    if (flushTimer.current) clearInterval(flushTimer.current);
    flushTimer.current = setInterval(() => flushWatchReport(playing.id), 10000);
  };

  const onVideoPause = () => {
    if (playing) flushWatchReport(playing.id);
    if (flushTimer.current) { clearInterval(flushTimer.current); flushTimer.current = null; }
  };

  const onVideoEnded = onVideoPause;

  useEffect(() => {
    return () => {
      if (flushTimer.current) clearInterval(flushTimer.current);
      if (previewTimer.current) clearInterval(previewTimer.current);
    };
  }, []);

  // ============================================================
  // 下载：文档/PPT/PDF/Excel 走服务端水印下载接口（留痕由服务端统一记录）；
  //        视频/图片/TXT 等其它类型保持原方式（先记日志再静态下载）
  // ============================================================
  const handleDownload = async (m: Material) => {
    const ext = (m.fileName || '').split('.').pop()?.toLowerCase() || '';
    if (PROTECTED_DOC_EXTS.includes('.' + ext)) {
      try {
        const res = await growthClassroomApi.downloadFile(m.id);
        const blob = new Blob([res.data]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = m.fileName || `download.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e: any) {
        let msg = '下载失败，请重试';
        const status = e?.response?.status;
        if (status === 401 || status === 403) {
          try {
            const json = JSON.parse(await e.response.data.text());
            if (json?.error) msg = json.error;
            else msg = status === 401 ? '请先登录后再下载' : '无权下载该文件';
          } catch { msg = status === 401 ? '请先登录后再下载' : '无权下载该文件'; }
        }
        alert(msg);
      }
      return;
    }
    try {
      await growthClassroomApi.reportDownload(m.id);
    } catch { /* 日志失败不阻断下载 */ }
    // 触发下载：视频/图片直接新窗口打开可预览；其余走 download 属性
    const a = document.createElement('a');
    a.href = m.filePath;
    a.download = m.fileName || '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ============================================================
  // 删除资料（仅「上传资料」全部视图提供入口；删除记录+文件，所有分类分区联动消失）
  // ============================================================
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const handleDelete = async (m: Material) => {
    if (deletingId) return;
    if (!window.confirm(`确定删除资料「${m.title}」吗？\n删除后所有分类中该资料将一并消失，且不可恢复。`)) return;
    setDeletingId(m.id);
    try {
      const res = await growthClassroomApi.remove(m.id);
      if (res.data?.ok) {
        if (playing?.id === m.id) closePlayer();
        if (preview?.id === m.id) closePreview();
        refreshAll();
      } else {
        alert(res.data?.error || '删除失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || '删除失败，请重试');
    } finally {
      setDeletingId(null);
    }
  };

  // ============================================================
  // 移动资料到指定子区
  // ============================================================
  const openMoveDialog = (m: Material) => {
    setMoveTarget(m);
    // 组合值：大区|子区，未分区为空串
    setMoveSub(m.subCategory ? `${m.categoryCode}|${m.subCategory}` : '');
  };

  const handleMove = async () => {
    if (!moveTarget || moving) return;
    setMoving(true);
    try {
      const [cat, sub] = moveSub.split('|');
      const res = await growthClassroomApi.moveSubCategory(moveTarget.id, sub ?? '', cat || undefined);
      if (res.data?.ok) {
        setMoveTarget(null);
        refreshAll();
      } else {
        alert(res.data?.error || '移动失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || '移动失败，请重试');
    } finally {
      setMoving(false);
    }
  };

  // ============================================================
  // 子区管理：新增 / 改名 / 删除
  // ============================================================
  const openSubManage = () => {
    setShowSubManage(true);
    setSubNewCat(subCategories.length ? subCategories[0].categoryCode : '');
    setSubNewName('');
    setSubEditingId(null);
    setSubEditName('');
    setSubError('');
  };

  const handleCreateSub = async () => {
    if (subBusy) return;
    const name = subNewName.trim();
    if (!subNewCat) { setSubError('请选择所属分类'); return; }
    if (!name) { setSubError('请输入子区名称'); return; }
    setSubBusy(true);
    setSubError('');
    try {
      const res = await growthClassroomApi.createSubCategory(subNewCat, name);
      if (res.data?.ok) {
        setSubNewName('');
        refreshAll();
      } else {
        setSubError(res.data?.error || '新增失败');
      }
    } catch (e: any) {
      setSubError(e.response?.data?.error || '新增失败，请重试');
    } finally {
      setSubBusy(false);
    }
  };

  const startEditSub = (id: number, name: string) => {
    setSubEditingId(id);
    setSubEditName(name);
    setSubError('');
  };

  const handleRenameSub = async (id: number) => {
    if (subBusy) return;
    const name = subEditName.trim();
    if (!name) { setSubError('子区名称不能为空'); return; }
    setSubBusy(true);
    setSubError('');
    try {
      const res = await growthClassroomApi.renameSubCategory(id, name);
      if (res.data?.ok) {
        setSubEditingId(null);
        refreshAll();
      } else {
        setSubError(res.data?.error || '改名失败');
      }
    } catch (e: any) {
      setSubError(e.response?.data?.error || '改名失败，请重试');
    } finally {
      setSubBusy(false);
    }
  };

  const handleDeleteSub = async (id: number, name: string) => {
    if (subBusy) return;
    if (!window.confirm(`确定删除子区「${name}」吗？\n该子区下的资料不会被删除，将移入未分区继续展示。`)) return;
    setSubBusy(true);
    setSubError('');
    try {
      const res = await growthClassroomApi.removeSubCategory(id);
      if (res.data?.ok) {
        setSubEditingId(null);
        refreshAll();
      } else {
        setSubError(res.data?.error || '删除失败');
      }
    } catch (e: any) {
      setSubError(e.response?.data?.error || '删除失败，请重试');
    } finally {
      setSubBusy(false);
    }
  };

  // ============================================================
  // 日志明细
  // ============================================================
  const openLogs = async (m: Material) => {
    setLogTarget(m);
    setLogs(null);
    setLogTab('watch');
    setLogsLoading(true);
    try {
      const res = await growthClassroomApi.getLogs(m.id);
      if (res.data?.ok) setLogs(res.data.data);
    } catch { /* 忽略 */ }
    finally { setLogsLoading(false); }
  };

  // ============================================================
  // 在线预览（全部类型）：打开即计入观看，停留时长定时上报
  // ============================================================
  const flushPreviewWatch = useCallback((materialId: number) => {
    const elapsed = Math.floor((Date.now() - previewOpenedAt.current) / 1000);
    const delta = elapsed - previewReported.current;
    if (delta >= 1) {
      growthClassroomApi.reportWatch(materialId, delta).catch(() => {});
      previewReported.current = elapsed;
    }
  }, []);

  // 预览取文件：统一走鉴权接口（token 自动附带），不再直连静态路径
  const fetchPreviewFile = (m: Material) => {
    const token = localStorage.getItem('token') || '';
    return fetch(`/api/growth-classroom/materials/${m.id}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };

  const openPreview = (m: Material) => {
    setPreview(m);
    setPreviewLoading(true);
    setPreviewError('');
    // 预览打开即启动观看统计：打开瞬间上报 1 秒（记人数），随后每 10s flush 停留时长
    previewOpenedAt.current = Date.now();
    previewReported.current = 0;
    growthClassroomApi.reportWatch(m.id, 1).catch(() => {});
    previewReported.current = 1;
    if (previewTimer.current) clearInterval(previewTimer.current);
    previewTimer.current = setInterval(() => { if (m) flushPreviewWatch(m.id); }, 10000);
  };

  const closePreview = () => {
    if (preview) flushPreviewWatch(preview.id);
    if (previewTimer.current) { clearInterval(previewTimer.current); previewTimer.current = null; }
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError('');
  };

  // 打开预览弹窗后，按文件类型异步加载渲染内容（txt/excel/word/ppt）
  useEffect(() => {
    if (!preview) return;
    const m = preview;
    const body = previewBodyRef.current;
    let cancelled = false;
    const ext = (m.fileName || '').split('.').pop()?.toLowerCase() || '';

    // 需要异步填充内容的类型先清空容器（pdf/image/video 由 JSX 直接渲染，不动容器，
    // 且不向容器内挂载任何 React 节点，避免被库 innerHTML 清空后 React 卸载时报错）
    if (['txt', 'excel', 'word', 'ppt'].includes(m.fileType)) {
      if (!body) return;
      body.innerHTML = '';
    }

    const fail = (msg: string) => {
      if (cancelled) return;
      setPreviewError(msg);
      setPreviewLoading(false);
    };

    const loadTxt = async () => {
      try {
      if (!body) return;
        const res = await fetchPreviewFile(m);
        const ct = res.headers.get('content-type') || '';
        if (!res.ok) throw new Error('文件不存在或登录已过期');
        const bytes = new Uint8Array(await res.arrayBuffer());
        let text = new TextDecoder('utf-8').decode(bytes);
        if (text.includes('\uFFFD')) {
          try { text = new TextDecoder('gbk').decode(bytes); } catch { /* 保持 utf-8 结果 */ }
        }
        if (cancelled) return;
        const pre = document.createElement('pre');
        pre.textContent = text;
        pre.className = 'whitespace-pre-wrap break-all text-sm leading-relaxed text-gray-800';
        body.appendChild(pre);
        setPreviewLoading(false);
      } catch (e: any) { fail(e.message || '文本加载失败'); }
    };

    const loadExcel = async () => {
      try {
      if (!body) return;
        const res = await fetchPreviewFile(m);
        const ct = res.headers.get('content-type') || '';
        if (!res.ok) throw new Error('文件不存在或登录已过期');
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        const container = document.createElement('div');
        container.className = 'space-y-4';
        (wb.SheetNames || []).forEach((name: string) => {
          const ws = wb.Sheets[name];
          const header = document.createElement('h4');
          header.className = 'text-sm font-semibold text-gray-700 mb-1';
          header.textContent = `工作表：${name}`;
          const wrap = document.createElement('div');
          wrap.className = 'overflow-auto';
          wrap.innerHTML = XLSX.utils.sheet_to_html(ws, { editable: false });
          const section = document.createElement('div');
          section.appendChild(header);
          section.appendChild(wrap);
          container.appendChild(section);
        });
        body.appendChild(container);
        setPreviewLoading(false);
      } catch (e: any) { fail(e.message || 'Excel 解析失败'); }
    };

    const loadDocx = async () => {
      try {
      if (!body) return;
        const res = await fetchPreviewFile(m);
        const ct = res.headers.get('content-type') || '';
        if (!res.ok) throw new Error('文件不存在或登录已过期');
        const blob = await res.blob();
        if (cancelled) return;
        await renderDocxAsync(blob, body, undefined, { breakPages: false });
        if (cancelled) return;
        setPreviewLoading(false);
      } catch (e: any) { fail(e.message || 'Word 解析失败'); }
    };

    const loadPptx = async () => {
      try {
      if (!body) return;
        const res = await fetchPreviewFile(m);
        const ct = res.headers.get('content-type') || '';
        if (!res.ok) throw new Error('文件不存在或登录已过期');
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const viewer = initPptxPreview(body, { width: body.clientWidth || 860, height: Math.max(body.clientHeight - 40, 480) });
        await viewer.preview(buf);
        if (cancelled) { viewer.destroy(); return; }
        setPreviewLoading(false);
      } catch (e: any) { fail(e.message || 'PPT 解析失败'); }
    };

    // 以扩展名为准分发（txt 资料在后端 fileType 为 other，不能依赖 fileType）
    if (ext === 'txt') loadTxt();
    else if (ext === 'xlsx' || ext === 'xls') loadExcel();
    else if (ext === 'docx') loadDocx();
    else if (ext === 'pptx') loadPptx();
    else if (ext === 'doc') fail('旧版 Word（.doc）格式暂不支持在线预览，请下载后查看');
    else if (ext === 'ppt') fail('旧版 PPT（.ppt）格式暂不支持在线预览，请下载后查看');
    else if (m.fileType === 'video' || m.fileType === 'pdf' || m.fileType === 'image') setPreviewLoading(false); // 由 JSX 直接渲染
    else fail('该文件类型暂不支持在线预览，请下载后查看');

    return () => { cancelled = true; };
  }, [preview]);

  // PDF 预览：走鉴权接口取文件并转 blob URL（用户滚动/缩放不受影响）
  useEffect(() => {
    if (!preview || preview.fileType !== 'pdf') return;
    let cancelled = false;
    (async () => {
      setPreviewLoading(true);
      try {
        const res = await fetchPreviewFile(preview);
        if (!res.ok) throw new Error('文件不存在或登录已过期，请重新登录');
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        previewPdfUrlRef.current = url;
        setPreviewPdfUrl(url);
        setPreviewLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setPreviewError(e.message || 'PDF 加载失败');
          setPreviewLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (previewPdfUrlRef.current) {
        URL.revokeObjectURL(previewPdfUrlRef.current);
        previewPdfUrlRef.current = null;
      }
      setPreviewPdfUrl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.id]);

  // ============================================================
  // 渲染：按分类分区
  // ============================================================
  const renderMaterialCard = (m: Material) => (
    <div key={m.id} className="bg-white rounded-xl border border-blue-200 shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col">
      <div className="flex items-start gap-3">
        <div className="shrink-0 bg-blue-100 rounded-lg p-2">
          <FileTypeIcon fileType={m.fileType} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-800 truncate" title={m.title}>{m.title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{m.fileName} · {formatSize(m.fileSize)}</p>
        </div>
      </div>
      <p className="text-sm text-gray-600 mt-3 line-clamp-2 min-h-[2.5rem]">{m.summary}</p>
      <div className="text-xs text-gray-400 mt-2">
        {m.uploaderName || m.uploaderCode} 上传于 {formatDate(m.createdAt)}
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-blue-100">
        <div className="flex gap-2">
          {m.fileType === 'video' ? (
            <button onClick={() => openPlayer(m)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-medium hover:bg-blue-100">
              <Play size={14} /> 在线观看
            </button>
          ) : (
            <button onClick={() => openPreview(m)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-medium hover:bg-blue-100">
              <Eye size={14} /> 在线预览
            </button>
          )}
          <button onClick={() => handleDownload(m)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-100 text-blue-600 text-xs font-medium hover:bg-blue-200">
            <Download size={14} /> 下载
          </button>
          {/* 移动入口：仅「上传资料」菜单（全部视图，activeCategory 为空）展示，其余分类菜单不展示 */}
          {!activeCategory && canManage === true && (
            <button
              onClick={() => openMoveDialog(m)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-50 text-teal-600 text-xs font-medium hover:bg-teal-100"
              title="移动该资料到指定子区（或移入未分区）"
            >
              <FolderInput size={14} /> 移动
            </button>
          )}
          {!activeCategory && canManage === true && (
            <button
              onClick={() => handleDelete(m)}
              disabled={deletingId === m.id}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 disabled:opacity-60"
              title="删除该资料（所有分类分区同步移除）"
            >
              {deletingId === m.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} 删除
            </button>
          )}
        </div>
        <button
          onClick={() => openLogs(m)}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-amber-50 text-amber-600 text-xs font-medium hover:bg-amber-100"
          title="查看观看/下载日志明细"
        >
          <BarChart3 size={14} />
          <span>观看 {m.viewUsers} 人 · {formatDuration(m.viewSeconds)}</span>
          <span className="text-amber-400">|</span>
          <span>下载 {m.downloadUsers} 人 · {m.downloadCount} 次</span>
        </button>
      </div>
    </div>
  );

  // 分类内按文件类型分区渲染（文档区 / EXCEL区 / PPT区 / 视频区）
  const renderZones = (items: Material[]) => (
    <div className="space-y-5">
      {FILE_ZONES.map((zone) => {
        const zoneItems = items.filter((m) => zone.types.includes(m.fileType));
        if (zoneItems.length === 0) return null;
        const ZoneIcon = zone.icon;
        return (
          <div key={zone.key} className="bg-white/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <ZoneIcon size={16} className="text-primary" />
              <h4 className="font-bold text-gray-800">{zone.label}</h4>
              <span className="text-xs text-blue-400">共 {zoneItems.length} 个资料</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {zoneItems.map(renderMaterialCard)}
            </div>
          </div>
        );
      })}
    </div>
  );

  const groupedMaterials = categories
    .map((c) => ({ cat: c, items: materials.filter((m) => m.categoryCode === c.catCode) }))
    // 选中分类时仅展示该分类（保留空分类提示），未选中时展示全部有资料的分类
    .filter((g) => (activeCategory ? g.cat.catCode === activeCategory : g.items.length > 0));

  return (
    <Layout title="成长课堂" subtitle="行政资产 · 各部门按分类上传的学习资料（全员可看可下载）">
      {/* 顶部操作栏：快速搜索 + 上传 */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="快速搜索标题或内容概述..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-blue-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        {/* 上传按钮 + 管理子区：仅"上传资料/全部"视图且已获「上传资料」授权时显示（未授权用户不显示入口） */}
        {!activeCategory && canManage === true && (
          <>
            <button
              onClick={() => setShowUpload(true)}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-medium hover:opacity-90 shrink-0"
            >
              <Upload size={18} /> 上传资料
            </button>
            <button
              onClick={openSubManage}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-blue-200 text-blue-600 font-medium hover:bg-blue-50 shrink-0"
            >
              <FolderCog size={18} /> 管理子区
            </button>
          </>
        )}
      </div>

      {/* 分类分区 */}
      {groupedMaterials.length === 0 && !loading ? (
        <div className="text-center py-16 text-blue-400">
          <BookOpen size={48} className="mx-auto mb-3 opacity-50" />
          <p>暂无资料{keyword ? `（搜索“${keyword}”无结果）` : ''}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedMaterials.map((g) => (
            <section key={g.cat.catCode} className="bg-gradient-to-r from-blue-100/80 via-sky-100/60 to-blue-100/80 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <GraduationCap size={18} className="text-primary" />
                <h3 className="font-bold text-gray-800">{g.cat.catName}</h3>
                <span className="text-xs text-blue-400">共 {g.items.length} 个资料</span>
              </div>
              {g.items.length === 0 ? (
                <div className="text-center text-sm text-blue-400 py-6">本分类暂无资料</div>
              ) : (
                (() => {
                  // 子区分区：无子区的资料一起展示（未分区），有子区的按子区展示
                  const bySub = new Map<string, Material[]>();
                  g.items.forEach((m) => {
                    const key = (m.subCategory || '').trim();
                    if (!bySub.has(key)) bySub.set(key, []);
                    bySub.get(key)!.push(m);
                  });
                  const subGroups: { key: string; subName: string; items: Material[] }[] = [];
                  if (bySub.has('')) subGroups.push({ key: '__none__', subName: '未分区', items: bySub.get('')! });
                  bySub.forEach((items, key) => { if (key) subGroups.push({ key, subName: key, items }); });
                  // 该分类完全没有子区：维持原有「分类 → 文件类型分区」展示
                  if (subGroups.length === 1 && subGroups[0].key === '__none__') return renderZones(subGroups[0].items);
                  return (
                    <div className="space-y-5">
                      {subGroups.map((sg) => (
                        <div key={sg.key} className="bg-blue-50/60 rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Folder size={16} className="text-primary" />
                            <h4 className="font-bold text-gray-800">{sg.subName}</h4>
                            <span className="text-xs text-blue-400">共 {sg.items.length} 个资料</span>
                          </div>
                          {renderZones(sg.items)}
                        </div>
                      ))}
                    </div>
                  );
                })()
              )}
            </section>
          ))}
          {materials.length > 0 && keyword && (
            <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50/40 rounded-xl px-4 py-2.5 border border-blue-200">
              <CheckCircle2 size={16} className="text-green-500" />
              “{keyword}” 共找到 {materials.length} 个资料（已在各分类分区中展示）
            </div>
          )}
        </div>
      )}

      {/* ======== 上传弹窗 ======== */}
      {showUpload && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget && !uploading) setShowUpload(false); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">上传成长课堂资料</h3>
              <button onClick={() => { if (!uploading) setShowUpload(false); }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">标题 <span className="text-red-500">*</span></label>
                <input
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="资料标题（不能与已有标题重复）"
                  className="w-full px-3 py-2 rounded-lg border border-blue-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">所属分类 <span className="text-red-500">*</span></label>
                <select
                  value={uploadCategory}
                  onChange={(e) => { setUploadCategory(e.target.value); setUploadSubCategory(''); setUploadNewSub(false); }}
                  className="w-full px-3 py-2 rounded-lg border border-blue-200 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                >
                  <option value="">请选择分类</option>
                  {categories.map((c) => <option key={c.catCode} value={c.catCode}>{c.catName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">子类（子区）</label>
                <div className="flex gap-2">
                  {!uploadNewSub ? (
                    <select
                      value={uploadSubCategory}
                      onChange={(e) => setUploadSubCategory(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg border border-blue-200 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                    >
                      <option value="">未分区（与其他未分区资料放在一起）</option>
                      {subCategories
                        .filter((s) => s.categoryCode === uploadCategory)
                        .map((s) => <option key={`${s.categoryCode}|${s.subName}`} value={s.subName}>{s.subName}</option>)}
                    </select>
                  ) : (
                    <input
                      value={uploadSubCategory}
                      onChange={(e) => setUploadSubCategory(e.target.value)}
                      placeholder="输入新子类名称，上传后自动创建对应子区"
                      className="flex-1 px-3 py-2 rounded-lg border border-blue-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => { setUploadNewSub(!uploadNewSub); setUploadSubCategory(''); }}
                    className="shrink-0 px-3 py-2 rounded-lg border border-blue-200 text-blue-600 text-sm font-medium hover:bg-blue-50"
                  >
                    {uploadNewSub ? '选择已有子类' : '新建子类'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">默认下拉选择已有子类；需要新子区时点「新建子类」输入新名称，上传后自动建档</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">内容概述 <span className="text-red-500">*</span></label>
                <textarea
                  value={uploadSummary}
                  onChange={(e) => setUploadSummary(e.target.value)}
                  rows={3}
                  placeholder="请填写资料的内容概述（必填）"
                  className="w-full px-3 py-2 rounded-lg border border-blue-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">文件 <span className="text-red-500">*</span></label>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-sm file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-primary file:text-white file:font-medium"
                />
                <p className="text-xs text-gray-400 mt-1">支持视频（MP4/WebM/MOV/MKV/AVI/FLV/WMV）、PPT、Word、Excel、PDF、图片、TXT，单文件≤1GB</p>
              </div>
              {uploadError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  <AlertCircle size={16} /> {uploadError}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white font-medium hover:opacity-90 disabled:opacity-60"
                >
                  {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                  {uploading ? '上传中...' : '确认上传'}
                </button>
                <button
                  onClick={() => { if (!uploading) setShowUpload(false); }}
                  className="px-4 py-2.5 rounded-xl border border-blue-200 text-blue-600 font-medium hover:bg-blue-50"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======== 移动资料到子区弹窗 ======== */}
      {moveTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget && !moving) setMoveTarget(null); }}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">移动资料到子区</h3>
              <button onClick={() => { if (!moving) setMoveTarget(null); }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              资料：<span className="font-medium text-gray-800">{moveTarget.title}</span>
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">目标子区</label>
              <select
                value={moveSub}
                onChange={(e) => setMoveSub(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-blue-200 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
              >
                <option value="">未分区（与其他未分区资料放在一起）</option>
                {categories.map((c) =>
                  subCategories
                    .filter((s) => s.categoryCode === c.catCode)
                    .length > 0 ? (
                      <optgroup key={c.catCode} label={c.catName}>
                        {subCategories
                          .filter((s) => s.categoryCode === c.catCode)
                          .map((s) => (
                            <option key={`${s.categoryCode}|${s.subName}`} value={`${s.categoryCode}|${s.subName}`}>
                              {c.catName} / {s.subName}
                            </option>
                          ))}
                      </optgroup>
                    ) : null
                )}
              </select>
              <p className="text-xs text-gray-400 mt-1">当前大区：{categories.find((c) => c.catCode === moveTarget.categoryCode)?.catName || '未知'} / 当前子区：{moveTarget.subCategory || '未分区'}；选择其他大区的子区时将一并移动到该大区</p>
            </div>
            <div className="flex gap-3 pt-5">
              <button
                onClick={handleMove}
                disabled={moving}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white font-medium hover:opacity-90 disabled:opacity-60"
              >
                {moving ? <Loader2 size={18} className="animate-spin" /> : <FolderInput size={18} />}
                {moving ? '移动中...' : '确认移动'}
              </button>
              <button
                onClick={() => { if (!moving) setMoveTarget(null); }}
                className="px-4 py-2.5 rounded-xl border border-blue-200 text-blue-600 font-medium hover:bg-blue-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======== 子区管理弹窗（新增/改名/删除） ======== */}
      {showSubManage && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget && !subBusy) setShowSubManage(false); }}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">管理子区</h3>
              <button onClick={() => { if (!subBusy) setShowSubManage(false); }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {/* 新增子区 */}
            <div className="bg-blue-50/60 rounded-xl p-4 mb-4">
              <div className="flex gap-2 mb-2">
                <select
                  value={subNewCat}
                  onChange={(e) => setSubNewCat(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg border border-blue-200 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                >
                  <option value="">请选择分类</option>
                  {categories.map((c) => <option key={c.catCode} value={c.catCode}>{c.catName}</option>)}
                </select>
                <input
                  value={subNewName}
                  onChange={(e) => setSubNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateSub(); }}
                  placeholder="输入新子区名称"
                  className="flex-1 px-3 py-2 rounded-lg border border-blue-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  onClick={handleCreateSub}
                  disabled={subBusy}
                  className="shrink-0 inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
                >
                  {subBusy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  新增
                </button>
              </div>
              <p className="text-xs text-gray-400">子区档案会一直保留，删除资料不会删除子区</p>
            </div>

            {subError && (
              <div className="mb-3 flex items-center gap-2 text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">
                <AlertCircle size={16} /> {subError}
              </div>
            )}

            {/* 已有子区列表，按分类分组 */}
            {subCategories.length === 0 ? (
              <div className="text-center py-8 text-blue-400">暂无子区，可先在上方新增</div>
            ) : (
              categories
                .filter((c) => subCategories.some((s) => s.categoryCode === c.catCode))
                .map((c) => (
                  <div key={c.catCode} className="mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Folder size={14} className="text-primary" />
                      <span className="text-sm font-semibold text-gray-700">{c.catName}</span>
                    </div>
                    <div className="space-y-2">
                      {subCategories.filter((s) => s.categoryCode === c.catCode).map((s) => (
                        <div key={s.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                          {subEditingId === s.id ? (
                            <>
                              <input
                                autoFocus
                                value={subEditName}
                                onChange={(e) => setSubEditName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSub(s.id); if (e.key === 'Escape') setSubEditingId(null); }}
                                className="flex-1 px-2 py-1.5 rounded-lg border border-blue-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
                              />
                              <button
                                onClick={() => handleRenameSub(s.id)}
                                disabled={subBusy}
                                className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:opacity-90 disabled:opacity-60"
                              >
                                <CheckCircle2 size={14} /> 保存
                              </button>
                              <button
                                onClick={() => setSubEditingId(null)}
                                disabled={subBusy}
                                className="shrink-0 px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 text-xs font-medium hover:bg-blue-50"
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="flex-1 text-sm text-gray-700">
                                {s.subName}
                                <span className="ml-2 text-xs text-blue-400">{materials.filter((m) => m.categoryCode === s.categoryCode && m.subCategory === s.subName).length} 个资料</span>
                              </span>
                              <button
                                onClick={() => startEditSub(s.id, s.subName)}
                                disabled={subBusy}
                                title="改名"
                                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-100 text-blue-600 text-xs font-medium hover:bg-blue-200 disabled:opacity-60"
                              >
                                <Pencil size={13} /> 改名
                              </button>
                              <button
                                onClick={() => handleDeleteSub(s.id, s.subName)}
                                disabled={subBusy}
                                title="删除（该子区下资料将移入未分区）"
                                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-100 text-red-600 text-xs font-medium hover:bg-red-200 disabled:opacity-60"
                              >
                                <Trash2 size={13} /> 删除
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* ======== 在线观看弹窗 ======== */}
      {playing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) closePlayer(); }}>
          <div className="bg-black rounded-2xl w-full max-w-4xl">
            <div className="flex items-center justify-between px-5 py-3 text-white">
              <div className="min-w-0">
                <h3 className="font-semibold truncate">{playing.title}</h3>
                <p className="text-xs text-gray-300">{playing.fileName} · {formatSize(playing.fileSize)}</p>
              </div>
              <button onClick={closePlayer} className="text-gray-300 hover:text-white ml-3"><X size={22} /></button>
            </div>
            <video
              ref={videoRef}
              src={playing.filePath}
              controls
              autoPlay
              className="w-full max-h-[70vh] rounded-b-2xl bg-black"
              onPlay={onVideoPlay}
              onPause={onVideoPause}
              onEnded={onVideoEnded}
            />
            <div className="flex items-center justify-between px-5 py-3 text-white text-xs">
              <span className="inline-flex items-center gap-1"><Eye size={14} /> 在线观看中，系统将自动记录您的观看时长</span>
              <button
                onClick={() => handleDownload(playing)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25"
              >
                <Download size={14} /> 下载本视频
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======== 日志明细弹窗 ======== */}
      {logTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setLogTarget(null); }}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-blue-100">
              <div className="min-w-0">
                <h3 className="font-bold text-gray-800 truncate">日志明细：{logTarget.title}</h3>
                <p className="text-xs text-gray-500 mt-0.5">展示谁观看了（多少人、多少时长）与谁下载了（多少人、多少次）</p>
              </div>
              <button onClick={() => setLogTarget(null)} className="text-gray-400 hover:text-gray-600 ml-3"><X size={20} /></button>
            </div>
            <div className="flex border-b border-blue-100 px-6 pt-3 gap-1">
              <button
                onClick={() => setLogTab('watch')}
                className={`px-4 py-2 rounded-t-lg text-sm font-medium ${logTab === 'watch' ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-500' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <span className="inline-flex items-center gap-1"><Eye size={14} /> 观看日志</span>
              </button>
              <button
                onClick={() => setLogTab('download')}
                className={`px-4 py-2 rounded-t-lg text-sm font-medium ${logTab === 'download' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <span className="inline-flex items-center gap-1"><Download size={14} /> 下载日志</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {logsLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <Loader2 size={24} className="animate-spin mr-2" /> 加载中...
                </div>
              ) : !logs ? (
                <div className="text-center py-12 text-gray-400">暂无日志数据</div>
              ) : logTab === 'watch' ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-amber-50 rounded-xl p-4">
                      <p className="text-xs text-amber-600">累计观看人数</p>
                      <p className="text-2xl font-bold text-amber-700 mt-1">{logs.watchSummary.users} 人</p>
                    </div>
                    <div className="bg-amber-50 rounded-xl p-4">
                      <p className="text-xs text-amber-600">累计观看时长</p>
                      <p className="text-2xl font-bold text-amber-700 mt-1">{formatDuration(logs.watchSummary.totalSeconds)}</p>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">按用户汇总</h4>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-400 text-xs border-b border-blue-100">
                          <th className="py-2">用户</th>
                          <th className="py-2">观看次数</th>
                          <th className="py-2">累计时长</th>
                          <th className="py-2">最近观看</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.watchAgg.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-gray-400">暂无观看记录</td></tr>}
                        {logs.watchAgg.map((r, i) => (
                          <tr key={i} className="border-b border-blue-50">
                            <td className="py-2">{r.userName || r.userCode || '-'}</td>
                            <td className="py-2">{r.watchTimes} 次</td>
                            <td className="py-2">{formatDuration(r.totalSeconds || 0)}</td>
                            <td className="py-2 text-gray-500">{formatDate(r.lastTime)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">逐条记录（最近 200 条）</h4>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-400 text-xs border-b border-blue-100">
                          <th className="py-2">用户</th>
                          <th className="py-2">本次时长</th>
                          <th className="py-2">观看时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.watchDetails.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-gray-400">暂无逐条记录</td></tr>}
                        {logs.watchDetails.map((r, i) => (
                          <tr key={i} className="border-b border-blue-50">
                            <td className="py-2">{r.userName || r.userCode || '-'}</td>
                            <td className="py-2">{formatDuration(r.watchSeconds || 0)}</td>
                            <td className="py-2 text-gray-500">{formatDate(r.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-50 rounded-xl p-4">
                      <p className="text-xs text-blue-600">累计下载人数</p>
                      <p className="text-2xl font-bold text-blue-700 mt-1">{logs.downloadSummary.users} 人</p>
                    </div>
                    <div className="bg-blue-50 rounded-xl p-4">
                      <p className="text-xs text-blue-600">累计下载次数</p>
                      <p className="text-2xl font-bold text-blue-700 mt-1">{logs.downloadSummary.totalCount} 次</p>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">按用户汇总</h4>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-400 text-xs border-b border-blue-100">
                          <th className="py-2">用户</th>
                          <th className="py-2">下载次数</th>
                          <th className="py-2">最近下载</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.downloadAgg.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-gray-400">暂无下载记录</td></tr>}
                        {logs.downloadAgg.map((r, i) => (
                          <tr key={i} className="border-b border-blue-50">
                            <td className="py-2">{r.userName || r.userCode || '-'}</td>
                            <td className="py-2">{r.downloadTimes} 次</td>
                            <td className="py-2 text-gray-500">{formatDate(r.lastTime)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">逐条记录（最近 200 条）</h4>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-400 text-xs border-b border-blue-100">
                          <th className="py-2">用户</th>
                          <th className="py-2">下载时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.downloadDetails.length === 0 && <tr><td colSpan={2} className="py-6 text-center text-gray-400">暂无逐条记录</td></tr>}
                        {logs.downloadDetails.map((r, i) => (
                          <tr key={i} className="border-b border-blue-50">
                            <td className="py-2">{r.userName || r.userCode || '-'}</td>
                            <td className="py-2 text-gray-500">{formatDate(r.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======== 在线预览弹窗（全部文件类型） ======== */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) closePreview(); }}>
          <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-blue-100">
              <div className="min-w-0">
                <h3 className="font-bold text-gray-800 truncate">{preview.title}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{preview.fileName} · {formatSize(preview.fileSize)}</p>
              </div>
              <button onClick={closePreview} className="text-gray-400 hover:text-gray-600 ml-3"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-auto p-5 bg-gray-50">
              {['video', 'pdf', 'image'].includes(preview.fileType) ? (
                <div className="relative min-h-[45vh]">
                  {!previewLoading && !previewError && preview.fileType === 'video' && (
                    <video src={preview.filePath} controls autoPlay className="max-w-full max-h-[70vh] mx-auto rounded-lg bg-black" />
                  )}
                  {!previewLoading && !previewError && preview.fileType === 'pdf' && (
                    <iframe src={previewPdfUrl || undefined} title={preview.title} className="w-full h-[70vh] rounded-lg bg-white" />
                  )}
                  {['pdf', 'word', 'excel', 'ppt'].includes(preview.fileType) && <WatermarkGrid text={previewWatermarkText} />}
                  {!previewLoading && !previewError && preview.fileType === 'image' && (
                    <div className="flex items-center justify-center">
                      <img src={preview.filePath} alt={preview.title} className="max-w-full max-h-[70vh] object-contain rounded-lg" />
                    </div>
                  )}
                  {previewLoading && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80 text-gray-400">
                      <Loader2 size={28} className="animate-spin mr-2" /> 正在加载预览内容...
                    </div>
                  )}
                  {previewError && !previewLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-white/90 text-center">
                      <AlertCircle size={32} className="text-amber-500 mb-3" />
                      <p className="text-sm text-gray-600 px-6">{previewError}</p>
                      <button onClick={() => handleDownload(preview)} className="mt-4 inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90">
                        <Download size={16} /> 下载该文件
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <div ref={previewBodyRef} className="bg-white rounded-xl p-4 shadow-sm min-h-[45vh]" />
                  {['pdf', 'word', 'excel', 'ppt'].includes(preview.fileType) && <WatermarkGrid text={previewWatermarkText} />}
                  {previewLoading && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80 text-gray-400">
                      <Loader2 size={28} className="animate-spin mr-2" /> 正在加载预览内容...
                    </div>
                  )}
                  {previewError && !previewLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-white/90 text-center">
                      <AlertCircle size={32} className="text-amber-500 mb-3" />
                      <p className="text-sm text-gray-600 px-6">{previewError}</p>
                      <button onClick={() => handleDownload(preview)} className="mt-4 inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90">
                        <Download size={16} /> 下载该文件
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}