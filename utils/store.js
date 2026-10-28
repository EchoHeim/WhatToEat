const reminderLib = require('./reminder')

const KEYS = {
  dishes: 'wte_dishes_v1',
  records: 'wte_records_v1',
  settings: 'wte_settings_v1',
  reminders: 'wte_reminders_v1',
  checkins: 'wte_checkins_v1',
  homePick: 'wte_home_pick_v1',
  // 本机已删、云端还没删掉的条目（删除墓碑），见 applyTombstones
  tombstones: 'wte_tombstones_v1',
  // 订阅授权成功但当时离线、还没记到云端的推送额度增量，见 flushQuotaPending
  quotaPending: 'wte_quota_pending_v1',
  // 每个集合的增量同步水位，见 pullCollection
  syncStamps: 'wte_sync_stamps_v1',
  // 待上云清单：本地改过、还没确认写进云端的条目，见 markDirty
  dirty: 'wte_dirty_v1'
}

const CATEGORIES = ['中餐', '西餐', '日料', '韩餐', '面食', '米饭', '火锅', '烧烤', '快餐', '小吃', '甜品', '饮品', '其他']
const TAGS = ['早餐', '午餐', '晚餐', '夜宵', '自己做', '外卖', '堂食', '清淡', '辣', '高蛋白', '减脂', '快手', '聚餐']
const MEALS = ['早餐', '午餐', '晚餐', '夜宵']
const EAT_TYPES = ['自己做', '外卖', '堂食']
const PRICES = ['经济', '普通', '丰盛', '豪华']
/** 每一档对应的价格区间，只用于界面文案，不参与数据匹配 */
const PRICE_RANGES = { 经济: '10元以下', 普通: '10-30元', 丰盛: '30-120元', 豪华: '120元以上' }
const DEFAULT_SETTINGS = { recentDays: 7, allowRepeat: false, defaultMeal: '午餐', nickname: '微信用户', avatarFileId: '', pushQuota: 0 }

// 预置菜库：只放菜品本身的信息，评分 / 吃过次数 / 最近一次 / 备注一律留空，
// 免得新用户一进来就被"假数据"糊一脸（统计、最喜欢、近期过滤全会被污染）。
const seedDishes = [
  { id: 'd1', name: '番茄炒蛋', emoji: '🍅', category: '中餐', tags: ['家常菜', '快手', '下饭'], mealTypes: ['午餐', '晚餐'], eatTypes: ['自己做'], price: '经济', score: 0, eatCount: 0, lastEatDate: '', remark: '', enableRandom: true },
  { id: 'd2', name: '牛肉面', emoji: '🍜', category: '面食', tags: ['高蛋白', '热乎'], mealTypes: ['午餐', '晚餐'], eatTypes: ['外卖', '堂食'], price: '普通', score: 0, eatCount: 0, lastEatDate: '', remark: '', enableRandom: true },
  { id: 'd3', name: '黄焖鸡米饭', emoji: '🍛', category: '米饭', tags: ['下饭', '外卖'], mealTypes: ['午餐', '晚餐'], eatTypes: ['外卖', '堂食'], price: '普通', score: 0, eatCount: 0, lastEatDate: '', remark: '', enableRandom: true },
  { id: 'd4', name: '寿司拼盘', emoji: '🍣', category: '日料', tags: ['清淡', '聚餐'], mealTypes: ['午餐', '晚餐'], eatTypes: ['堂食', '外卖'], price: '丰盛', score: 0, eatCount: 0, lastEatDate: '', remark: '', enableRandom: true },
  { id: 'd5', name: '火锅', emoji: '🍲', category: '火锅', tags: ['辣', '聚餐'], mealTypes: ['晚餐', '夜宵'], eatTypes: ['堂食'], price: '丰盛', score: 0, eatCount: 0, lastEatDate: '', remark: '', enableRandom: true },
  { id: 'd6', name: '鸡蛋三明治', emoji: '🥪', category: '西餐', tags: ['早餐', '快手'], mealTypes: ['早餐'], eatTypes: ['自己做'], price: '经济', score: 0, eatCount: 0, lastEatDate: '', remark: '', enableRandom: true },
  { id: 'd7', name: '麻辣烫', emoji: '🥘', category: '小吃', tags: ['辣', '外卖'], mealTypes: ['午餐', '晚餐', '夜宵'], eatTypes: ['外卖', '堂食'], price: '普通', score: 0, eatCount: 0, lastEatDate: '', remark: '', enableRandom: true },
  { id: 'd8', name: '酸奶水果碗', emoji: '🥣', category: '甜品', tags: ['早餐', '减脂', '清淡'], mealTypes: ['早餐'], eatTypes: ['自己做'], price: '经济', score: 0, eatCount: 0, lastEatDate: '', remark: '', enableRandom: true }
].map((dish, index) => ({ ...dish, createdAt: Date.now() - index * 1000 }))

