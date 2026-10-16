// Interface text. The island's first language picks the set; Chinese and
// English for now.

const zh = {
  skip: '跳到正文',
  allRecords: '全部记录',
  recent: '最近的记录',
  neighbors: '关注的岛',
  noRecords: '还没有记录。',
  kinds: { article: '文章', note: '短记录', project: '项目' },
  done: '已完成',
  updated: '更新于',
  back: '回到首页',
  notFound: '这里什么也没有。',
  stage: '阶段',
  stages: { seed: '初生', growing: '成形', flourishing: '繁盛' },
  points: '积分',
  nextStage: (/** @type {string} */ stage, /** @type {number} */ points) => `${points} 点到${zh.stages[/** @type {'seed'} */ (stage)] ?? stage}`,
  streak: '连续记录',
  streakTemplate: '{n} 周',
  lastRecord: '最近一次记录',
  activeWeeks: '有记录的周',
  unlocked: '已解锁',
  records: '记录',
  describe: (/** @type {{ trees: number, houses: number, towers: number, decorations: string[] }} */ d, /** @type {string} */ stage) =>
    `一座${zh.stages[/** @type {'seed'} */ (stage)] ?? stage}阶段的浮空岛：${d.houses} 座房子代表文章，${d.trees} 棵树代表短记录，${d.towers} 座塔代表项目${d.decorations.length ? `，还有 ${d.decorations.length} 件装饰` : ''}。`,
  footer: '这座岛用群岛框架搭建。名片、动态和订阅源都是公开的。',
  feed: '订阅',
};

/** @type {typeof zh} */
const en = {
  skip: 'Skip to content',
  allRecords: 'All records',
  recent: 'Recent records',
  neighbors: 'Islands I follow',
  noRecords: 'Nothing recorded yet.',
  kinds: { article: 'Article', note: 'Note', project: 'Project' },
  done: 'Done',
  updated: 'Updated',
  back: 'Back home',
  notFound: 'Nothing here.',
  stage: 'Stage',
  stages: { seed: 'Seedling', growing: 'Growing', flourishing: 'Flourishing' },
  points: 'Points',
  nextStage: (stage, points) => `${points} points to ${en.stages[/** @type {'seed'} */ (stage)] ?? stage}`,
  streak: 'Streak',
  streakTemplate: '{n} weeks',
  lastRecord: 'Last record',
  activeWeeks: 'Active weeks',
  unlocked: 'Unlocked',
  records: 'Records',
  describe: (d, stage) =>
    `A floating island at the ${en.stages[/** @type {'seed'} */ (stage)] ?? stage} stage: ${d.houses} houses for articles, ${d.trees} trees for notes, ${d.towers} towers for projects${d.decorations.length ? `, and ${d.decorations.length} decorations` : ''}.`,
  footer: 'Built with the islands framework. The manifest, outbox and feed are public.',
  feed: 'Feed',
};

/** @param {string} language */
export function strings(language) {
  return language.toLowerCase().startsWith('zh') ? zh : en;
}
