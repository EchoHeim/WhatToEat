/**
 * 古诗词句子库回归测试
 * 关注四件事：数量正好 100、每句不超过 20 字、随机抽取不连着重复、顶部小标记库可用。
 * 运行：node tests/quotes.test.js
 */
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const { QUOTES, MARKS, randomQuote, randomMark } = require(path.join(ROOT, 'utils', 'quotes'))

let failed = 0
function ok(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failed++; console.log(`FAIL ${name}\n  actual   ${a}\n  expected ${e}`) }
  else console.log(`pass ${name} => ${a}`)
}
function section(title) { console.log(`\n=== ${title} ===`) }

section('句子库 · 数量与长度')
ok('正好 100 句', QUOTES.length, 100)
ok('没有超过 20 字的句子', QUOTES.filter(item => [...item].length > 20), [])
ok('没有空句子', QUOTES.filter(item => !String(item).trim()), [])
ok('没有重复句子', QUOTES.filter((item, index) => QUOTES.indexOf(item) !== index), [])
ok('每句都以中文标点收尾', QUOTES.filter(item => !/[。！？]$/.test(item)), [])

section('随机抽取')
const picked = []
for (let i = 0; i < 300; i++) picked.push(randomQuote())
ok('抽到的都在库里', picked.filter(item => QUOTES.indexOf(item) === -1), [])
let repeatInRow = 0
for (let i = 1; i < picked.length; i++) if (picked[i] === picked[i - 1]) repeatInRow++
ok('没有连续两次抽到同一句', repeatInRow, 0)
ok('300 次抽到 50 句以上', new Set(picked).size > 50, true)

section('顶部小标记')
ok('库里有标记', MARKS.length >= 20, true)
ok('没有空标记', MARKS.filter(item => !String(item).trim()), [])
ok('没有重复标记', MARKS.filter((item, index) => MARKS.indexOf(item) !== index), [])
ok('每个标记只有一个字符', MARKS.filter(item => [...item].length !== 1), [])
const marks = []
for (let i = 0; i < 300; i++) marks.push(randomMark())
ok('抽到的标记都在库里', marks.filter(item => MARKS.indexOf(item) === -1), [])
let markRepeatInRow = 0
for (let i = 1; i < marks.length; i++) if (marks[i] === marks[i - 1]) markRepeatInRow++
ok('没有连续两次抽到同一标记', markRepeatInRow, 0)

console.log(failed ? `\n❌ ${failed} 个用例失败` : '\n✅ 全部用例通过')
process.exit(failed ? 1 : 0)