// 新用户首启不预置任何"吃过记录"，记录必须由用户自己攒
const seedRecords = []

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function get(key, fallback) {
  const value = wx.getStorageSync(key)
  return value && Array.isArray(fallback) === Array.isArray(value) ? value : clone(fallback)
}
function set(key, value) { wx.setStorageSync(key, value); return value }
function uid(prefix) { return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}` }
function two(n) { return `${n}`.padStart(2, '0') }

// ---------- 待上云清单（outbox） ----------
/**
 * 本地改过、还没确认写进云端的条目。
 * 增量同步只看得到「云端这轮变了的文档」，本机独有的新数据它看不见，
 * 所以每次本地写入都先进这份清单，云写成功才划掉。
 * 断网、杀进程都不怕：清单存在本机 storage 里，下次同步接着传。
 */
const COLLECTION_KEYS = { dishes: KEYS.dishes, meal_records: KEYS.records, reminders: KEYS.reminders, daily_checkins: KEYS.checkins }
function getDirty() {
  const value = wx.getStorageSync(KEYS.dirty)
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}
function markDirty(collection, id) {
  if (!collection || !id) return
  const dirty = getDirty()
  const list = Array.isArray(dirty[collection]) ? dirty[collection] : []
  if (!list.includes(id)) {
    list.push(id)
    dirty[collection] = list
    set(KEYS.dirty, dirty)
  }
}
function clearDirty(collection, id) {
  const dirty = getDirty()
  const list = Array.isArray(dirty[collection]) ? dirty[collection] : []
  const next = list.filter(item => item !== id)
  if (next.length !== list.length) {
    if (next.length) dirty[collection] = next
    else delete dirty[collection]
    set(KEYS.dirty, dirty)
  }
}
function findLocalItem(collection, id) {
  const key = COLLECTION_KEYS[collection]
  if (!key) return null
  return get(key, []).find(item => item && item.id === id) || null
}
/**
 * 把清单里的条目补传上云。
 * 先看一眼云端那份：云端更新就听云端的（本地那份已经过时），本地更新才传。
 */
async function flushDirtyUploads() {
  const dirty = getDirty()
  for (const collection of Object.keys(dirty)) {
    for (const id of dirty[collection] || []) {
      const localItem = findLocalItem(collection, id)
      // 本地已经删掉了：云端那条交给墓碑处理，清单可以划掉
      if (!localItem) { clearDirty(collection, id); continue }
      try {
        const existing = await wx.cloud.database().collection(collection).where({ id }).limit(1).get()
        const cloudItem = existing.data[0]
        const localStamp = Number(localItem.updatedAt || 0)
        const cloudStamp = cloudItem ? Number(cloudItem.updatedAt || 0) : 0
        if (cloudItem && cloudStamp >= localStamp) { clearDirty(collection, id); continue }
        await upsertCloud(collection, localItem, COLLECTION_KEYS[collection])
        clearDirty(collection, id)
      } catch (error) {
        console.error(`${collection} 补传失败，留到下次同步`, id, error)
      }
    }
  }
}

// ---------- 云端写队列 ----------
/**
 * 保存类操作一律「本地写完就返回，云端写排进队列慢慢来」。
 * 两个好处：用户不用对着 loading 等 3 次网络往返；并发写被压成串行，
 * 连着保存时不会把云库打出写冲突。
 * 队列里的任务失败不再抛给页面（页面拿到的已经是本地结果），
 * 统一走 onCloudError 回调提示——数据留在本地，下次同步会补传。
 */
let cloudChain = Promise.resolve()
let cloudErrorHandler = null

/** 注册云端写失败的回调（页面用它提示用户），返回取消注册函数 */
function onCloudError(handler) {
  cloudErrorHandler = handler || null
  return () => { if (cloudErrorHandler === handler) cloudErrorHandler = null }
}
function reportCloudError(error, context) {
  console.error(`云端写入失败：${context}`, error)
  if (!cloudErrorHandler) return
  try { cloudErrorHandler(error, context) } catch (e) { console.error('云端错误回调本身出错', e) }
}
/** 把一次云端写排进队列；返回整条队列的 promise（测试 / 退到后台前用来排空） */
function enqueueCloud(context, task) {
  cloudChain = cloudChain.then(async () => {
    try {
      await task()
    } catch (error) {
      reportCloudError(error, context)
    }
  })
  return cloudChain
}
/** 等队列里的写任务全部跑完 */
function flushCloudQueue() { return cloudChain }

/** '9:5' / '09:05' → '09:05'；非法值返回空串 */
function normalizeClock(text) {
  const matched = /^(\d{1,2})\s*:\s*(\d{1,2})$/.exec(String(text || '').trim())
  if (!matched) return ''
  const hour = Number(matched[1])
  const minute = Number(matched[2])
  if (hour > 23 || minute > 59) return ''
  return `${two(hour)}:${two(minute)}`
}

/** 时间戳 → 'HH:mm'，老记录没存 time 时用它兜底 */
function clockFromStamp(stamp) {
  if (!stamp) return ''
  const date = stamp instanceof Date ? stamp : new Date(stamp)
  return isNaN(date.getTime()) ? '' : `${two(date.getHours())}:${two(date.getMinutes())}`
}

/** 这一餐的实际时间文案：优先存下来的 time，老数据退到创建时间 */
function recordClock(record) {
  if (!record) return ''
  return normalizeClock(record.time) || clockFromStamp(record.createdAt)
}
let syncPromise = null

function bootstrap() {
  if (!wx.getStorageSync(KEYS.dishes)) set(KEYS.dishes, seedDishes)
  if (!wx.getStorageSync(KEYS.records)) set(KEYS.records, seedRecords)
  if (!wx.getStorageSync(KEYS.settings)) set(KEYS.settings, DEFAULT_SETTINGS)
  if (!wx.getStorageSync(KEYS.reminders)) set(KEYS.reminders, [])
  if (!wx.getStorageSync(KEYS.checkins)) set(KEYS.checkins, [])
}

function getDishes() { return get(KEYS.dishes, seedDishes) }
function getDish(id) { return getDishes().find(item => item.id === id) }

// ---------- 菜品聚合 ----------
/**
 * 从饮食记录推导出菜品的「吃过次数 / 平均分 / 最近一次」。
 * 以前是保存时做增量平均（(旧均分×旧次数+新分)/(旧次数+1)），
 * 但删除记录、修改评分、换菜这些操作没法反算，一错就永久错。
 * 现在一律按已落盘的记录重算，增删改走同一条路径。
 */
function dishStatsFromRecords(list) {
  const items = Array.isArray(list) ? list : []
  const scored = items.map(item => Number(item && item.score)).filter(value => Number.isFinite(value) && value > 0)
  const dates = items.map(item => item && item.date).filter(Boolean).sort()
  return {
    eatCount: items.length,
    score: scored.length ? Number((scored.reduce((sum, value) => sum + value, 0) / scored.length).toFixed(1)) : 0,
    lastEatDate: dates.length ? dates[dates.length - 1] : ''
  }
}
/** 重算并写回本地某道菜的聚合字段；菜品已删除时返回 null */
function recomputeDish(dishId) {
  if (!dishId) return null
  const dishes = getDishes()
  const index = dishes.findIndex(item => item.id === dishId)
  if (index < 0) return null
  const stats = dishStatsFromRecords(getRecords().filter(item => item.id && item.dishId === dishId))
  const current = dishes[index]
  const changed = current.eatCount !== stats.eatCount || Number(current.score) !== stats.score || current.lastEatDate !== stats.lastEatDate
  // updatedAt 跟着聚合一起走：聚合变了就说明这道菜该重新上云，
  // 增量同步才认得出它变了（recomputeAllDishStats 那条自愈路径刻意不动这个戳）
  const dish = { ...current, ...stats, updatedAt: changed ? Date.now() : (current.updatedAt || Date.now()) }
  dishes[index] = dish
  set(KEYS.dishes, dishes)
  if (changed) markDirty('dishes', dishId)
  return dish
}
/** 聚合回写云端；失败上抛给云写队列统一报错——本地已经算对了，下次保存会重算 */
async function syncDishStats(dish) {
  if (!dish) return
  await upsertCloud('dishes', dish, KEYS.dishes)
}
async function saveDish(input) {
  const dishes = getDishes()
  const now = Date.now()
  let savedDish
  if (input.id) {
    const index = dishes.findIndex(item => item.id === input.id)
    if (index >= 0) {
      dishes[index] = { ...dishes[index], ...input, updatedAt: now }
      savedDish = dishes[index]
    }
  } else {
    savedDish = { score: 0, eatCount: 0, lastEatDate: '', emoji: '🍽️', enableRandom: true, ...input, id: uid('dish'), createdAt: now, updatedAt: now }
    dishes.unshift(savedDish)
  }
  set(KEYS.dishes, dishes)
  if (savedDish) {
    markDirty('dishes', savedDish.id)
    enqueueCloud('保存菜品', async () => {
      // 队列任务永远传「当前最新的本地版本」：排队期间用户可能又改了一遍
      const latest = findLocalItem('dishes', savedDish.id)
      if (!latest) return
      await upsertCloud('dishes', latest, KEYS.dishes)
      clearDirty('dishes', latest.id)
    })
  }
  return savedDish
}
async function deleteDish(id) {
  const dish = getDish(id)
  set(KEYS.dishes, getDishes().filter(item => item.id !== id))
  if (dish) scheduleCloudDelete('dishes', dish, '删除菜品')
}

// ---------- 首页当前显示的那道菜 ----------
/**
 * 只存本机，不参与云同步：这是「这台手机上首页正显示哪道菜」的界面状态，
 * 不是业务数据。以前每次 onShow 都重抽，用户选好了切个 tab 回来就变，
 * 现在把落定的结果记住，只有点「帮我选一个」或这道菜失效时才换。
 */
function getHomePick() {
  const value = wx.getStorageSync(KEYS.homePick)
  return typeof value === 'string' ? value : ''
}
function saveHomePick(dishId) {
  if (!dishId) return ''
  return set(KEYS.homePick, String(dishId))
}

function getRecords() { return get(KEYS.records, seedRecords).sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`)) }
function getRecord(id) { return getRecords().find(item => item.id === id) || null }
/**
 * 保存一餐。带 id 视为编辑（原地更新，保留 createdAt），否则新增。
 * 写完记录后重算涉及到的菜品：编辑时如果换了菜，前后两道菜都要回算。
 */
