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
  store.onCloudError(null)
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

/**
 * 带状态的假云库：where / doc 过滤、add / update / remove 真实生效，command.inc 支持原子自增。
 * 墓碑清理、updatedAt 冲突合并、额度记账这类「写完再读回来」的行为只能用它验。
 */
function useSyncCloud(docs) {
  const collections = docs
  let seq = 0
  const copy = value => JSON.parse(JSON.stringify(value))
  const makeColl = name => {
    const list = () => collections[name] || (collections[name] = [])
    let skip = 0
    let limit = 20
    let where = null
    let docId = ''
    const chain = {
      skip(n) { skip = n; return chain },
      limit(n) { limit = n; return chain },
      where(cond) { where = cond || null; return chain },
      doc(id) { docId = id; return chain },
      get: async () => {
        let data = list()
        if (docId) return { data: data.filter(item => item._id === docId).map(copy) }
        if (where) {
          data = data.filter(item => Object.keys(where).every(key => {
            const cond = where[key]
            // command.gte 序列化成 { __gte: n }，假库里按 updatedAt 比大小
            if (cond && typeof cond === 'object' && typeof cond.__gte === 'number') return Number(item[key] || 0) >= cond.__gte
            return item[key] === cond
          }))
        }
        return { data: data.slice(skip, skip + limit).map(copy) }
      },
      update: async ({ data }) => {
        const target = list().find(item => item._id === docId)
        if (target) {
          Object.entries(copy(data)).forEach(([key, value]) => {
            // command.inc 序列化成 { __inc: n }，假库里就地做加法
            if (value && typeof value === 'object' && typeof value.__inc === 'number') {
              target[key] = Math.max(0, Number(target[key]) || 0) + value.__inc
            } else {
              target[key] = value
            }
          })
        }
        return { stats: { updated: target ? 1 : 0 } }
      },
      remove: async () => {
        const index = list().findIndex(item => item._id === docId)
        if (index >= 0) list().splice(index, 1)
        return { stats: { removed: index >= 0 ? 1 : 0 } }
      },
      add: async ({ data }) => {
        const doc = { _id: `${name}_${++seq}`, _openid: 'o1', ...copy(data) }
        list().push(doc)
        return { _id: doc._id }
      }
    }
    return chain
  }
  wx.cloud = {
    database: () => ({
      command: { inc: n => ({ __inc: n }), gte: n => ({ __gte: n }) },
      collection: makeColl
    })
  }
}

