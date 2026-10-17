import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, TrendingUp, FileSpreadsheet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import axios from '../../api/axios';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface SectionConfig {
  id: string; title: string; periodLabel: string;
  summaryDX: string; detailDX: string; dateRange: number; topN: number; newOnly?: boolean;
}

const SECTIONS: SectionConfig[] = [
  { id: 'yesterday', title: '昨日畅销款 TOP20', periodLabel: '昨日', summaryDX: '畅销款_昨日TOP20_汇总', detailDX: '畅销款_昨日TOP20_明细', dateRange: 1, topN: 20 },
  { id: 'week7', title: '近7天畅销款 TOP20', periodLabel: '近7天', summaryDX: '畅销款_7天TOP20_汇总', detailDX: '畅销款_7天TOP20_明细', dateRange: 7, topN: 20 },
  { id: 'month20', title: '近20天全款畅销款 TOP20', periodLabel: '近20天全款', summaryDX: '畅销款_20天全款TOP20_汇总', detailDX: '畅销款_20天全款TOP20_明细', dateRange: 20, topN: 20 },
  { id: 'new20', title: '近20天上新畅销款周畅销 TOP20', periodLabel: '近20天上新', summaryDX: '畅销款_20天上新TOP20_汇总', detailDX: '畅销款_20天上新TOP20_明细', dateRange: 20, topN: 20, newOnly: true },
];

const WAREHOUSES = ['直营', '加盟', '山东直营'];
const SD_WAREHOUSE_MAP: Record<string, string> = { '山东直营': '山东仓库', '直营': '河南仓库', '加盟': '加盟仓库' };

// 季节起始日期：缩小查询时间范围用（避免全表扫描历史数据）
function computeSeasonStart(seasons: string[], year: string): string {
  const y = parseInt(year, 10) || new Date().getFullYear();
  const map: Record<string, string> = {
    '春': `${y - 1}-12-01`,
    '夏': `${y}-03-01`,
    '秋': `${y}-07-01`,
    '冬': `${y}-09-01`,
  };
  let min = '';
  for (const s of seasons) {
    const d = map[s];
    if (d && (!min || d < min)) min = d;
  }
  return min || `${y - 1}-01-01`;
}

// 根据今天日期取当前最近的季节及其对应年份（12月属于下一年「春」）
function getCurrentSeasonContext(): { season: string; year: string } {
  const now = new Date();
  const m = now.getMonth() + 1;
  const y = now.getFullYear();
  const year = m === 12 ? y + 1 : y;
  let season = '春';
  if (m >= 3 && m <= 6) season = '夏';
  else if (m >= 7 && m <= 8) season = '秋';
  else if (m >= 9 && m <= 11) season = '冬';
  return { season, year: String(year) };
}

// 模块级缓存：切换页面不丢失
let _cachedData: Record<string, Record<string, { products: ProductData[]; detail: DetailRow[]; dates: string[] }>> | null = null;
let _cachedSeasons: string[] | null = null;
let _cachedYear: string | null = null;