async function saveRecord(input) {
  const data = input || {}
  const records = getRecords()
  const now = Date.now()
  const index = data.id ? records.findIndex(item => item.id === data.id) : -1
  const previous = index >= 0 ? records[index] : null
  const score = Number(data.score)
  const record = {
    ...(previous || {}),
    ...data,
    id: previous ? previous.id : uid('record'),
    mealType: data.mealType || (previous && previous.mealType) || '午餐',
    status: data.status || (previous && previous.status) || '',
    remark: data.remark === undefined ? ((previous && previous.remark) || '') : String(data.remark),
    // 记一餐的具体时间：新数据用表单选的，老记录退回 createdAt，保证列表里都有时间可看
    time: normalizeClock(data.time) || (previous && normalizeClock(previous.time)) || recordClock(previous) || clockFromStamp(now),
    createdAt: previous ? (previous.createdAt || now) : now,
    updatedAt: now,
    score: Number.isFinite(score) ? score : Number(previous && previous.score) || 0
  }
  if (previous) records[index] = record
  else records.unshift(record)
  set(KEYS.records, records)

  // 先把涉及菜的聚合在本地重算好，再去写云。
  // 顺序不能反：upsertCloud 一抛错（离线 / 集合没建好），后面的重算就被整个跳过——
  // 记录明明记下了，首页却还显示「还没吃过」。
  const touched = [...new Set([record.dishId, previous && previous.dishId].filter(Boolean))]
  for (const dishId of touched) recomputeDish(dishId)
  markDirty('meal_records', record.id)

  enqueueCloud('保存记录', async () => {
    // 传最新的本地版本，避免排队期间被改过的那一版被旧数据盖回去
    const latest = findLocalItem('meal_records', record.id)
    if (!latest) return
    await upsertCloud('meal_records', latest, KEYS.records)
    clearDirty('meal_records', latest.id)
    for (const dishId of touched) await syncDishStats(findLocalItem('dishes', dishId))
  })
  return record
}
async function deleteRecord(id) {
  const records = getRecords()
  const record = records.find(item => item.id === id)
  if (!record) return
  set(KEYS.records, records.filter(item => item.id !== id))
  // 本地先把聚合回滚，免得云同步失败时统计还挂着已删记录
  const dish = record.dishId ? recomputeDish(record.dishId) : null
  scheduleCloudDelete('meal_records', record, '删除记录')
  enqueueCloud('回写菜品聚合', async () => {
    if (dish) await syncDishStats(dish)
  })
}

