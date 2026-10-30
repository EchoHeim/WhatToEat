/**
 * 节日库：中国传统节日（农历 / 节气）+ 国际公认节日与国际日
 *
 * 纯函数，不依赖小程序 API，可在 Node 里直接回归（tests/festival.test.js）。
 * 农历节日靠 utils/lunar.js 现算，不写死某一年的公历日期——春节明年换个日子也照样对。
 *
 * 首页用法：weekFestivals() 取「本周还剩的节日」，没有就不显示那一块。
 */
const lunar = require('./lunar')
const checkin = require('./checkin')
const reminderLib = require('./reminder')
/** 展示用的分类标签 */
const KIND_TEXT = {
  trad: '传统',
  intl: '国际',
  day: '节日',
  anniv: '纪念',
  reminder: '提醒',
}
/** 同一天里的排序：节日在前，其次普通提醒，纪念日压尾 */
const KIND_RANK = { trad: 0, intl: 0, day: 0, reminder: 1, anniv: 2 }
/**
 * 公历固定节日。
 * 只收「真会过」的：大众节日 + 知名度高的国际日 + 中国法定节日。
 * 国际日（世界水日 / 世界气象日 …）挑了跟生活或吃相关的几个，全塞进来首页就成公告栏了。
 */
const SOLAR = [
  { m: 1, d: 1, name: '元旦', kind: 'intl', emoji: '🎊', line: '新年第一顿，好好吃' },
  { m: 2, d: 14, name: '情人节', kind: 'intl', emoji: '💝', food: '巧克力' },
  { m: 3, d: 8, name: '国际妇女节', kind: 'intl', emoji: '🌸', line: '今天值得被好好款待' },
  { m: 3, d: 12, name: '植树节', kind: 'day', emoji: '🌳', line: '春天种树，也种点菜' },
  { m: 4, d: 1, name: '愚人节', kind: 'intl', emoji: '🤡', line: '今天吃什么都别太当真' },
  { m: 4, d: 22, name: '世界地球日', kind: 'intl', emoji: '🌍', line: '少点一份，少浪费一点' },
  { m: 4, d: 23, name: '世界读书日', kind: 'intl', emoji: '📚', line: '书要读，饭也要吃' },
  { m: 5, d: 1, name: '劳动节', kind: 'day', emoji: '🛠️', line: '歇一天，吃顿好的' },
  { m: 5, d: 4, name: '青年节', kind: 'day', emoji: '✨', line: '今天该有点少年气' },
  { m: 6, d: 1, name: '国际儿童节', kind: 'intl', emoji: '🎈', line: '今天可以理直气壮吃甜' },
  { m: 6, d: 5, name: '世界环境日', kind: 'intl', emoji: '🌱', line: '自带杯子，少用一次性' },
  { m: 7, d: 1, name: '建党节', kind: 'day', emoji: '🚩', line: '今天吃点家常的' },
  { m: 8, d: 1, name: '建军节', kind: 'day', emoji: '🎖️', line: '致敬，然后好好吃饭' },
  { m: 9, d: 10, name: '教师节', kind: 'day', emoji: '🍎', line: '给老师说声谢谢' },
  { m: 9, d: 21, name: '国际和平日', kind: 'intl', emoji: '🕊️', line: '好好吃饭，就是太平日子' },
  { m: 10, d: 1, name: '国庆节', kind: 'day', emoji: '🇨🇳', line: '国泰民安，长假第一天，慢慢吃' },
  { m: 10, d: 16, name: '世界粮食日', kind: 'intl', emoji: '🌾', food: '光盘行动' },
  { m: 10, d: 31, name: '万圣节', kind: 'intl', emoji: '🎃', food: '南瓜派' },
  { m: 12, d: 24, name: '平安夜', kind: 'intl', emoji: '🍎', food: '平安果' },
  { m: 12, d: 25, name: '圣诞节', kind: 'intl', emoji: '🎄', line: '热红酒配烤鸡，随便挑' },
  { m: 12, d: 31, name: '跨年夜', kind: 'intl', emoji: '🎆', line: '最后一顿，吃热闹点' },
]
/** 某月第 N 个星期几（weekday 与 Date.getDay() 一致，0 = 周日） */
const FLOATING = [
  { m: 5, weekday: 0, nth: 2, name: '母亲节', kind: 'intl', emoji: '💐', food: '一顿家常菜' },
  { m: 6, weekday: 0, nth: 3, name: '父亲节', kind: 'intl', emoji: '👔', food: '一顿家常菜' },
  { m: 11, weekday: 4, nth: 4, name: '感恩节', kind: 'intl', emoji: '🦃', food: '火鸡' },
]
/**
 * 农历节日。day: -1 表示「当月最后一天」（除夕，腊月可能是廿九）。
 * 闰月不重复过节：isLeap 的那个月直接跳过。
 */
