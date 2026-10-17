/**
 * 统计素材库 4500 张图片的分类分布
 * ============================================================
 * 1. 扫描素材库目录中的所有图片
 * 2. 从文件名提取货号
 * 3. 查询数据库"商品全"表
 * 4. 统计性别/风格/款式/细类分布
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const sql = require('mssql');

// ======= 配置 =======
const MATERIALS_DIR = '\\\\192.168.110.199\\tupian\\图片';
const CACHE_DIR = 'h:\\AI测试项目\\卡迪高巡店系统\\src\\server\\data';
const CONFIG_PATH = 'h:\\AI测试项目\\卡迪高巡店系统\\config.json';

console.log('============================================================');
console.log(' 素材库图片分类统计');
console.log('============================================================\n');

// ============================================================
// 货号提取逻辑
// ============================================================
function extractStyleCode(fileName) {
  const baseName = path.basename(fileName, path.extname(fileName));
  const strictPattern = baseName.match(/(\d{2,3}[A-Za-z]\d{4,5})/);
  if (strictPattern) return strictPattern[1].toUpperCase();
  const spMatch = baseName.match(/(SP|sp)[A-Za-z0-9]+/);
  if (spMatch) return spMatch[0].toUpperCase();
  const sepMatch = baseName.split(/[-_\s]/)[0];
  if (sepMatch && /^[A-Za-z0-9]+$/.test(sepMatch) && sepMatch.length >= 4)
    return sepMatch.toUpperCase();
  const clean = baseName.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.substring(0, 12);
}

// ============================================================
// 细类识别
// ============================================================
function detectCategory(goodsType, styleType) {
  if (!goodsType && !styleType) return '未知';
  const str = (String(goodsType || '') + ' ' + String(styleType || '')).toLowerCase();
  if (str.includes('鞋') || str.includes('sneaker') || str.includes('shoe') || str.includes('boot')) return '鞋';
  if (str.includes('包') || str.includes('bag') || str.includes('手袋')) return '包';
  if (str.includes('衣') || str.includes('裤') || str.includes('装')) return '服装';
  if (str.includes('帽') || str.includes('饰') || str.includes('巾') || str.includes('带')) return '配饰';
  return '其他';
}

function detectShoeSubcategory(goodsType, styleType) {
  if (!goodsType && !styleType) return '未知';
  const str = (String(goodsType || '') + ' ' + String(styleType || '')).toLowerCase();
  if (str.includes('板鞋') || str.includes('休闲') || str.includes('运动') ||
      str.includes('帆布') || str.includes('sneaker') || str.includes('trainer')) return '板鞋类';
  if (str.includes('高跟') || str.includes('时装') || str.includes('跟鞋') ||
      str.includes('浅口') || str.includes('尖头') || str.includes('单鞋')) return '高跟鞋类';
  if (str.includes('皮鞋') || str.includes('商务') || str.includes('正装')) return '皮鞋类';
  if (str.includes('凉鞋') || str.includes('拖鞋') || str.includes('人字')) return '凉鞋类';
  if (str.includes('靴')) return '靴子类';
  return '其他鞋';
}

// ============================================================
// 主逻辑
// ============================================================
(async () => {
  try {
    console.log('步骤 1: 扫描素材库目录...');
    const allFiles = fs.readdirSync(MATERIALS_DIR)
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f));
    console.log('  发现图片总数:', allFiles.length, '张\n');

    console.log('步骤 2: 从文件名提取唯一货号...');
    const uniqueCodes = new Set();
    const codeToFiles = new Map();
    allFiles.forEach(f => {
      const code = extractStyleCode(f);
      if (code && code.length >= 4) {
        uniqueCodes.add(code);
        if (!codeToFiles.has(code)) codeToFiles.set(code, []);
        codeToFiles.get(code).push(f);
      }
    });
    console.log('  提取到唯一货号:', uniqueCodes.size, '个');
    const sortedCodes = Array.from(uniqueCodes);
    console.log('  前 20 个货号示例:', sortedCodes.slice(0, 20).join(', '));
    console.log('  单个货号最多图片数:', Math.max(...Array.from(codeToFiles.values()).map(arr => arr.length)), '\n');

    // ---- 3. 连接数据库 ----
    console.log('步骤 3: 连接数据库并查询商品信息...');
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const dbConfig = {
      server: config.database.server || '192.168.110.200',
      port: config.database.port || 1433,
      database: config.database.database || 'test',
      user: config.database.user || 'sa',
      password: config.database.password || '123456',
      connectionTimeout: 30000,
      requestTimeout: 120000,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
      },
    };
    const pool = await sql.connect(dbConfig);
    console.log('  ✅ 数据库连接成功\n');

    // 分批查询数据库
    const goodsMap = new Map();
    const batchSize = 500;
    const codesArray = Array.from(uniqueCodes);

    console.log('步骤 4: 分批查询数据库商品信息（每批 ' + batchSize + ' 个）...');
    for (let i = 0; i < codesArray.length; i += batchSize) {
      const batch = codesArray.slice(i, i + batchSize);
      const inClause = batch.map((_, idx) => '@code' + idx).join(',');
      const request = pool.request();
      batch.forEach((code, idx) => request.input('code' + idx, sql.NVarChar(100), code));

      const query = `
        SELECT 
          商品代码 as style_code,
          性别 as gender,
          风格 as style_type,
          款式 as goods_type
        FROM [商品全]
        WHERE 商品代码 IN (${inClause})
      `;

      const result = await request.query(query);
      result.recordset.forEach(row => {
        const key = (row.style_code || '').toString().toUpperCase();
        if (key) {
          goodsMap.set(key, {
            gender: row.gender ? String(row.gender).trim() : null,
            style_type: row.style_type ? String(row.style_type).trim() : null,
            goods_type: row.goods_type ? String(row.goods_type).trim() : null,
          });
        }
      });

      console.log('  批次 ' + (Math.floor(i / batchSize) + 1) + '/' + Math.ceil(codesArray.length / batchSize) +
        ': 查询 ' + batch.length + ' 个，命中 ' + result.recordset.length + ' 条（累计 ' + goodsMap.size + '）');
    }
    console.log('  ✅ 数据库查询完成，共命中 ' + goodsMap.size + ' 个不同货号\n');

    // ---- 4. 统计分布 ----
    console.log('============================================================');
    console.log(' 统计结果');
    console.log('============================================================\n');

    // 大类统计
    const categoryCount = new Map();
    const subcategoryCount = new Map();
    const genderCount = new Map();
    const styleCount = new Map();
    const goodsTypeCount = new Map();
    let matchedInDb = 0;

    allFiles.forEach(f => {
      const code = extractStyleCode(f);
      const goods = goodsMap.get(code);
      if (goods) {
        matchedInDb++;
        const category = detectCategory(goods.goods_type, goods.style_type);
        const subcategory = detectShoeSubcategory(goods.goods_type, goods.style_type);
        categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
        subcategoryCount.set(subcategory, (subcategoryCount.get(subcategory) || 0) + 1);
        if (goods.gender) genderCount.set(goods.gender, (genderCount.get(goods.gender) || 0) + 1);
        if (goods.style_type) styleCount.set(goods.style_type, (styleCount.get(goods.style_type) || 0) + 1);
        if (goods.goods_type) goodsTypeCount.set(goods.goods_type, (goodsTypeCount.get(goods.goods_type) || 0) + 1);
      }
    });

    const totalImages = allFiles.length;
    const matchedRatio = ((matchedInDb / totalImages) * 100).toFixed(1);

    console.log('📊 基本统计:');
    console.log('  - 图片总数:', totalImages);
    console.log('  - 唯一货号数:', uniqueCodes.size);
    console.log('  - 数据库匹配货号数:', goodsMap.size);
    console.log('  - 有元数据的图片数:', matchedInDb);
    console.log('  - 数据库命中率:', matchedRatio + '%\n');

    // 大类分布
    console.log('📦 大类分布（图片数/占比）:');
    const sortedCategories = Array.from(categoryCount.entries()).sort((a, b) => b[1] - a[1]);
    sortedCategories.forEach(([cat, count]) => {
      const pct = ((count / matchedInDb) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(count / 50));
      console.log('  - ' + cat.padEnd(10) + ':', String(count).padStart(5) + ' (' + pct.padStart(5) + '%) ' + bar);
    });
    console.log('');

    // 细类分布
    console.log('👟 细类分布（鞋子类进一步细分，图片数/占比）:');
    const sortedSubcategories = Array.from(subcategoryCount.entries()).sort((a, b) => b[1] - a[1]);
    sortedSubcategories.forEach(([sub, count]) => {
      const pct = ((count / matchedInDb) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(count / 50));
      console.log('  - ' + sub.padEnd(10) + ':', String(count).padStart(5) + ' (' + pct.padStart(5) + '%) ' + bar);
    });
    console.log('');

    // 性别分布
    console.log('👨‍👩‍👧 性别分布:');
    const sortedGenders = Array.from(genderCount.entries()).sort((a, b) => b[1] - a[1]);
    sortedGenders.forEach(([g, count]) => {
      const pct = ((count / matchedInDb) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(count / 50));
      console.log('  - ' + g.padEnd(10) + ':', String(count).padStart(5) + ' (' + pct.padStart(5) + '%) ' + bar);
    });
    console.log('');

    // 风格分布（Top 20）
    console.log('🎨 风格分布 Top 20:');
    const sortedStyles = Array.from(styleCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
    sortedStyles.forEach(([s, count]) => {
      const pct = ((count / matchedInDb) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(count / 30));
      console.log('  - ' + s.padEnd(15) + ':', String(count).padStart(5) + ' (' + pct.padStart(5) + '%) ' + bar);
    });
    console.log('');

    // 款式分布（Top 30）
    console.log('👢 款式（goods_type）分布 Top 30:');
    const sortedGoodsTypes = Array.from(goodsTypeCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);
    sortedGoodsTypes.forEach(([gt, count]) => {
      const pct = ((count / matchedInDb) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(count / 30));
      console.log('  - ' + gt.padEnd(20) + ':', String(count).padStart(5) + ' (' + pct.padStart(5) + '%) ' + bar);
    });
    console.log('');

    // ---- 5. 保存详细结果到 JSON ----
    console.log('步骤 5: 保存统计结果...');
    const outputData = {
      createdAt: new Date().toISOString(),
      totalImages,
      uniqueStyles: uniqueCodes.size,
      matchedStyles: goodsMap.size,
      matchedImages: matchedInDb,
      matchedRatio: matchedRatio,
      categoryDistribution: sortedCategories.map(([name, count]) => ({ name, count, ratio: (count / matchedInDb * 100).toFixed(1) + '%' })),
      subcategoryDistribution: sortedSubcategories.map(([name, count]) => ({ name, count, ratio: (count / matchedInDb * 100).toFixed(1) + '%' })),
      genderDistribution: sortedGenders.map(([name, count]) => ({ name, count, ratio: (count / matchedInDb * 100).toFixed(1) + '%' })),
      styleTypeDistribution: sortedStyles.map(([name, count]) => ({ name, count, ratio: (count / matchedInDb * 100).toFixed(1) + '%' })),
      goodsTypeDistribution: sortedGoodsTypes.map(([name, count]) => ({ name, count, ratio: (count / matchedInDb * 100).toFixed(1) + '%' })),
    };

    const outputPath = path.join(CACHE_DIR, 'material-category-stats.json');
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    console.log('  ✅ 统计结果已保存:', outputPath);

    // 也保存一份简化版，方便快速浏览
    const summaryLines = [];
    summaryLines.push('素材库图片分类统计 - ' + new Date().toLocaleString('zh-CN'));
    summaryLines.push('');
    summaryLines.push('图片总数: ' + totalImages);
    summaryLines.push('唯一货号数: ' + uniqueCodes.size);
    summaryLines.push('数据库匹配货号数: ' + goodsMap.size);
    summaryLines.push('有元数据的图片数: ' + matchedInDb + ' (命中率: ' + matchedRatio + '%)');
    summaryLines.push('');
    summaryLines.push('====== 细类分布 ======');
    sortedSubcategories.forEach(([name, count]) => {
      const pct = ((count / matchedInDb) * 100).toFixed(1);
      summaryLines.push('  ' + name.padEnd(12) + ': ' + String(count).padStart(5) + ' (' + pct + '%)');
    });
    summaryLines.push('');
    summaryLines.push('====== 款式分布（Top 30）======');
    sortedGoodsTypes.forEach(([name, count]) => {
      const pct = ((count / matchedInDb) * 100).toFixed(1);
      summaryLines.push('  ' + name.padEnd(20) + ': ' + String(count).padStart(5) + ' (' + pct + '%)');
    });

    const summaryPath = path.join(CACHE_DIR, 'material-category-stats.txt');
    fs.writeFileSync(summaryPath, summaryLines.join('\n'), 'utf-8');
    console.log('  ✅ 简化版已保存:', summaryPath);

    console.log('\n============================================================');
    console.log(' 全部完成！');
    console.log('============================================================');

  } catch (error) {
    console.error('\n❌ 处理失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    try { await sql.close(); } catch (e) {}
  }
})();
