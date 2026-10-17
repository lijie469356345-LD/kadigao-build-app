/**
 * 为素材库特征缓存补充商品元数据（性别/风格/款式）
 * ============================================================
 * 1. 读取 config.json 中的数据库配置
 * 2. 连接 SQL Server，查询"商品全"表
 * 3. 读取现有 material-features.json
 * 4. 用优化的 extractStyleCode 函数从文件名提取货号
 * 5. 根据货号匹配数据库中的商品元数据
 * 6. 保存新的缓存文件（包含 gender/style_type/goods_type）
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const sql = require('mssql');

// ======= 配置 =======
const MATERIALS_DIR = '\\\\192.168.110.199\\tupian\\图片';
const CACHE_DIR = 'h:\\AI测试项目\\卡迪高巡店系统\\src\\server\\data';
const CACHE_FILE = path.join(CACHE_DIR, 'material-features.json');
const CONFIG_PATH = 'h:\\AI测试项目\\卡迪高巡店系统\\config.json';

console.log('===== 开始为素材库缓存补充商品元数据 =====');
console.log('缓存文件:', CACHE_FILE);
console.log('配置文件:', CONFIG_PATH);
console.log('');

// ============================================================
// 优化的 extractStyleCode 函数
// 根据用户提供的货号格式：28T0792, 37S2962, 713S0686, 297S2115, ...
// 模式：数字(2-3位) + 字母(T/S等) + 数字(4位)
// ============================================================
function extractStyleCode(fileName) {
  const baseName = path.basename(fileName, path.extname(fileName));

  // 1) 优先匹配"数字(2-3位) + 字母 + 数字(4-5位)" 的明确模式
  //    如 28T0792, 37S2962, 713S0686, 297S2115, 516S9696, 561T1130
  const strictPattern = baseName.match(/(\d{2,3}[A-Za-z]\d{4,5})/);
  if (strictPattern) {
    return strictPattern[1].toUpperCase();
  }

  // 2) 匹配 SP + 数字 的模式（如 SP123456）
  const spMatch = baseName.match(/(SP|sp)[A-Za-z0-9]+/);
  if (spMatch) {
    return spMatch[0].toUpperCase();
  }

  // 3) 分隔符优先：取第一个 - 或 _ 之前的部分
  const sepMatch = baseName.split(/[-_\s]/)[0];
  if (sepMatch && /^[A-Za-z0-9]+$/.test(sepMatch) && sepMatch.length >= 4) {
    return sepMatch.toUpperCase();
  }

  // 4) 取连续的字母数字组合中最长的
  const clean = baseName.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean.length >= 4) {
    return clean.substring(0, 12);
  }

  return baseName.toUpperCase().substring(0, 12);
}

// ============================================================
// 主逻辑
// ============================================================
(async () => {
  try {
    // ---- 1. 读取数据库配置 ----
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

    // ---- 2. 读取现有缓存 ----
    if (!fs.existsSync(CACHE_FILE)) {
      console.error('❌ 缓存文件不存在，请先运行 generate-material-cache.js');
      process.exit(1);
    }

    const cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    const cachedItems = cacheData.processed || cacheData.cache || [];
    console.log('读取现有缓存:', cachedItems.length, '张图片');

    // 分析现有缓存中的元数据情况
    const existingWithMeta = cachedItems.filter(i => i.gender !== null && i.gender !== undefined).length;
    console.log('其中已有元数据:', existingWithMeta, '张');
    console.log('需要补充元数据:', cachedItems.length - existingWithMeta, '张');
    console.log('');

    // ---- 3. 从所有文件名中提取货号，去重 ----
    console.log('从文件名中提取货号...');
    const uniqueCodes = new Set();
    const codeToFileNames = new Map(); // 每个货号对应的文件名列表（用于调试）

    cachedItems.forEach((item) => {
      const code = extractStyleCode(item.name);
      if (code && code.length >= 4) {
        uniqueCodes.add(code);
        if (!codeToFileNames.has(code)) codeToFileNames.set(code, []);
        codeToFileNames.get(code).push(item.name);
      }
    });

    console.log('提取到唯一货号:', uniqueCodes.size, '个');
    const codesArray = Array.from(uniqueCodes);
    console.log('前 10 个货号示例:', codesArray.slice(0, 10).join(', '));
    console.log('');

    // ---- 4. 连接数据库并查询商品元数据 ----
    console.log('连接数据库...');
    await sql.connect(dbConfig);
    console.log('✅ 数据库连接成功');
    console.log('查询"商品全"表...');

    // 分批查询，每批 500 个
    const batchSize = 500;
    const goodsMap = new Map(); // key: styleCode (大写), value: {gender, style_type, goods_type}

    for (let batchIdx = 0; batchIdx < codesArray.length; batchIdx += batchSize) {
      const batch = codesArray.slice(batchIdx, batchIdx + batchSize);
      const inClause = batch.map((_, i) => `@code${i}`).join(',');
      const request = sql.request();
      batch.forEach((code, i) => {
        request.input(`code${i}`, sql.NVarChar(100), code);
      });

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
      result.recordset.forEach((row) => {
        const key = (row.style_code || '').toString().toUpperCase();
        if (key) {
          goodsMap.set(key, {
            gender: row.gender ? String(row.gender).trim() : null,
            style_type: row.style_type ? String(row.style_type).trim() : null,
            goods_type: row.goods_type ? String(row.goods_type).trim() : null,
          });
        }
      });

      console.log(`  批处理 ${Math.floor(batchIdx / batchSize) + 1}/${Math.ceil(codesArray.length / batchSize)}: 查询 ${batch.length} 个，命中 ${result.recordset.length} 条`);
    }

    console.log('✅ 数据库查询完成，共命中', goodsMap.size, '个商品');
    console.log('');

    // ---- 5. 补充元数据到缓存 ----
    console.log('为缓存中的图片补充元数据...');
    let matchedCount = 0;
    let noMetaCount = 0;

    const genderStats = new Map();
    const styleStats = new Map();
    const goodsTypeStats = new Map();

    const enrichedItems = cachedItems.map((item) => {
      const code = extractStyleCode(item.name);
      const meta = goodsMap.get(code);

      if (meta) {
        matchedCount++;
        if (meta.gender) genderStats.set(meta.gender, (genderStats.get(meta.gender) || 0) + 1);
        if (meta.style_type) styleStats.set(meta.style_type, (styleStats.get(meta.style_type) || 0) + 1);
        if (meta.goods_type) goodsTypeStats.set(meta.goods_type, (goodsTypeStats.get(meta.goods_type) || 0) + 1);

        // 计算 norm（如果之前没有）
        let norm = item.norm;
        if (!norm && item.vector && item.vector.length > 0) {
          let sumSq = 0;
          for (let i = 0; i < item.vector.length; i++) sumSq += item.vector[i] * item.vector[i];
          norm = Math.sqrt(sumSq);
        }

        return {
          name: item.name,
          vector: item.vector,
          mtime: item.mtime || Date.now(),
          norm: norm || 0,
          styleCode: code,
          gender: meta.gender,
          style_type: meta.style_type,
          goods_type: meta.goods_type,
        };
      } else {
        noMetaCount++;
        // 保留原有信息
        let norm = item.norm;
        if (!norm && item.vector && item.vector.length > 0) {
          let sumSq = 0;
          for (let i = 0; i < item.vector.length; i++) sumSq += item.vector[i] * item.vector[i];
          norm = Math.sqrt(sumSq);
        }
        return {
          name: item.name,
          vector: item.vector,
          mtime: item.mtime || Date.now(),
          norm: norm || 0,
          styleCode: code,
          gender: item.gender || null,
          style_type: item.style_type || null,
          goods_type: item.goods_type || null,
        };
      }
    });

    // ---- 6. 输出统计信息 ----
    console.log('✅ 元数据补充完成:');
    console.log(`  - 成功匹配: ${matchedCount} 张 (${((matchedCount / cachedItems.length) * 100).toFixed(1)}%)`);
    console.log(`  - 未匹配到: ${noMetaCount} 张`);
    console.log('');

    console.log('性别分布:');
    const sortedGenders = Array.from(genderStats.entries()).sort((a, b) => b[1] - a[1]);
    sortedGenders.slice(0, 10).forEach(([g, count]) => console.log(`  - ${g}: ${count}`));

    console.log('风格分布 (Top 10):');
    const sortedStyles = Array.from(styleStats.entries()).sort((a, b) => b[1] - a[1]);
    sortedStyles.slice(0, 10).forEach(([s, count]) => console.log(`  - ${s}: ${count}`));

    console.log('款式分布 (Top 15):');
    const sortedGoodsTypes = Array.from(goodsTypeStats.entries()).sort((a, b) => b[1] - a[1]);
    sortedGoodsTypes.slice(0, 15).forEach(([gt, count]) => console.log(`  - ${gt}: ${count}`));
    console.log('');

    // ---- 7. 保存新的缓存文件 ----
    const outputData = {
      createdAt: Date.now(),
      totalCount: cachedItems.length,
      processedCount: enrichedItems.length,
      matchedMetaCount: matchedCount,
      failedCount: cacheData.failedCount || 0,
      processed: enrichedItems,
    };

    fs.writeFileSync(CACHE_FILE, JSON.stringify(outputData));
    console.log('💾 新缓存已保存:', CACHE_FILE);
    console.log('缓存文件大小:', (fs.statSync(CACHE_FILE).size / 1024 / 1024).toFixed(2), 'MB');

    // ---- 8. 同时保存一份数据库元数据的独立 JSON 文件（便于查看） ----
    const metaJsonPath = path.join(CACHE_DIR, 'goods-metadata.json');
    const metaDump = Array.from(goodsMap.entries()).map(([code, meta]) => ({
      code,
      gender: meta.gender,
      style_type: meta.style_type,
      goods_type: meta.goods_type,
    }));
    fs.writeFileSync(metaJsonPath, JSON.stringify(metaDump, null, 2));
    console.log('💾 数据库元数据快照:', metaJsonPath, `(共 ${metaDump.length} 条)`);

    console.log('');
    console.log('===== 全部完成 =====');
    console.log('提示: 重启服务器后，新的缓存将被加载，商品匹配会自动使用 gender/style_type/goods_type 进行过滤');

  } catch (error) {
    console.error('❌ 处理失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    try { await sql.close(); } catch (e) {}
  }
})();