const LUNAR = [
  { m: 12, d: 8, name: '腊八', kind: 'trad', emoji: '🥣', food: '腊八粥' },
  { m: 12, d: 23, name: '小年', kind: 'trad', emoji: '🍬', food: '糖瓜' },
  { m: 12, d: -1, name: '除夕', kind: 'trad', emoji: '🏮', food: '年夜饭' },
  { m: 1, d: 1, name: '春节', kind: 'trad', emoji: '🧨', food: '年菜' },
  { m: 1, d: 15, name: '元宵', kind: 'trad', emoji: '🍡', food: '汤圆' },
  { m: 2, d: 2, name: '龙抬头', kind: 'trad', emoji: '🐉', food: '春饼' },
  { m: 3, d: 3, name: '上巳节', kind: 'trad', emoji: '🌿', food: '荠菜煮蛋' },
  { m: 5, d: 5, name: '端午', kind: 'trad', emoji: '🛶', food: '粽子' },
  { m: 7, d: 7, name: '七夕', kind: 'trad', emoji: '💕', food: '巧果' },
  { m: 7, d: 15, name: '中元', kind: 'trad', emoji: '🕯️', line: '早点回家，好好吃饭' },
  { m: 8, d: 15, name: '中秋', kind: 'trad', emoji: '🥮', food: '月饼' },
  { m: 9, d: 9, name: '重阳', kind: 'trad', emoji: '🌼', food: '重阳糕' },
]
/**
 * 节气节日：清明与冬至。
 * 用寿星通用公式算（21 世纪常数）：日 = int(Y*0.2422 + C) - int((Y-1)/4)，Y 是年份后两位。
 * 误差最多一天，对「本周有没有节日」这种粒度够用。
 */
const TERMS = [
  { name: '清明', m: 4, c: 4.81, kind: 'trad', emoji: '🍃', food: '青团' },
  { name: '冬至', m: 12, c: 21.94, kind: 'trad', emoji: '🥟', food: '饺子 / 汤圆' },
]
/** 寿星公式算节气所在的公历日 */
function termDay(year, c) {
  const y = year % 100
  return Math.floor(y * 0.2422 + c) - Math.floor((y - 1) / 4)
}

function weekdayOf(dateText) {
  return new Date(`${dateText}T00:00:00`).getDay()
}

/** 「10 月 31 日」 */
function dateLabel(dateText) {
  return `${Number(dateText.slice(5, 7))} 月 ${Number(dateText.slice(8, 10))} 日`
}

/** 距今天数 → 文案。往回看的日子（选中历史日期）走「天前」那一支 */
function whenText(offset) {
  if (offset === 0) return '今天'
  if (offset === 1) return '明天'
  if (offset === 2) return '后天'
  if (offset === 3) return '大后天'
  if (offset === -1) return '昨天'
  if (offset === -2) return '前天'
  if (offset < 0) return `${-offset} 天前`
  return `${offset} 天后`
}

/**
 * 公历日期 → 农历月日写法（八月十五）。
 * 不带「农历」前缀：卡片右侧位置窄，而且汉字月日一眼就能认出来。
 * 取不到就返回空串，页面会退回公历日期。
 */