// ---------- 每日签到 ----------
const CHECKIN_COLLECTION = 'daily_checkins'

function getCheckins() {
  return get(KEYS.checkins, []).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.updatedAt || 0) - (a.updatedAt || 0))
}
function getCheckinByDate(date) {
  if (!date) return null
  return getCheckins().find(item => item.date === date) || null
}
/**
 * 保存签到，一天只保留一条：
 * 传了 id 视为编辑（允许改日期），否则按日期判断是覆盖已有签到还是新增。
 */
async function saveCheckin(input) {
  const list = getCheckins()
  const now = Date.now()
  const byId = input.id ? list.findIndex(item => item.id === input.id) : -1
  const byDate = input.date ? list.findIndex(item => item.date === input.date) : -1
  const index = byId >= 0 ? byId : byDate
  let saved
  if (index >= 0) {
    list[index] = { ...list[index], ...input, updatedAt: now }
    saved = list[index]
  } else {
    saved = { ...input, id: uid('checkin'), createdAt: now, updatedAt: now }
    list.unshift(saved)
  }
  // 改日期后撞上另一条同日期签到：以当前这次编辑为准，移除被撞的那条
  const duplicates = list.filter(item => item.id !== saved.id && item.date === saved.date)
  set(KEYS.checkins, duplicates.length ? list.filter(item => item.id === saved.id || item.date !== saved.date) : list)
  if (saved) {
    markDirty(CHECKIN_COLLECTION, saved.id)
    enqueueCloud('保存签到', async () => {
      const latest = findLocalItem(CHECKIN_COLLECTION, saved.id)
      if (!latest) return
      await upsertCloud(CHECKIN_COLLECTION, latest, KEYS.checkins)
      clearDirty(CHECKIN_COLLECTION, latest.id)
    })
  }
  for (const item of duplicates) scheduleCloudDelete(CHECKIN_COLLECTION, item, '清理重复签到')
  return saved
}
async function deleteCheckin(id) {
  const checkin = getCheckins().find(item => item.id === id)
  set(KEYS.checkins, getCheckins().filter(item => item.id !== id))
  if (checkin) scheduleCloudDelete(CHECKIN_COLLECTION, checkin, '删除签到')
}
function getReminders() {
  return get(KEYS.reminders, []).sort((a, b) => {
    if (Boolean(a.enabled !== false) !== Boolean(b.enabled !== false)) return a.enabled === false ? 1 : -1
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
  })
}
function getReminder(id) { return getReminders().find(item => item.id === id) }
async function saveReminder(input) {
  const reminders = getReminders()
  const now = Date.now()
  let saved
  if (input.id) {
    const index = reminders.findIndex(item => item.id === input.id)
    if (index >= 0) {
      reminders[index] = { ...reminders[index], ...input, updatedAt: now }
      saved = reminders[index]
    }
  } else {
    saved = {
      enabled: true,
      repeat: 'none',
      calendar: 'solar',
      advanceDays: [0],
      time: '09:00',
      lastPushed: '',
      ...input,
      id: uid('reminder'),
      createdAt: now,
      updatedAt: now
    }
    reminders.unshift(saved)
  }
  set(KEYS.reminders, reminders)
  if (saved) {
    markDirty('reminders', saved.id)
    enqueueCloud('保存提醒', async () => {
      const latest = findLocalItem('reminders', saved.id)
      if (!latest) return
      await upsertCloud('reminders', latest, KEYS.reminders)
      clearDirty('reminders', latest.id)
    })
  }
  return saved
}
async function deleteReminder(id) {
  const reminder = getReminder(id)
  set(KEYS.reminders, getReminders().filter(item => item.id !== id))
  if (reminder) scheduleCloudDelete('reminders', reminder, '删除提醒')
}
async function toggleReminder(id, enabled) { return saveReminder({ id, enabled }) }
// ---------- 推送额度记账 ----------
/** 攒着还没记到云端的额度增量（订阅授权成功的那一刻恰好离线） */
function getQuotaPending() {
  const value = Number(wx.getStorageSync(KEYS.quotaPending))
  return Number.isFinite(value) ? value : 0
}
function addQuotaPending(delta) {
  set(KEYS.quotaPending, getQuotaPending() + delta)
}
/** 把攒下的额度增量原子地补记到云端（command.inc），成功才清零 */
async function flushQuotaPending() {
  const pending = getQuotaPending()
  if (!pending || !cloudEnabled()) return
  const db = wx.cloud.database()
  const command = db.command
  const { doc } = await readSettingsDoc()
  if (doc) {
    await db.collection('user_settings').doc(doc._id).update({ data: { pushQuota: command.inc(pending) } })
  } else {
    await db.collection('user_settings').add({ data: { pushQuota: Math.max(0, pending), initialized: true, updatedAt: Date.now() } })
  }
  set(KEYS.quotaPending, 0)
}
/**
 * 用户完成一次订阅授权后累加推送额度。
 * 微信一次性订阅「授权一次 = 可推送一条」，云函数推送成功后会递减云端额度。
 * 云端一律走原子自增（command.inc），绝不把本地值整份写回——
 * 整份写回会连云函数已经扣掉的份额一起盖回去，额度虚高，真推送时才报 43101。
 * 当时离线记不上就把增量攒在本地，下次同步先补记再拉取。
 */
async function addPushQuota(step) {
  const raw = step === undefined ? 1 : Number(step)
  const delta = Number.isFinite(raw) && raw !== 0 ? raw : 1
  const settings = getSettings()
  const value = normalizeSettings({ ...settings, pushQuota: Math.max(0, Number(settings.pushQuota || 0) + delta) })
  set(KEYS.settings, value)
  addQuotaPending(delta)
  enqueueCloud('额度记账', () => flushQuotaPending())
  return value
}
/**
 * 今日待提醒数量，用于「我的」页面角标。
 * 纪念日默认只在日历上标个日子，不算进来；开了「到期提醒」的才算。
 */
