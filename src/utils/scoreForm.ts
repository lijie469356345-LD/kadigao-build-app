// 店铺优化评估表（巡店）——评分模板与整改报告工具
// 结构：项目(project) → 环节(section) → 条目(item{content, full})
// 每条以 key = `${项目序号-环节序号-条序号}` (均从 0 开始) 作为 scoresJSON 的键

export interface ScoreItem {
  content: string;
  full: number;
}
export interface ScoreSection {
  name: string;
  items: ScoreItem[];
}
export interface ScoreProject {
  name: string;
  sections: ScoreSection[];
}

export const SCORE_FORM: ScoreProject[] = [
  {
    name: '基础店务',
    sections: [
      {
        name: '一、样鞋管理',
        items: [
          { content: '小白鞋、磨砂材质的样鞋未动销的，每两周更换一次样鞋，防止出现色差、发黄、裂纹等。', full: 2 },
          { content: '鞋面、鞋底保持干净，鞋撑不外露，鞋带绑好塞进鞋里；价格签涂改超2次必须更换。', full: 2 },
          { content: '出样出整双，女鞋36-38码，男鞋41、42码。', full: 1 },
        ],
      },
      {
        name: '二、卫生管理',
        items: [
          { content: '店铺门前3米范围卫生整洁，无杂物。门头、卷闸门、橱窗无灰尘、无蛛网，玻璃干净透亮，门头字，门头灯完好。', full: 2 },
          { content: '店内地面，墙面，货柜层板，陈列道具，空调，茶具，灯具等保持干净整洁，鞋凳无污渍，镜子无水渍、手印。', full: 2 },
          { content: '收银台区域干净无杂物、无私人物品，商品摆放整齐，无线材凌乱等。', full: 2 },
          { content: '仓库地面、天花板、货架保持干净，鞋盒无灰尘、无破损，日常用品、个人物品摆放整洁。', full: 2 },
          { content: '洗手间卫生洁净无异味，洗手池、镜子、地面无污渍，注重指定物品的存取标准。', full: 2 },
        ],
      },
      {
        name: '三、调拨管理',
        items: [
          { content: '系统调拨送货单、打印或手工调拨出的单据，三者与实物一致。', full: 1 },
          { content: '各部门熟悉货品调拨流程，保障调货时不影响正常销售。', full: 1 },
          { content: '店铺调拨单收货后3天处理完毕，超3天未处理的及时跟进并解决。', full: 1 },
          { content: '店铺调拨出货率≥90%，客订鞋调拨做到有货必出。', full: 2 },
        ],
      },
      {
        name: '四、陈列管理',
        items: [
          { content: '陈列布局符合销售节点要求，季节前置10-15天左右。应季款扩大陈列面，非应季款缩小陈列面。', full: 2 },
          { content: '橱窗每周更换，品种齐全，新品主推，有主色系与新款。', full: 2 },
          { content: '主推款、新款陈列在黄金区域，橱窗、中岛、货柜重复出样3-5次。具体陈列：包包第一、二层，主推/新款第二、三层，断码款、出清款、特价款集中底层。', full: 2 },
          { content: '陈列手法：品类成块、系列成组、前四后三、正侧间隔、爆款重复、颜色平衡、道具平衡。', full: 2 },
          { content: '空间服陈列饰动按调调整，位置摆放美观，吊牌不外漏。', full: 1 },
          { content: '海报、柜贴、立牌、小圆牌等符合当期销售活动需要，整洁美观。A4促销立牌与相应的鞋款陈列。', full: 1 },
          { content: '漏标、漏卡、漏调、错装检查。（“三漏一错”）', full: 4 },
        ],
      },
      {
        name: '五、仓库整理',
        items: [
          { content: '鞋盒分意见、按大小，从大到从小逐码摆列，尺码有序。在最方便取落的区间设置爆款、主推专区。', full: 2 },
          { content: '客订鞋、售后鞋（维修或清洗）、残次鞋分开摆放，空盒写上“空”字单独放一边。', full: 2 },
          { content: '出样鞋盒贴绿标，对应圆孔正上方。', full: 1 },
        ],
      },
      {
        name: '六、会员管理',
        items: [
          { content: '全员掌握会员权益具体内容。', full: 2 },
          { content: '每天企业微信朋友圈发内容：①公众号内容转发（朋友圈、客户群）②新品主推推荐9宫格1条 ③店铺活动、节假日宣传等。', full: 2 },
          { content: '每日跟进新增会员目标达成，会员标签与新会员打标率≥90%，完善率≥90%。', full: 2 },
        ],
      },
    ],
  },
  {
    name: '销售跟进',
    sections: [
      {
        name: '一、销售氛围',
        items: [
          { content: '上岗化运妆、穿工作服，着装得体，长发扎起，佩戴企微二维码。', full: 2 },
          { content: '使用迎宾语招呼顾客，保持热情、微笑、主动问好。', full: 1 },
          { content: '店铺音乐用T台秀、动感音乐，音量适中。', full: 1 },
          { content: '接待顾客过程中，动作迅速、说话热情、有感染力。', full: 2 },
          { content: '店铺门口做有效截流。', full: 3 },
        ],
      },
      {
        name: '二、目标管理',
        items: [
          { content: '《店铺日志本》填写规范。', full: 2 },
          { content: '清晰店铺月度目标及达成率、个人目标及达成率，及本店的区域排名。', full: 2 },
          { content: '员工熟知主推款和清款款的款式及库存情况，每日跟进销售进度。', full: 2 },
          { content: '业绩达成与时段跟进（12：00、18：00）。', full: 2 },
        ],
      },
      {
        name: '三、销售管理',
        items: [
          { content: '销售中熟练运用《销售八步曲》，主动做活动宣导、礼包推荐等。', full: 3 },
          { content: '主动推荐当季新品及高价位商品，熟练掌握并运用产品FAB。', full: 3 },
          { content: '销售正价时主动推荐加强特价/连带推荐，增加连带率。', full: 2 },
          { content: '进仓库拿货30秒出仓，拿鞋拿两双，相邻尺码、主推款连带。', full: 2 },
          { content: '按要求相互辅销配合，或针对某单做复盘。', full: 2 },
          { content: '茶水服务（时机和话术），擦鞋服务（时机、主动），保证：数量。', full: 4 },
          { content: '洗鞋服务落地及销售的转化。', full: 2 },
        ],
      },
      {
        name: '四、收银环节',
        items: [
          { content: '添加新会员并做会员权益说明，话术到位。', full: 2 },
          { content: '店铺活动/购礼包话术，从顾客角度促进交易。', full: 3 },
          { content: '主动告知顾客商品洗涤及保养方法。', full: 1 },
          { content: '收银完毕后继续服务，微笑示意，送到门口，邀约复购转介绍。', full: 1 },
          { content: '下班后现金不放收银台。', full: 2 },
        ],
      },
      {
        name: '五、会议管理',
        items: [
          { content: '每日交接班次会议（跟进各项重点指标，互相鼓励）。', full: 2 },
          { content: '周会（总结下周，计划本周）。', full: 2 },
        ],
      },
      {
        name: '六、客诉处理',
        items: [
          { content: '员工熟知售后与退换货流程，能处理解决客诉问题。', full: 3 },
          { content: '客诉问题做分析、总结，找出问题，防止复发。', full: 2 },
        ],
      },
      {
        name: '七、盘点',
        items: [
          { content: '每月严格按照盘点制度执行。', full: 2 },
        ],
      },
    ],
  },
];

