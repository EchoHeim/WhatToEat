/**
 * store 数据层回归测试
 * 重点盯「记录增 / 删 / 改之后菜品聚合是否还对」——这类偏差不会报错，只会悄悄把评分算错。
 * 运行：node tests/store.test.js
 */
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

let memory = {}
global.wx = {
  // 真实环境每次读取都是新对象，这里也走一遍序列化，避免测试里改引用改出假象
  getStorageSync: key => (memory[key] === undefined ? undefined : JSON.parse(JSON.stringify(memory[key]))),
  setStorageSync: (key, value) => { memory[key] = JSON.parse(JSON.stringify(value)) }
}

const store = require(path.join(ROOT, 'utils', 'store'))

const clone = value => JSON.parse(JSON.stringify(value))
const DISHES = [
  { id: 'A', name: '番茄炒蛋', emoji: '🍅', category: '中餐', tags: [], mealTypes: ['午餐'], eatTypes: ['自己做'], price: '经济', score: 0, eatCount: 0, lastEatDate: '', enableRandom: true, createdAt: 1 },
  { id: 'B', name: '牛肉面', emoji: '🍜', category: '面食', tags: [], mealTypes: ['午餐'], eatTypes: ['外卖'], price: '普通', score: 0, eatCount: 0, lastEatDate: '', enableRandom: true, createdAt: 2 }
]

/** 每个用例前重置本地库；默认不启用云开发 */
function reset() {
  memory = {}
  delete wx.cloud
  store.bootstrap()
  memory['wte_dishes_v1'] = clone(DISHES)
  memory['wte_records_v1'] = []
  memory['wte_reminders_v1'] = []
  memory['wte_checkins_v1'] = []
}