function lunarDayText(dateText) {
  const info = lunar.fromDateText(dateText)
  if (!info) return ''
  return `${lunar.monthText(info.month, info.isLeap)}${lunar.dayText(info.day)}`
}

/** 某一天有哪些节日 */
function festivalsOf(dateText) {
  if (!checkin.isDateText(dateText)) return []
  const parts = dateText.split('-').map(Number)
  const [year, month, day] = parts
  const out = []
  const push = (item) =>
    out.push({
      name: item.name,
      kind: item.kind,
      kindText: KIND_TEXT[item.kind] || '',
      emoji: item.emoji || '📅',
      // 有 food 时页面只显示「吃点：XX」，line 是给没有吃食的节日垫一句的
      food: item.food || '',
      line: item.line || '',
    })
  SOLAR.forEach((item) => {
    if (item.m === month && item.d === day) push(item)
  })
  FLOATING.forEach((item) => {
    if (item.m !== month) return
    if (weekdayOf(dateText) !== item.weekday) return
    // 当月第几个这样的星期几：1 号所在的那周算第一周
    if (Math.floor((day - 1) / 7) + 1 !== item.nth) return
    push(item)
  })
  const info = lunar.fromDateText(dateText)
  if (info && !info.isLeap) {
    LUNAR.forEach((item) => {
      const target =
        item.d === -1
          ? lunar.lunarMonthDayCount(info.year, item.m, false)
          : item.d
      if (info.month === item.m && info.day === target) push(item)
    })
  }

  TERMS.forEach((item) => {
    if (item.m === month && day === termDay(year, item.c)) push(item)
  })
  return out
}

/** 一周的第一天：中国习惯周一开头 */
function weekStart(dateText) {
  const today = checkin.isDateText(dateText) ? dateText : checkin.today()
  return checkin.addDays(today, -((weekdayOf(today) + 6) % 7))
}

/**
 * 把「哪一天 + 什么日子」包成页面能直接渲染的一条。
 *
 * withLunar 只在「选中某一天」的视图里为真：那时上下文只有这一天，农历是补充信息，
 * 节日、提醒、纪念日都该显示。而「本周节日」要横着扫七个日子，公历更好认，所以不换。
 */
function decorate(item, date, offset, withLunar) {
  return {
    key: `${item.kind || 'day'}-${date}-${item.name}`,
    date,
    dateText: dateLabel(date),
    lunarText: withLunar ? lunarDayText(date) : '',
    weekday: checkin.weekdayText(date),
    offset,
    whenText: whenText(offset),
    ...item,
  }
}

/**
 * 本周（周一 ~ 周日）还剩的节日，按日期升序。
 * 已经过去的不提醒——那块只放「还来得及惦记」的，不然周一看到周六已经过的节日没意义。
 * limit 默认 3：一年里最多的一周也就三四个，超了说明数据有问题，截住。
 */
function weekFestivals(dateText, limit) {
  const today = checkin.isDateText(dateText) ? dateText : checkin.today()
  const start = weekStart(today)
  const out = []
  for (let i = 0; i < 7; i++) {
    const date = checkin.addDays(start, i)
    const offset = checkin.diffDays(today, date)
    if (offset < 0) continue
    festivalsOf(date).forEach((item) => out.push(decorate(item, date, offset, false)))
  }
  out.sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name))
  return out.slice(0, limit || 3)
}

/** 某一天的自定义纪念日（用户自己加的，来自 reminders 集合） */
function anniversariesOn(reminders, dateText) {
  if (!checkin.isDateText(dateText)) return []
  return (reminders || [])
    .filter((item) => reminderLib.anniversaryHit(item, dateText))
    .map((item) => ({
      name: item.content || '纪念日',
      kind: 'anniv',
      kindText: KIND_TEXT.anniv,
      emoji: '🎉',
      food: '',
    }))
}

