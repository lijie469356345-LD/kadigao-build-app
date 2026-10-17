import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import JSZip from 'jszip';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// ============================================================
// 成长课堂 - 下载水印服务
//   对文档/PPT/PDF/Excel 四类资料在下载时叠加含下载人信息的水印，
//   视频、图片、TXT 等其它类型不做内容级水印（下载留痕由下载接口统一记录）。
//   各格式实现：
//     PDF   -> pdf-lib 逐页绘制斜排半透明文字水印（嵌入系统黑体，保证中文）
//     DOCX  -> 注入 Word 原生 VML 文字水印（PowerPlusWaterMarkObject，Word/WPS 原生展示）
//     PPTX  -> 每页 slide 插入旋转 45° 的半透明文本框水印（置于页面最上层）
//     XLSX  -> 注入页眉图片水印（&G，微软官方推荐做法，页面布局/打印预览可见）
//     doc/ppt/xls 旧二进制格式     -> 不支持内容级水印，返回原文件（下载留痕仍记录）
// ============================================================

/** 四类受保护资料扩展名（下载走水印接口，uploads 静态直出需拦截） */
export const PROTECTED_DOC_EXTS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'];

export function isProtectedDocExt(ext: string): boolean {
  return PROTECTED_DOC_EXTS.includes(ext.toLowerCase());
}

const SIMHEI_FONT = 'C:/Windows/Fonts/simhei.ttf';
const MSYH_FONT = 'C:/Windows/Fonts/msyh.ttc';

// 候选 Python 解释器：优先已验证装有 Pillow 的解释器，其次 PATH 中的 python/python3
const PYTHON_CANDIDATES = [
  'G:/AIgongzuobao/lightsandbox/python/python.exe',
  'python',
  'python3',
];

let _pyPicker: string | null | undefined;
function pickPython(): string | null {
  if (_pyPicker !== undefined) return _pyPicker;
  for (const cand of PYTHON_CANDIDATES) {
    try {
      const r = spawnSync(cand, ['-c', 'import PIL'], { encoding: 'utf8', timeout: 10000 });
      if (r.status === 0) {
        _pyPicker = cand;
        return cand;
      }
    } catch { /* 尝试下一个 */ }
  }
  _pyPicker = null;
  return null;
}