const PLACEHOLDER_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
  '<rect fill="#f3f4f6" width="200" height="200"/>' +
  '<rect fill="#d1d5db" x="50" y="50" width="100" height="80" rx="4"/>' +
  '<text fill="#6b7280" font-size="13" font-family="Arial" text-anchor="middle" x="100" y="85">暂无图片</text>' +
  '<text fill="#9ca3af" font-size="11" font-family="Arial" text-anchor="middle" x="100" y="108">NO IMAGE</text>' +
  '</svg>'
);

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function fetchImageWithTimeout(code: string, reloadKey: number, timeoutMs = 3000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`/api/product-image/${encodeURIComponent(code)}?_=${reloadKey}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return PLACEHOLDER_SVG;
    const blob = await res.blob();
    if (blob.size === 0) return PLACEHOLDER_SVG;
    return await blobToDataURL(blob);
  } catch {
    clearTimeout(timer);
    return PLACEHOLDER_SVG;
  }
}

async function preloadImagesRobust(codes: string[], reloadKey: number): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const batchSize = 4;
  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async code => {
      const dataUrl = await fetchImageWithTimeout(code, reloadKey);
      return { code, dataUrl };
    }));
    for (const { code, dataUrl } of results) {
      map.set(code, dataUrl);
    }
  }
  return map;
}

function buildExportTableHTML(products: ProductData[], detailData: DetailRow[], detailDates: string[], imageMap: Map<string, string>): string {
  const cols = '<colgroup><col width="200"><col width="110"><col width="70"><col width="80"><col width="90"><col width="90"><col width="70"><col width="70"><col width="70"><col width="90"></colgroup>';
  const td = (c: string, extra = '') => `<td style="text-align:center;border:1px solid #9ca3af;padding:4px 6px;${extra}">${c}</td>`;
  const tdBold = (c: string, extra = '') => td(c, `font-weight:bold;${extra}`);
  const tdGray = (c: string) => td(c, 'font-weight:600;color:#4b5563');
  let html = '';
  for (const p of products) {
    const imgSrc = imageMap.get(p.productCode) || PLACEHOLDER_SVG;
    const productDetails = detailData.filter(d => d.productCode === p.productCode);
    const sortedDetails = [...productDetails].sort((a, b) => b.periodTotal - a.periodTotal);
    const rowSpan = p.colors.length + sortedDetails.length + 4;
    const ct = (arr: any[], field: string, init = 0) => arr.reduce((s: number, c: any) => s + (Number(c[field]) || 0), init);
    const totals = { salesCount: ct(p.colors, 'salesCount'), shopStock: ct(p.colors, 'shopStock'), sdStock: ct(p.colors, 'sdStock'), cumulativeSales: ct(p.colors, 'cumulativeSales') };
    html += `<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:1110px;margin-bottom:16px;font-size:14px;font-family:Arial,sans-serif;table-layout:fixed" data-product-code="${p.productCode}">${cols}<tbody>`;
    html += `<tr style="background:#dbeafe">`;
    html += `<td rowspan="${rowSpan}" style="width:200px;height:200px;text-align:center;vertical-align:middle;padding:0;border:1px solid #9ca3af" data-product-code="${p.productCode}"><img src="${imgSrc}" data-product-code="${p.productCode}" style="width:200px;height:200px;display:block;object-fit:cover" /></td>`;
    html += tdGray('货号') + tdBold(p.productCode) + tdGray('销售价') + td(String(p.wholesalePrice || '-')) + tdGray('上市日期') + td(p.launchDate || '-') + tdGray('总排名') + tdBold(String(p.totalRank), 'color:#ea580c;font-size:16px') + '<td style="text-align:center;border:1px solid #9ca3af"></td>';
    html += `</tr>`;
    html += `<tr style="background:#f3f4f6">${tdGray('颜色名称')}${tdGray('排名')}${tdGray('销量')}${tdGray('店铺库存')}${tdGray('仓库库存')}${tdGray('库存店')}${tdGray('动销店')}${tdGray('动销率')}${tdGray('累计销量')}</tr>`;
    for (let i = 0; i < p.colors.length; i++) {
      const c = p.colors[i];
      html += `<tr style="background:${i % 2 === 0 ? '#fff' : '#f9fafb'}">${tdBold(c.colorName)}${td(String(c.colorRank || '-'))}${tdBold(c.salesCount.toLocaleString('zh-CN', { useGrouping: false }))}${td(c.shopStock.toLocaleString('zh-CN', { useGrouping: false }))}${td(String(c.sdStock || '-'))}${td(String(c.stockShops || '-'))}${td(String(c.activeShops || '-'))}${td(String(c.activationRate || '-'))}${td(c.cumulativeSales.toLocaleString('zh-CN', { useGrouping: false }))}</tr>`;
    }
    html += `<tr style="background:#fef9c3;font-weight:bold">${td('合计')}${td('-')}${tdBold(totals.salesCount.toLocaleString('zh-CN', { useGrouping: false }))}${tdBold(totals.shopStock.toLocaleString('zh-CN', { useGrouping: false }))}${tdBold(totals.sdStock.toLocaleString('zh-CN', { useGrouping: false }))}${td('-')}${td('-')}${td('-')}${tdBold(totals.cumulativeSales.toLocaleString('zh-CN', { useGrouping: false }))}</tr>`;
    if (detailDates.length > 0 && sortedDetails.length > 0) {
      html += `<tr style="background:#f3f4f6">${tdGray('颜色名称')}${detailDates.map(d => td(d.substring(5), 'font-size:11px;font-weight:600;color:#4b5563')).join('')}${td('合计', 'background:#dbeafe;font-weight:600')}</tr>`;
      for (let i = 0; i < sortedDetails.length; i++) {
        const d = sortedDetails[i];
        html += `<tr style="background:${i % 2 === 0 ? '#fff' : '#f9fafb'}">${td(d.colorName)}${detailDates.map(dt => td(d.dailySales[dt] ? d.dailySales[dt].toLocaleString('zh-CN', { useGrouping: false }) : '', 'font-size:11px')).join('')}${td(d.periodTotal.toLocaleString('zh-CN', { useGrouping: false }), 'background:#dbeafe;font-weight:bold')}</tr>`;
      }
    }
    html += `</tbody></table>`;
  }
  return html;
}

