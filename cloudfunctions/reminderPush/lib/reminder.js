/**
 * 提醒计算引擎
 * 纯函数实现，不依赖任何小程序 API，小程序端与云函数端共用同一份代码。
 * ⚠️ 本文件是 utils/reminder.js 的副本：修改请改 utils/reminder.js，然后复制到这里覆盖。
 *    云端副本：cloudfunctions/reminderPush/lib/reminder.js
 */
const lunar = require('./lunar')

const CALENDARS = [
  { value: 'solar', label: '公历' },
  { value: 'lunar', label: '农历' }
]

/**
 * 一条「日期提醒」可以是普通提醒，也可以是纪念日。
 * 纪念日只在日历上标个日子（紫色数字 + 当周列出），不推送、不计入「今天几条提醒」；
 * 云函数扫描 reminders 时也要靠这个字段把它跳过去，否则会给纪念日发订阅消息。
 * 老数据没有 kind 字段，一律按普通提醒处理。
 */
const KINDS = [
  { value: 'reminder', label: '提醒' },
  { value: 'anniversary', label: '纪念日' }
]

const KIND_REMINDER = 'reminder'
const KIND_ANNIVERSARY = 'anniversary'

const REPEATS = [
  { value: 'none', label: '不重复', hint: '只在指定日期提醒一次' },
  { value: 'daily', label: '每天', hint: '从起始日期起每 N 天提醒一次' },
  { value: 'monthly', label: '每月', hint: '每个月的同一天提醒' },
  { value: 'yearly', label: '每年', hint: '每年的同一天提醒' }
]

/** 「每 N 天」的步长范围：1 就是每天，上限一年 */
const MIN_INTERVAL = 1
const MAX_INTERVAL = 365

const ADVANCE_OPTIONS = [
  { value: 0, label: '当天' },
  { value: 1, label: '提前 1 天' },
  { value: 3, label: '提前 3 天' }
]

const MAX_ADVANCE = 3
// 单次向前搜索的窗口上限，覆盖闰年 + 最长农历年 + 提前天数
const SEARCH_HORIZON = 400

const DEFAULT_TIME = '09:00'

function pad(value) {
  return `${value}`.padStart(2, '0')
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function today() {
  return formatDate(new Date())
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

function daysInSolarMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function isDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function repeatLabel(value) {
  const found = REPEATS.find(item => item.value === value)
  return found ? found.label : REPEATS[0].label
}

/**
 * 「每 N 天」的步长。老数据没有 intervalDays，一律当 1（= 每天）；
 * 非法值（0 / 负数 / 小数 / 超上限）就地夹回合法区间，别让坏数据把循环算成死循环。
 */
function intervalDays(reminder) {
  const raw = Number(reminder && reminder.intervalDays)
  if (!Number.isFinite(raw)) return MIN_INTERVAL
  return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(raw)))
}

/** 循环方式文案：daily 且步长大于 1 时说「每 N 天」，否则沿用 REPEATS 的标签 */
function repeatText(reminder) {
  const repeat = (reminder && reminder.repeat) || 'none'
  if (repeat === 'daily') {
    const step = intervalDays(reminder)
    return step > 1 ? `每 ${step} 天` : '每天'
  }
  return repeatLabel(repeat)
}

function calendarLabel(value) {
  const found = CALENDARS.find(item => item.value === value)
  return found ? found.label : CALENDARS[0].label
}

/** 归一化提前提醒天数，去重升序，至少包含当天 */
function advanceList(reminder) {
  const raw = Array.isArray(reminder && reminder.advanceDays) ? reminder.advanceDays : []
  const list = [...new Set(raw.map(Number).filter(value => Number.isFinite(value) && value >= 0))]
  return list.length ? list.sort((a, b) => a - b) : [0]
}

/** 「当天 · 提前 1 天 · 提前 3 天」 */
function advanceText(reminder) {
  return advanceList(reminder)
    .map(value => (ADVANCE_OPTIONS.find(item => item.value === value) || {}).label || `提前 ${value} 天`)
    .join(' · ')
}

