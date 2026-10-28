/**
 * 农历换算与提醒计算引擎回归测试
 * 运行：node tests/engine.test.js
 */
const lunar = require('../utils/lunar')
const R = require('../utils/reminder')

let failed = 0
function ok(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failed++; console.log(`FAIL ${name}\n  actual   ${a}\n  expected ${e}`) }
  else console.log(`pass ${name} => ${a}`)
}
function section(title) { console.log(`\n=== ${title} ===`) }

section('农历换算')
ok('1900-01-31 -> 正月初一', lunar.solarToLunar(1900, 1, 31), { year: 1900, month: 1, day: 1, isLeap: false })
ok('2026 春节 02-17 -> 正月初一', lunar.solarToLunar(2026, 2, 17), { year: 2026, month: 1, day: 1, isLeap: false })
ok('2025 春节 01-29 -> 正月初一', lunar.solarToLunar(2025, 1, 29), { year: 2025, month: 1, day: 1, isLeap: false })
ok('2024 春节 02-10 -> 正月初一', lunar.solarToLunar(2024, 2, 10), { year: 2024, month: 1, day: 1, isLeap: false })
ok('2023 春节 01-22 -> 正月初一', lunar.solarToLunar(2023, 1, 22), { year: 2023, month: 1, day: 1, isLeap: false })
ok('2026 中秋 09-25 -> 八月十五', lunar.solarToLunar(2026, 9, 25), { year: 2026, month: 8, day: 15, isLeap: false })
ok('2025 中秋 10-06 -> 八月十五', lunar.solarToLunar(2025, 10, 6), { year: 2025, month: 8, day: 15, isLeap: false })
ok('2026 端午 06-19 -> 五月初五', lunar.solarToLunar(2026, 6, 19), { year: 2026, month: 5, day: 5, isLeap: false })

ok('leapMonth(2023)=2', lunar.leapMonth(2023), 2)
ok('leapMonth(2025)=6', lunar.leapMonth(2025), 6)
ok('leapMonth(2026)=0', lunar.leapMonth(2026), 0)
const leap2023 = lunar.lunarToSolar(2023, 2, 1, true)
ok('2023 闰二月初一', leap2023, { year: 2023, month: 3, day: 22 })
ok('闰二月初一 -> 农历', lunar.solarToLunar(leap2023.year, leap2023.month, leap2023.day), { year: 2023, month: 2, day: 1, isLeap: true })
const leap2025 = lunar.lunarToSolar(2025, 6, 1, true)
ok('2025 闰六月初一', leap2025, { year: 2025, month: 7, day: 25 })
ok('闰六月初一 -> 农历', lunar.solarToLunar(leap2025.year, leap2025.month, leap2025.day), { year: 2025, month: 6, day: 1, isLeap: true })

section('公历↔农历往返一致性（2020-2035 全量）')
let roundTripErrors = 0
for (let t = Date.UTC(2020, 0, 1); t <= Date.UTC(2035, 11, 31); t += 86400000) {
  const d = new Date(t)
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate()
  const l = lunar.solarToLunar(y, m, day)
  const back = lunar.lunarToSolar(l.year, l.month, l.day, l.isLeap)
  if (back.year !== y || back.month !== m || back.day !== day) {
    roundTripErrors++
    if (roundTripErrors < 5) console.log(`  mismatch ${y}-${m}-${day} -> ${JSON.stringify(l)} -> ${JSON.stringify(back)}`)
  }
}
ok('公历↔农历往返全部一致', roundTripErrors, 0)

section('提醒计算')
const solarYearly = { content: '结婚纪念日', calendar: 'solar', date: '2020-10-01', repeat: 'yearly', advanceDays: [0, 1, 3], time: '09:00' }
ok('每年-公历 从 2026-09-17 起下一触发日', R.nextTrigger(solarYearly, '2026-09-17'), '2026-09-28')
ok('每年-公历 事件日', R.nextOccurrence(solarYearly, '2026-09-17'), '2026-10-01')