/** 模拟断网（云调用直接抛错），返回恢复网络的函数 */
function breakCloud() {
  const original = wx.cloud.database
  wx.cloud.database = () => { throw new Error('offline') }
  return () => { wx.cloud.database = original }
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

  section('记录时间 · 归一与老数据兜底')
  ok('9:5 补齐成 09:05', store.normalizeClock('9:5'), '09:05')
  ok('25:00 判为非法', store.normalizeClock('25:00'), '')
  ok('空值返回空串', store.normalizeClock(''), '')
  reset()
  const timed = await store.saveRecord({ dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-20', time: '8:7', score: 5 })
  ok('保存时时间被规范化', timed.time, '08:07')
  ok('重新读取仍是 08:07', store.getRecords()[0].time, '08:07')
  const noTime = await store.saveRecord({ dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-21', score: 4 })
  ok('没传时间时落成 HH:mm', /^\d{2}:\d{2}$/.test(noTime.time), true)
  await store.saveRecord({ id: noTime.id, score: 3 })
  ok('编辑未传时间时保留原时间', store.getRecord(noTime.id).time, noTime.time)
  const legacy = { id: 'legacy', dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-22', createdAt: new Date(2026, 9, 22, 19, 6).getTime() }
  ok('老记录按 createdAt 取时间', store.recordClock(legacy), '19:06')
  ok('有 time 时优先用 time', store.recordClock({ time: '7:30', createdAt: legacy.createdAt }), '07:30')

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

  section('设置项 · 过滤天数最小 1 天')
  reset()
  useCloud({ _id: 's5', _openid: 'o5', recentDays: 0 })
  await store.syncFromCloud({ force: true })
  ok('云端存的 0 读成 1 天', store.getSettings().recentDays, 1)
  await store.saveSettings({ recentDays: 30 })
  ok('正常值不受影响', store.getSettings().recentDays, 30)
  await store.saveSettings({ recentDays: 0 })
  ok('再写 0 也会被抬到 1', store.getSettings().recentDays, 1)

  section('首页记住的菜 · 只存本机')
  reset()
  ok('初始没有记住任何菜', store.getHomePick(), '')
  store.saveHomePick('B')
  ok('存过之后能读回来', store.getHomePick(), 'B')
  ok('空值不覆盖已有记忆', store.saveHomePick(''), '')
  ok('空值写入后还是上次那道', store.getHomePick(), 'B')
  useCloud({ _id: 's3', _openid: 'o3', recentDays: 7 }, { dishes: [], meal_records: [] })
  await store.syncFromCloud({ force: true })
  ok('云同步不动这条本机记忆', store.getHomePick(), 'B')

  section('离线保存 · 本地先落盘，聚合照算')
  reset()
  wx.cloud = { database: () => { throw new Error('offline') } }
  const cloudErrors = []
  store.onCloudError((error, context) => cloudErrors.push(context))
  await store.saveRecord({ dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-01', mealType: '午餐', score: 5 })
  ok('保存立即返回，不等云端', store.getRecords().length, 1)
  ok('聚合仍重算（次数）', store.getDish('A').eatCount, 1)
  ok('聚合仍重算（均分）', store.getDish('A').score, 5)
  await store.flushCloudQueue()
  ok('云写失败被捕获并上报', cloudErrors.length > 0, true)

  section('离线删除 · 墓碑防复活')
  reset()
  useSyncCloud({
    user_settings: [{ _id: 's9', _openid: 'o1', recentDays: 7, updatedAt: 1000 }],
    dishes: [{ _id: 'cd1', _openid: 'o1', id: 'A', name: '番茄炒蛋', category: '中餐', score: 4, eatCount: 1, lastEatDate: '2026-10-02', enableRandom: true, updatedAt: 1000 }],
    meal_records: [{ _id: 'cr1', _openid: 'o1', id: 'r1', dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-02', mealType: '午餐', score: 4, updatedAt: 1000 }]
  })
  await store.syncFromCloud({ force: true })
  ok('同步后本地有这条记录', store.getRecords().length, 1)
  let restore = breakCloud()
  await store.deleteRecord('r1')
  await store.flushCloudQueue()
  ok('断网删除后本地已删', store.getRecords().length, 0)
  restore()
  await store.syncFromCloud({ force: true })
  ok('恢复后同步，删掉的记录没有复活', store.getRecords().length, 0)

  section('离线编辑 · 不被云端旧值回滚')
  reset()
  useSyncCloud({
    user_settings: [{ _id: 's9', _openid: 'o1', recentDays: 7, updatedAt: 1000 }],
    dishes: [{ _id: 'cd1', _openid: 'o1', id: 'A', name: '番茄炒蛋', category: '中餐', score: 4, eatCount: 1, lastEatDate: '2026-10-02', enableRandom: true, updatedAt: 1000 }],
    meal_records: [{ _id: 'cr1', _openid: 'o1', id: 'r1', dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-02', mealType: '午餐', score: 4, updatedAt: 1000 }]
  })
  await store.syncFromCloud({ force: true })
  restore = breakCloud()
  await store.saveRecord({ id: 'r1', score: 1 })
  await store.flushCloudQueue()
  ok('离线改分已落本地', store.getRecord('r1').score, 1)
  restore()
  await store.syncFromCloud({ force: true })
  ok('同步后本地新分没被云端旧值回滚', store.getRecord('r1').score, 1)

  section('离线改设置 · 不被云端旧值覆盖')
  reset()
  useSyncCloud({
    user_settings: [{ _id: 's9', _openid: 'o1', nickname: '云端名', recentDays: 7, updatedAt: 1000 }],
    dishes: [],
    meal_records: []
  })
  await store.syncFromCloud({ force: true })
  ok('同步后昵称来自云端', store.getSettings().nickname, '云端名')
  restore = breakCloud()
  await store.saveSettings({ nickname: '本地名' })
  await store.flushCloudQueue()
  ok('离线改名已落本地', store.getSettings().nickname, '本地名')
  restore()
  await store.syncFromCloud({ force: true })
  ok('同步后本地名没被云端旧值盖回', store.getSettings().nickname, '本地名')

  section('推送额度 · 原子记账不被整份覆盖')
  reset()
  useSyncCloud({
    user_settings: [{ _id: 's9', _openid: 'o1', pushQuota: 3, updatedAt: 1000 }],
    dishes: [],
    meal_records: []
  })
  await store.syncFromCloud({ force: true })
  ok('同步后本地额度读云端', store.getSettings().pushQuota, 3)
  await store.addPushQuota(1)
  await store.flushCloudQueue()
  ok('授权一次本地额度 +1', store.getSettings().pushQuota, 4)
  // 模拟云函数推送成功后的扣减（原子减，只动 pushQuota 不动 updatedAt）
  await wx.cloud.database().collection('user_settings').doc('s9').update({ data: { pushQuota: wx.cloud.database().command.inc(-2) } })
  // 客户端再整份保存一次设置——旧实现会把本地额度盖回云端
  await store.saveSettings({ nickname: 'lodge' })
  await store.flushCloudQueue()
  let cloudDoc = (await wx.cloud.database().collection('user_settings').doc('s9').get()).data[0]
  ok('改设置后云端额度仍是服务端的 2', cloudDoc.pushQuota, 2)
  await store.syncFromCloud({ force: true })
  ok('同步后本地额度对齐服务端', store.getSettings().pushQuota, 2)

  section('推送额度 · 离线授权攒账，恢复后补记')
  reset()
  useSyncCloud({
    user_settings: [{ _id: 's9', _openid: 'o1', pushQuota: 1, updatedAt: 1000 }],
    dishes: [],
    meal_records: []
  })
  await store.syncFromCloud({ force: true })
  restore = breakCloud()
  await store.addPushQuota(1)
  await store.flushCloudQueue()
  restore()
  await store.syncFromCloud({ force: true })
  cloudDoc = (await wx.cloud.database().collection('user_settings').doc('s9').get()).data[0]
  ok('恢复后攒的额度补记到云端', cloudDoc.pushQuota, 2)
  ok('本地额度与云端对齐', store.getSettings().pushQuota, 2)

  section('增量同步 · 只拉变过的文档')
  reset()
  const docs = {
    user_settings: [{ _id: 's9', _openid: 'o1', recentDays: 7, updatedAt: 1000 }],
    dishes: [{ _id: 'cd1', _openid: 'o1', id: 'A', name: '番茄炒蛋', category: '中餐', score: 4, eatCount: 1, lastEatDate: '2026-10-02', enableRandom: true, updatedAt: 1000 }],
    meal_records: [{ _id: 'cr1', _openid: 'o1', id: 'r1', dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-02', mealType: '午餐', score: 4, updatedAt: 1000 }]
  }
  useSyncCloud(docs)
  await store.syncFromCloud({ force: true })
  ok('首次同步拿到云端记录', store.getRecords().length, 1)
  ok('记录了增量水位', Number(wx.getStorageSync('wte_sync_stamps_v1').meal_records) >= 1000, true)
  // 模拟另一台设备加了一条记录（updatedAt 更大）
  docs.meal_records.push({ _id: 'cr2', _openid: 'o1', id: 'r2', dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-03', mealType: '晚餐', score: 5, updatedAt: 2000 })
  await store.syncFromCloud({ force: true })
  ok('第二次同步把变过的记录带回来了', store.getRecords().length, 2)
  ok('本机原有记录没被冲掉', store.getRecord('r1').score, 4)

  section('待上云清单 · 断网写的有水位也能补传')
  reset()
  const docs2 = {
    user_settings: [{ _id: 's9', _openid: 'o1', recentDays: 7, updatedAt: 1000 }],
    dishes: [{ _id: 'cd1', _openid: 'o1', id: 'A', name: '番茄炒蛋', category: '中餐', score: 4, eatCount: 0, lastEatDate: '', enableRandom: true, updatedAt: 1000 }],
    meal_records: []
  }
  useSyncCloud(docs2)
  await store.syncFromCloud({ force: true })
  restore = breakCloud()
  await store.saveRecord({ dishId: 'A', dishName: '番茄炒蛋', date: '2026-10-05', mealType: '午餐', score: 5 })
  await store.flushCloudQueue()
  ok('断网时记录留在本地', store.getRecords().length, 1)
  ok('断网时云端还没有这条', docs2.meal_records.length, 0)
  restore()
  await store.syncFromCloud({ force: true })
  ok('恢复后本机独有的数据补传上云', docs2.meal_records.length, 1)
  ok('补传的是最新版本', docs2.meal_records[0].score, 5)

  section('设置文档重复 · 取最新那份并清掉多余的')
  reset()
  const docs3 = {
    user_settings: [
      { _id: 's_old', _openid: 'o1', pushQuota: 0, nickname: '旧文档', updatedAt: 1000 },
      { _id: 's_new', _openid: 'o1', pushQuota: 2, nickname: '新文档', updatedAt: 5000 }
    ],
    dishes: [],
    meal_records: []
  }
  useSyncCloud(docs3)
  await store.syncFromCloud({ force: true })
  ok('取的是最新那份设置', store.getSettings().nickname, '新文档')
  ok('额度也取最新那份', store.getSettings().pushQuota, 2)
  await store.saveSettings({ nickname: 'lodge' })
  await store.flushCloudQueue()
  ok('重复的设置文档被清掉了', docs3.user_settings.length, 1)
  ok('留下的是最新那份', docs3.user_settings[0]._id, 's_new')
  ok('昵称写进了留下的那份', docs3.user_settings[0].nickname, 'lodge')
  ok('额度没被整份写回盖掉', docs3.user_settings[0].pushQuota, 2)

  console.log(failed ? `\n❌ ${failed} 个用例失败` : '\n✅ 全部用例通过')
  process.exit(failed ? 1 : 0)
})().catch(error => {
  console.error('测试执行异常', error)
  process.exit(1)
})
