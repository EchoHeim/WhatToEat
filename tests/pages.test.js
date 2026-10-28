/**
 * 提醒列表页 / 提醒编辑页 逻辑回归测试
 * 在 Node 里用桩替掉 wx 与 Page，直接驱动页面方法。
 * 运行：node tests/pages.test.js
 */
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

const toasts = []
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  showToast: opt => toasts.push(opt.title),
  showModal: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  navigateBack: () => {},
  navigateTo: () => {},
  requestSubscribeMessage: opt => opt.fail && opt.fail(new Error('stub')),
  cloud: undefined
}
let captured = null
global.Page = def => { captured = def }

const store = require(path.join(ROOT, 'utils', 'store'))
const reminderLib = require(path.join(ROOT, 'utils', 'reminder'))
const lunar = require(path.join(ROOT, 'utils', 'lunar'))

let failed = 0
function ok(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failed++; console.log(`FAIL ${name}\n  actual   ${a}\n  expected ${e}`) }
  else console.log(`pass ${name} => ${a}`)
}
function section(title) { console.log(`\n=== ${title} ===`) }

function instantiate(relPath) {
  captured = null
  require(path.join(ROOT, relPath))
  const def = captured
  const inst = Object.assign({}, def)
  inst.data = JSON.parse(JSON.stringify(def.data))
  inst.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb.call(this) }
  return inst
}

section('提醒编辑页 · 农历选择器')
const form = instantiate('pages/reminder-form/reminder-form.js')
form.onLoad({})
ok('默认公历 + 今天', form.data.calendar === 'solar' && form.data.solarDate === reminderLib.today(), true)
ok('默认循环不重复', form.data.repeat, 'none')
ok('默认提前当天', form.data.advanceDays, [0])
ok('预览已生成', typeof form.data.previewText === 'string' && form.data.previewText.length > 0, true)

const state815 = form.computeLunarState({ year: 2026, month: 8, day: 15, isLeap: false }, '2026-09-17')
ok('农历八月十五 -> 公历 2026-09-25', state815.solarDate, '2026-09-25')
ok('月份标签命中八月', state815.lunarMonthLabels[state815.lunarMonthIndex], '八月')
ok('日期标签命中十五', state815.lunarDayLabels[state815.lunarDayIndex], '十五')

const stateSpring = form.computeLunarState({ year: 2026, month: 1, day: 1, isLeap: false }, '2026-09-17')
ok('正月初一已过 -> 顺延到 2027-02-06', stateSpring.solarDate, '2027-02-06')
ok('顺延后农历年为 2027', stateSpring.lunarYear, 2027)

const leapState = form.computeLunarState({ year: 2023, month: 2, day: 1, isLeap: true }, '2026-09-17')
ok('2026 无闰二月 -> 回退到二月', leapState.lunarMonthLabels[leapState.lunarMonthIndex], '二月')
ok('回退后日期在今天之后', leapState.solarDate > '2026-09-17', true)

const leap2025 = form.computeLunarState({ year: 2025, month: 6, day: 1, isLeap: true }, '2025-06-01')
ok('2025 闰六月初一存在', leap2025.lunarMonthLabels[leap2025.lunarMonthIndex], '闰六月')
ok('闰六月初一 -> 2025-07-25', leap2025.solarDate, '2025-07-25')

const bigDay = form.computeLunarState({ year: 2026, month: 1, day: 30, isLeap: false }, '2026-01-01')
ok('正月三十超出天数时收敛到月末', bigDay.lunarDayLabels[bigDay.lunarDayIndex], lunar.lunarMonthDayCount(2026, 1, false) === 30 ? '三十' : '廿九')

section('提醒编辑页 · 表单流转')
form.setData({ today: '2026-09-17' })
form.setData({ content: '中秋团圆饭' })
form.repeatChange({ currentTarget: { dataset: { value: 'yearly' } } })
form.calendarChange({ currentTarget: { dataset: { value: 'lunar' } } })
form.setData(form.computeLunarState({ year: 2026, month: 8, day: 15, isLeap: false }, '2026-09-17'))
form.refreshDerived()
ok('仅当天提醒时的预览', form.data.previewText, '下次提醒 8 天后 · 事件日 农历八月十五')

form.toggleAdvance({ currentTarget: { dataset: { value: 3 } } })
ok('勾选提前 3 天后跨度变 5 天', form.data.previewText, '下次提醒 5 天后 · 事件日 农历八月十五')