function buildExportCardHTML(product: ProductData, detailData: DetailRow[], detailDates: string[], imageMap: Map<string, string>): string {
  const imgSrc = imageMap.get(product.productCode) || PLACEHOLDER_SVG;
  const cols = '<colgroup><col width="110"><col width="70"><col width="80"><col width="90"><col width="90"><col width="70"><col width="70"><col width="70"><col width="90"></colgroup>';
  const td = (c: string, extra = '') => `<td style="text-align:center;border:1px solid #9ca3af;padding:4px 6px;height:32px;${extra}">${c}</td>`;
  const tdBold = (c: string, extra = '') => td(c, `font-weight:bold;${extra}`);
  const tdGray = (c: string) => td(c, 'font-weight:600;color:#4b5563');
  const productDetails = detailData.filter(d => d.productCode === product.productCode);
  const sortedDetails = [...productDetails].sort((a, b) => b.periodTotal - a.periodTotal);
  const ct = (arr: any[], field: string, init = 0) => arr.reduce((s: number, c: any) => s + (Number(c[field]) || 0), init);
  const totals = { salesCount: ct(product.colors, 'salesCount'), shopStock: ct(product.colors, 'shopStock'), sdStock: ct(product.colors, 'sdStock'), cumulativeSales: ct(product.colors, 'cumulativeSales') };

  let rows = '';
  rows += `<tr style="background:#dbeafe">${tdGray('货号')}${tdBold(product.productCode)}${tdGray('销售价')}${td(String(product.wholesalePrice || '-'))}${tdGray('上市日期')}${td(product.launchDate || '-')}${tdGray('总排名')}${tdBold(String(product.totalRank), 'color:#ea580c;font-size:16px')}<td style="text-align:center;border:1px solid #9ca3af;height:32px"></td></tr>`;
  rows += `<tr style="background:#f3f4f6">${tdGray('颜色名称')}${tdGray('排名')}${tdGray('销量')}${tdGray('店铺库存')}${tdGray('仓库库存')}${tdGray('库存店')}${tdGray('动销店')}${tdGray('动销率')}${tdGray('累计销量')}</tr>`;
  for (let i = 0; i < product.colors.length; i++) {
    const c = product.colors[i];
    rows += `<tr style="background:${i % 2 === 0 ? '#fff' : '#f9fafb'}">${tdBold(c.colorName)}${td(String(c.colorRank || '-'))}${tdBold(c.salesCount.toLocaleString('zh-CN', { useGrouping: false }))}${td(c.shopStock.toLocaleString('zh-CN', { useGrouping: false }))}${td(String(c.sdStock || '-'))}${td(String(c.stockShops || '-'))}${td(String(c.activeShops || '-'))}${td(String(c.activationRate || '-'))}${td(c.cumulativeSales.toLocaleString('zh-CN', { useGrouping: false }))}</tr>`;
  }
  rows += `<tr style="background:#fef9c3;font-weight:bold">${td('合计')}${td('-')}${tdBold(totals.salesCount.toLocaleString('zh-CN', { useGrouping: false }))}${tdBold(totals.shopStock.toLocaleString('zh-CN', { useGrouping: false }))}${tdBold(totals.sdStock.toLocaleString('zh-CN', { useGrouping: false }))}${td('-')}${td('-')}${td('-')}${tdBold(totals.cumulativeSales.toLocaleString('zh-CN', { useGrouping: false }))}</tr>`;
  if (detailDates.length > 0 && sortedDetails.length > 0) {
    rows += `<tr style="background:#f3f4f6">${tdGray('颜色名称')}${detailDates.map(d => td(d.substring(5), 'font-size:11px;font-weight:600;color:#4b5563')).join('')}${td('合计', 'background:#dbeafe;font-weight:600')}</tr>`;
    for (let i = 0; i < sortedDetails.length; i++) {
      const d = sortedDetails[i];
      rows += `<tr style="background:${i % 2 === 0 ? '#fff' : '#f9fafb'}">${td(d.colorName)}${detailDates.map(dt => td(d.dailySales[dt] ? d.dailySales[dt].toLocaleString('zh-CN', { useGrouping: false }) : '', 'font-size:11px')).join('')}${td(d.periodTotal.toLocaleString('zh-CN', { useGrouping: false }), 'background:#dbeafe;font-weight:bold')}</tr>`;
    }
  }

  const totalRows = 2 + product.colors.length + 1 + (detailDates.length > 0 && sortedDetails.length > 0 ? 1 + sortedDetails.length : 0);
  const cardHeight = totalRows * 35 + 4;

  return `<div style="display:flex;width:1110px;margin-bottom:12px;border:1px solid #9ca3af;border-radius:4px;overflow:hidden;font-size:13px;font-family:Arial,sans-serif;height:${cardHeight}px" data-product-code="${product.productCode}">
    <div style="width:200px;flex-shrink:0;overflow:hidden"><img src="${imgSrc}" data-product-code="${product.productCode}" style="width:200px;height:${cardHeight}px;display:block;object-fit:cover" /></div>
    <div style="flex:1;overflow:hidden"><table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed">${cols}<tbody>${rows}</tbody></table></div>
  </div>`;
}

interface ColorRow { colorName: string; colorRank: number; salesCount: number; shopStock: number; sdStock: number; stockShops: number; activeShops: number; activationRate: string; cumulativeSales: number; }
interface ProductData { productCode: string; wholesalePrice: number; launchDate: string; totalRank: number; imageUrl: string; colors: ColorRow[]; }
interface DetailRow { productCode: string; colorName: string; dailySales: Record<string, number>; periodTotal: number; }