/** 提醒对象的基准公历日期（农历模式由农历日期换算） */
function baseDate(reminder) {
  if (!reminder) return ''
  if (reminder.calendar === 'lunar' && reminder.lunar) {
    const target = reminder.lunar
    const solar = lunar.lunarToSolar(Number(target.year), Number(target.month), Number(target.day), target.isLeap)
    if (solar) return `${solar.year}-${pad(solar.month)}-${pad(solar.day)}`
  }
  return isDateText(reminder.date) ? reminder.date : ''
}

/** 农历模式下基准日的文字描述，如「农历八月十五」 */
function eventText(reminder) {
  if (!reminder) return ''
  if (reminder.calendar === 'lunar' && reminder.lunar) {
    return lunar.text({ month: Number(reminder.lunar.month), day: Number(reminder.lunar.day), isLeap: reminder.lunar.isLeap })
  }
  return baseDate(reminder)
}

/**
 * 每 N 天一次的日期序列。
 * 节奏以基准日（起始日期）为准：10-01 建、N=3 → 10-01 / 10-04 / 10-07…
 * 查询窗口从 10-02 开始时，第一条是 10-04，不能拿窗口起点重新起算，
 * 否则同一个提醒在不同窗口里算出来的日子会不一样。
 */
function dailyOccurrences(reminder, startDate, endDate) {
  const base = baseDate(reminder)
  const step = intervalDays(reminder)
  const from = base && base > startDate ? base : startDate
  const result = []
  let cursor = base || from
  if (base && cursor < from) {
    const gap = diffDays(cursor, from)
    cursor = addDays(cursor, Math.ceil(gap / step) * step)
  }
  let guard = 0
  while (cursor <= endDate && guard++ < 4000) {
    result.push(cursor)
    cursor = addDays(cursor, step)
  }
  return result
}

function solarOccurrences(reminder, startDate, endDate) {
  const repeat = reminder.repeat || 'none'
  const base = baseDate(reminder)
  const result = []
  if (!base) return result

  if (repeat === 'none') {
    if (base >= startDate && base <= endDate) result.push(base)
    return result
  }

  const baseParts = base.split('-').map(Number)
  const startYear = Number(startDate.split('-')[0])

  if (repeat === 'monthly') {
    let year = startYear
    let month = Number(startDate.split('-')[1])
    for (let guard = 0; guard < 60; guard++) {
      const day = Math.min(baseParts[2], daysInSolarMonth(year, month))
      const candidate = `${year}-${pad(month)}-${pad(day)}`
      if (candidate > endDate) break
      if (candidate >= startDate && candidate >= base) result.push(candidate)
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }
    return result
  }

  // yearly
  const endYear = Number(endDate.split('-')[0])
  for (let year = startYear; year <= endYear; year++) {
    const day = Math.min(baseParts[2], daysInSolarMonth(year, baseParts[1]))
    const candidate = `${year}-${pad(baseParts[1])}-${pad(day)}`
    if (candidate >= startDate && candidate <= endDate && candidate >= base) result.push(candidate)
  }
  return result
}

function lunarOccurrences(reminder, startDate, endDate) {
  const repeat = reminder.repeat || 'none'
  const target = reminder.lunar
  const result = []
  if (!target) return result

  const base = baseDate(reminder)
  if (repeat === 'none') {
    if (base && base >= startDate && base <= endDate) result.push(base)
    return result
  }

  const baseMonth = Number(target.month) || 1
  const baseDay = Number(target.day) || 1
  const baseIsLeap = Boolean(target.isLeap)
  const startLunar = lunar.fromDateText(startDate)
  if (!startLunar) return result

  if (repeat === 'monthly') {
    // 每个农历月都提醒一次，从起始日期所在的农历月开始向后推
    let year = startLunar.year
    let months = lunar.monthsOfYear(year)
    let index = months.findIndex(item => item.month === startLunar.month && item.isLeap === startLunar.isLeap)
    if (index < 0) index = 0
    for (let guard = 0; guard < 60; guard++) {
      const slot = months[index]
      const day = Math.min(baseDay, lunar.lunarMonthDayCount(year, slot.month, slot.isLeap))
      const solar = lunar.lunarToSolar(year, slot.month, day, slot.isLeap)
      index += 1
      if (index >= months.length) {
        year += 1
        months = lunar.monthsOfYear(year)
        index = 0
      }
      if (!solar) continue
      const candidate = `${solar.year}-${pad(solar.month)}-${pad(solar.day)}`
      if (candidate > endDate) break
      if (candidate >= startDate && candidate >= base) result.push(candidate)
    }
    return result
  }

  // yearly：当年无该闰月时回退到常规月
  for (let year = startLunar.year; year <= startLunar.year + 4; year++) {
    const isLeap = baseIsLeap && lunar.leapMonth(year) === baseMonth
    const day = Math.min(baseDay, lunar.lunarMonthDayCount(year, baseMonth, isLeap))
    const solar = lunar.lunarToSolar(year, baseMonth, day, isLeap)
    if (!solar) continue
    const candidate = `${solar.year}-${pad(solar.month)}-${pad(solar.day)}`
    if (candidate > endDate) break
    if (candidate >= startDate && candidate >= base) result.push(candidate)
  }
  return result
}

