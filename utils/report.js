/**
 * 月度饮食报告
 *
 * 记录类应用攒了一堆数据，如果只看「本月 42 餐」这一个数字，
 * 用户没有理由继续记下去。这个模块把一个月的数据摊开成：
 * 吃了多少、最常吃什么、口味偏哪边、评分走势、跟上月比是多是少。
 *
 * 纯函数，不依赖小程序 API，可在 Node 里直接回归（tests/report.test.js）。
 */

/** 餐次固定顺序：跟 store.MEALS 一致，报告里按这个顺序铺，缺的显示 0 */
const MEAL_ORDER = ['早餐', '午餐', '晚餐', '夜宵']

/** 口味标签只看这几类：'快餐' '聚餐' 这种不是口味 */
const TASTE_TAGS = ['辣', '清淡', '减脂', '高蛋白', '快手']

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad(value) { return `${value}`.padStart(2, '0') }

/** 当前月份 YYYY-MM */
function currentMonth(date) {
  const now = date instanceof Date ? date : new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}

/** 月份偏移：'2026-01' 往前一个月 → '2025-12' */
function shiftMonth(month, delta) {
  const parts = String(month || '').split('-').map(Number)
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return ''
  let year = parts[0]
  let index = parts[1] - 1 + Number(delta || 0)
  year += Math.floor(index / 12)
  index = ((index % 12) + 12) % 12
  return `${year}-${pad(index + 1)}`
}

/** 这个月有几天 */
function daysInMonth(month) {
  const parts = String(month || '').split('-').map(Number)
  if (parts.length !== 2) return 0
  return new Date(parts[0], parts[1], 0).getDate()
}

/** 空报告：还没有记录时页面照样能渲染，不用到处判空 */
function emptyReport(month) {
  return {
    month,
    monthLabel: month ? `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月` : '',
    hasData: false,
    mealCount: 0,
    dayCount: 0,
    monthDays: daysInMonth(month),
    ratedCount: 0,
    averageScore: 0,
    prevCount: 0,
    delta: 0,
    topDishes: [],
    byMeal: MEAL_ORDER.map(name => ({ name, count: 0, percent: 0 })),
    byTaste: [],
    trend: [],
    bestDay: null
  }
}

/**
 * 生成一个月的报告模型。
 * @param {{records?: Array, dishes?: Array, month?: string}} options
 */
function buildReport(options) {
  const opts = options || {}
  const month = /^\d{4}-\d{2}$/.test(String(opts.month || '')) ? String(opts.month) : currentMonth()
  const records = (Array.isArray(opts.records) ? opts.records : []).filter(item => item && item.date)
  const dishes = Array.isArray(opts.dishes) ? opts.dishes : []
  const inMonth = records.filter(item => String(item.date).slice(0, 7) === month)
  if (!inMonth.length) return emptyReport(month)

  const dishMap = new Map(dishes.map(item => [item.id, item]))
  const prevCount = records.filter(item => String(item.date).slice(0, 7) === shiftMonth(month, -1)).length
  const monthDays = daysInMonth(month)
  const todayCount = new Set(inMonth.map(item => item.date)).size

  // ---- 最常吃：按菜名分组。菜品可能已经被删，菜名是记下那一刻的快照，照样统计 ----
  const byName = new Map()
  inMonth.forEach(item => {
    const name = String(item.dishName || '未命名').trim() || '未命名'
    const entry = byName.get(name) || { name, count: 0, scoreSum: 0, scoreCount: 0, dishId: item.dishId, emoji: '' }
    entry.count += 1
    const score = Number(item.score)
    if (Number.isFinite(score) && score > 0) { entry.scoreSum += score; entry.scoreCount += 1 }
    if (!entry.emoji) {
      const dish = dishMap.get(item.dishId)
      entry.emoji = (dish && dish.emoji) || '🍽'
    }
    byName.set(name, entry)
  })
  const topDishes = [...byName.values()]
    .sort((a, b) => b.count - a.count || b.scoreSum - a.scoreSum)
    .slice(0, 5)
    .map(item => ({
      name: item.name,
      emoji: item.emoji || '🍽',
      count: item.count,
      scoreText: item.scoreCount ? (item.scoreSum / item.scoreCount).toFixed(1) : '—'
    }))

  // ---- 餐次分布 ----
  const mealCounter = {}
  inMonth.forEach(item => {
    const key = MEAL_ORDER.includes(item.mealType) ? item.mealType : '其他'
    mealCounter[key] = (mealCounter[key] || 0) + 1
  })
  const byMeal = MEAL_ORDER.map(name => {
    const count = mealCounter[name] || 0
    return { name, count, percent: Math.round((count / inMonth.length) * 100) }
  })

  // ---- 口味分布：靠菜品标签，只认固定的几类 ----
  const tasteCounter = {}
  inMonth.forEach(item => {
    const dish = dishMap.get(item.dishId)
    const tags = (dish && Array.isArray(dish.tags)) ? dish.tags : []
    tags.forEach(tag => {
      if (TASTE_TAGS.includes(tag)) tasteCounter[tag] = (tasteCounter[tag] || 0) + 1
    })
  })
  const byTaste = Object.keys(tasteCounter)
    .map(name => ({ name, count: tasteCounter[name] }))
    .sort((a, b) => b.count - a.count)
  const tasteMax = byTaste.length ? byTaste[0].count : 0
  byTaste.forEach(item => { item.percent = tasteMax ? Math.round((item.count / tasteMax) * 100) : 0 })

  // ---- 评分走势：一天一根柱子，没记录的天留空 ----
  const dayScores = {}
  inMonth.forEach(item => {
    const score = Number(item.score)
    if (!Number.isFinite(score) || score <= 0) return
    if (!dayScores[item.date]) dayScores[item.date] = []
    dayScores[item.date].push(score)
  })
  const trend = []
  for (let day = 1; day <= monthDays; day++) {
    const date = `${month}-${pad(day)}`
    const scores = dayScores[date]
    const average = scores && scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0
    trend.push({
      date,
      day,
      // 柱子高度按 5 分制换算；没记录给 0，页面画成一条浅色底线
      height: average ? Math.round((average / 5) * 100) : 0,
      scoreText: average ? average.toFixed(1) : '',
      weekday: WEEKDAYS[new Date(`${date}T00:00:00`).getDay()]
    })
  }

  // ---- 最高分那天 ----
  let bestDay = null
  trend.forEach(item => {
    const score = Number(item.scoreText)
    if (!Number.isFinite(score) || score <= 0) return
    if (!bestDay || score > Number(bestDay.scoreText)) bestDay = { date: item.date, scoreText: item.scoreText, weekday: item.weekday }
  })

  const rated = inMonth.map(item => Number(item.score)).filter(value => Number.isFinite(value) && value > 0)
  const averageScore = rated.length ? Number((rated.reduce((sum, value) => sum + value, 0) / rated.length).toFixed(1)) : 0

  return {
    month,
    monthLabel: `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`,
    hasData: true,
    mealCount: inMonth.length,
    dayCount: todayCount,
    monthDays,
    ratedCount: rated.length,
    averageScore,
    prevCount,
    delta: inMonth.length - prevCount,
    topDishes,
    byMeal,
    byTaste,
    trend,
    bestDay
  }
}

module.exports = { MEAL_ORDER, TASTE_TAGS, currentMonth, shiftMonth, daysInMonth, emptyReport, buildReport }
