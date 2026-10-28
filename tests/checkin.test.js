/**
 * 每日签到统计回归测试
 * 运行：node tests/checkin.test.js
 */
const fs = require('fs')
const path = require('path')
const C = require('../utils/checkin')

let failed = 0
function ok(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failed++; console.log(`FAIL ${name}\n  actual   ${a}\n  expected ${e}`) }
  else console.log(`pass ${name} => ${a}`)
}
function section(title) { console.log(`\n=== ${title} ===`) }
function pick(source, keys) { return keys.reduce((acc, key) => ({ ...acc, [key]: source[key] }), {}) }

const TODAY = '2026-10-22'
const mk = (date, key) => ({ date, moodKey: key || 'cozy', mood: C.moodByKey(key || 'cozy') })

section('心情图标')
ok('心情数量（4x4）', C.MOODS.length, 16)
ok('key 无重复', new Set(C.MOODS.map(item => item.key)).size, 16)
ok('label 无重复', new Set(C.MOODS.map(item => item.label)).size, 16)
ok('每项都有 emoji 与 label', C.MOODS.every(item => Boolean(item.emoji) && Boolean(item.label)), true)
ok('未知 key 兜底默认心情', C.normalizeMood(null, 'not-exist').key, C.DEFAULT_MOOD.key)
ok('兜底心情是平静', C.DEFAULT_MOOD.key, 'calm')
ok('按 key 查找', (C.moodByKey('tired') || {}).label, '疲惫')
ok('每项都有 icon 且指向 png', C.MOODS.every(item => /\.png$/.test(item.icon)), true)
ok('icon 文件都真实存在', C.MOODS.filter(item => !fs.existsSync(path.join(__dirname, '..', item.icon))).map(item => item.icon), [])
ok('第 16 个心情是惬意', C.MOODS[15].label, '惬意')
// 老心情 key 必须落到新的一套上，否则历史签到会集体变成同一个表情
ok('旧 key 映射到新心情', ['joyful', 'excited', 'plain', 'down', 'busy', 'sleepy'].map(key => (C.moodByKey(key) || {}).key),
  ['happy', 'expectant', 'calm', 'unwell', 'anxious', 'confused'])
ok('旧记录兜底渲染', C.normalizeMood({ key: 'joyful' }).key, 'happy')
ok('craving 现在就是嘴馋', (C.moodByKey('craving') || {}).label, '嘴馋')

section('日期工具')
ok('addDays 跨月', C.addDays('2026-10-31', 1), '2026-11-01')
ok('addDays 往前跨年', C.addDays('2026-01-01', -1), '2025-12-31')
ok('diffDays', C.diffDays('2026-10-20', '2026-10-22'), 2)
ok('monthPrefix', C.monthPrefix('2026-10-22'), '2026-10')

section('连续签到')
ok('今天已签，连续 3 天', C.calcStreak([mk('2026-10-22'), mk('2026-10-21'), mk('2026-10-20')], TODAY), { streak: 3, checkedToday: true, earliest: '2026-10-20' })
ok('今天未签，从昨天往前数', C.calcStreak([mk('2026-10-21'), mk('2026-10-20')], TODAY), { streak: 2, checkedToday: false, earliest: '2026-10-20' })
ok('中间断档只算最近一段', C.calcStreak([mk('2026-10-22'), mk('2026-10-20')], TODAY).streak, 1)
ok('昨天也没签则为 0', C.calcStreak([mk('2026-10-19')], TODAY), { streak: 0, checkedToday: false, earliest: '' })
ok('空数据', C.calcStreak([], TODAY), { streak: 0, checkedToday: false, earliest: '' })
ok('同日重复不重复计数', C.calcStreak([mk('2026-10-22'), mk('2026-10-22')], TODAY).streak, 1)

section('最近 14 天条带')
const strip = C.buildStrip([mk('2026-10-22', 'happy'), mk('2026-10-16', 'tired')], TODAY, 14)
ok('条带长度', strip.length, 14)
ok('首日为 13 天前', strip[0].date, '2026-10-09')
ok('末日是今天', pick(strip[13], ['date', 'day', 'checked', 'emoji', 'isToday']), { date: '2026-10-22', day: 22, checked: true, emoji: '😄', isToday: true })
ok('缺签那天为灰点', pick(strip[6], ['date', 'checked', 'emoji', 'isToday']), { date: '2026-10-15', checked: false, emoji: '', isToday: false })
ok('有签到的那天带心情', pick(strip[7], ['date', 'checked', 'emoji']), { date: '2026-10-16', checked: true, emoji: '😪' })
ok('单日条带', C.buildStrip([mk('2026-10-22')], TODAY, 1), [{ date: '2026-10-22', day: 22, weekday: '周四', checked: true, emoji: '😌', icon: '/images/moods/cozy.png', isToday: true }])

section('统计')
const monthList = [mk('2026-10-22', 'happy'), mk('2026-10-21', 'happy'), mk('2026-10-20', 'tired'), mk('2026-09-30', 'cozy')]
ok('累计与本月', C.counters(monthList, TODAY), { total: 4, monthCount: 3 })
ok('本月心情分布（次数倒序）', C.moodTally(monthList, '2026-10'), [
  { key: 'happy', emoji: '😄', label: '高兴', icon: '/images/moods/happy.png', count: 2 },
  { key: 'tired', emoji: '😪', label: '疲惫', icon: '/images/moods/tired.png', count: 1 }
])
ok('跨月不串味', C.moodTally(monthList, '2026-09'), [{ key: 'cozy', emoji: '😌', label: '惬意', icon: '/images/moods/cozy.png', count: 1 }])
ok('空数据心情分布', C.moodTally([], '2026-10'), [])

section('概览模型')
const info = C.overview(monthList, TODAY)
ok('今日已签', info.checkedToday, true)
ok('今日心情', info.todayMood.key, 'happy')
ok('连续天数', info.streak, 3)
ok('累计/本月', [info.total, info.monthCount], [4, 3])
ok('最近签到日', info.lastDate, '2026-10-22')
ok('无数据时今日心情为 null', C.overview([], TODAY).todayMood, null)
ok('乱序输入也能取到今日记录', C.overview([mk('2026-09-01'), mk('2026-10-22')], TODAY).todayRecord.date, '2026-10-22')

console.log(failed ? `\n❌ ${failed} 个用例失败` : '\n✅ 全部用例通过')
process.exit(failed ? 1 : 0)