/** 闭区间 [startDate, endDate] 内的全部事件日 */
function occurrencesBetween(reminder, startDate, endDate) {
  if (!reminder || !isDateText(startDate) || !isDateText(endDate) || startDate > endDate) return []
  const repeat = reminder.repeat || 'none'
  if (repeat === 'daily') return dailyOccurrences(reminder, startDate, endDate)
  if (reminder.calendar === 'lunar') return lunarOccurrences(reminder, startDate, endDate)
  return solarOccurrences(reminder, startDate, endDate)
}

/** 闭区间 [startDate, endDate] 内的全部提醒触发日（事件日按提前天数回退） */
function triggersBetween(reminder, startDate, endDate) {
  const advance = advanceList(reminder)
  const span = Math.max(...advance)
  const occurrences = occurrencesBetween(reminder, startDate, addDays(endDate, span))
  const triggers = {}
  occurrences.forEach(date => {
    advance.forEach(offset => {
      const trigger = addDays(date, -offset)
      if (trigger >= startDate && trigger <= endDate) triggers[trigger] = true
    })
  })
  return Object.keys(triggers).sort()
}

/** 判断某天是否需要提醒（云函数逐条判定入口） */
function isTriggerOn(reminder, dateText) {
  if (!reminder || reminder.enabled === false || !isDateText(dateText)) return false
  return advanceList(reminder).some(offset => {
    const occurrence = addDays(dateText, offset)
    return occurrencesBetween(reminder, occurrence, occurrence).length > 0
  })
}

/** 某天触发时，对应的事件日 */
function occurrenceForTrigger(reminder, dateText) {
  const match = advanceList(reminder).find(offset => {
    const occurrence = addDays(dateText, offset)
    return occurrencesBetween(reminder, occurrence, occurrence).length > 0
  })
  if (match === undefined) return ''
  return addDays(dateText, match)
}

/** 某天触发时，距离事件日还有几天 */
function advanceForTrigger(reminder, dateText) {
  const occurrence = occurrenceForTrigger(reminder, dateText)
  if (!occurrence) return null
  return diffDays(dateText, occurrence)
}

/** 下一次提醒触发日，没有则返回空串 */
function nextTrigger(reminder, fromDate) {
  if (!reminder || reminder.enabled === false) return ''
  const start = isDateText(fromDate) ? fromDate : today()
  const list = triggersBetween(reminder, start, addDays(start, SEARCH_HORIZON))
  return list.length ? list[0] : ''
}

/** 下一个事件日（不含提前），没有则返回空串 */
function nextOccurrence(reminder, fromDate) {
  if (!reminder) return ''
  const start = isDateText(fromDate) ? fromDate : today()
  const list = occurrencesBetween(reminder, start, addDays(start, SEARCH_HORIZON))
  return list.length ? list[0] : ''
}

/** 规范成 HH:MM，非法返回空串（老数据可能是 9:00） */
function normalizeTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim())
  if (!match) return ''
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return ''
  return `${pad(hour)}:${pad(minute)}`
}