/**
 * 这一天有没有会响的普通提醒。
 * 只要布尔值，不建数组 —— 日历要逐天问一遍，31 个格子不值得为每格生成对象。
 * 纪念日不算：它在日历上已经有自己的紫色数字标记，再来个红点就重复了。
 */
function hasReminderOn(reminders, dateText) {
  if (!checkin.isDateText(dateText)) return false
  return (reminders || []).some(
    (item) => item && !reminderLib.isAnniversary(item) && reminderLib.isTriggerOn(item, dateText),
  )
}

/**
 * 某一天会响的普通提醒（同样来自 reminders，纪念日另走 anniversariesOn）。
 * 提前天数、循环规则都交给 reminderLib.isTriggerOn 判，跟推送口径一致。
 */
function remindersOn(reminders, dateText) {
  if (!checkin.isDateText(dateText)) return []
  return (reminders || [])
    .filter(
      (item) =>
        item &&
        !reminderLib.isAnniversary(item) &&
        reminderLib.isTriggerOn(item, dateText),
    )
    .map((item) => ({
      name: item.content || '提醒',
      kind: 'reminder',
      kindText: KIND_TEXT.reminder,
      emoji: '🔔',
      food: '',
    }))
}

/** 本周（周一 ~ 周日）还剩的自定义纪念日 */
function weekAnniversaries(reminders, dateText) {
  const today = checkin.isDateText(dateText) ? dateText : checkin.today()
  const start = weekStart(today)
  const out = []
  for (let i = 0; i < 7; i++) {
    const date = checkin.addDays(start, i)
    const offset = checkin.diffDays(today, date)
    if (offset < 0) continue
    anniversariesOn(reminders, date).forEach((item) =>
      out.push(decorate(item, date, offset, false)),
    )
  }
  out.sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name))
  return out
}

/**
 * 页面要展示的「日子」：节日 + 普通提醒 + 自定义纪念日合并，按日期升序。
 * mode:
 *   - 'week'：本周剩余（未选中某天时）——只放节日与纪念日，日常提醒天天响，塞进来就没重点了
 *   - 'day'：指定那一天的全部（日历上选中某天时，历史与未来都能看）
 * 三类混在一起，靠 kindText 区分；同一天按 节日 → 提醒 → 纪念日 排。
 */
function daysToShow(reminders, todayText, options) {
  const opt = options || {}
  const limit = opt.limit || 3
  if (opt.date) {
    const offset = checkin.diffDays(todayText, opt.date)
    // 选中某天：节日、提醒、纪念日一律显示农历（日历上已经写了公历）
    const list = festivalsOf(opt.date)
      .map((item) => decorate(item, opt.date, offset, true))
      .concat(
        remindersOn(reminders, opt.date).map((item) =>
          decorate(item, opt.date, offset, true),
        ),
      )
      .concat(
        anniversariesOn(reminders, opt.date).map((item) =>
          decorate(item, opt.date, offset, true),
        ),
      )
    return list.sort((a, b) => {
      const rank = (KIND_RANK[a.kind] || 0) - (KIND_RANK[b.kind] || 0)
      return rank || a.name.localeCompare(b.name)
    })
  }
  return weekFestivals(todayText, limit)
    .concat(weekAnniversaries(reminders, todayText))
    .sort(
      (a, b) =>
        a.offset - b.offset ||
        (a.kind === b.kind
          ? a.name.localeCompare(b.name)
          : a.kind === 'anniv'
            ? 1
            : -1),
    )
    .slice(0, limit)
}

/** 列表里有没有纪念日，用来决定标题写「本周节日」还是「本周节日 · 纪念日」 */
function hasAnniversary(list) {
  return list.some((item) => item.kind === 'anniv')
}

module.exports = {
  KIND_TEXT,
  SOLAR,
  FLOATING,
  LUNAR,
  TERMS,
  termDay,
  lunarDayText,
  festivalsOf,
  anniversariesOn,
  hasReminderOn,
  remindersOn,
  weekStart,
  weekFestivals,
  weekAnniversaries,
  daysToShow,
  hasAnniversary,
}