// 满分合计
export const FULL_SCORE = SCORE_FORM.reduce(
  (sum, p) => sum + p.sections.reduce((s2, s) => s2 + s.items.reduce((s3, it) => s3 + it.full, 0), 0),
  0
);

// 生成稳定 key
export function itemKey(pIndex: number, sIndex: number, iIndex: number): string {
  return `${pIndex}-${sIndex}-${iIndex}`;
}

// 生成初始空评分（全部为 0）
export function emptyScores(): Record<string, number> {
  const s: Record<string, number> = {};
  SCORE_FORM.forEach((p, pi) =>
    p.sections.forEach((sect, si) =>
      sect.items.forEach((_it, ii) => {
        s[itemKey(pi, si, ii)] = 0;
      })
    )
  );
  return s;
}

// 由评分对象计算总分
export function calcTotal(scores: Record<string, number>): number {
  let total = 0;
  SCORE_FORM.forEach((p, pi) =>
    p.sections.forEach((sect, si) =>
      sect.items.forEach((it, ii) => {
        total += clampScore(scores[itemKey(pi, si, ii)], it.full);
      })
    )
  );
  return total;
}

// 校验每个得分在 [0, full]
export function clampScore(v: number | undefined, full: number): number {
  if (v == null || Number.isNaN(Number(v))) return 0;
  const n = Math.floor(Number(v));
  if (n < 0) return 0;
  if (n > full) return full;
  return n;
}

export interface RectificationBlock {
  project: string;
  section: string;
  content: string;
  full: number;
  score: number;
  gap: number;
}

export interface Rectification {
  blocks: RectificationBlock[];
  deductionTotal: number;
  scoreTotal: number;
  scorePct: number;
  full: number;
}

// 提炼扣分项：得分 < 满分 的条目
export function buildRectification(scores: Record<string, number>): Rectification {
  const blocks: RectificationBlock[] = [];
  let scoreTotal = 0;
  SCORE_FORM.forEach((p, pi) =>
    p.sections.forEach((sect, si) =>
      sect.items.forEach((it, ii) => {
        const full = it.full;
        const score = clampScore(scores[itemKey(pi, si, ii)], full);
        scoreTotal += score;
        if (score < full) {
          blocks.push({
            project: p.name,
            section: sect.name,
            content: it.content,
            full,
            score,
            gap: full - score,
          });
        }
      })
    )
  );
  const deductionTotal = blocks.reduce((s, b) => s + b.gap, 0);
  const full = FULL_SCORE;
  return {
    blocks,
    deductionTotal,
    scoreTotal,
    scorePct: full > 0 ? Math.round((scoreTotal / full) * 100) : 0,
    full,
  };
}

// 生成用于企微推送的整改报告文本
export function buildRectificationMessage(header: Record<string, string>, scores: Record<string, number>): string {
  const report = buildRectification(scores);
  const lines: string[] = [];
  lines.push('【店铺优化评估整改报告】');
  lines.push(`店铺：${header.shopName || ''}`);
  lines.push(`评估月份：${header.evalMonth || ''}`);
  lines.push(`评估人员：${header.evaluator || ''}`);
  lines.push(`——总得分 ${report.scoreTotal}/${report.full}（${report.scorePct}%），扣分 ${report.deductionTotal} 分——`);
  lines.push('');
  if (report.blocks.length === 0) {
    lines.push('本次评估无扣分项，执行表现优秀。');
  } else {
    lines.push('扣分项如下：');
    report.blocks.forEach((b, i) => {
      lines.push(`${i + 1}.【${b.project}·${b.section}】${b.content}（满分 ${b.full}，得分 ${b.score}，扣 ${b.gap} 分）`);
    });
  }
  return lines.join('\n');
}