function countTodayReminders(dateText) {
  const todayText = dateText || reminderLib.today()
  return getReminders()
    .filter(item => !reminderLib.isAnniversary(item) || reminderLib.anniversaryNotify(item))
    .filter(item => item.enabled !== false && reminderLib.isTriggerOn(item, todayText)).length
}

// 云端文档里的库层字段，落回本地时剥掉
const CLOUD_META_KEYS = ['_id', '_openid', 'initialized', 'updatedAt', 'createdAt']
/**
 * 设置项归一化：以 DEFAULT_SETTINGS 的键与类型为准，其余字段原样保留。
 * 早先 pullCloudData 里手写了 6 个字段的白名单，云端文档少一个字段就落成 0 / 空串
 * （recentDays 变 0 等于「不再避开最近吃过的」）。改成按默认值推导后，
 * 新增设置项只需要动 DEFAULT_SETTINGS 这一处。
 */
function normalizeSettings(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const result = {}
  Object.keys(raw).forEach(key => {
    if (!CLOUD_META_KEYS.includes(key)) result[key] = raw[key]
  })
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    const fallback = DEFAULT_SETTINGS[key]
    const value = raw[key]
    const empty = value === undefined || value === null || value === ''
    if (typeof fallback === 'number') {
      const num = Number(value)
      result[key] = empty || !Number.isFinite(num) ? fallback : num
    } else if (typeof fallback === 'boolean') {
      result[key] = empty ? fallback : Boolean(value)
    } else {
      result[key] = typeof value === 'string' ? value : fallback
    }
  })
  // 「过滤最近几天吃过」最小就是 1 天，0 那一档已经去掉了：老数据里存过 0（等于不过滤），
  // 读的时候统一抬到 1，否则首页会显示「已自动避开最近 0 天吃过的菜」。
  result.recentDays = Math.max(1, result.recentDays)
  // updatedAt 是同步用的版本戳（本地与云端比新旧、决定设置听谁的），跟着设置一起存取；
  // 注意改设置才换戳，加推送额度不换——额度不参与设置冲突，一律以云端记账为准。
  const stamp = Number(raw.updatedAt)
  result.updatedAt = Number.isFinite(stamp) && stamp > 0 ? stamp : 0
  return result
}

function getSettings() { return normalizeSettings(get(KEYS.settings, DEFAULT_SETTINGS)) }
/**
 * 云端设置项只应该有一份。
 * 历史上留下过重复文档（两端各 add 过一次），额度会记到不同文档上——
 * 本机看着有额度、云端那份却是 0，推送时才报 43101。
 * 所以统一按「updatedAt 最新的那份」为准，顺手把多余的清掉。
 */
async function readSettingsDoc() {
  const result = await wx.cloud.database().collection('user_settings').limit(10).get()
  const list = (result.data || []).slice().sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
  return { doc: list[0] || null, extras: list.slice(1) }
}
async function saveSettings(settings) {
  const now = Date.now()
  const value = normalizeSettings({ ...getSettings(), ...settings })
  value.updatedAt = now
  set(KEYS.settings, value)
  if (!cloudEnabled()) return value
  enqueueCloud('保存设置', async () => {
    const db = wx.cloud.database()
    const { doc, extras } = await readSettingsDoc()
    const data = cloudData(value)
    // pushQuota 不随整份设置写回云端：它由云函数扣减、addPushQuota 原子自增，
    // 整份覆盖会把云端已扣掉的额度又盖回去（本地看着还有额度，真推送才报 43101）
    delete data.pushQuota
    data.initialized = true
    data.updatedAt = now
    if (doc) await db.collection('user_settings').doc(doc._id).update({ data })
    else await db.collection('user_settings').add({ data })
    for (const extra of extras) {
      await db.collection('user_settings').doc(extra._id).remove().catch(error => console.error('清理重复设置文档失败', error))
    }
  })
  return value
}

function cloudEnabled() { return Boolean(wx.cloud && wx.cloud.database) }

// 云开发常见错误码 → 可操作的排查提示
// 集合相关的提示按实际集合名生成，避免「签到集合缺失却提示 reminders」这类误导。
const CLOUD_ERROR_HINTS = {
  '-502005': name => name
    ? `云数据库还没有 ${name} 集合。请到云开发控制台 → 数据库 → 新建集合 ${name}，权限选「仅创建者可读写」`
    : '云数据库集合还不存在。请到云开发控制台 → 数据库 → 新建缺少的集合，权限选「仅创建者可读写」',
  '-502003': name => name
    ? `数据库权限不足。请把 ${name} 集合的权限改为「仅创建者可读写」`
    : '数据库权限不足。请把对应集合的权限改为「仅创建者可读写」',
  '-502002': () => '数据库请求被拒绝，请确认集合权限与安全规则没有拦截写入',
  '-502001': () => '云数据库请求失败，请稍后重试',
  '-501000': () => '云开发环境未初始化，请确认 app.js 中 wx.cloud.init 的 env 与云开发控制台一致',
  '-501001': () => '云开发环境不存在或已被删除，请核对 app.js 中的 env',
  '-40101': () => '云开发调用凭证失效，请重新编译小程序后重试'
}
/**
 * 把云开发异常翻译成用户能照着做的提示。
 * collectionName 可省略，省略时优先取 error.collectionName（由 upsertCloud / removeCloud 自动挂上）。
 */
