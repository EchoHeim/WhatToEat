/**
 * reminderPush 云函数回归测试
 *
 * 盯两件事：
 *   1. 推送失败分「永久」和「临时」两种——临时失败不能写 lastPushed，
 *      不然一次网络抖动就导致当天再也收不到（这是之前的老毛病）。
 *   2. 并发推送时额度只能按用户结算一次，不能两条提醒都按同一份额度扣。
 *
 * 本地没有 wx-server-sdk，用 Module._load 打桩换一个假的上去。
 * 运行：node tests/cloudpush.test.js
 */
const path = require('path')
const Module = require('module')
const ROOT = path.resolve(__dirname, '..')

// ---- 固定时钟：北京时间 2026-10-29 14:30 ----
const FIXED = new Date('2026-10-29T06:30:00Z')
const RealDate = Date
class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED.getTime())
    else super(...args)
  }
  static now() { return FIXED.getTime() }
}
global.Date = FakeDate

// ---- 假云库 ----
const collections = {
  reminders: [],
  user_settings: []
}
let sendImpl = async () => ({ errCode: 0 })
let quotaWrites = 0

const fakeSdk = {
  init() {},
  database: () => ({
    command: { inc: n => ({ __inc: n }) },
    collection: name => {
      const list = () => collections[name] || (collections[name] = [])
      let where = null
      let docId = ''
      let skip = 0
      let limit = 20
      const chain = {
        where(cond) { where = cond || null; return chain },
        doc(id) { docId = id; return chain },
        skip(n) { skip = n; return chain },
        limit(n) { limit = n; return chain },
        get: async () => {
          let data = list()
          if (where) data = data.filter(item => Object.keys(where).every(key => item[key] === where[key]))
          return { data: data.slice(skip, skip + limit).map(item => ({ ...item })) }
        },
        update: async ({ data }) => {
          const target = list().find(item => item._id === docId)
          if (target) {
            Object.entries(data).forEach(([key, value]) => {
              if (value && typeof value === 'object' && typeof value.__inc === 'number') {
                target[key] = Math.max(0, Number(target[key]) || 0) + value.__inc
              } else {
                target[key] = value
              }
            })
          }
          if (name === 'user_settings') quotaWrites += 1
          return { stats: { updated: target ? 1 : 0 } }
        }
      }
      return chain
    }
  }),
  openapi: {
    subscribeMessage: {
      send: async payload => {
        sent.push(payload)
        return sendImpl(payload)
      }
    }
  }
}
let sent = []

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return fakeSdk
  return originalLoad(request, parent, isMain)
}
const push = require(path.join(ROOT, 'cloudfunctions', 'reminderPush', 'index.js'))

/** 一条今天 14:30 会触发的提醒 */
function reminder(overrides) {
  return {
    _id: 'cr1',
    _openid: 'o1',
    id: 'r1',
    content: '该吃饭了',
    calendar: 'solar',
    repeat: 'daily',
    date: '2026-10-29',
    advanceDays: [0],
    time: '14:30',
    enabled: true,
    lastPushed: '',
    ...overrides
  }
}

function reset() {
  collections.reminders = []
  collections.user_settings = [{ _id: 's1', _openid: 'o1', pushQuota: 3, updatedAt: 1 }]
  sent = []
  quotaWrites = 0
  sendImpl = async () => ({ errCode: 0 })
}

let failed = 0
function ok(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failed++; console.log(`FAIL ${name}\n  actual   ${a}\n  expected ${e}`) }
  else console.log(`pass ${name} => ${a}`)
}
function section(title) { console.log(`\n=== ${title} ===`) }

