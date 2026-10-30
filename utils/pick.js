/**
 * 加权抽签
 *
 * 「帮我选一个」以前是纯均匀随机：打过 2 分、三个月没碰的菜，
 * 和打过 5 分、上周刚吃还想吃的菜，中签概率一模一样。
 * 评分、吃过次数、最近一次日期这些数据其实一直在攒，只是没参与决策。
 *
 * 这里换成按权重抽。三个因子互相制衡，任何一项都压不死别的：
 *   评分    5 分 ×1.6，3 分 ×1，1 分 ×0.4 —— 不好吃的明显少出现，但不是永不出现
 *   间隔    60 天没吃 ×1.5，昨天刚吃 ×1.01 —— 久违的菜更容易被想起
 *   频次    吃过 20 次 ×0.5 —— 常吃的不至于霸屏
 *   重复    最近 N 天内吃过再 ×0.25（仅「允许重复」时生效，此时不做硬过滤）
 *
 * 系数是压着调的：三项全乘起来最极端也只有 12 倍左右。
 * 再激进一点就会变成「每次都推那道 5 分的」，抽签就没意义了。
 * 目标是「明显偏向」而不是「钦定」。
 *
 * 纯函数，不依赖小程序 API，可在 Node 里直接回归（tests/pick.test.js）。
 */

/** 权重下限：再差的菜也留一线，否则候选池会被算出 0，抽签退化成「只推固定几道」 */
const WEIGHT_MIN = 0.05
/** 间隔加权封顶天数：超过两个月没吃，加权到顶不再涨 */
const GAP_CAP_DAYS = 60
/** 频次抑制的封顶次数 */
const COUNT_CAP = 20

/** 两个日期差几天；dateText 不合法时当作「很久没吃」 */
function daysSince(dateText, todayText) {
  const from = String(dateText || '')
  const to = String(todayText || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return GAP_CAP_DAYS
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  // 用 UTC 算，避免夏令时 / 时区把天数算成 23 或 25 小时
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)
  return Math.max(0, Math.round(diff / 86400000))
}

/**
 * 一道菜的中签权重。
 * @param {object} dish 菜品（读 score / eatCount / lastEatDate）
 * @param {string} todayText 今天 YYYY-MM-DD
 * @param {{recentDays?: number}} options recentDays > 0 时对「最近吃过」再压一档
 */
function dishWeight(dish, todayText, options) {
  if (!dish) return WEIGHT_MIN
  const opts = options || {}
  const score = Number(dish.score) || 0
  const eatCount = Number(dish.eatCount) || 0
  const days = daysSince(dish.lastEatDate, todayText)

  // 没打过分（新菜）按 3 分算，给个中性权重，别让新菜永远抽不到
  const scoreFactor = score > 0 ? Math.max(0.4, 1 + (score - 3) * 0.3) : 1
  const gapFactor = 1 + Math.min(days / GAP_CAP_DAYS, 1) * 0.5
  const countFactor = 1 / (1 + Math.min(eatCount, COUNT_CAP) / COUNT_CAP)
  const recentDays = Number(opts.recentDays) || 0
  const repeatFactor = recentDays > 0 && days < recentDays ? 0.25 : 1

  return Math.max(WEIGHT_MIN, scoreFactor * gapFactor * countFactor * repeatFactor)
}

/**
 * 按权重抽一道。
 * @param {Array} list 候选菜
 * @param {string} todayText 今天
 * @param {{recentDays?: number, random?: function}} options random 可注入，测试用来固定结果
 * @returns {object|null}
 */
function pickWeighted(list, todayText, options) {
  const opts = options || {}
  const items = (Array.isArray(list) ? list : []).filter(Boolean)
  if (!items.length) return null
  if (items.length === 1) return items[0]
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const weights = items.map(item => dishWeight(item, todayText, opts))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  // total 理论上一定 > 0（每项都有 WEIGHT_MIN 兜底），保险起见还是判断一下
  if (!(total > 0)) return items[Math.floor(random() * items.length)]
  let ticket = random() * total
  for (let index = 0; index < items.length; index++) {
    ticket -= weights[index]
    if (ticket <= 0) return items[index]
  }
  // 浮点误差导致最后没落到任何一项时，退回最后一项
  return items[items.length - 1]
}

module.exports = { WEIGHT_MIN, GAP_CAP_DAYS, COUNT_CAP, daysSince, dishWeight, pickWeighted }