const payload = form.buildPayload()
ok('payload.calendar', payload.calendar, 'lunar')
ok('payload.repeat', payload.repeat, 'yearly')
ok('payload.lunar', payload.lunar, { year: 2026, month: 8, day: 15, isLeap: false })
ok('payload.advanceDays', payload.advanceDays, [0, 3])
ok('payload.date', payload.date, '2026-09-25')

form.repeatChange({ currentTarget: { dataset: { value: 'daily' } } })
ok('每天循环时隐藏提前设置', form.data.dailyRepeat, true)
ok('每天循环强制当天', form.data.advanceDays, [0])
ok('每天循环预览', form.data.previewText, '下次提醒 8 天后 · 事件日 农历八月十五')
ok('每天循环 payload 归一化', form.buildPayload().advanceDays, [0])

form.repeatChange({ currentTarget: { dataset: { value: 'yearly' } } })
ok('切回每年恢复提前设置', form.data.advanceDays, [0, 3])

section('提醒列表页 · 分组')
const fake = [
  { id: 'a', content: '今天交房租（每月/公历）', enabled: true, calendar: 'solar', repeat: 'monthly', date: '2026-01-17', advanceDays: [0, 1, 3], time: '09:00' },
  { id: 'b', content: '中秋（每年/农历）', enabled: true, calendar: 'lunar', repeat: 'yearly', date: '2026-09-25', lunar: { year: 2026, month: 8, day: 15, isLeap: false }, advanceDays: [0, 3], time: '09:00' },
  { id: 'c', content: '提前 3 天触发（一次性/公历）', enabled: true, calendar: 'solar', repeat: 'none', date: '2026-10-01', advanceDays: [0, 3], time: '09:00' },
  { id: 'd', content: '每天喝水', enabled: true, calendar: 'solar', repeat: 'daily', date: '2026-09-01', advanceDays: [0], time: '08:00' },
  { id: 'e', content: '已关闭的提醒', enabled: false, calendar: 'solar', repeat: 'yearly', date: '2026-12-25', advanceDays: [0], time: '09:00' },
  { id: 'f', content: '已经过去的一次性提醒', enabled: true, calendar: 'solar', repeat: 'none', date: '2026-01-01', advanceDays: [0], time: '09:00' }
]
store.getReminders = () => fake
store.getSettings = () => ({ pushQuota: 2 })
reminderLib.today = () => '2026-09-17'

const list = instantiate('pages/reminders/reminders.js')
list.refresh()

const groups = {}
list.data.groups.forEach(group => { groups[group.key] = group.items.map(item => item.id) })
ok('今天分组', groups.today, ['a', 'd'])
ok('未来 7 天分组', groups.soon, ['b'])
ok('更远分组', groups.later, ['c'])
ok('关闭/结束分组', groups.closed, ['e', 'f'])
ok('今日提醒计数', list.data.todayCount, 2)
ok('总条数', list.data.total, 6)
ok('推送额度透出', list.data.pushQuota, 2)

const itemA = list.data.groups[0].items.find(item => item.id === 'a')
ok('列表卡片 · 日期文案', itemA.dateText, '今天')
ok('列表卡片 · 农历事件标签', list.data.groups.find(g => g.key === 'soon').items[0].eventLabel, '农历八月十五')
ok('列表卡片 · 提前提醒文案', itemA.advanceText, '当天 · 提前 1 天 · 提前 3 天')
ok('列表卡片 · 每月循环文案', itemA.repeatText, '每月')