const lunarYearly = { content: '中秋', calendar: 'lunar', date: '2026-09-25', lunar: { year: 2026, month: 8, day: 15, isLeap: false }, repeat: 'yearly', advanceDays: [0, 3], time: '09:00' }
ok('每年-农历 事件日', R.nextOccurrence(lunarYearly, '2026-09-17'), '2026-09-25')
ok('每年-农历 下一触发日（提前 3 天）', R.nextTrigger(lunarYearly, '2026-09-17'), '2026-09-22')
ok('每年-农历 跨年事件日 2027', R.nextOccurrence(lunarYearly, '2026-10-01'), '2027-09-15')

const lunarLeapYearly = { content: '闰月生日', calendar: 'lunar', date: '2023-03-22', lunar: { year: 2023, month: 2, day: 1, isLeap: true }, repeat: 'yearly', advanceDays: [0], time: '09:00' }
ok('每年-闰二月 2026 回退到二月', R.nextOccurrence(lunarLeapYearly, '2026-01-01'), '2026-03-19')

const noneFuture = { content: '体检', calendar: 'solar', date: '2026-12-20', repeat: 'none', advanceDays: [0, 1, 3], time: '09:00' }
ok('一次性 事件日', R.nextOccurrence(noneFuture, '2026-09-17'), '2026-12-20')
ok('一次性 触发日', R.nextTrigger(noneFuture, '2026-09-17'), '2026-12-17')
const nonePast = { content: '已过', calendar: 'solar', date: '2026-01-01', repeat: 'none', advanceDays: [0], time: '09:00' }
ok('一次性 已过期', R.nextTrigger(nonePast, '2026-09-17'), '')

const daily = { content: '吃药', calendar: 'solar', date: '2026-09-01', repeat: 'daily', advanceDays: [0], time: '08:00' }
ok('每天 从今天起', R.nextTrigger(daily, '2026-09-17'), '2026-09-17')
ok('每天 起始日未到', R.nextTrigger({ ...daily, date: '2026-10-01' }, '2026-09-17'), '2026-10-01')

const monthlySolar = { content: '交房租', calendar: 'solar', date: '2026-01-31', repeat: 'monthly', advanceDays: [0, 1], time: '10:00' }
ok('每月-公历 31 号自动收敛到月末', R.nextOccurrence(monthlySolar, '2026-09-17'), '2026-09-30')
ok('每月-公历 10 月', R.nextOccurrence(monthlySolar, '2026-10-01'), '2026-10-31')

const monthlyLunar = { content: '农历初一', calendar: 'lunar', date: '2026-02-17', lunar: { year: 2026, month: 1, day: 1, isLeap: false }, repeat: 'monthly', advanceDays: [0], time: '10:00' }
ok('每月-农历 从 2026-09-17 起', R.nextOccurrence(monthlyLunar, '2026-09-17'), '2026-10-10')

section('触发判定')
ok('isTriggerOn 提前 3 天', R.isTriggerOn(solarYearly, '2026-09-28'), true)
ok('isTriggerOn 提前 1 天', R.isTriggerOn(solarYearly, '2026-09-30'), true)
ok('isTriggerOn 当天', R.isTriggerOn(solarYearly, '2026-10-01'), true)
ok('isTriggerOn 提前 2 天应为 false', R.isTriggerOn(solarYearly, '2026-09-29'), false)
ok('occurrenceForTrigger', R.occurrenceForTrigger(solarYearly, '2026-09-28'), '2026-10-01')
ok('advanceForTrigger', R.advanceForTrigger(solarYearly, '2026-09-28'), 3)
ok('已停用不触发', R.isTriggerOn({ ...solarYearly, enabled: false }, '2026-10-01'), false)

section('展示模型')
const view = R.describe(solarYearly, '2026-09-17')
ok('describe.triggerText', view.triggerText, '11 天后')
ok('describe.repeatText', view.repeatText, '每年')
ok('describe.advanceText', view.advanceText, '当天 · 提前 1 天 · 提前 3 天')
ok('describe.eventLabel（农历）', R.describe(lunarYearly, '2026-09-17').eventLabel, '农历八月十五')

console.log(failed ? `\n❌ ${failed} 个用例失败` : '\n✅ 全部用例通过')
process.exit(failed ? 1 : 0)
