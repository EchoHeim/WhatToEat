/**
 * 节日库回归测试
 * 运行：node tests/festival.test.js
 */
const F = require('../utils/festival')
const C = require('../utils/checkin')
const L = require('../utils/lunar')

let failed = 0
function ok(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failed++; console.log(`FAIL ${name}\n  actual   ${a}\n  expected ${e}`) }
  else console.log(`pass ${name} => ${a}`)
}
function section(title) { console.log(`\n=== ${title} ===`) }

const names = date => F.festivalsOf(date).map(item => item.name)
const pick = (date, keys) => F.festivalsOf(date).map(item => keys.reduce((acc, k) => ({ ...acc, [k]: item[k] }), {}))

section('公历固定节日')
ok('元旦', names('2026-01-01'), ['元旦'])
ok('万圣节', names('2026-10-31'), ['万圣节'])
ok('圣诞只认 12-25', names('2026-12-25'), ['圣诞节'])
ok('平安夜与圣诞分开', names('2026-12-24'), ['平安夜'])
ok('没节日那天是空的', names('2026-07-20'), [])

section('浮动节日（某月第 N 个星期几）')
ok('母亲节 · 5 月第 2 个周日', names('2026-05-10'), ['母亲节'])
ok('母亲节不落在第 1 个周日', names('2026-05-03'), [])
ok('父亲节 · 6 月第 3 个周日', names('2026-06-21'), ['父亲节'])
ok('感恩节 · 11 月第 4 个周四', names('2026-11-26'), ['感恩节'])
ok('感恩节不落在第 3 个周四', names('2026-11-19'), [])

section('农历节日（每年现算，不写死公历）')
ok('除夕 2026', names('2026-02-16'), ['除夕'])
ok('春节 2026', names('2026-02-17'), ['春节'])
ok('元宵 2026', names('2026-03-03'), ['元宵'])
ok('端午 2026', names('2026-06-19'), ['端午'])
ok('中秋 2026', names('2026-09-25'), ['中秋'])
ok('重阳 2026', names('2026-10-18'), ['重阳'])
ok('腊八 2026', names('2026-01-26'), ['腊八'])
// 换一年也照样算得出来，才算真的按农历走
const spring2027 = L.lunarToSolar(2027, 1, 1)
const spring2027Text = `${spring2027.year}-${`${spring2027.month}`.padStart(2, '0')}-${`${spring2027.day}`.padStart(2, '0')}`
ok(`春节 ${spring2027Text.slice(0, 4)} 也认得`, names(spring2027Text), ['春节'])
ok('闰月不重复过节', F.festivalsOf('2025-08-07').filter(item => item.name === '七夕').length, 0)

section('节气节日')
ok('清明 2026-04-05', names('2026-04-05'), ['清明'])
ok('冬至 2026-12-22', names('2026-12-22'), ['冬至'])
ok('清明就一天', names('2026-04-04'), [])

section('本周节日')
ok('一周从周一起算', F.weekStart('2026-10-29'), '2026-10-26')
ok('周日也算在上一周里', F.weekStart('2026-11-01'), '2026-10-26')
ok('当周节日带日期与倒计时', pick2(F.weekFestivals('2026-10-29')), [
  { name: '万圣节', date: '2026-10-31', offset: 2, whenText: '后天', kindText: '国际', emoji: '🎃' }
])
ok('节日已过就不再提醒', F.weekFestivals('2026-11-02'), [])
ok('今天的节目标成今天', F.weekFestivals('2026-02-17')[0].whenText, '今天')
ok('一周最多列 3 个', F.weekFestivals('2026-12-21').length, 3)
// 12-28 那周跨到 2027：跨年夜与元旦都在同一周里
ok('跨年那周也接得上', F.weekFestivals('2026-12-28').map(item => `${item.date} ${item.name}`),
  ['2026-12-31 跨年夜', '2027-01-01 元旦'])
ok('空周返回空数组', F.weekFestivals('2026-07-20'), [])

function pick2(list) {
  return list.map(item => ({ name: item.name, date: item.date, offset: item.offset, whenText: item.whenText, kindText: item.kindText, emoji: item.emoji }))
}

section('自定义纪念日')
const annis = [
  { id: 'a1', kind: 'anniversary', content: '结婚纪念日', calendar: 'solar', date: '2020-05-20', repeat: 'yearly' },
  { id: 'a2', kind: 'anniversary', content: '奶奶生日', calendar: 'lunar', date: '2024-09-25', repeat: 'yearly', lunar: { year: 2024, month: 8, day: 15, isLeap: false } }
]
ok('公历纪念日命中', F.anniversariesOn(annis, '2026-05-20').map(item => item.name), ['结婚纪念日'])
ok('农历纪念日命中', F.anniversariesOn(annis, '2026-09-25').map(item => item.name), ['奶奶生日'])
ok('纪念日带展示字段', pick3(F.anniversariesOn(annis, '2026-05-20')), [
  { name: '结婚纪念日', kind: 'anniv', kindText: '纪念', emoji: '🎉', food: '' }
])
ok('没纪念日那天是空的', F.anniversariesOn(annis, '2026-05-21'), [])
ok('空列表不炸', F.anniversariesOn([], '2026-05-20'), [])
// 2026-05-18 是周一，结婚纪念日 5-20 在同一周的周三
ok('本周纪念日', F.weekAnniversaries(annis, '2026-05-18').map(item => `${item.date} ${item.name}`), ['2026-05-20 结婚纪念日'])
ok('已过的本周纪念日不再提醒', F.weekAnniversaries(annis, '2026-05-21'), [])
ok('合并展示 · 本周', F.daysToShow(annis, '2026-05-18').map(item => item.name), ['结婚纪念日'])
ok('合并展示 · 指定那天', F.daysToShow(annis, '2026-10-31', { date: '2026-10-31' }).map(item => item.name), ['万圣节'])
ok('指定那天节日在前、纪念日在后', F.daysToShow(annis, '2026-09-25', { date: '2026-09-25' }).map(item => item.kind), ['trad', 'anniv'])
ok('列表里有没有纪念日', F.hasAnniversary(F.daysToShow(annis, '2026-09-25', { date: '2026-09-25' })), true)

function pick3(list) {
  return list.map(item => ({ name: item.name, kind: item.kind, kindText: item.kindText, emoji: item.emoji, food: item.food }))
}

section('数据自检')
const all = [...F.SOLAR, ...F.FLOATING, ...F.LUNAR, ...F.TERMS]
ok('节日总数', all.length, 38)
ok('名字不重复', new Set(all.map(item => item.name)).size, all.length)
ok('每一项都有名字与分类', all.every(item => Boolean(item.name) && Boolean(item.kind)), true)
ok('分类都能翻成中文', all.every(item => Boolean(F.KIND_TEXT[item.kind])), true)
ok('每一项都有 emoji', all.every(item => Boolean(item.emoji)), true)
ok('传统节日都带点吃的', F.LUNAR.filter(item => item.name !== '中元').every(item => Boolean(item.food)), true)
ok('农历月份都在 1-12', F.LUNAR.every(item => item.m >= 1 && item.m <= 12), true)
// 整年扫一遍：不能崩，也不能少到离谱
let cursor = '2026-01-01'
let total = 0
for (let i = 0; i < 365; i++) {
  total += F.festivalsOf(cursor).length
  cursor = C.addDays(cursor, 1)
}
ok('2026 全年节日条数', total, all.length)

console.log(failed ? `\n❌ ${failed} 个用例失败` : '\n✅ 全部用例通过')
process.exit(failed ? 1 : 0)
