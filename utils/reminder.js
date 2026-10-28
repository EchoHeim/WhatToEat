/**
 * 提醒计算引擎
 * 纯函数实现，不依赖任何小程序 API，小程序端与云函数端共用同一份代码。
 * 云端副本：cloudfunctions/reminderPush/lib/reminder.js（修改本文件后需同步复制）
 */
const lunar = require('./lunar')

const CALENDARS = [
  { value: 'solar', label: '公历' },
  { value: 'lunar', label: '农历' }
]

const REPEATS = [
  { value: 'none', label: '不重复', hint: '只在指定日期提醒一次' },
  { value: 'daily', label: '每天', hint: '从起始日期起每天提醒' },
  { value: 'monthly', label: '每月', hint: '每个月的同一天提醒' },
  { value: 'yearly', label: '每年', hint: '每年的同一天提醒' }
]

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

function dailyOccurrences(reminder, startDate, endDate) {
  const base = baseDate(reminder)
  const from = base && base > startDate ? base : startDate
  const result = []
  let cursor = from
  let guard = 0
  while (cursor <= endDate && guard++ < 4000) {
    result.push(cursor)
    cursor = addDays(cursor, 1)
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

/** 距离提示：「今天」「明天」「3 天后」 */
function relativeText(days) {
  if (days === null || days === undefined) return ''
  if (days === 0) return '今天'
  if (days === 1) return '明天'
  if (days === 2) return '后天'
  if (days < 0) return `已过 ${Math.abs(days)} 天`
  return `${days} 天后`
}

/** 列表页用的展示模型 */
function describe(reminder, fromDate) {
  const start = isDateText(fromDate) ? fromDate : today()
  const trigger = nextTrigger(reminder, start)
  const occurrence = nextOccurrence(reminder, start)
  const days = trigger ? diffDays(start, trigger) : null
  return {
    reminder,
    trigger,
    occurrence,
    days,
    triggerText: trigger ? relativeText(days) : '已结束',
    dateText: trigger === start ? '今天' : trigger,
    eventLabel: occurrence ? (reminder.calendar === 'lunar' ? eventText(reminder) : occurrence) : '',
    calendarText: calendarLabel(reminder.calendar),
    repeatText: repeatLabel(reminder.repeat),
    advanceText: advanceText(reminder),
    timeText: reminder.time || DEFAULT_TIME,
    active: reminder.enabled !== false && Boolean(trigger)
  }
}

module.exports = {
  CALENDARS,
  REPEATS,
  ADVANCE_OPTIONS,
  MAX_ADVANCE,
  DEFAULT_TIME,
  pad,
  today,
  addDays,
  diffDays,
  isDateText,
  parseDate,
  repeatLabel,
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
  relativeText,
  describe
}