/** 本机当前时刻 HH:MM：列表页靠它判断「今天这条过没过点」 */
function nowTime() {
  const now = new Date()
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 距离提示：「今天」「明天」「3 天后」 */
function relativeText(days) {
  if (days === null || days === undefined) return ''
  if (days === 0) return '今天'
  if (days === 1) return '明天'
  if (days === 2) return '后天'
  if (days < 0) return `已过 ${Math.abs(days)} 天`
  return `${days} 天后`
}

/** 是不是纪念日（老数据没有 kind，算普通提醒） */
function isAnniversary(reminder) {
  return Boolean(reminder) && reminder.kind === KIND_ANNIVERSARY
}

/**
 * 纪念日要不要推送。
 * 纪念日默认只在日历上标个日子，不推送——只有用户显式打开「到期提醒」（notify: true）才推。
 * 云函数与「今天几条提醒」的计数都用它判断。
 */
function anniversaryNotify(reminder) {
  return isAnniversary(reminder) && reminder.enabled !== false && reminder.notify === true
}

/**
 * 纪念日落在哪一天：公历按「每年同月日」，农历按「农历同月日」（农历本来就年年有）。
 * 纪念日一律每年纪念，没有「仅一次」这回事——要只记一次请建普通提醒。
 */
function anniversaryHit(reminder, dateText) {
  if (!isAnniversary(reminder) || !isDateText(dateText)) return false
  if (reminder.enabled === false) return false
  const date = String(reminder.date || '')
  if (!isDateText(date)) return false
  if (reminder.calendar === 'lunar') {
    const info = reminder.lunar
    if (!info) return false
    const target = lunar.fromDateText(dateText)
    if (!target) return false
    return target.month === Number(info.month) && target.day === Number(info.day) && Boolean(target.isLeap) === Boolean(info.isLeap)
  }
  return date.slice(5) === dateText.slice(5)
}

/**
 * 列表页用的展示模型。
 * nowText 由调用方传入（默认本机当前时刻），方便测试固定时间。
 * 一次性提醒触发日就是今天、但时刻已经过去 → 今天不会再响，标记 expired；
 * 循环提醒不受影响（它明天/下个月还会再响）。
 */
function describe(reminder, fromDate, nowText) {
  const start = isDateText(fromDate) ? fromDate : today()
  const trigger = nextTrigger(reminder, start)
  const occurrence = nextOccurrence(reminder, start)
  const days = trigger ? diffDays(start, trigger) : null
  const timeText = normalizeTime(reminder.time) || DEFAULT_TIME
  const active = reminder.enabled !== false && Boolean(trigger)
  const once = (reminder.repeat || 'none') === 'none'
  const expired = Boolean(trigger) && trigger === start && once && (normalizeTime(nowText) || nowTime()) > timeText
  return {
    reminder,
    trigger,
    occurrence,
    days,
    triggerText: trigger ? relativeText(days) : '已结束',
    dateText: trigger === start ? '今天' : trigger,
    statusText: expired ? '已过期' : (active ? (trigger === start ? '今天' : trigger) : '已结束'),
    eventLabel: occurrence ? (reminder.calendar === 'lunar' ? eventText(reminder) : occurrence) : '',
    calendarText: calendarLabel(reminder.calendar),
    repeatText: repeatText(reminder),
    advanceText: advanceText(reminder),
    timeText,
    active,
    expired
  }
}

module.exports = {
  CALENDARS,
  KINDS,
  KIND_REMINDER,
  KIND_ANNIVERSARY,
  REPEATS,
  ADVANCE_OPTIONS,
  MAX_ADVANCE,
  MIN_INTERVAL,
  MAX_INTERVAL,
  DEFAULT_TIME,
  pad,
  today,
  addDays,
  diffDays,
  isDateText,
  parseDate,
  repeatLabel,
  repeatText,
  intervalDays,
  calendarLabel,
  advanceList,
  advanceText,
  baseDate,
  eventText,
  occurrencesBetween,
  triggersBetween,
  isTriggerOn,
  occurrenceForTrigger,
  advanceForTrigger,
  nextTrigger,
  nextOccurrence,
  normalizeTime,
  nowTime,
  relativeText,
  describe,
  isAnniversary,
  anniversaryNotify,
  anniversaryHit
}