function pickFont(): string {
  try {
    if (fs.existsSync(SIMHEI_FONT)) return SIMHEI_FONT;
  } catch { /* ignore */ }
  return MSYH_FONT;
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 生成水印文案：{姓名}({工号}) 下载于 {yyyy-MM-dd HH:mm} */
export function makeWatermarkText(user: any): string {
  const name = user?.userName || user?.userCode || '未知用户';
  const code = user?.userCode || user?.userId || '';
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return code ? `${name}(${code}) 下载于 ${ts}` : `${name} 下载于 ${ts}`;
}

// ============================================================
// PDF：pdf-lib 逐页斜排水印
// ============================================================
async function watermarkPdf(buf: Buffer, text: string): Promise<Buffer> {
  const fontPath = pickFont();
  const fontBytes = fs.readFileSync(fontPath);
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const pages = doc.getPages();
  const fontSize = 22;
  const stepX = 300;
  const stepY = 170;
  for (const page of pages) {
    const { width, height } = page.getSize();
    for (let x = -width * 0.2; x < width; x += stepX) {
      for (let y = -height * 0.2; y < height; y += stepY) {
        page.drawText(text, {
          x,
          y,
          size: fontSize,
          font,
          color: rgb(0.4, 0.4, 0.5),
          opacity: 0.2,
          rotate: degrees(-32),
        });
      }
    }
  }
  return Buffer.from(await doc.save());
}

// ============================================================
// DOCX：注入 Word 原生 VML 文字水印（PowerPlusWaterMarkObject）
// ============================================================
function buildDocxWatermarkParagraph(text: string): string {
  const esc = escapeXml(text);
  // 需要调整里的内容 z-index 为负，使水印在正文之下
  const uniq = Date.now().toString();
  return (
    '<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:pict>' +
    '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" ' +
    'path="m@7,l@8,m@5,21600l@6,21600e">' +
    '<v:formulas>' +
    '<v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/>' +
    '<v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/>' +
    '<v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/>' +
    '<v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/>' +
    '<v:f eqn="sum @6 0 @5"/>' +
    '</v:formulas>' +
    '<v:path textpathok="t" o:connecttype="none"/>' +
    '<v:textpath on="t" fitshape="t"/>' +
    '</v:shapetype>' +
    '<v:shape id="PowerPlusWaterMarkObject' + uniq + '" o:spid="_x0000_s2049" type="#_x0000_t136" ' +
    'style="position:absolute;margin-left:0;margin-top:0;width:450pt;height:270pt;z-index:-251658752;' +
    'mso-wrap-edited:f;mso-position-horizontal:center;mso-position-horizontal-relative:margin;' +
    'mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" ' +
    'filled="f" fillcolor="silver" stroked="f">' +
    '<v:fill opacity=".5"/>' +
    '<v:textpath style="font-family:&quot;黑体&quot;;font-size:1pt" string="' + esc + '"/>' +
    '</v:shape>' +
    '</w:pict></w:r></w:p>'
  );
}

async function watermarkDocx(buf: Buffer, text: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) return buf;
  let xml = await docEntry.async('string');

  // 1) 根元素补齐 VML 命名空间（缺省时 Word 打开会忽略水印形状）
  xml = xml.replace(/(<w:document\b[^>]*?)(\/?\s*>)/, (m, head: string, tail: string) => {
    let h = head;
    if (!/xmlns:v=/.test(h)) h += ' xmlns:v="urn:schemas-microsoft-com:vml"';
    if (!/xmlns:o=/.test(h)) h += ' xmlns:o="urn:schemas-microsoft-com:office:office"';
    return h + tail;
  });

  // 2) 在 body 最后一个 sectPr 之前插入水印段落（多节文档该 sectPr 为 body 级，其余节的水印由节自身决定）
  const bodyEnd = xml.lastIndexOf('</w:body>');
  if (bodyEnd < 0) return buf;
  const bodySlice = xml.slice(0, bodyEnd);
  const sectIdx = bodySlice.lastIndexOf('<w:sectPr');
  const wmPara = buildDocxWatermarkParagraph(text);
  if (sectIdx >= 0) {
    xml = bodySlice.slice(0, sectIdx) + wmPara + bodySlice.slice(sectIdx) + xml.slice(bodyEnd);
  } else {
    xml = bodySlice + wmPara + xml.slice(bodyEnd);
  }

  zip.file('word/document.xml', xml);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

// ============================================================
// PPTX：每页注入旋转 45° 的半透明水印文本框（置于最上层）
// ============================================================
function buildPptxWatermarkShape(text: string): string {
  const esc = escapeXml(text);
  const uniq = (Date.now() % 100000) + 1; // 每页形状 id 需唯一（不同页可复用，但保持不同更稳）
  return (
    '<p:sp>' +
    '<p:nvSpPr>' +
    '<p:cNvPr id="9' + uniq + '" name="WatermarkTextBox"/>' +
    '<p:cNvSpPr txBox="1"/>' +
    '<p:nvPr/>' +
    '</p:nvSpPr>' +
    '<p:spPr>' +
    '<a:xfrm rot="2700000">' +
    '<a:off x="0" y="0"/>' +
    '<a:ext cx="12192000" cy="6858000"/>' +
    '</a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:solidFill><a:srgbClr val="808080"><a:alpha val="20000"/></a:srgbClr></a:solidFill>' +
    '<a:ln><a:noFill/></a:ln>' +
    '</p:spPr>' +
    '<p:txBody>' +
    '<a:bodyPr wrap="square" anchor="ctr" lIns="91440" tIns="45720" rIns="91440" bIns="45720">' +
    '<a:normAutofit fontScale="80000"/>' +
    '</a:bodyPr>' +
    '<a:lstStyle/>' +
    '<a:p>' +
    '<a:r><a:rPr lang="zh-CN" sz="2800" b="1" dirty="0"/><a:t>' + esc + '</a:t></a:r>' +
    '</a:p>' +
    '</p:txBody>' +
    '</p:sp>'
  );
}

async function watermarkPptx(buf: Buffer, text: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const slideNames = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  if (slideNames.length === 0) return buf;
  for (const name of slideNames) {
    let xml = await zip.files[name].async('string');
    const spTreeEnd = xml.lastIndexOf('</p:spTree>');
    if (spTreeEnd < 0) continue;
    xml = xml.slice(0, spTreeEnd) + buildPptxWatermarkShape(text) + xml.slice(spTreeEnd);
    zip.file(name, xml);
  }
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

// ============================================================
// XLSX：页眉图片水印（&G）。水印 PNG 由 Python(Pillow) 动态生成，
//       页眉图是微软官方推荐的 Excel 水印做法（页面布局/打印预览可见）
// ============================================================
const PILLOW_SCRIPT = [
  'import sys',
  'from PIL import Image, ImageDraw, ImageFont',
  "text = sys.argv[1]",
  "out = sys.argv[2]",
  "font_path = r'C:\\Windows\\Fonts\\simhei.ttf'",
  "W, H = 1500, 320",
  "img = Image.new('RGBA', (W, H), (0, 0, 0, 0))",
  "size = 56",
  "font = ImageFont.truetype(font_path, size)",
  "d = ImageDraw.Draw(img)",
  "bb = d.textbbox((0, 0), text, font=font)",
  "tw = bb[2] - bb[0]",
  "if tw > W - 100:",
  "    size = max(28, int(56 * (W - 100) / tw))",
  "    font = ImageFont.truetype(font_path, size)",
  "    bb = d.textbbox((0, 0), text, font=font)",
  "    tw = bb[2] - bb[0]",
  "th = bb[3] - bb[1]",
  "x = (W - tw) / 2 - bb[0]",
  "y = (H - th) / 2 - bb[1]",
  "d.text((x, y), text, font=font, fill=(128, 128, 128, 180))",
  "img.save(out)",
].join('\n'); // 用换行连接：脚本含 if 块级缩进语句，不能用分号压成单行

function generateWatermarkPng(text: string): string | null {
  const py = pickPython();
  if (!py) return null;
  const tmp = path.join(os.tmpdir(), `gc_wm_${Date.now()}_${Math.round(Math.random() * 1e6)}.png`);
  try {
    const r = spawnSync(py, ['-c', PILLOW_SCRIPT, text, tmp], { encoding: 'utf8', timeout: 30000 });
    if (r.status !== 0 || !fs.existsSync(tmp)) {
      return null;
    }
    return tmp;
  } catch {
    return null;
  }
}

async function watermarkXlsx(buf: Buffer, text: string): Promise<Buffer> {
  const pngPath = generateWatermarkPng(text);
  if (!pngPath) return buf; // Pillow 不可用则降级返回原文件（下载留痕仍记录）
  try {
    const zip = await JSZip.loadAsync(buf);

    // 1) 注入水印 PNG 到 xl/media/
    const pngBytes = fs.readFileSync(pngPath);
    const mediaName = `gcWatermark_${Date.now()}.png`;
    zip.file(`xl/media/${mediaName}`, pngBytes);

    // 2) [Content_Types].xml 补 png Default（缺失时）
    const ctEntry = zip.file('[Content_Types].xml');
    if (ctEntry) {
      let ct = await ctEntry.async('string');
      if (!/<Default[^>]*Extension="png"/i.test(ct)) {
        ct = ct.replace(/<\/Types>/, '<Default Extension="png" ContentType="image/png"/></Types>');
        zip.file('[Content_Types].xml', ct);
      }
    }

    // 3) 为每个 worksheet 注入 headerFooter(&G) 并关联图片关系
    const sheetNames = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    for (const name of sheetNames) {
      let xml = await zip.files[name].async('string');
      if (!/<headerFooter[\s>]/i.test(xml)) {
        xml = xml.replace(/<\/worksheet>/, '<headerFooter><oddHeader>&amp;C&amp;G</oddHeader></headerFooter></worksheet>');
        zip.file(name, xml);
      }
      // rels 追加 image 关系
      const relName = name.replace(/\.xml$/, '.rels').replace(/^xl\/worksheets\//, 'xl/worksheets/_rels/');
      const relId = `rIdGcWm${Date.now()}`;
      let rels = '';
      if (zip.files[relName]) {
        rels = await zip.files[relName].async('string');
        if (!rels.includes(relId)) {
          rels = rels.replace(/<\/Relationships>/, `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/></Relationships>`);
          zip.file(relName, rels);
        }
      } else {
        rels =
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/>` +
          '</Relationships>';
        zip.file(relName, rels);
      }
    }

    return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  } finally {
    try { fs.unlinkSync(pngPath); } catch { /* 清理临时文件 */ }
  }
}

// ============================================================
// 统一入口：按扩展名分发水印处理；不支持的格式返回原文件
//   返回 changed=false 表示水印未叠加（旧二进制格式 / 处理失败），下载留痕仍由接口记录
// ============================================================
export interface WatermarkResult {
  data: Buffer;
  changed: boolean;
}

export async function applyWatermark(ext: string, buf: Buffer, text: string): Promise<WatermarkResult> {
  const e = ext.toLowerCase();
  try {
    if (e === '.pdf') return { data: await watermarkPdf(buf, text), changed: true };
    if (e === '.docx') return { data: await watermarkDocx(buf, text), changed: true };
    if (e === '.pptx') return { data: await watermarkPptx(buf, text), changed: true };
    if (e === '.xlsx') return { data: await watermarkXlsx(buf, text), changed: true };
  } catch (err) {
    // 水印失败不阻断下载（留痕记录由接口统一保证），打日志便于排查
    console.error('[growth-classroom] watermark failed for ' + e + ':', (err as Error)?.message);
    return { data: buf, changed: false };
  }
  // .doc/.ppt/.xls 旧二进制格式不支持内容级水印 -> 返回原文件
  return { data: buf, changed: false };
}