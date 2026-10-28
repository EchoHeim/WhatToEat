/**
 * 农历换算（1900-2100）
 * 纯函数实现，不依赖任何小程序 API，因此小程序端与云函数端可以共用同一份代码。
 *
 * ⚠️ 本文件是 utils/lunar.js 的副本：修改请改 utils/lunar.js，然后复制到这里覆盖。
 *    云端副本：cloudfunctions/reminderPush/lib/lunar.js
 */

// 每年 4 位十六进制编码：
// bit16      闰月是否 30 天（1 = 30 天，0 = 29 天）
// bit15-bit4 十二个常规月是否 30 天（1 = 30 天，0 = 29 天）
// bit3-bit0  闰月月份（0 表示当年无闰月）
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
  0x0d520 // 2100
]

const MIN_YEAR = 1900
const MAX_YEAR = 2100
const DAY_MS = 86400000
// 1900-01-31 为农历 1900 年正月初一
const BASE_UTC = Date.UTC(1900, 0, 31)

const CN_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
const CN_DAYS = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
]

/** 农历 year 年闰几月，0 表示无闰月 */
function leapMonth(year) {
  return LUNAR_INFO[year - MIN_YEAR] & 0xf
}

/** 农历 year 年闰月天数，无闰月返回 0 */
function leapDays(year) {
  if (!leapMonth(year)) return 0
  return (LUNAR_INFO[year - MIN_YEAR] & 0x10000) ? 30 : 29
}

/** 农历 year 年 month 月（常规月）的天数 */
function monthDays(year, month) {
  return (LUNAR_INFO[year - MIN_YEAR] & (0x10000 >> month)) ? 30 : 29
}

/** 农历 year 年全年天数 */
function yearDays(year) {
  let sum = 348 // 12 个常规月至少 29 天
  for (let i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[year - MIN_YEAR] & i) ? 1 : 0
  return sum + leapDays(year)
}

/** 公历日期相对 1900-01-31 的天数差 */
function daysFromBase(year, month, day) {
  return Math.round((Date.UTC(year, month - 1, day) - BASE_UTC) / DAY_MS)
}

/** 天数差还原为公历日期 */
function offsetToSolar(offset) {
  const date = new Date(BASE_UTC + offset * DAY_MS)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

/** 公历 → 农历，超出 1900-2100 返回 null */
function solarToLunar(year, month, day) {
  let offset = daysFromBase(year, month, day)
  if (offset < 0) return null

  let cursor = MIN_YEAR
  let span = 0
  for (; cursor <= MAX_YEAR && offset > 0; cursor++) {
    span = yearDays(cursor)
    offset -= span
  }
  if (offset < 0) {
    offset += span
    cursor -= 1
  }
  const lunarYear = cursor

  const leap = leapMonth(lunarYear)
  let isLeap = false
  let index = 1
  for (; index < 13 && offset > 0; index++) {
    if (leap > 0 && index === leap + 1 && !isLeap) {
      index -= 1
      isLeap = true
      span = leapDays(lunarYear)
    } else {
      span = monthDays(lunarYear, index)
    }
    if (isLeap && index === leap + 1) isLeap = false
    offset -= span
  }
  if (offset === 0 && leap > 0 && index === leap + 1) {
    if (isLeap) {
      isLeap = false
    } else {
      isLeap = true
      index -= 1
    }
  }
  if (offset < 0) {
    offset += span
    index -= 1
  }
  return { year: lunarYear, month: index, day: offset + 1, isLeap }
}

/**
 * 农历 → 公历
 * isLeap 为 true 且当年确有该闰月时，定位到闰月；否则定位到常规月
 */
function lunarToSolar(year, month, day, isLeap) {
  if (year < MIN_YEAR || year > MAX_YEAR) return null
  const leap = leapMonth(year)
  const targetLeap = Boolean(isLeap) && leap === month

  let offset = 0
  for (let y = MIN_YEAR; y < year; y++) offset += yearDays(y)
  for (let m = 1; m < month; m++) {
    offset += monthDays(year, m)
    if (leap === m) offset += leapDays(year)
  }
  if (targetLeap) offset += monthDays(year, month)
  offset += day - 1
  return offsetToSolar(offset)
}

/** 某个农历月实际有多少天（闰月不存在时回退到常规月） */
function lunarMonthDayCount(year, month, isLeap) {
  if (isLeap && leapMonth(year) === month) return leapDays(year)
  return monthDays(year, month)
}

/** 农历年的月份序列，例如 [正月, 二月, 闰二月, 三月, ...] */
function monthsOfYear(year) {
  const leap = leapMonth(year)
  const list = []
  for (let m = 1; m <= 12; m++) {
    list.push({ month: m, isLeap: false })
    if (leap === m) list.push({ month: m, isLeap: true })
  }
  return list
}

/** 「八月」/「闰四月」 */
function monthText(month, isLeap) {
  return `${isLeap ? '闰' : ''}${CN_MONTHS[month - 1]}月`
}

/** 「十五」 */
function dayText(day) {
  return CN_DAYS[day - 1] || ''
}

/** 「农历八月十五」 */
function text(target) {
  if (!target) return ''
  return `农历${monthText(target.month, target.isLeap)}${dayText(target.day)}`
}

/** 日期字符串（本地时区）→ 农历 */
function fromDateText(dateText) {
  const parts = String(dateText).split('-').map(Number)
  if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return null
  return solarToLunar(parts[0], parts[1], parts[2])
}

module.exports = {
  MIN_YEAR,
  MAX_YEAR,
  CN_MONTHS,
  CN_DAYS,
  leapMonth,
  leapDays,
  monthDays,
  yearDays,
  lunarMonthDayCount,
  monthsOfYear,
  solarToLunar,
  lunarToSolar,
  monthText,
  dayText,
  text,
  fromDateText
}