section('记录页 · 一天一张卡（饮食 + 心情合并）')
// 换成内存 storage，才能给记录页喂造好的数据
const memory = {}
wx.getStorageSync = key => memory[key]
wx.setStorageSync = (key, value) => { memory[key] = value }
memory['wte_dishes_v1'] = [{ id: 'd1', name: '番茄炒蛋', emoji: '🍅' }]
memory['wte_records_v1'] = [
  { id: 'r1', dishId: 'd1', dishName: '番茄炒蛋', date: '2026-10-12', mealType: '午餐', score: 4.5, status: '吃得很好', remark: '汤汁下饭' },
  { id: 'r2', dishId: 'd1', dishName: '番茄炒蛋', date: '2026-10-12', mealType: '晚餐', score: 4, status: '还不错', remark: '' },
  { id: 'r3', dishId: 'd1', dishName: '番茄炒蛋', date: '2026-10-10', mealType: '午餐', score: 4, status: '还不错', remark: '' }
]
memory['wte_checkins_v1'] = [
  { id: 'c1', date: '2026-10-12', moodKey: 'joyful', mood: { key: 'joyful', emoji: '😄', label: '开心' }, note: '今天状态不错' },
  { id: 'c2', date: '2026-10-11', moodKey: 'tired', mood: { key: 'tired', emoji: '😪', label: '疲惫' }, note: '' }
]
const recordsPage = instantiate('pages/records/records.js')
recordsPage.onLoad()
// 固定到 2026 年 10 月，避免测试跟着运行日期漂移
recordsPage.year = 2026
recordsPage.month = 10
recordsPage.refresh()
ok('只聚合成有内容的日期', recordsPage.data.days.length, 3)
ok('日期倒序', recordsPage.data.days.map(item => item.date), ['2026-10-12', '2026-10-11', '2026-10-10'])
ok('同一天两餐归到一张卡', recordsPage.data.days[0].mealCount, 2)
ok('卡片带上心情图标', recordsPage.data.days[0].moodEmoji, '😄')
ok('卡片带上心情标签', recordsPage.data.days[0].moodLabel, '开心')
ok('卡片带上随笔', recordsPage.data.days[0].note, '今天状态不错')
ok('只有心情没餐也成卡', recordsPage.data.days[1].mealCount, 0)
ok('只有心情的日期心情不乱', recordsPage.data.days[1].moodEmoji, '😪')
ok('只有餐的日期没有心情', recordsPage.data.days[2].moodEmoji, '')
ok('餐数据带上菜品图标', recordsPage.data.days[0].meals[0].emoji, '🍅')
ok('餐数据带上状态备注', recordsPage.data.days[0].meals[0].noteText, '吃得很好 · 汤汁下饭')
ok('合计餐数', recordsPage.data.monthCount, 3)
ok('合计天数', recordsPage.data.moodCount, 2)
const cellWithMood = recordsPage.data.cells.find(item => item.date === '2026-10-12')
const cellMealOnly = recordsPage.data.cells.find(item => item.date === '2026-10-10')
ok('日历格心情优先', cellWithMood.mark, '😄')
ok('日历格退回菜品图标', cellMealOnly.mark, '🍅')
ok('日历格标记心情标记位', cellWithMood.hasMood, true)

recordsPage.setData({ selectedDate: '2026-10-11' })
recordsPage.refresh()
ok('选中某天后只留那一天', recordsPage.data.days.map(item => item.date), ['2026-10-11'])
ok('选中后餐数跟着收窄', recordsPage.data.monthCount, 0)
recordsPage.clearDate()
ok('清空选中回到整月', recordsPage.data.days.length, 3)

section('云同步错误提示')
ok('集合不存在 · 带集合名', store.describeCloudError({ errCode: -502005, errMsg: 'collection not exists' }, 'daily_checkins').indexOf('daily_checkins 集合') >= 0, true)
ok('集合不存在 · 集合名取自 error', store.describeCloudError({ errCode: -502005, collectionName: 'reminders' }).indexOf('reminders 集合') >= 0, true)
ok('集合不存在 · 无集合名不误导', store.describeCloudError({ errCode: -502005 }).indexOf('reminders') === -1, true)
ok('权限不足', store.describeCloudError({ errCode: -502003 }, 'dishes').indexOf('dishes 集合的权限') >= 0, true)
ok('环境未初始化', store.describeCloudError({ errCode: -501000 }).indexOf('wx.cloud.init') >= 0, true)
ok('未知错误码带出原始信息', store.describeCloudError({ errCode: -99999, errMsg: 'boom' }), '云同步失败（错误码 -99999）：boom')
ok('普通 Error 兜底', store.describeCloudError(new Error('network timeout')), '云同步失败：network timeout')
ok('空错误兜底', store.describeCloudError(null), '云同步失败，请检查网络与云开发配置')

store.checkCloudReady().then(result => {
  ok('未启用云开发时自检不通过', result, { ok: false, message: '未启用云开发，数据只保存在本机' })
  console.log(failed ? `\n❌ ${failed} 个用例失败` : '\n✅ 全部用例通过')
  process.exit(failed ? 1 : 0)
})