;(async () => {
  section('命中窗口 · 推出去并记账')
  reset()
  collections.reminders = [reminder({})]
  let stats = await push.main({})
  ok('推送成功计数', stats.pushed, 1)
  ok('扫描到这条', stats.scanned, 1)
  ok('写上了已推送标记', collections.reminders[0].lastPushed, '2026-10-29')
  ok('额度扣掉一次', collections.user_settings[0].pushQuota, 2)
  ok('统计里带扫描耗时', typeof stats.scanMs === 'number', true)

  section('临时失败 · 不写已推送标记，当天还能再试')
  reset()
  collections.reminders = [reminder({})]
  sendImpl = async () => { const e = new Error('network timeout'); e.errCode = -1; throw e }
  stats = await push.main({})
  ok('记为失败', stats.failed, 1)
  ok('没有写已推送标记（关键）', collections.reminders[0].lastPushed, '')
  ok('额度没动', collections.user_settings[0].pushQuota, 3)

  section('永久失败 · 模板参数错，写标记不再重试')
  reset()
  collections.reminders = [reminder({})]
  sendImpl = async () => { const e = new Error('argument invalid'); e.errCode = 47003; throw e }
  stats = await push.main({})
  ok('记为失败', stats.failed, 1)
  ok('写了已推送标记', collections.reminders[0].lastPushed, '2026-10-29')

  section('额度用完 · 归零并停止推送')
  reset()
  collections.reminders = [reminder({})]
  sendImpl = async () => { const e = new Error('user refuse'); e.errCode = 43101; throw e }
  stats = await push.main({})
  ok('额度归零', collections.user_settings[0].pushQuota, 0)
  ok('写了已推送标记', collections.reminders[0].lastPushed, '2026-10-29')

  section('已经推过 · 不重复推')
  reset()
  collections.reminders = [reminder({ lastPushed: '2026-10-29' })]
  stats = await push.main({})
  ok('跳过了', stats.skipped, 1)
  ok('没有推送', stats.pushed, 0)
  ok('一条消息都没发', sent.length, 0)

  section('不在时间窗口 · 不推')
  reset()
  collections.reminders = [reminder({ time: '03:00' })]
  stats = await push.main({})
  ok('跳过了', stats.skipped, 1)
  ok('没有推送', stats.pushed, 0)

  section('多条同时命中 · 都要推，额度只结算一次')
  reset()
  collections.reminders = [
    reminder({ _id: 'cr1', id: 'r1' }),
    reminder({ _id: 'cr2', id: 'r2' }),
    reminder({ _id: 'cr3', id: 'r3' })
  ]
  stats = await push.main({})
  ok('三条都推了', stats.pushed, 3)
  ok('消息发了三条', sent.length, 3)
  ok('额度从 3 扣到 0', collections.user_settings[0].pushQuota, 0)
  ok('额度只写了一次（并发不重复扣）', quotaWrites, 1)

  section('force · 忽略窗口与已推送标记')
  reset()
  collections.reminders = [reminder({ time: '03:00', lastPushed: '2026-10-29' })]
  stats = await push.main({ force: true })
  ok('强制推送', stats.pushed, 1)

  // 纪念日默认只在日历上标个日子，绝不能给它发订阅消息
  section('纪念日 · 默认不推送')
  reset()
  collections.reminders = [reminder({ kind: 'anniversary', content: '结婚纪念日', repeat: 'yearly' })]
  stats = await push.main({})
  ok('纪念日不算候选', stats.candidates, 0)
  ok('纪念日没推出去', stats.pushed, 0)
  ok('额度也没动', collections.user_settings[0].pushQuota, 3)
  // 同一轮里普通提醒照推，别被纪念日连累
  reset()
  collections.reminders = [reminder({ kind: 'anniversary', content: '结婚纪念日', repeat: 'yearly' }), reminder({})]
  stats = await push.main({})
  ok('纪念日混在里头也只推普通提醒', stats.pushed, 1)
  ok('扫描数两条都算', stats.scanned, 2)

  // 开了「到期提醒」的纪念日要跟普通提醒一样推
  section('纪念日 · 开了到期提醒就推')
  reset()
  collections.reminders = [reminder({ kind: 'anniversary', content: '结婚纪念日', repeat: 'yearly', date: '2020-10-29', notify: true })]
  stats = await push.main({})
  ok('开了提醒的纪念日照推', stats.pushed, 1)
  ok('额度扣掉一次', collections.user_settings[0].pushQuota, 2)
  ok('写上了已推送标记', collections.reminders[0].lastPushed, '2026-10-29')
  // 提前 3 天：纪念日 11-01，今天 10-29 正好落在提前 3 天的节点上
  reset()
  collections.reminders = [reminder({ kind: 'anniversary', content: '结婚纪念日', repeat: 'yearly', date: '2020-11-01', advanceDays: [3], notify: true })]
  stats = await push.main({})
  ok('提前 3 天也推', stats.pushed, 1)
  // 关掉开关（或没开）就不推
  reset()
  collections.reminders = [reminder({ kind: 'anniversary', content: '结婚纪念日', repeat: 'yearly', date: '2020-10-29', notify: false })]
  stats = await push.main({})
  ok('notify 关掉就不推', stats.pushed, 0)
  // 整个停用（enabled: false）的纪念日，就算开着提醒也不推
  reset()
  collections.reminders = [reminder({ kind: 'anniversary', content: '结婚纪念日', repeat: 'yearly', date: '2020-10-29', notify: true, enabled: false })]
  stats = await push.main({})
  ok('停用的纪念日不推', stats.pushed, 0)

  console.log(failed ? `\n❌ ${failed} 个用例失败` : '\n✅ 全部用例通过')
  process.exit(failed ? 1 : 0)
})().catch(error => {
  console.error('测试执行异常', error)
  process.exit(1)
})
