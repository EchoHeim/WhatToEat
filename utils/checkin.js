/**
 * 每日签到计算
 * 纯函数实现，不依赖任何小程序 API，可在 Node 里直接回归（tests/checkin.test.js）。
 * 小程序端（pages/checkins、pages/checkin-form、pages/records、pages/index）与统计口径共用这一份。
 */

/** 可选心情图标，3x3 展示 */
const MOODS = [
  { key: 'joyful', emoji: '😄', label: '开心' },
  { key: 'excited', emoji: '🥳', label: '兴奋' },
  { key: 'satisfied', emoji: '😋', label: '满足' },
  { key: 'cozy', emoji: '😌', label: '惬意' },
  { key: 'plain', emoji: '😐', label: '平淡' },
  { key: 'tired', emoji: '😪', label: '疲惫' },
  { key: 'down', emoji: '😕', label: '低落' },
  { key: 'busy', emoji: '🤯', label: '忙乱' },
  { key: 'craving', emoji: '🤤', label: '嘴馋' }
]

const DEFAULT_MOOD = MOODS[0]
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
/** 连续签到回溯上限，防止异常数据造成死循环 */
const STREAK_GUARD = 3660

function pad(value) {
  return `${value}`.padStart(2, '0')
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function today() {
  return formatDate(new Date())
}

function isDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function parseDate(text) {
  const parts = String(text).split('-').map(Number)
  return new Date(parts[0], parts[1] - 1, parts[2])
}

function addDays(dateText, days) {
  const date = parseDate(dateText)
  date.setDate(date.getDate() + days)
  return formatDate(date)
}

function diffDays(fromText, toText) {
  return Math.round((parseDate(toText) - parseDate(fromText)) / 86400000)
}

function weekdayText(dateText) {
  if (!isDateText(dateText)) return ''
  return WEEKDAYS[parseDate(dateText).getDay()]
}

/** 月份前缀，如 2026-10 */
function monthPrefix(dateText) {
  const value = isDateText(dateText) ? dateText : today()
  return value.slice(0, 7)
}

function moodByKey(key) {
  return MOODS.find(item => item.key === key) || null
}

/** 兜底成可渲染的心情对象，避免历史数据缺字段时页面空白 */
function normalizeMood(mood, key) {
  return moodByKey((mood && mood.key) || key) || DEFAULT_MOOD
}

/** 把签到列表收敛成去重后的日期集合 */
function dateSet(checkins) {
  const set = new Set()
  ;(checkins || []).forEach(item => {
    const date = typeof item === 'string' ? item : item && item.date
    if (isDateText(date)) set.add(date)
  })
  return set
}

/**
 * 连续签到天数。
 * 今天已签到 → 从今天往前数；今天还没签 → 从昨天往前数（当天补签后自动接上）。
 * earliest 是这段连续签到的第一天，没有连续记录时为空串。
 */
function calcStreak(checkins, fromDate) {
  const set = dateSet(checkins)
  const start = isDateText(fromDate) ? fromDate : today()
  const checkedToday = set.has(start)
  let cursor = checkedToday ? start : addDays(start, -1)
  let streak = 0
  let earliest = ''
  while (set.has(cursor) && streak < STREAK_GUARD) {
    streak += 1
    earliest = cursor
    cursor = addDays(cursor, -1)
  }
  return { streak, checkedToday, earliest }
}

/**
 * 最近 N 天的心情条带，按时间正序返回。
 * 没有签到的那天 checked 为 false，页面渲染成灰点。
 */
function buildStrip(checkins, endDate, days) {
  const end = isDateText(endDate) ? endDate : today()
  const span = Math.max(1, Number(days) || 14)
  const byDate = {}
  ;(checkins || []).forEach(item => {
    if (item && isDateText(item.date)) byDate[item.date] = item
  })
  const list = []
  for (let offset = span - 1; offset >= 0; offset--) {
    const date = addDays(end, -offset)
    const record = byDate[date]
    const mood = record ? normalizeMood(record.mood, record.moodKey) : null
    list.push({
      date,
      day: Number(date.slice(8, 10)),
      weekday: weekdayText(date),
      checked: Boolean(record),
      emoji: mood ? mood.emoji : '',
      isToday: date === end
    })
  }
  return list
}

/** 心情分布（默认统计本月），按出现次数倒序 */
function moodTally(checkins, month) {
  const prefix = month || ''
  const counter = {}
  ;(checkins || []).forEach(item => {
    if (!item || !isDateText(item.date)) return
    if (prefix && item.date.slice(0, 7) !== prefix) return
    const mood = normalizeMood(item.mood, item.moodKey)
    counter[mood.key] = (counter[mood.key] || 0) + 1
  })
  return MOODS
    .map(mood => ({ ...mood, count: counter[mood.key] || 0 }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count || MOODS.findIndex(m => m.key === a.key) - MOODS.findIndex(m => m.key === b.key))
}

/** 累计 / 本月签到数 */
function counters(checkins, fromDate) {
  const prefix = monthPrefix(fromDate)
  let total = 0
  let monthCount = 0
  ;(checkins || []).forEach(item => {
    if (!item || !isDateText(item.date)) return
    total += 1
    if (item.date.slice(0, 7) === prefix) monthCount += 1
  })
  return { total, monthCount }
}

/** 列表页 / 首页 / 我的页共用的概览数据 */
function overview(checkins, fromDate) {
  const start = isDateText(fromDate) ? fromDate : today()
  const list = (checkins || []).filter(item => item && isDateText(item.date))
  const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date))
  const todayRecord = sorted.find(item => item.date === start) || null
  const streakInfo = calcStreak(sorted, start)
  const stats = counters(sorted, start)
  return {
    today: start,
    todayRecord,
    todayMood: todayRecord ? normalizeMood(todayRecord.mood, todayRecord.moodKey) : null,
    checkedToday: Boolean(todayRecord),
    streak: streakInfo.streak,
    total: stats.total,
    monthCount: stats.monthCount,
    lastDate: sorted.length ? sorted[0].date : ''
  }
}

module.exports = {
  MOODS,
  DEFAULT_MOOD,
  WEEKDAYS,
  pad,
  today,
  formatDate,
  addDays,
  diffDays,
  isDateText,
  parseDate,
  weekdayText,
  monthPrefix,
  moodByKey,
  normalizeMood,
  calcStreak,
  buildStrip,
  moodTally,
  counters,
  overview
}