/** 最小可用的假云库：分页读取、add / update / remove 都能应答 */
function useCloud(settingsDoc, docs) {
  const collections = docs || {}
  collections.user_settings = [settingsDoc]
  wx.cloud = {
    database: () => ({
      collection: name => {
        let skip = 0
        let limit = 20
        const api = {
          skip(n) { skip = n; return api },
          limit(n) { limit = n; return api },
          where() { return api },
          doc() { return api },
          orderBy() { return api },
          get: async () => ({ data: (collections[name] || []).slice(skip, skip + limit) }),
          add: async () => ({ _id: `cloud_${name}` }),
          set: async () => ({ _id: `cloud_${name}` }),
          update: async () => ({ stats: { updated: 1 } }),
          remove: async () => ({ stats: { removed: 1 } })
        }
        return api
      }
    })
  }
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
  section('记录新增 · 菜品聚合')
  reset()
  await store.saveRecord({ dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-01', mealType: '午餐', score: 5 })
  let dishA = store.getDish('A')
  ok('新增后吃过次数', dishA.eatCount, 1)
  ok('新增后平均分', dishA.score, 5)
  ok('新增后最近日期', dishA.lastEatDate, '2026-10-01')
  ok('另一道菜不受影响', store.getDish('B').eatCount, 0)

  await store.saveRecord({ dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-05', mealType: '晚餐', score: 3 })
  dishA = store.getDish('A')
  ok('两餐后次数', dishA.eatCount, 2)
  ok('两餐后平均分', dishA.score, 4)
  ok('最近日期取最新', dishA.lastEatDate, '2026-10-05')

  section('记录删除 · 聚合回滚')
  const lowScore = store.getRecords().find(item => item.score === 3)
  await store.deleteRecord(lowScore.id)
  dishA = store.getDish('A')
  ok('删除后次数回滚', dishA.eatCount, 1)
  ok('删除后平均分回滚', dishA.score, 5)
  ok('删除后最近日期回退', dishA.lastEatDate, '2026-10-01')
  ok('记录本身已移除', store.getRecords().length, 1)

  section('记录编辑 · 原地更新')
  const only = store.getRecords()[0]
  const createdAt = only.createdAt
  await store.saveRecord({ id: only.id, score: 1 })
  dishA = store.getDish('A')
  ok('改分后仍是同一条', store.getRecords().length, 1)
  ok('改分后创建时间保留', store.getRecords()[0].createdAt, createdAt)
  ok('改分后平均分跟着变', dishA.score, 1)
  ok('改分后次数不变', dishA.eatCount, 1)

  await store.saveRecord({ id: only.id, date: '2026-09-20' })
  ok('改日期后最近日期跟着走', store.getDish('A').lastEatDate, '2026-09-20')

  section('记录编辑 · 换菜前后都回算')
  await store.saveRecord({ id: only.id, dishId: 'B', dishName: '牛肉面' })
  ok('原菜次数清零', store.getDish('A').eatCount, 0)
  ok('原菜均分清零', store.getDish('A').score, 0)
  ok('原菜最近日期清空', store.getDish('A').lastEatDate, '')
  ok('新菜次数累加', store.getDish('B').eatCount, 1)
  ok('新菜最近日期', store.getDish('B').lastEatDate, '2026-09-20')

  section('记录清空 · 归零而不是残留')
  for (const record of store.getRecords()) await store.deleteRecord(record.id)
  ok('清空后次数归零', store.getDish('B').eatCount, 0)
  ok('清空后均分归零', store.getDish('B').score, 0)
  ok('清空后最近日期清空', store.getDish('B').lastEatDate, '')
  ok('记录列表为空', store.getRecords().length, 0)

  section('记录编辑 · 异常入参')
  const orphan = await store.saveRecord({ id: 'record_not_exist', dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-10', score: 4 })
  ok('不存在的 id 退化成新增', orphan.id !== 'record_not_exist', true)
  ok('新增后记录数为 1', store.getRecords().length, 1)
  const noScore = await store.saveRecord({ dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-11', score: 'abc' })
  ok('非法分数落成 0 而不是 NaN', noScore.score, 0)
  ok('无分记录仍计入次数', store.getDish('A').eatCount, 2)
  ok('无分记录不污染均分', store.getDish('A').score, 4)

  section('云同步 · 菜品聚合按记录自愈')
  reset()
  useCloud(
    { _id: 's4', _openid: 'o4', recentDays: 7 },
    {
      dishes: [
        { _id: 'cd1', _openid: 'o4', id: 'A', name: '番茄炒蛋', emoji: '🍅', category: '中餐', tags: [], mealTypes: ['午餐'], eatTypes: ['自己做'], price: '经济', score: 1.2, eatCount: 99, lastEatDate: '2020-01-01', enableRandom: true }
      ],
      meal_records: [
        { _id: 'cr1', _openid: 'o4', id: 'r1', dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-02', mealType: '午餐', score: 4 },
        { _id: 'cr2', _openid: 'o4', id: 'r2', dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-04', mealType: '晚餐', score: 5 }
      ]
    }
  )
  await store.syncFromCloud({ force: true })
  const healed = store.getDish('A')
  ok('自愈后次数以记录为准', healed.eatCount, 2)
  ok('自愈后均分以记录为准', healed.score, 4.5)
  ok('自愈后最近日期以记录为准', healed.lastEatDate, '2026-10-04')

  section('设置项 · 云端缺字段落回默认值')
  reset()
  useCloud({ _id: 's1', _openid: 'o1', initialized: true, updatedAt: 123, nickname: 'lodge', allowRepeat: true })
  ok('同步确实执行', await store.syncFromCloud({ force: true }), true)
  const settings = store.getSettings()
  ok('缺 recentDays 落回默认 7', settings.recentDays, 7)
  ok('缺 defaultMeal 落回默认午餐', settings.defaultMeal, '午餐')
  ok('云端有的字段生效', settings.nickname, 'lodge')
  ok('布尔值正常', settings.allowRepeat, true)
  ok('剥掉 _id', Object.prototype.hasOwnProperty.call(settings, '_id'), false)
  ok('剥掉 _openid', Object.prototype.hasOwnProperty.call(settings, '_openid'), false)
  ok('剥掉 initialized', Object.prototype.hasOwnProperty.call(settings, 'initialized'), false)

  section('设置项 · 类型归一与未知字段')
  reset()
  useCloud({ _id: 's2', _openid: 'o2', recentDays: '14', pushQuota: '3', allowRepeat: false, theme: 'dark' })
  await store.syncFromCloud({ force: true })
  const typed = store.getSettings()
  ok('字符串数字归一成 14', typed.recentDays, 14)
  ok('字符串数字归一成 3', typed.pushQuota, 3)
  ok('false 不被当真', typed.allowRepeat, false)
  ok('未知字段原样保留', typed.theme, 'dark')

  section('设置项 · 本地保存')
  await store.saveSettings({ pushQuota: 5 })
  ok('保存后额度', store.getSettings().pushQuota, 5)
  ok('未传的字段保持原值', store.getSettings().recentDays, 14)
  ok('保存后仍不残留库层字段', Object.prototype.hasOwnProperty.call(store.getSettings(), '_id'), false)

  console.log(failed ? `\n❌ ${failed} 个用例失败` : '\n✅ 全部用例通过')
  process.exit(failed ? 1 : 0)
})().catch(error => {
  console.error('测试执行异常', error)
  process.exit(1)
})