function describeCloudError(error, collectionName) {
  const raw = (error && (error.errMsg || error.message)) || ''
  const code = String(error && (error.errCode !== undefined ? error.errCode : error.code) || '')
  const hint = CLOUD_ERROR_HINTS[code]
  if (hint) return hint(collectionName || (error && error.collectionName) || '')
  if (code) return `云同步失败（错误码 ${code}）：${raw}`
  return raw ? `云同步失败：${raw}` : '云同步失败，请检查网络与云开发配置'
}
/** 给云开发异常补上集合名，页面的 describeCloudError 就能给出准确提示 */
function tagCollection(error, collectionName) {
  if (error && !error.collectionName) error.collectionName = collectionName
  return error
}
/** 云环境自检：集合缺失或权限不对时返回可读的修复提示 */
async function checkCloudReady(names) {
  if (!cloudEnabled()) return { ok: false, message: '未启用云开发，数据只保存在本机' }
  // 默认把五个集合都过一遍：以前只查 reminders，dishes 集合没建时照样报「一切正常」
  const targets = Array.isArray(names) && names.length ? names : ['dishes', 'meal_records', 'reminders', CHECKIN_COLLECTION, 'user_settings']
  for (const name of targets) {
    try {
      await wx.cloud.database().collection(name).limit(1).get()
    } catch (error) {
      console.error(`云环境自检未通过：${name} 集合`, error)
      return { ok: false, message: describeCloudError(error, name) }
    }
  }
  return { ok: true, message: '' }
}

// ---------- 异常上报 ----------
const ERROR_LOG_LIMIT = 20
/**
 * 记一条异常：本地留档 + 尽力上报云端。
 * 以前前端只有 console.error，线上白屏只能等用户截图；
 * 现在未捕获异常和 Promise 拒绝都会留一条，能查。
 */
function logError(kind, detail) {
  const raw = detail && (detail.message || detail.errMsg) ? (detail.message || detail.errMsg) : String(detail || '')
  const message = String(raw).slice(0, 300)
  console.error(`[${kind}] ${message}`, detail)
  const list = get('wte_error_log_v1', [])
  list.unshift({ kind: String(kind || 'error'), message, at: Date.now() })
  set('wte_error_log_v1', list.slice(0, ERROR_LOG_LIMIT))
  if (!cloudEnabled()) return
  try {
    wx.cloud.database().collection('error_logs').add({
      data: { kind: String(kind || 'error'), message, at: Date.now() }
    }).catch(error => console.error('异常上报失败', error))
  } catch (error) {
    console.error('异常上报失败', error)
  }
}
function cloudData(item) {
  const data = clone(item)
  delete data._id
  delete data._openid
  delete data.cloudId
  return data
}
function localData(item) {
  const data = clone(item)
  data.cloudId = data._id
  delete data._id
  delete data._openid
  return data
}
async function queryAll(name) {
  const collection = wx.cloud.database().collection(name)
  const all = []
  const pageSize = 20
  let page = 0
  while (true) {
    const result = await collection.skip(page * pageSize).limit(pageSize).get()
    all.push(...result.data)
    if (result.data.length < pageSize) break
    page += 1
  }
  return all
}
/**
 * 增量拉取：只要 updatedAt 大于等于水位的文档。
 * 用 >= 而不是 >：同一毫秒里写的数据也不会漏（多拉一条只是重复更新，幂等）。
 */
async function querySince(name, stamp) {
  const db = wx.cloud.database()
  const collection = db.collection(name)
  const command = db.command
  const all = []
  const pageSize = 20
  let page = 0
  while (true) {
    const result = await collection.where({ updatedAt: command.gte(stamp) }).skip(page * pageSize).limit(pageSize).get()
    all.push(...result.data)
    if (result.data.length < pageSize) break
    page += 1
  }
  return all
}
/** 一批文档里最大的 updatedAt */
function maxStamp(list) {
  return (list || []).reduce((max, item) => Math.max(max, Number(item && item.updatedAt) || 0), 0)
}
async function upsertCloud(collectionName, item, localKey) {
  if (!cloudEnabled()) return item
  try {
    return await upsertCloudRaw(collectionName, item, localKey)
  } catch (error) {
    throw tagCollection(error, collectionName)
  }
}
async function upsertCloudRaw(collectionName, item, localKey) {
  const collection = wx.cloud.database().collection(collectionName)
  const data = cloudData(item)
  let cloudId = item.cloudId
  if (!cloudId) {
    const existing = await collection.where({ id: item.id }).limit(1).get()
    cloudId = existing.data.length ? existing.data[0]._id : ''
  }
  if (cloudId) await collection.doc(cloudId).update({ data })
  else {
    const result = await collection.add({ data })
    cloudId = result._id
  }
  const list = get(localKey, [])
  const index = list.findIndex(value => value.id === item.id)
  if (index >= 0) {
    list[index].cloudId = cloudId
    set(localKey, list)
  }
  item.cloudId = cloudId
  return item
}
async function removeCloud(collectionName, item) {
  if (!cloudEnabled()) return
  try {
    return await removeCloudRaw(collectionName, item)
  } catch (error) {
    throw tagCollection(error, collectionName)
  }
}
async function removeCloudRaw(collectionName, item) {
  const collection = wx.cloud.database().collection(collectionName)
  if (item.cloudId) return collection.doc(item.cloudId).remove()
  const existing = await collection.where({ id: item.id }).limit(1).get()
  if (existing.data.length) await collection.doc(existing.data[0]._id).remove()
}

// ---------- 删除墓碑 ----------
/**
 * 本机已删、云端还没删掉的条目；同步时先按这份名单清云端，再拉数据。
 * 墓碑在「本地删除那一刻」就记下（而不是云写失败时），这样同步流程
 * 不会跟排队中的云写抢先后——否则刚删的记录会被拉回来复活。
 */