function ProductCard({ product, detailData, detailDates, reloadKey }: { product: ProductData; detailData: DetailRow[]; detailDates: string[]; reloadKey: number }) {
  const colorTotals = useMemo(() => ({
    salesCount: product.colors.reduce((s, c) => s + c.salesCount, 0),
    shopStock: product.colors.reduce((s, c) => s + c.shopStock, 0),
    sdStock: product.colors.reduce((s, c) => s + c.sdStock, 0),
    cumulativeSales: product.colors.reduce((s, c) => s + c.cumulativeSales, 0),
  }), [product.colors]);
  const productDetails = detailData.filter(d => d.productCode === product.productCode);
  const sortedDetails = [...productDetails].sort((a, b) => b.periodTotal - a.periodTotal);
  const rowSpan = product.colors.length + sortedDetails.length + 4;

  return (
    <div className="mb-4 border border-gray-400 rounded-lg overflow-x-auto" data-product-code={product.productCode}>
      <table className="text-sm border-collapse table-fixed" style={{ width: 1110, minWidth: 1110 }} data-product-code={product.productCode}>
        <colgroup>
          <col style={{ width: '200px' }} />
          <col style={{ width: '110px' }} />
          <col style={{ width: '70px' }} />
          <col style={{ width: '80px' }} />
          <col style={{ width: '90px' }} />
          <col style={{ width: '90px' }} />
          <col style={{ width: '70px' }} />
          <col style={{ width: '70px' }} />
          <col style={{ width: '70px' }} />
          <col style={{ width: '90px' }} />
        </colgroup>
        <tbody>
          {/* 行1：产品信息 - 图片占 rowSpan，货号+code+销售价+price+上市日期+date+总排名+rank = 9 td，但图片占1列共10列 */}
          <tr className="bg-blue-50">
            <td className="border border-gray-400 text-center align-middle p-0" rowSpan={rowSpan}>
              <img src={`/api/product-image/${encodeURIComponent(product.productCode)}?_=${reloadKey}`} alt={product.productCode} data-product-code={product.productCode} style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }} crossOrigin="anonymous" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
            </td>
            <td className="px-2 py-2 font-medium text-gray-600 border border-gray-400 text-center">货号</td>
            <td className="px-2 py-2 font-bold text-gray-800 border border-gray-400 text-center">{product.productCode}</td>
            <td className="px-2 py-2 font-medium text-gray-600 border border-gray-400 text-center">销售价</td>
            <td className="px-2 py-2 font-medium text-gray-800 border border-gray-400 text-center">{product.wholesalePrice || '-'}</td>
            <td className="px-2 py-2 font-medium text-gray-600 border border-gray-400 text-center">上市日期</td>
            <td className="px-2 py-2 text-gray-800 border border-gray-400 text-center">{product.launchDate || '-'}</td>
            <td className="px-2 py-2 font-medium text-gray-600 border border-gray-400 text-center">总排名</td>
            <td className="px-2 py-2 font-bold text-orange-600 border border-gray-400 text-lg text-center" colSpan={2}>{product.totalRank}</td>
          </tr>

          {/* 行2：颜色列头 - 9 个 td（图片被 rowSpan 占用）*/}
          <tr className="bg-gray-100">
            <td className="px-2 py-1.5 font-medium text-gray-600 border border-gray-400 text-center">颜色名称</td>
            <td className="px-2 py-1.5 font-medium text-gray-600 border border-gray-400 text-center">排名</td>
            <td className="px-2 py-1.5 font-medium text-gray-600 border border-gray-400 text-center">销量</td>
            <td className="px-2 py-1.5 font-medium text-gray-600 border border-gray-400 text-center">店铺库存</td>
            <td className="px-2 py-1.5 font-medium text-gray-600 border border-gray-400 text-center">仓库库存</td>
            <td className="px-2 py-1.5 font-medium text-gray-600 border border-gray-400 text-center">库存店</td>
            <td className="px-2 py-1.5 font-medium text-gray-600 border border-gray-400 text-center">动销店</td>
            <td className="px-2 py-1.5 font-medium text-gray-600 border border-gray-400 text-center">动销率</td>
            <td className="px-2 py-1.5 font-medium text-gray-600 border border-gray-400 text-center">累计销量</td>
          </tr>

          {/* 颜色明细 */}
          {product.colors.map((c, i) => (
            <tr key={c.colorName} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="px-2 py-1.5 font-medium border border-gray-400 text-center">{c.colorName}</td>
              <td className="px-2 py-1.5 border border-gray-400 text-center">{c.colorRank || '-'}</td>
              <td className="px-2 py-1.5 font-medium border border-gray-400 text-center">{c.salesCount.toLocaleString('zh-CN', { useGrouping: false })}</td>
              <td className="px-2 py-1.5 border border-gray-400 text-center">{c.shopStock.toLocaleString('zh-CN', { useGrouping: false })}</td>
              <td className="px-2 py-1.5 border border-gray-400 text-center">{c.sdStock || '-'}</td>
              <td className="px-2 py-1.5 border border-gray-400 text-center">{c.stockShops || '-'}</td>
              <td className="px-2 py-1.5 border border-gray-400 text-center">{c.activeShops || '-'}</td>
              <td className="px-2 py-1.5 border border-gray-400 text-center">{c.activationRate || '-'}</td>
              <td className="px-2 py-1.5 border border-gray-400 text-center">{c.cumulativeSales.toLocaleString('zh-CN', { useGrouping: false })}</td>
            </tr>
          ))}

          {/* 合计 */}
          <tr className="bg-yellow-50 font-medium">
            <td className="px-2 py-1.5 border border-gray-400 text-center">合计</td>
            <td className="px-2 py-1.5 border border-gray-400 text-center">-</td>
            <td className="px-2 py-1.5 font-bold border border-gray-400 text-center">{colorTotals.salesCount.toLocaleString('zh-CN', { useGrouping: false })}</td>
            <td className="px-2 py-1.5 font-bold border border-gray-400 text-center">{colorTotals.shopStock.toLocaleString('zh-CN', { useGrouping: false })}</td>
            <td className="px-2 py-1.5 font-bold border border-gray-400 text-center">{colorTotals.sdStock.toLocaleString('zh-CN', { useGrouping: false })}</td>
            <td className="px-2 py-1.5 border border-gray-400 text-center">-</td>
            <td className="px-2 py-1.5 border border-gray-400 text-center">-</td>
            <td className="px-2 py-1.5 border border-gray-400 text-center">-</td>
            <td className="px-2 py-1.5 font-bold border border-gray-400 text-center">{colorTotals.cumulativeSales.toLocaleString('zh-CN', { useGrouping: false })}</td>
          </tr>

          {/* 每日明细列头 */}
          <tr className="bg-gray-100">
            <td className="px-2 py-1.5 font-medium text-gray-600 border border-gray-400 text-center">颜色名称</td>
            {detailDates.length > 0 ? detailDates.map(d => <td key={d} className="px-1 py-1.5 font-medium text-gray-600 border border-gray-400 text-center text-xs">{d.substring(5)}</td>)
              : <td className="px-2 py-1.5 font-medium text-gray-400 border border-gray-400 text-center" colSpan={8}>暂无每日明细数据</td>}
            {detailDates.length > 0 && <td className="px-2 py-1.5 font-medium text-gray-700 border border-gray-400 text-center bg-blue-50">合计</td>}
          </tr>

          {/* 每日明细行 */}
          {detailDates.length > 0 && sortedDetails.map((d, i) => (
            <tr key={d.colorName} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="px-2 py-1 border border-gray-400 text-center">{d.colorName}</td>
              {detailDates.map(date => <td key={date} className="px-1 py-1 border border-gray-400 text-center text-xs">{d.dailySales[date] ? d.dailySales[date].toLocaleString('zh-CN', { useGrouping: false }) : ''}</td>)}
              <td className="px-2 py-1 border border-gray-400 text-center font-medium bg-blue-50">{d.periodTotal.toLocaleString('zh-CN', { useGrouping: false })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionBlock({ config, warehouseData, loading, reloadKey, warehouse }: {
  config: SectionConfig; warehouseData: Record<string, { products: ProductData[]; detail: DetailRow[]; dates: string[] }>; loading: boolean; reloadKey: number; warehouse: string;
}) {
  const sd = warehouseData[warehouse] || { products: [], detail: [], dates: [] };
  if (loading) return <div className="bg-white rounded-xl shadow-sm p-8 mb-4"><div className="animate-pulse"><div className="h-6 bg-gray-200 rounded w-1/3 mb-4" /><div className="h-48 bg-gray-100 rounded" /></div></div>;
  return (
    <div className="mb-4">
      <div className="bg-blue-600 text-white px-4 py-2 rounded-t-lg text-center"><h3 style={{ fontSize: '1.4rem' }} className="font-bold">【{config.periodLabel}】{warehouse}畅销款前 {sd.products.length} 名</h3></div>
      <div className="bg-white rounded-b-lg shadow-sm p-3">
        {sd.products.length === 0 ? <div className="text-center py-8 text-gray-400">暂无数据 (DX: {config.summaryDX})</div>
          : sd.products.map(p => <ProductCard key={`${p.productCode}_${p.totalRank}_${warehouse}`} product={p} detailData={sd.detail} detailDates={sd.dates} reloadKey={reloadKey} />)}
      </div>
    </div>
  );
}

export default function BestSellerPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [reloading, setReloading] = useState(false);
  const [seasons, setSeasons] = useState<string[]>(() => [getCurrentSeasonContext().season]);
  const [year, setYear] = useState<string>(() => getCurrentSeasonContext().year);
  const [sectionData, setSectionData] = useState<Record<string, Record<string, { products: ProductData[]; detail: DetailRow[]; dates: string[] }>>>({});
  const [activeSection, setActiveSection] = useState<string>('yesterday');
  const [exporting, setExporting] = useState<{ type: 'word' | 'image' | 'page'; sectionId: string } | null>(null);

  const formatTimestamp = () => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
  };

  useEffect(() => {
    if (_cachedData && _cachedSeasons) {
      setSeasons(_cachedSeasons);
      if (_cachedYear) setYear(_cachedYear);
      setSectionData(_cachedData);
      setLoading(false);
    } else {
      setLoading(false);
    }
  }, []);

  const loadData = async () => {
    setLoading(true);
    const seasonParam = seasons.length > 0 ? `'${seasons.join("','")}'` : '';
    const seasonStart = computeSeasonStart(seasons, year);
    const init: Record<string, Record<string, { products: ProductData[]; detail: DetailRow[]; dates: string[] }>> = {};
    for (const sec of SECTIONS) {
      init[sec.id] = {};
      const detailDates: string[] = [];
      for (let i = 7; i >= 1; i--) { const d = new Date(); d.setDate(d.getDate() - i); detailDates.push(d.toISOString().split('T')[0]); }
      for (const wh of WAREHOUSES) {
        try {
          const res = await axios.get(`/data-extraction/execute/${encodeURIComponent(sec.summaryDX)}`, { params: { season: seasonParam, year, seasonStart: `'${seasonStart}'`, warehouse: `'${wh}'`, sdWarehouse: `'${SD_WAREHOUSE_MAP[wh]}'` }, timeout: 180000 });
          const rawRows: any[] = res.data || [];
          const productMap = new Map<string, ProductData>();
          for (const r of rawRows) {
            const code = r.productCode || '';
            if (!productMap.has(code)) productMap.set(code, { productCode: code, wholesalePrice: Number(r.wholesalePrice) || 0, launchDate: r.launchDate || '', totalRank: Number(r.totalRank) || 0, imageUrl: r.imageUrl || '', colors: [] });
            productMap.get(code)!.colors.push({ colorName: r.colorName || '', colorRank: Number(r.colorRank) || 0, salesCount: Number(r.salesCount) || 0, shopStock: Number(r.shopStock) || 0, sdStock: Number(r.sdStock) || 0, stockShops: Number(r.stockShops) || 0, activeShops: Number(r.activeShops) || 0, activationRate: r.activationRate || '', cumulativeSales: Number(r.cumulativeSales) || 0 });
          }
          let detail: DetailRow[] = [];
          try {
            const dres = await axios.get(`/data-extraction/execute/${encodeURIComponent('畅销款_每日明细_近7天')}`, { params: { warehouse: `'${wh}'` }, timeout: 180000 });
            const drows: any[] = dres.data || [];
            const map = new Map<string, DetailRow>();
            for (const r of drows) {
              const cn = r.colorName || ''; const pc = r.productCode || ''; const key = pc + '|' + cn;
              if (!map.has(key)) map.set(key, { productCode: pc, colorName: cn, dailySales: {}, periodTotal: 0 });
              const dt = String(r.日期 || r.date || '').slice(0, 10);
              const q = Number(r.本期销量 || r.salesCount || 0);
              if (dt) map.get(key)!.dailySales[dt] = (map.get(key)!.dailySales[dt] || 0) + q;
              map.get(key)!.periodTotal += q;
            }
            detail = Array.from(map.values());
          } catch (e) { console.error(`[${sec.id}][${wh}] detail failed:`, e); }
          init[sec.id][wh] = { products: Array.from(productMap.values()).sort((a, b) => a.totalRank - b.totalRank), detail, dates: detailDates };
        } catch (e) { console.error(`[${sec.id}][${wh}] failed:`, e); init[sec.id][wh] = { products: [], detail: [], dates: detailDates }; }
      }
    }
    setSectionData(init); setLoading(false);
    _cachedData = init; _cachedSeasons = [...seasons]; _cachedYear = year;
  };

  const reloadImages = async () => {
    setReloading(true);
    try { await axios.post('/product-image/reload-images'); } catch { /* ignore */ }
    setReloadKey(k => k + 1);
    setReloading(false);
  };

  const toggleSeason = (s: string) => {
    setSeasons(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    for (const sec of SECTIONS) {
      for (const wh of WAREHOUSES) {
        const sd = sectionData[sec.id]?.[wh];
        if (!sd || sd.products.length === 0) continue;
        const rows: any[][] = [];
        for (const p of sd.products) {
          const colorTotals = {
            salesCount: p.colors.reduce((s, c) => s + c.salesCount, 0),
            shopStock: p.colors.reduce((s, c) => s + c.shopStock, 0),
            sdStock: p.colors.reduce((s, c) => s + c.sdStock, 0),
            cumulativeSales: p.colors.reduce((s, c) => s + c.cumulativeSales, 0),
          };
          rows.push(['', '货号', p.productCode, '销售价', p.wholesalePrice, '上市日期', p.launchDate, '总排名', p.totalRank, '']);
          rows.push(['图片', '颜色名称', '排名', '销量', '店铺库存', '仓库库存', '库存店', '动销店', '动销率', '累计销量']);
          for (const c of p.colors) {
            rows.push(['', c.colorName, c.colorRank, c.salesCount, c.shopStock, c.sdStock, c.stockShops, c.activeShops, c.activationRate, c.cumulativeSales]);
          }
          rows.push(['', '合计', '-', colorTotals.salesCount, colorTotals.shopStock, colorTotals.sdStock, '-', '-', '-', colorTotals.cumulativeSales]);
          const sortedDetails = sd.detail.filter(d => d.productCode === p.productCode).sort((a, b) => b.periodTotal - a.periodTotal);
          if (sd.dates.length > 0 && sortedDetails.length > 0) {
            rows.push(['颜色名称', ...sd.dates, '合计']);
            for (const d of sortedDetails) {
              rows.push([d.colorName, ...sd.dates.map(dt => d.dailySales[dt] || 0), d.periodTotal]);
            }
          }
          rows.push([]);
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, (sec.periodLabel + '_' + wh).slice(0, 30));
      }
    }
    XLSX.writeFile(wb, `畅销款排行_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const scrollAndWaitForImages = async (sectionId: string): Promise<void> => {
    const sectionEl = document.querySelector(`[data-section-id="${sectionId}"]`);
    if (!sectionEl) return;
    const cards = Array.from(sectionEl.querySelectorAll('[data-product-code]')) as HTMLElement[];
    const uniqueCards = new Map<string, HTMLElement>();
    for (const el of cards) {
      const code = el.getAttribute('data-product-code');
      if (code && !uniqueCards.has(code)) uniqueCards.set(code, el);
    }
    for (const el of uniqueCards.values()) {
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      await new Promise(r => setTimeout(r, 150));
    }
    const imgs = Array.from(sectionEl.querySelectorAll('img[data-product-code]')) as HTMLImageElement[];
    await Promise.all(imgs.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>(resolve => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 3000);
      });
    }));
    await new Promise(r => setTimeout(r, 500));
  };

  const exportWord = async (sectionId: string) => {
    const wd = sectionData[sectionId];
    if (!wd) return;
    const sec = SECTIONS.find(s => s.id === sectionId)!;
    setExporting({ type: 'word', sectionId });
    try {
      await scrollAndWaitForImages(sectionId);
      let allHTML = '';
      for (const wh of WAREHOUSES) {
        const sd = wd[wh];
        if (!sd || sd.products.length === 0) continue;
        const codes = [...new Set(sd.products.map(p => p.productCode))];
        const imageMap = await preloadImagesRobust(codes, reloadKey);
        allHTML += `<h3 style="text-align:center;color:#2563eb;margin:20px 0 12px">【${sec.periodLabel}】${wh}畅销款前 ${sd.products.length} 名</h3>`;
        allHTML += buildExportTableHTML(sd.products, sd.detail, sd.dates, imageMap);
      }
      const fullHTML = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>畅销款排行_${sec.periodLabel}</title><style>body{font-family:Arial,sans-serif;padding:20px;font-size:14px}h2{text-align:center;color:#2563eb;font-size:20px}h3{text-align:center;color:#2563eb;font-size:17px}table{page-break-inside:avoid;font-size:14px}img{display:block}</style></head><body>${allHTML}</body></html>`;
      const blob = new Blob(['\ufeff' + fullHTML], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `畅销款排行_${sec.periodLabel}_${formatTimestamp()}.doc`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(`[exportWord:${sectionId}]`, e); alert(`Word导出失败: ${(e as Error).message}`); }
    setExporting(null);
  };

  const exportImage = async (sectionId: string) => {
    const wd = sectionData[sectionId];
    if (!wd) return;
    setExporting({ type: 'image', sectionId });
    try {
      await scrollAndWaitForImages(sectionId);
      const sec = SECTIONS.find(s => s.id === sectionId)!;
      const allCanvases: { label: string; cards: HTMLCanvasElement[] }[] = [];
      for (const wh of WAREHOUSES) {
        const sd = wd[wh];
        if (!sd || sd.products.length === 0) continue;
        const codes = [...new Set(sd.products.map(p => p.productCode))];
        const imageMap = await preloadImagesRobust(codes, reloadKey);
        const cardCanvases: HTMLCanvasElement[] = [];
        for (const p of sd.products) {
          const cardHTML = buildExportCardHTML(p, sd.detail, sd.dates, imageMap);
          const wrap = document.createElement('div');
          wrap.style.cssText = 'position:absolute;left:-9999px;top:0;width:1130px;padding:2px;background:#fff';
          wrap.innerHTML = cardHTML;
          document.body.appendChild(wrap);
          const imgs = Array.from(wrap.querySelectorAll('img')) as HTMLImageElement[];
          await Promise.all(imgs.map(img => {
            if (img.complete && img.naturalWidth > 0) return Promise.resolve();
            return new Promise<void>(resolve => {
              let done = false;
              const onDone = () => { if (!done) { done = true; resolve(); } };
              img.addEventListener('load', onDone, { once: true });
              img.addEventListener('error', onDone, { once: true });
              setTimeout(onDone, 5000);
            });
          }));
          await new Promise(r => setTimeout(r, 500));
          const c = await html2canvas(wrap, { scale: 2, backgroundColor: '#ffffff', useCORS: true, allowTaint: true, logging: false, width: wrap.scrollWidth, height: wrap.scrollHeight });
          document.body.removeChild(wrap);
          cardCanvases.push(c);
        }
        allCanvases.push({ label: `【${sec.periodLabel}】${wh}畅销款前 ${sd.products.length} 名`, cards: cardCanvases });
      }
      // 合成全部
      const gap = 8; const sectionGap = 24; const titleH = 100; const subTitleH = 90;
      const maxW = Math.max(...allCanvases.flatMap(a => a.cards.map(c => c.width)), 200);
      const totalH = titleH + allCanvases.reduce((s, a) => s + subTitleH + a.cards.reduce((cs, c) => cs + c.height + gap, 0) + sectionGap, 0);
      const big = document.createElement('canvas');
      big.width = maxW; big.height = totalH;
      const ctx = big.getContext('2d')!;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, maxW, totalH);
      // 主标题：天蓝背景 + 大红字 3倍，垂直居中
      ctx.fillStyle = '#87CEEB'; ctx.fillRect(0, 0, maxW, titleH);
      ctx.fillStyle = '#DC143C'; ctx.font = 'bold 84px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`畅销款排行 — ${sec.periodLabel}`, maxW / 2, titleH / 2);
      let y = titleH;
      for (const a of allCanvases) {
        // 副标题：蓝色背景 + 粉红字 3倍，垂直居中
        ctx.fillStyle = '#2563eb'; ctx.fillRect(0, y, maxW, subTitleH);
        ctx.fillStyle = '#FF69B4'; ctx.font = 'bold 72px Arial'; ctx.textBaseline = 'middle';
        ctx.fillText(a.label, maxW / 2, y + subTitleH / 2);
        y += subTitleH;
        for (const c of a.cards) { ctx.drawImage(c, 0, y); y += c.height + gap; }
        y += sectionGap;
      }
      const imgData = big.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pw = pdf.internal.pageSize.getWidth(); const ph = pdf.internal.pageSize.getHeight();
      const ratio = pw / big.width; const imgH = big.height * ratio;
      let pos = 0;
      pdf.addImage(imgData, 'JPEG', 0, pos, pw, imgH);
      let remaining = imgH - ph;
      while (remaining > 0) { pos -= ph; pdf.addPage(); pdf.addImage(imgData, 'JPEG', 0, pos, pw, imgH); remaining -= ph; }
      // 文件名映射
      const nameMap: Record<string, string> = {
        yesterday: '昨日销',
        week7: '周销',
        month20: '20日销',
        new20: '近20天上新周销',
      };
      pdf.save(`畅销款排行前20名_${nameMap[sectionId] || sec.periodLabel}2026新秋_${formatTimestamp()}.pdf`);
    } catch (e) { console.error(`[exportImage:${sectionId}]`, e); alert(`图片导出失败: ${(e as Error).message}`); }
    setExporting(null);
  };

  return (
    <Layout title="畅销款排行" subtitle="昨日/7天/20天畅销款排行榜">
      <div className="p-4">
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          <div className="h-5 w-px bg-gray-200" /><TrendingUp size={20} className="text-orange-500" />
          <span className="font-medium">基准日：{new Date().toISOString().split('T')[0]}</span>
          <div className="flex items-center gap-2 ml-2">
            <span className="text-sm text-gray-600">季节:</span>
            {['春', '夏', '秋', '冬'].map(s => (
              <label key={s} className="flex items-center gap-1 text-sm cursor-pointer">
                <input type="checkbox" checked={seasons.includes(s)} onChange={() => toggleSeason(s)} className="cursor-pointer" />
                <span>{s}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">年份:</span>
            <input type="text" value={year} onChange={e => setYear(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-20" />
            <button onClick={() => loadData()} disabled={loading} className="px-4 py-1.5 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50 text-sm font-medium">确认刷新</button>
          </div>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <button onClick={reloadImages} disabled={reloading} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm">{reloading ? '刷新中...' : '重新获取图片'}</button>
            <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm"><FileSpreadsheet size={16} /> 导出Excel</button>
            <span className="text-sm text-gray-600 font-medium ml-1">导出Word:</span>
            {SECTIONS.map(sec => (
              <button key={'w_' + sec.id} onClick={() => exportWord(sec.id)} disabled={exporting !== null} className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 text-sm">
                {exporting?.type === 'word' && exporting?.sectionId === sec.id ? '导出中...' : sec.periodLabel}
              </button>
            ))}
            <span className="text-sm text-gray-600 font-medium ml-1">导出图片:</span>
            {SECTIONS.map(sec => (
              <button key={'i_' + sec.id} onClick={() => exportImage(sec.id)} disabled={exporting !== null} className="flex items-center gap-1 px-2.5 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 text-sm">
                {exporting?.type === 'image' && exporting?.sectionId === sec.id ? '导出中...' : sec.periodLabel}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-0 -mb-px">
          {SECTIONS.map(sec => (
            <button key={sec.id} onClick={() => setActiveSection(sec.id)}
              className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${activeSection === sec.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {sec.periodLabel}
            </button>
          ))}
        </div>
        <div style={{ width: 'fit-content', minWidth: 1110 }}>
          {(() => {
            const config = SECTIONS.find(s => s.id === activeSection)!;
            const wd = sectionData[config.id] || {};
            return <div data-section-id={config.id} className="mb-6">
              {WAREHOUSES.map(wh => <SectionBlock key={wh} config={config} warehouseData={wd} loading={loading} reloadKey={reloadKey} warehouse={wh} />)}
            </div>;
          })()}
        </div>
      </div>
    </Layout>
  );
}