function getTombstones() {
  const value = wx.getStorageSync(KEYS.tombstones)
  return Array.isArray(value) ? value : []
}
function addTombstone(collectionName, item) {
  if (!item || !item.id) return
  const list = getTombstones()
  const exists = list.some(entry => entry.collection === collectionName && entry.id === item.id)
  if (!exists) {
    list.push({ collection: collectionName, id: item.id, cloudId: item.cloudId || '', at: Date.now() })
    set(KEYS.tombstones, list)
  }
}
function removeTombstone(collectionName, id) {
  const list = getTombstones()
  const next = list.filter(entry => !(entry.collection === collectionName && entry.id === id))
  if (next.length !== list.length) set(KEYS.tombstones, next)
}
/** 把墓碑逐条落到云端（删掉对应文档）；删不掉的留在名单里下次再试 */
async function applyTombstones() {
  const list = getTombstones()
  if (!list.length) return
  const remaining = []
  for (const entry of list) {
    try {
      await removeCloudRaw(entry.collection, { id: entry.id, cloudId: entry.cloudId })
      removeTombstone(entry.collection, entry.id)
    } catch (error) {
      console.error('墓碑对应的云端文档删除失败，下次同步再试', entry, error)
      remaining.push(entry)
    }
  }
  if (remaining.length !== list.length) set(KEYS.tombstones, remaining)
}
/** 删除一条数据：本地先删、记墓碑，云端删除排进队列，成功后摘掉墓碑 */
function scheduleCloudDelete(collectionName, item, context) {
  if (!item || !item.id) return
  addTombstone(collectionName, item)
  enqueueCloud(context, async () => {
    await removeCloud(collectionName, item)
    removeTombstone(collectionName, item.id)
  })
}
async function migrateLocalToCloud() {
  const dishes = getDishes()
  const records = getRecords()
  for (const dish of dishes) await upsertCloud('dishes', dish, KEYS.dishes)
  for (const record of records) await upsertCloud('meal_records', record, KEYS.records)
  // reminders 集合可能尚未在云开发控制台创建，失败时保留本地数据即可
  try {
    for (const reminder of getReminders()) await upsertCloud('reminders', reminder, KEYS.reminders)
  } catch (error) {
    console.error('提醒数据上云失败，请确认已创建 reminders 集合', error)
  }
  // daily_checkins 集合可能尚未创建，失败时保留本地签到即可
  try {
    for (const checkin of getCheckins()) await upsertCloud(CHECKIN_COLLECTION, checkin, KEYS.checkins)
  } catch (error) {
    console.error('签到数据上云失败，请确认已创建 daily_checkins 集合', error)
  }
  await saveSettings(getSettings())
}
/**
 * 增量结果合并：云端这次只返回「变过的文档」。
 * 本地没被提到的条目一律保留（它们只是这轮没变），
 * 不能当成「云端没有」去补传或删掉——这是增量同步和全量合并最大的区别。
 */
function mergeIncremental(key, cloudList) {
  const local = get(key, [])
  const result = local.slice()
  const index = new Map()
  local.forEach((item, i) => { if (item && item.id) index.set(item.id, i) })
  const newer = []
  cloudList.forEach(cloud => {
    if (!cloud || !cloud.id) return
    const at = index.get(cloud.id)
    if (at === undefined) { result.push(cloud); return }
    const localItem = result[at]
    const cloudStamp = Number(cloud.updatedAt || 0)
    const localStamp = Number(localItem.updatedAt || 0)
    if (cloudStamp > localStamp) result[at] = cloud
    else if (localStamp > cloudStamp) newer.push(localItem)
  })
  return { result, newer }
}

/**
 * 拉一个集合：第一次全量，之后按 updatedAt 增量。
 * 全量走 mergeLocalOnly（云端没有的本地条目补传上去），
 * 增量走 mergeIncremental（只处理这轮变过的，剩下的本地条目原样留着）。
 */
async function pullCollection(name, key, options) {
  const opts = options || {}
  const stamp = getSyncStamp(name)
  if (!stamp) {
    const cloudList = await queryAll(name)
    const merged = await mergeLocalOnly(name, key, cloudList.map(localData), opts.dedupeKey)
    set(key, merged)
    setSyncStamp(name, maxStamp(cloudList))
    return
  }
  const cloudList = await querySince(name, stamp)
  const { result, newer } = mergeIncremental(key, cloudList.map(localData))
  for (const item of newer) {
    try {
      await upsertCloud(name, item, key)
    } catch (error) {
      console.error(`${name} 补传失败，先留在本机`, error)
    }
  }
  set(key, result)
  setSyncStamp(name, maxStamp(cloudList))
}

/** 每个集合的增量水位：只拉 updatedAt 比水位新的文档 */
function getSyncStamps() {
  const value = wx.getStorageSync(KEYS.syncStamps)
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}
function getSyncStamp(name) {
  const stamp = Number(getSyncStamps()[name])
  return Number.isFinite(stamp) && stamp > 0 ? stamp : 0
}
function setSyncStamp(name, stamp) {
  const stamps = getSyncStamps()
  stamps[name] = Math.max(Number(stamps[name] || 0), Number(stamp) || 0)
  set(KEYS.syncStamps, stamps)
}

/**
 * 云端拉取后与本地合并，两条规则：
 *   1. 云端没有的本地条目 → 补传（集合没建好期间存的数据不能被空云端覆盖）
 *   2. 两边都有的同一条 → updatedAt 新的赢，本地新的补传覆盖云端。
 *      以前只比 id：云端有同 id 就直接采纳云端那份，离线改过的评分 / 备注
 *      会在下一次同步被云端旧值静默回滚。
 * dedupeKey 用于按业务唯一键兜底去重（例如签到按 date 一天一条），本地为准。
 */
async function mergeLocalOnly(collectionName, key, cloudList, dedupeKey) {
  const byId = new Map()
  cloudList.forEach(item => { if (item && item.id) byId.set(item.id, item) })
  const push = []
  get(key, []).forEach(item => {
    if (!item || !item.id) return
    const cloud = byId.get(item.id)
    if (!cloud) {
      if (dedupeKey) {
        const value = item[dedupeKey]
        // 本地独有条目撞上云端的业务键（如同一天的签到）→ 视为重复，不再补传
        if (value && cloudList.some(other => other && other[dedupeKey] === value)) return
      }
      push.push(item)
      return
    }
    if (Number(item.updatedAt || 0) > Number(cloud.updatedAt || 0)) push.push(item)
  })
  for (const item of push) {
    try {
      byId.set(item.id, await upsertCloud(collectionName, item, key))
    } catch (error) {
      console.error(`${collectionName} 补传失败，先留在本机`, error)
      // 补传失败也用本地这份占住这个 id，避免云端旧版和本地新版在列表里同时出现
      byId.set(item.id, item)
    }
  }
  return [...byId.values()]
}
/**
 * 五个集合并行拉取，再把结果逐个合并回本地。
 * 以前是顺序 await，切一次 tab 要排 8~15 次网络往返，这就是切 tab 卡顿的来源。
 * mergeLocalOnly 仍然串行（它可能要往云端补传本地独有条目），但网络等待已经从「累加」变成「取最大值」。
 */
/**
 * 按本地记录重算所有菜品的聚合字段。
 * 聚合是派生数据，云端文档里存的只是上一次写回的结果——换设备、旧版本客户端、
 * 或删除记录时云同步失败，都会让云端那份变旧。所以每次拉完数据都本地自愈一次，
 * 只纠正本机、不反写云端，避免同步时反复抖动。
 */
function recomputeAllDishStats() {
  const dishes = getDishes()
  const byDish = {}
  getRecords().forEach(item => {
    if (!item || !item.dishId) return
    if (!byDish[item.dishId]) byDish[item.dishId] = []
    byDish[item.dishId].push(item)
  })
  let changed = false
  const next = dishes.map(dish => {
    const stats = dishStatsFromRecords(byDish[dish.id] || [])
    if (dish.eatCount === stats.eatCount && Number(dish.score) === stats.score && dish.lastEatDate === stats.lastEatDate) return dish
    changed = true
    return { ...dish, ...stats }
  })
  if (changed) set(KEYS.dishes, next)
}
async function pullCloudData(settingsDocument) {
  // 四个集合并行拉；dishes / meal_records 是核心集合，拉不到就整体失败，让调用方走本地降级
  const [dishesResult, recordsResult, remindersResult, checkinsResult] = await Promise.allSettled([
    pullCollection('dishes', KEYS.dishes),
    pullCollection('meal_records', KEYS.records),
    pullCollection('reminders', KEYS.reminders),
    pullCollection(CHECKIN_COLLECTION, KEYS.checkins, { dedupeKey: 'date' })
  ])
  if (dishesResult.status === 'rejected') throw dishesResult.reason
  if (recordsResult.status === 'rejected') throw recordsResult.reason
  recomputeAllDishStats()
  if (remindersResult.status === 'rejected') {
    console.error('提醒数据拉取失败，继续使用本地缓存', remindersResult.reason)
  }
  if (checkinsResult.status === 'rejected') {
    console.error('签到数据拉取失败，继续使用本地缓存', checkinsResult.reason)
  }
  // 设置冲突：updatedAt 新的赢——离线改过的设置不能被云端旧值盖回去。
  // 本地较新时顺手把这份补传上云，云端才不会一直停在旧版本。
  // pushQuota 是唯一例外：一律以云端为准，那边才是记账方，本地这份只是展示缓存。
  const cloudDoc = settingsDocument || {}
  const cloudStamp = Number(cloudDoc.updatedAt) || 0
  const localSettings = getSettings()
  if (Number(localSettings.updatedAt || 0) > cloudStamp) {
    try {
      await saveSettings(localSettings)
    } catch (error) {
      console.error('本地设置补传失败，下次同步会再试', error)
    }
  } else {
    set(KEYS.settings, normalizeSettings(cloudDoc))
  }
}
/** 两次全量同步之间的最小间隔；页面切来切去不必每次都拉一遍云 */
const SYNC_THROTTLE_MS = 20 * 1000
let lastSyncAt = 0
/**
 * 拉取云端数据并合并到本地。
 * @param {{force?: boolean}} options force=true 时忽略节流窗口（手动刷新用）
 * @returns {Promise<boolean>} 真的跑了同步返回 true；被节流/未启用云开发返回 false
 */
async function syncFromCloud(options) {
  if (!cloudEnabled()) return false
  if (syncPromise) return syncPromise
  const force = Boolean(options && options.force)
  if (!force && lastSyncAt && Date.now() - lastSyncAt < SYNC_THROTTLE_MS) return false
  syncPromise = (async () => {
    // 顺序不能反：先补传本地独有条目 → 再清墓碑 → 再补记账 → 最后拉数据。
    // 反了的话，本机新记的数据拉不回来（增量只看得到云端变过的），
    // 刚删的记录会被复活，刚攒的额度会被云端旧值盖掉。
    await flushDirtyUploads()
    await applyTombstones()
    await flushQuotaPending().catch(error => console.error('补记推送额度失败，下次同步再试', error))
    // 设置文档可能存在历史重复，统一取 updatedAt 最新的那份
    const { doc } = await readSettingsDoc()
    if (!doc) await migrateLocalToCloud()
    else await pullCloudData(doc)
    lastSyncAt = Date.now()
    return true
  })()
  try { return await syncPromise } finally { syncPromise = null }
}

module.exports = { CATEGORIES, TAGS, MEALS, EAT_TYPES, PRICES, PRICE_RANGES, bootstrap, syncFromCloud, getDishes, getDish, saveDish, deleteDish, getHomePick, saveHomePick, getRecords, getRecord, saveRecord, deleteRecord, normalizeClock, clockFromStamp, recordClock, getCheckins, getCheckinByDate, saveCheckin, deleteCheckin, getReminders, getReminder, saveReminder, deleteReminder, toggleReminder, addPushQuota, countTodayReminders, describeCloudError, checkCloudReady, getSettings, saveSettings, onCloudError, flushCloudQueue, logError }
