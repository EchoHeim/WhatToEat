const reminderLib = require('./reminder')

const KEYS = {
  dishes: 'wte_dishes_v1',
  /**
   * 旧版单键全量记录。小程序单个 storage key 上限 1MB，
   * 一条记录约 340~480 字节，2500 条上下就会写不进去（setStorageSync 直接抛异常）。
   * 现在按年分片存（wte_records_2026_v1），这个键只在启动迁移时读一次，搬完即删。
   */
  records: 'wte_records_v1',
  /** 分片索引：存着「本地有哪几年的记录」，如 ['2025','2026'] */
  recordsYears: 'wte_records_years_v1',
  /** 分片前缀，拼上年份与后缀才是完整 key */
  recordsPrefix: 'wte_records_',
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
/**
 * 默认「允许近期重复」是开着的。
 * 硬过滤掉最近吃过的菜太激进：早餐的包子、午饭的食堂这种天天吃的东西会被直接排除，
 * 候选池反而越筛越窄，抽出来的都是「很久没吃但其实不想吃」的菜。
 * 现在重复不再等于硬性排除，而是权重降一档（最近 N 天内吃过的 ×0.25）——
 * 连着抽到同一道的概率很低，常吃的那几道也不会被藏起来。
 * 注意：这里改的只是「新装 / 没存过设置」时的默认值，已有用户的设置不会被覆盖。
 */
const DEFAULT_SETTINGS = { recentDays: 7, allowRepeat: true, defaultMeal: '午餐', nickname: '微信用户', avatarFileId: '', pushQuota: 0 }

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
/** 删一个 storage 键；测试环境的 wx 桩可能没有这个方法，缺了就静默跳过 */
function removeKey(key) {
  if (typeof wx.removeStorageSync !== 'function') return false
  try { wx.removeStorageSync(key); return true } catch (error) { console.error(`清掉 ${key} 失败`, error); return false }
}
function uid(prefix) { return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}` }
function two(n) { return `${n}`.padStart(2, '0') }

// ---------- 记录分片（按年） ----------
/**
 * 为什么要按年切：单个 storage key 上限 1MB，记录全塞一个键里，
 * 每天两餐大约三年就会写满，写满后 setStorageSync 抛异常、页面提示「保存失败」——
 * 但重试多少次都没用，原因不是网络。切年之后单个分片最多一年的量，离上限很远。
 *
 * 代价是读一次要遍历几个键：一年一个，正常也就 2~4 个，可忽略。
 */
/** 某一年的分片 key */
function recordsKey(year) { return `${KEYS.recordsPrefix}${year}_v1` }

/** 本地有哪几年的分片（升序）；索引缺失时算作没有 */
function getRecordYears() {
  const list = get(KEYS.recordsYears, [])
  return Array.isArray(list) ? list.filter(year => /^\d{4}$/.test(String(year))).map(String).sort() : []
}

/** 一条记录属于哪一年：优先按 date，缺 date 时退回时间戳 */
function recordYear(record) {
  const date = String((record && record.date) || '')
  if (/^\d{4}-\d{2}/.test(date)) return date.slice(0, 4)
  const stamp = Number((record && (record.createdAt || record.updatedAt)) || 0)
  if (stamp > 0) {
    const year = new Date(stamp).getFullYear()
    if (year > 1970) return String(year)
  }
  return String(new Date().getFullYear())
}

/** 读出所有分片（不排序） */
function readRecordShards() {
  const years = getRecordYears()
  if (!years.length) return []
  let all = []
  for (const year of years) {
    const list = get(recordsKey(year), [])
    if (list.length) all = all.concat(list)
  }
  return all
}

/**
 * 按年份重新分桶写入。
 * 不做「增量改一条」，因为改日期会让记录跨年——重新分桶是最不容易出错的做法，
 * 一次涉及几百条，本地写几次 storage 远比修 bug 便宜。
 */
function writeRecordShards(list) {
  const buckets = {}
  ;(list || []).forEach(item => {
    if (!item || !item.id) return
    const year = recordYear(item)
    if (!buckets[year]) buckets[year] = []
    buckets[year].push(item)
  })
  const years = Object.keys(buckets).sort()
  for (const year of years) {
    try {
      set(recordsKey(year), buckets[year])
    } catch (error) {
      // 单年写不进去只剩一种可能：这一年记了太多条（2500+）。
      // 抛给调用方，让页面如实提示「去导出备份」，别让它以为重试就能好。
      console.error(`记录分片 ${year} 写入失败`, error)
      const wrapped = new Error(`记录分片 ${year} 写入失败：${(error && (error.errMsg || error.message)) || 'storage 写入异常'}`)
      wrapped.storageFull = true
      wrapped.year = year
      throw wrapped
    }
  }
  // 整年记录被删空的，把那个分片也清掉，别留一份死数据占着 storage
  for (const year of getRecordYears()) {
    if (!buckets[year]) removeKey(recordsKey(year))
  }
  set(KEYS.recordsYears, years)
}

/**
 * 旧版单键 → 按年分片。启动时跑，幂等。
 * 顺序是「先写分片、再删旧键」：中途失败旧数据还在，下次启动重来一遍，不会丢。
 */
function migrateRecordShards() {
  const legacyRaw = wx.getStorageSync(KEYS.records)
  const legacy = Array.isArray(legacyRaw) ? legacyRaw : []
  if (!legacy.length) {
    if (legacyRaw !== undefined) removeKey(KEYS.records)
    if (!getRecordYears().length) set(KEYS.recordsYears, [])
    return
  }
  // 理论上只有第一次会进来；万一上次迁到一半（分片已写、旧键没删），按 updatedAt 取新的那份
  const merged = new Map()
  readRecordShards().forEach(item => { if (item && item.id) merged.set(item.id, item) })
  legacy.forEach(item => {
    if (!item || !item.id) return
    const exists = merged.get(item.id)
    if (!exists || Number(item.updatedAt || 0) > Number(exists.updatedAt || 0)) merged.set(item.id, item)
  })
  try {
    writeRecordShards([...merged.values()])
  } catch (error) {
    console.error('记录分片迁移未完成，旧数据保留在原键里，下次启动再试', error)
    return
  }
  removeKey(KEYS.records)
}

// ---------- 待上云清单（outbox） ----------
/**
 * 本地改过、还没确认写进云端的条目。
 * 增量同步只看得到「云端这轮变了的文档」，本机独有的新数据它看不见，
 * 所以每次本地写入都先进这份清单，云写成功才划掉。
 * 断网、杀进程都不怕：清单存在本机 storage 里，下次同步接着传。
 */
const COLLECTION_KEYS = { dishes: KEYS.dishes, reminders: KEYS.reminders, daily_checkins: KEYS.checkins }
/** 某个集合在本地占哪些 storage 键：记录按年分片，其余集合就是单键 */
function localKeysOf(collection) {
  if (collection === 'meal_records') return getRecordYears().map(recordsKey)
  const key = COLLECTION_KEYS[collection]
  return key ? [key] : []
}
/** 在本地找出某个集合里 id 对应的条目；记录要跨分片找 */
function findLocalItem(collection, id) {
  if (!collection || !id) return null
  for (const key of localKeysOf(collection)) {
    const found = get(key, []).find(item => item && item.id === id)
    if (found) return found
  }
  return null
}
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
/**
 * 每轮同步最多补传多少条。
 * 正常使用一天也就几条，这个上限碰不到；但导入几千条历史数据时，
 * 一条要 2 次往返（查重 + 写），一轮全传完会把同步拖到几分钟。
 * 超出的留在待传清单里，下次打开小程序接着传。
 */
const DIRTY_UPLOAD_PER_ROUND = 40

/**
 * 取云端对应的那一条，用来比 updatedAt。
 * 本地通常早就存着 cloudId，那就走主键取 —— 没必要为了一个已知文档再按业务 id 全表扫一遍。
 * doc 取不到（云端被删 / cloudId 失效）才退回按 id 查，行为与以前完全一致。
 */
async function readCloudItem(collectionName, localItem) {
  const collection = wx.cloud.database().collection(collectionName)
  if (localItem.cloudId) {
    try {
      const result = await collection.doc(localItem.cloudId).get()
      if (result && result.data) return result.data
    } catch (error) {
      // 文档不存在最常见，不值得报错；下面按 id 再找一次就够
    }
  }
  const existing = await collection.where({ id: localItem.id }).limit(1).get()
  return (existing.data && existing.data[0]) || null
}

/**
 * 把清单里的条目补传上云。
 * 先看一眼云端那份：云端更新就听云端的（本地那份已经过时），本地更新才传。
 */
async function flushDirtyUploads() {
  const dirty = getDirty()
  let done = 0
  for (const collection of Object.keys(dirty)) {
    for (const id of dirty[collection] || []) {
      if (done >= DIRTY_UPLOAD_PER_ROUND) return
      done += 1
      const localItem = findLocalItem(collection, id)
      // 本地已经删掉了：云端那条交给墓碑处理，清单可以划掉
      if (!localItem) { clearDirty(collection, id); continue }
      try {
        const cloudItem = await readCloudItem(collection, localItem)
        const localStamp = Number(localItem.updatedAt || 0)
        const cloudStamp = cloudItem ? Number(cloudItem.updatedAt || 0) : 0
        if (cloudItem && cloudStamp >= localStamp) { clearDirty(collection, id); continue }
        await upsertCloud(collection, localItem)
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
  if (!wx.getStorageSync(KEYS.settings)) set(KEYS.settings, DEFAULT_SETTINGS)
  if (!wx.getStorageSync(KEYS.reminders)) set(KEYS.reminders, [])
  if (!wx.getStorageSync(KEYS.checkins)) set(KEYS.checkins, [])
  // 记录按年分片：启动时把旧版单键数据搬过去，搬完旧键就删掉（幂等）
  migrateRecordShards()
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
  await upsertCloud('dishes', dish)
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
      await upsertCloud('dishes', latest)
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

/** 全部记录，按日期倒序（跨所有年份分片合并后排序） */
function getRecords() {
  return readRecordShards().sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`))
}
function getRecord(id) { return getRecords().find(item => item.id === id) || null }

// ---------- 数据导出 ----------
/**
 * 导出一份能带走的全量快照（JSON）。
 * 剥掉 cloudId：那是「这条对应云端哪个文档」的本地指针，换机器 / 换账号都没意义，
 * 留着只是白占剪贴板长度。头像地址与推送额度同理——一个绑账号、一个绑模板，导过去只会误导。
 */
function exportSnapshot() {
  const strip = list => (list || []).map(item => {
    const copy = clone(item)
    delete copy.cloudId
    return copy
  })
  const settings = clone(getSettings())
  delete settings.pushQuota
  delete settings.avatarFileId
  const data = {
    dishes: strip(getDishes()),
    records: strip(getRecords()),
    checkins: strip(getCheckins()),
    reminders: strip(getReminders()),
    settings
  }
  return {
    app: 'what-to-eat',
    schema: SNAPSHOT_SCHEMA,
    exportedAt: new Date().toISOString(),
    counts: {
      dishes: data.dishes.length,
      records: data.records.length,
      checkins: data.checkins.length,
      reminders: data.reminders.length
    },
    data
  }
}

// ---------- 备份文件：写盘 / 读取 / 导入 ----------
/**
 * 快照格式版本。
 * 导入时只接受「不高于当前版本」的文件：更高版本可能带了这个版本不认识的字段，
 * 硬导进来会静默丢字段，比拒绝导入更糟。
 */
const SNAPSHOT_SCHEMA = 1
/** 单个集合最多接受多少条：防一份超大/构造的文件把页面卡死 */
const MAX_IMPORT_ITEMS = 20000

/**
 * 把快照写成 JSON 文件。
 * 微信只允许转发「本地用户目录 / 临时目录」里的文件，所以必须真的落盘，
 * 不能直接把字符串交给分享接口。
 * 路径用英文（避免不同系统对中文文件名的编码差异），展示用的文件名才带中文。
 */
function writeSnapshotFile(snapshot) {
  const now = new Date()
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`
  const fileName = `今天吃什么-备份-${stamp}.json`
  const filePath = `${wx.env.USER_DATA_PATH}/what-to-eat-${stamp}.json`
  const fs = wx.getFileSystemManager()
  // 先清掉之前导出的备份。用户目录是有配额的，攒十几个就写不进去了——
  // 而写不进去的那一刻，恰恰是用户最需要备份的时候。
  // 只删自己命名的那批，别人的文件一律不碰。
  try {
    const names = fs.readdirSync(wx.env.USER_DATA_PATH) || []
    names.filter(name => /^what-to-eat-\d{8}\.json$/.test(String(name))).forEach(name => {
      try { fs.unlinkSync(`${wx.env.USER_DATA_PATH}/${name}`) } catch (error) { console.warn('删除旧备份失败', name, error) }
    })
  } catch (error) {
    console.warn('清理旧备份失败，继续写新文件', error)
  }
  const text = JSON.stringify(snapshot)
  fs.writeFileSync(filePath, text, 'utf8')
  return { filePath, fileName, sizeKB: Math.ceil(text.length / 1024) }
}

/** 读用户从聊天里选的文件；格式不对时抛错，由页面翻译成人话 */
function readSnapshotFile(filePath) {
  const text = wx.getFileSystemManager().readFileSync(filePath, 'utf8')
  return JSON.parse(text)
}

/** 校验备份文件的结构与版本 */
function validateSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: '文件内容不是备份格式' }
  if (raw.app !== 'what-to-eat') return { ok: false, message: '这不是「今天吃什么」导出的备份文件' }
  const schema = Number(raw.schema) || 0
  if (schema > SNAPSHOT_SCHEMA) return { ok: false, message: `备份文件来自更新的版本（v${schema}），请先升级小程序再导入` }
  const data = raw.data
  if (!data || typeof data !== 'object') return { ok: false, message: '备份文件里没有数据' }
  return { ok: true, message: '', data }
}

/** 清洗一条外来数据：只保留业务字段，剔掉云文档元信息与本地指针 */
function cleanImported(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null
  const item = clone(raw)
  delete item._id
  delete item._openid
  delete item.cloudId
  if (typeof item.id !== 'string') return null
  return item
}

/**
 * 合并一份备份，返回统计。
 * 规则跟云端同步一致：同 id 比 updatedAt，新的赢；本地独有的条目不删。
 * dryRun=true 只统计不落盘，用来在确认弹窗里说清「会改什么」。
 */
function mergeSnapshot(data, dryRun) {
  const counts = { dishes: 0, records: 0, checkins: 0, reminders: 0 }
  const touched = { dishes: [], records: [], checkins: [], reminders: [] }
  let skipped = 0

  /** 通用合并：source 是本地数组，raw 是外来数组，keyOf 决定去重键 */
  const mergeInto = (name, localList, rawList, isValid) => {
    const byId = new Map(localList.map(item => [item.id, item]))
    ;(Array.isArray(rawList) ? rawList : []).slice(0, MAX_IMPORT_ITEMS).forEach(raw => {
      const item = cleanImported(raw)
      if (!item || !isValid(item)) { skipped += 1; return }
      const exists = byId.get(item.id)
      // 本机更新（或一样新）就保留本机：导入是「补充」，不是「覆盖」
      if (exists && Number(exists.updatedAt || 0) >= Number(item.updatedAt || 0)) { skipped += 1; return }
      byId.set(item.id, item)
      counts[name] += 1
      touched[name].push(item.id)
    })
    return [...byId.values()]
  }

  const nextDishes = mergeInto('dishes', getDishes(), data.dishes, item => Boolean(item.name))
  const nextRecords = mergeInto('records', getRecords(), data.records, item => Boolean(item.date) && Boolean(item.dishId))
  const nextCheckins = mergeInto('checkins', getCheckins(), data.checkins, item => Boolean(item.date))
  const nextReminders = mergeInto('reminders', getReminders(), data.reminders, item => Boolean(item.content))

  const total = counts.dishes + counts.records + counts.checkins + counts.reminders
  const result = { counts, skipped, total }
  if (dryRun) return result

  // 记录放最前：分片最容易因单年超 1MB 抛错，先做它。
  // 它失败时后面几个集合还没写过，本机不会停在「菜导进来一半、记录没有」的状态。
  if (counts.records) writeRecordShards(nextRecords)
  if (counts.dishes) set(KEYS.dishes, nextDishes)
  if (counts.checkins) set(KEYS.checkins, nextCheckins)
  if (counts.reminders) set(KEYS.reminders, nextReminders)

  // 导入的数据要能被同步出去：逐条排进待传清单，下一轮 syncFromCloud 会补传
  Object.keys(touched).forEach(name => touched[name].forEach(id => markDirty(name, id)))

  // 记录变了要重算菜品聚合；聚合变了的菜也得补传，否则云端还是旧的平均分
  if (counts.records) recomputeAllDishStats().forEach(id => markDirty('dishes', id))

  return result
}

/** 导入前预演：算出会导入多少、跳过多少 */
function previewSnapshot(raw) {
  const check = validateSnapshot(raw)
  if (!check.ok) return { ok: false, message: check.message, counts: null, skipped: 0, total: 0 }
  return { ok: true, message: '', ...mergeSnapshot(check.data, true) }
}

/** 真正写入 */
function applySnapshot(raw) {
  const check = validateSnapshot(raw)
  if (!check.ok) throw new Error(check.message)
  return mergeSnapshot(check.data, false)
}
// ---------- 清空全部数据 ----------
/** 清空待办标记：云端没删干净时留着，下次同步接着删 */
const WIPE_FLAG = 'wte_wipe_pending_v1'
/** 业务数据的键前缀，清空时按它扫 */
const KEY_PREFIX = 'wte_'
/** 要清空的云端集合：user_settings 一起删，推送额度跟着归零 */
const WIPE_COLLECTIONS = ['dishes', 'meal_records', 'daily_checkins', 'reminders', 'user_settings']

/** 集合不存在不算失败：本来就没建，等于已经清空了 */
function isMissingCollection(error) {
  const code = String((error && (error.errCode !== undefined ? error.errCode : error.code)) || '')
  return code === '-502005'
}

/** 兜底：批量删被拒时逐条删（客户端 SDK 一页最多 20 条） */
async function wipeCollectionOneByOne(name) {
  const db = wx.cloud.database()
  for (let round = 0; round < 100; round++) {
    const page = await db.collection(name).limit(20).get()
    const list = (page && page.data) || []
    if (!list.length) return
    for (const doc of list) {
      await db.collection(name).doc(doc._id).remove().catch(() => {})
    }
  }
}

/** 删掉一个集合里属于本账号的全部文档 */
async function wipeCollection(name) {
  const db = wx.cloud.database()
  try {
    // 首选批量删：客户端一次最多 20 条，循环到返回 0 为止
    for (let round = 0; round < 200; round++) {
      const result = await db.collection(name).where({}).remove()
      const removed = Number((result && result.stats && result.stats.removed) || 0)
      if (!removed) return
    }
  } catch (error) {
    if (isMissingCollection(error)) return
    // 部分基础库不接受空 where 条件，退回逐条删
    console.warn(`${name} 批量清空被拒，改用逐条删除`, error)
    await wipeCollectionOneByOne(name)
  }
}

/**
 * 把云端各集合里属于本账号的文档全删掉。
 * 权限是「仅创建者可读写」，删不到别人的数据，不需要额外加 openid 条件。
 */
async function wipeCloudData() {
  if (!cloudEnabled()) return
  for (const name of WIPE_COLLECTIONS) {
    await wipeCollection(name)
  }
}

/**
 * 清空全部数据：本机 + 云端。
 *
 * 只清本机是不够的——下次 syncFromCloud 会按「本地没有、云端有」把数据全拉回来，
 * 用户会觉得根本没清掉。所以必须连云端一起删，并且清掉同步水位。
 *
 * 顺序有讲究：
 *   1. 先删本机所有 wte_ 键，再 bootstrap 回到新装状态（预置菜、空记录、默认设置）
 *   2. 落一个待清理标记，再动云端
 *   3. 云端删干净才摘标记；删不干净就留着，下次同步开头重试
 * 这样即使清空那一刻断网，也不会卡在「本地空了、云端还在、一同步全回来」的死循环里。
 *
 * @returns {Promise<{cloudOk: boolean, removedKeys: number}>}
 */
async function clearAllData() {
  // 头像和昵称属于「这个用户是谁」，不属于「这个用户吃了什么」。
  // 清数据时保留——否则清一次就要重新设昵称、重新传头像，纯属找骂。
  // 云端的 user_settings 一样会被删，但下次同步会用本地这份重建，头像文件本来就存在云存储里。
  const before = getSettings()
  const identity = { nickname: before.nickname, avatarFileId: before.avatarFileId }

  // 键列表优先问系统；拿不到就按已知的键自己拼（分片要补上，否则记录删不干净）
  const keys = new Set()
  try {
    const info = typeof wx.getStorageInfoSync === 'function' ? wx.getStorageInfoSync() : null
    ;((info && info.keys) || []).forEach(key => keys.add(key))
  } catch (error) {
    console.error('读取本地键列表失败，退回按已知键清理', error)
  }
  Object.values(KEYS).forEach(key => keys.add(key))
  getRecordYears().forEach(year => keys.add(recordsKey(year)))

  const targets = [...keys].filter(key => String(key).indexOf(KEY_PREFIX) === 0)
  targets.forEach(key => removeKey(key))
  // 回到新装：预置菜库、空记录、默认设置（pushQuota 归 0）
  bootstrap()
  // 把身份信息写回刚重建的默认设置。updatedAt 保持 bootstrap 写的 0，
  // 让接下去那次同步按「云端更新就听云端」的规则走，不在这里抢先定版本
  set(KEYS.settings, normalizeSettings({ ...getSettings(), ...identity }))
  // 标记要在动云端之前落，中途失败下次才能接着删
  set(WIPE_FLAG, Date.now())
  // 水位必须跟着清：留着旧水位会让下一轮增量同步跳过已经删掉的时段
  removeKey(KEYS.syncStamps)

  let cloudOk = true
  try {
    await wipeCloudData()
  } catch (error) {
    cloudOk = false
    console.error('清空云端数据失败，已留标记下次重试', error)
  }
  if (cloudOk) removeKey(WIPE_FLAG)
  return { cloudOk, removedKeys: targets.length }
}

/**
 * 上次清空没删完的话现在补上。
 * 返回 false 表示还没清完，这一轮同步应该直接放弃——否则会把刚删的数据拉回来。
 */
async function retryPendingWipe() {
  if (!wx.getStorageSync(WIPE_FLAG)) return true
  try {
    await wipeCloudData()
    removeKey(WIPE_FLAG)
    return true
  } catch (error) {
    console.error('清空数据仍未完成，下次同步再试', error)
    return false
  }
}

/** UTF-8 字节数：小程序里没有 Buffer，按码点手算 */
function byteLength(text) {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else bytes += 3
  }
  return bytes
}
/**
 * 本地 storage 用量，直接读系统统计。
 * 以前「我的」页每次 onShow 都把全部分片 stringify 一遍去算字节，
 * 几千条记录就是每次进页面白跑几十毫秒——而这个数字要的只是一个总量。
 * 注意 usedKB 是整个小程序的本地占用（含菜品、签到、设置），不是记录单占。
 */
function storageUsage() {
  try {
    const info = wx.getStorageInfoSync()
    return {
      usedKB: Math.max(0, Number(info && info.currentSize) || 0),
      limitKB: Math.max(1, Number(info && info.limitSize) || 10240)
    }
  } catch (error) {
    console.error('读取本地存储用量失败', error)
    return { usedKB: 0, limitKB: 10240 }
  }
}

/**
 * 本地记录各分片占多大（字节）。
 * 这个要真的序列化一遍，只在「导出 / 迁移」这类低频动作里调，别放进 onShow。
 */
function storageReport() {
  const shards = getRecordYears().map(year => {
    const list = get(recordsKey(year), [])
    return { year, count: list.length, bytes: byteLength(JSON.stringify(list)) }
  })
  return {
    shards,
    records: shards.reduce((sum, item) => sum + item.count, 0),
    bytes: shards.reduce((sum, item) => sum + item.bytes, 0),
    limitBytes: 1024 * 1024
  }
}
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
  writeRecordShards(records)

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
    await upsertCloud('meal_records', latest)
    clearDirty('meal_records', latest.id)
    for (const dishId of touched) await syncDishStats(findLocalItem('dishes', dishId))
  })
  return record
}
async function deleteRecord(id) {
  const records = getRecords()
  const record = records.find(item => item.id === id)
  if (!record) return
  writeRecordShards(records.filter(item => item.id !== id))
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
      await upsertCloud(CHECKIN_COLLECTION, latest)
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
/**
 * 这条提醒「什么时候会响」的指纹：日期 / 农历月日 / 循环方式 / 时间 / 提前节点。
 * 云端的 lastPushed 是旧时刻留下的，指纹一变就得清掉 ——
 * 否则「今天 13:00 推过，改成 15:00 再保存」时，15:00 那轮会被 lastPushed 直接跳过，当天再也收不到。
 */
function triggerSignature(reminder) {
  if (!reminder) return ''
  const lunarInfo = reminder.lunar || {}
  return JSON.stringify([
    reminder.date || '',
    reminder.calendar || 'solar',
    reminder.repeat || 'none',
    // 「每 N 天」的步长也算触发时刻的一部分：从每天改成每 3 天，当天的推送策略就变了
    Number(reminder.intervalDays) || 1,
    reminder.time || '',
    reminder.advanceDays || [],
    lunarInfo.month || 0,
    lunarInfo.day || 0,
    Boolean(lunarInfo.isLeap)
  ])
}
/**
 * 下一次触发日的哨兵值。
 * 没有下一次（单次提醒已过期、或整条停用）时写它，云函数就再也不会扫到这条。
 * 不能用空串：云库里 '' <= '2026-10-30' 成立，写空串等于天天命中。
 */
const NEXT_TRIGGER_NONE = '9999-12-31'

/**
 * 写进云端的「下次触发日」，云函数靠它筛今天的候选，不再全表扫。
 * 只写不读：本地判断一律用 reminderLib 现算，改了规则立刻生效。
 * 这个字段唯一的职责是让云端少扫点东西，所以宁可算错也不能当成业务真相。
 */
function computeNextTriggerDate(reminder, fromDate) {
  if (!reminder || reminder.enabled === false) return NEXT_TRIGGER_NONE
  const start = reminderLib.isDateText(fromDate) ? fromDate : reminderLib.today()
  return reminderLib.nextTrigger(reminder, start) || NEXT_TRIGGER_NONE
}
/**
 * 给缺 nextTriggerDate 的老提醒补上。
 * 云函数那边也有一层兜底（查出没有该字段的再补），
 * 这里补是为了不漏掉「用户打开小程序但今天不是推送时刻」的那一轮。
 * 补完要 bump updatedAt，否则 flushDirtyUploads 会因「云端更新」跳过上传，永远补不上去。
 */
function backfillNextTriggerDate() {
  const reminders = getReminders()
  let changed = false
  const now = Date.now()
  reminders.forEach(item => {
    if (!item || item.nextTriggerDate !== undefined) return
    item.nextTriggerDate = computeNextTriggerDate(item)
    item.updatedAt = now
    markDirty('reminders', item.id)
    changed = true
  })
  if (changed) set(KEYS.reminders, reminders)
  return changed
}
async function saveReminder(input) {
  const reminders = getReminders()
  const now = Date.now()
  let saved
  if (input.id) {
    const index = reminders.findIndex(item => item.id === input.id)
    if (index >= 0) {
      const previous = reminders[index]
      const merged = { ...previous, ...input, updatedAt: now }
      if (triggerSignature(previous) !== triggerSignature(merged)) merged.lastPushed = ''
      reminders[index] = merged
      saved = merged
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
  // 云函数靠 nextTriggerDate 筛候选：保存时就算一次，停用/改时间都会跟着重算
  if (saved) saved.nextTriggerDate = computeNextTriggerDate(saved)
  set(KEYS.reminders, reminders)
  if (saved) {
    markDirty('reminders', saved.id)
    enqueueCloud('保存提醒', async () => {
      const latest = findLocalItem('reminders', saved.id)
      if (!latest) return
      await upsertCloud('reminders', latest)
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
  // 五个一起探：串行等于排五次往返，而这里只需要知道「有没有一个不通」
  const results = await Promise.all(targets.map(async name => {
    try {
      await wx.cloud.database().collection(name).limit(1).get()
      return ''
    } catch (error) {
      console.error(`云环境自检未通过：${name} 集合`, error)
      return describeCloudError(error, name)
    }
  }))
  // 按 targets 顺序报第一个问题：提示稳定，不随哪次请求先回来而变
  const message = results.find(Boolean) || ''
  return { ok: !message, message }
}

// ---------- 异常上报 ----------
const ERROR_LOG_LIMIT = 20
/** 本地日志保留 30 天：再久远的报错对着代码也对不上，留着只是让 storage 越吃越满 */
const ERROR_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** 云端日志同样只留 30 天，惰性清理间隔 7 天 */
const ERROR_LOG_CLOUD_TTL_MS = 30 * 24 * 60 * 60 * 1000
const ERROR_LOG_PRUNE_GAP_MS = 7 * 24 * 60 * 60 * 1000
const ERROR_LOG_PRUNE_KEY = 'wte_error_log_pruned_v1'
const ERROR_LOG_KEY = 'wte_error_log_v1'
/**
 * 同一条报错的上报间隔。
 * 一个 render 里的循环能把同一个异常抛几十次，每次都 add 一份就是几十条云文档，
 * 而云端只在 7 天一次的惰性清理里才回收。本地留全量（有 20 条上限兜着），云端只留首次。
 */
const ERROR_REPORT_GAP_MS = 60 * 1000
/** 本地去重窗口：同一句在 3 秒内重复出现就不再压栈，省掉重复的写盘 */
const ERROR_LOCAL_GAP_MS = 3 * 1000
/** kind + message → 上次上报时间；纯内存，重启就清空，不需要持久化 */
let errorReportedAt = {}
let errorLocalTail = { key: '', at: 0 }
/**
 * 本地异常日志的过期清理：按条数（20）与时间（30 天）双限。
 * 只有条数上限时，一个陈年报错会一直卡在列表里等着被新报错挤掉，
 * 而「挤掉」这件事在稳定运行的机器上可能永远不发生。
 */
function pruneErrorLogs() {
  const list = get(ERROR_LOG_KEY, [])
  const now = Date.now()
  const next = list
    .filter(entry => entry && (!entry.at || now - Number(entry.at) < ERROR_LOG_TTL_MS))
    .slice(0, ERROR_LOG_LIMIT)
  if (next.length !== list.length) set(ERROR_LOG_KEY, next)
  return next
}
/**
 * 云端 error_logs 的惰性清理：每 7 天最多跑一次，删掉自己 30 天前的记录。
 * 不单独养一个定时云函数——为几百条日志多一个触发器不划算，挂在同步链路上够了。
 * 客户端只能删自己的文档（集合是「仅创建者可读写」），所以不会误伤别人。
 */
async function pruneCloudErrorLogs() {
  if (!cloudEnabled()) return false
  const last = Number(wx.getStorageSync(ERROR_LOG_PRUNE_KEY) || 0)
  const now = Date.now()
  if (last && now - last < ERROR_LOG_PRUNE_GAP_MS) return false
  set(ERROR_LOG_PRUNE_KEY, now)
  try {
    const db = wx.cloud.database()
    await db.collection('error_logs').where({ at: db.command.lt(now - ERROR_LOG_CLOUD_TTL_MS) }).remove()
    return true
  } catch (error) {
    // 集合没建 / 权限不对：不影响主流程，存个时间戳下周再试
    console.error('清理云端异常日志失败', error)
    return false
  }
}
/**
 * 记一条异常：本地留档 + 尽力上报云端。
 * 以前前端只有 console.error，线上白屏只能等用户截图；
 * 现在未捕获异常和 Promise 拒绝都会留一条，能查。
 *
 * 刷屏保护分两层：本地 3 秒内同一句不重复压栈，云端 60 秒内同一句只上报一次。
 * 本地保留是为了「出现过几次」这个信息仍有据可查，云端控制的是成本。
 */
function logError(kind, detail) {
  const raw = detail && (detail.message || detail.errMsg) ? (detail.message || detail.errMsg) : String(detail || '')
  const message = String(raw).slice(0, 300)
  const label = String(kind || 'error')
  // detail 是字符串时 message 已经包含它了，再跟一遍会打成「xxx xxx」
  if (detail && typeof detail === 'object') console.error(`[${label}] ${message}`, detail)
  else console.error(`[${label}] ${message}`)
  const now = Date.now()
  const key = `${label}\u0000${message}`

  if (!(errorLocalTail.key === key && now - errorLocalTail.at < ERROR_LOCAL_GAP_MS)) {
    errorLocalTail = { key, at: now }
    const list = pruneErrorLogs()
    list.unshift({ kind: label, message, at: now })
    set(ERROR_LOG_KEY, list.slice(0, ERROR_LOG_LIMIT))
  }

  if (!cloudEnabled()) return
  const lastAt = errorReportedAt[key] || 0
  if (now - lastAt < ERROR_REPORT_GAP_MS) return
  errorReportedAt[key] = now
  // 键随报错种类增长；超过 50 条整体重置，别让这层保护自己变成泄漏
  if (Object.keys(errorReportedAt).length > 50) errorReportedAt = { [key]: now }
  try {
    wx.cloud.database().collection('error_logs').add({
      data: { kind: label, message, at: now }
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
/**
 * 把云端返回的 _id 回写到本地对应的那条记录上。
 * 记录按年分片后「一条记录在哪个键」不能靠调用方传了：改过日期的记录会换年份，
 * 所以这里按集合类型自己找。
 */
function patchLocalCloudId(collectionName, id, cloudId) {
  if (!id || !cloudId) return
  const keys = localKeysOf(collectionName)
  for (const key of keys) {
    const list = get(key, [])
    const index = list.findIndex(value => value && value.id === id)
    if (index >= 0) {
      list[index].cloudId = cloudId
      set(key, list)
      return
    }
  }
}
async function upsertCloud(collectionName, item) {
  if (!cloudEnabled()) return item
  try {
    return await upsertCloudRaw(collectionName, item)
  } catch (error) {
    throw tagCollection(error, collectionName)
  }
}
async function upsertCloudRaw(collectionName, item) {
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
  patchLocalCloudId(collectionName, item.id, cloudId)
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
/**
 * 墓碑保留 90 天。
 * 为什么需要过期：墓碑是「本机删了、云端还没删掉」的待办，只有云端删除成功才摘掉。
 * 如果那个集合被删了、权限改错了，或者换了台根本不连云的手機，它就会永远躺在名单里——
 * 每天同步都白试一次，storage 只增不减。
 *
 * 90 天是有意的宽松：正常离线顶多几周，真拖过 90 天说明这条数据早就无所谓了。
 * 代价是「过期墓碑对应的云端文档会留在云端」，下次换设备全量同步会把它拉回来一次——
 * 那时候要处理的是「云端有、本机没有的历史脏数据」，不是这里的锅。
 */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000
/** 名单最多留 500 条：防极端情况（批量删库）下 storage 被它撑爆 */
const TOMBSTONE_LIMIT = 500
/** 清掉过期与超量的墓碑，返回清理后的名单 */
function pruneTombstones() {
  const list = getTombstones()
  const now = Date.now()
  let changed = false
  const alive = []
  for (const entry of list) {
    if (!entry || !entry.id || !entry.collection) { changed = true; continue }
    const at = Number(entry.at || 0)
    // 老墓碑没有时间戳：补上今天，让它从现在开始算 90 天，而不是立刻被丢掉
    if (!at) { entry.at = now; changed = true }
    if (now - entry.at >= TOMBSTONE_TTL_MS) { changed = true; continue }
    alive.push(entry)
  }
  const next = alive.length > TOMBSTONE_LIMIT ? alive.slice(alive.length - TOMBSTONE_LIMIT) : alive
  if (next.length !== alive.length) changed = true
  if (changed) set(KEYS.tombstones, next)
  return next
}
/** 把墓碑逐条落到云端（删掉对应文档）；删不掉的留在名单里下次再试 */
async function applyTombstones() {
  const list = pruneTombstones()
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
  for (const dish of dishes) await upsertCloud('dishes', dish)
  for (const record of records) await upsertCloud('meal_records', record)
  // reminders 集合可能尚未在云开发控制台创建，失败时保留本地数据即可
  try {
    for (const reminder of getReminders()) await upsertCloud('reminders', reminder)
  } catch (error) {
    console.error('提醒数据上云失败，请确认已创建 reminders 集合', error)
  }
  // daily_checkins 集合可能尚未创建，失败时保留本地签到即可
  try {
    for (const checkin of getCheckins()) await upsertCloud(CHECKIN_COLLECTION, checkin)
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
function mergeIncremental(cloudList, read) {
  const local = read()
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
  // 记录按年分片，读要合并多键、写要重新分桶；其余集合仍是单键。
  // 用一组读写适配器把差异挡在这里，合并逻辑（下面两个函数）就不用关心存法。
  const read = opts.reader || (() => get(key, []))
  const write = opts.writer || (list => set(key, list))
  const stamp = getSyncStamp(name)
  if (!stamp) {
    const cloudList = await queryAll(name)
    const merged = await mergeLocalOnly(name, cloudList.map(localData), { dedupeKey: opts.dedupeKey, reader: read })
    write(merged)
    setSyncStamp(name, maxStamp(cloudList))
    return
  }
  const cloudList = await querySince(name, stamp)
  const { result, newer } = mergeIncremental(cloudList.map(localData), read)
  for (const item of newer) {
    try {
      await upsertCloud(name, item)
    } catch (error) {
      console.error(`${name} 补传失败，先留在本机`, error)
    }
  }
  write(result)
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
async function mergeLocalOnly(collectionName, cloudList, options) {
  const opts = options || {}
  const dedupeKey = opts.dedupeKey
  const read = opts.reader || (() => [])
  const byId = new Map()
  cloudList.forEach(item => { if (item && item.id) byId.set(item.id, item) })
  const push = []
  read().forEach(item => {
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
      byId.set(item.id, await upsertCloud(collectionName, item))
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
  const changedIds = []
  const next = dishes.map(dish => {
    const stats = dishStatsFromRecords(byDish[dish.id] || [])
    if (dish.eatCount === stats.eatCount && Number(dish.score) === stats.score && dish.lastEatDate === stats.lastEatDate) return dish
    changedIds.push(dish.id)
    return { ...dish, ...stats }
  })
  // 只纠正本机、不反写云端（同步自愈路径刻意不动 updatedAt，防两机互覆盖）；
  // 变化了哪些菜交给调用方决定要不要补传——导入数据时需要，云同步自愈时不需要
  if (changedIds.length) set(KEYS.dishes, next)
  return changedIds
}
async function pullCloudData(settingsDocument) {
  // 四个集合并行拉；dishes / meal_records 是核心集合，拉不到就整体失败，让调用方走本地降级
  const [dishesResult, recordsResult, remindersResult, checkinsResult] = await Promise.allSettled([
    pullCollection('dishes', KEYS.dishes),
    pullCollection('meal_records', KEYS.records, { reader: readRecordShards, writer: writeRecordShards }),
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
    // 上次「清空数据」没删干净：先把云端补删掉，这一轮不要拉数据，
    // 否则刚删掉的东西又被拉回来，用户会以为清空失败
    if (!(await retryPendingWipe())) return false
    // 顺序不能反：先补传本地独有条目 → 再清墓碑 → 再补记账 → 最后拉数据。
    // 反了的话，本机新记的数据拉不回来（增量只看得到云端变过的），
    // 刚删的记录会被复活，刚攒的额度会被云端旧值盖掉。
    await flushDirtyUploads()
    await applyTombstones()
    await flushQuotaPending().catch(error => console.error('补记推送额度失败，下次同步再试', error))
    // 云端异常日志的清理不挡同步：它是惰性的（7 天一次），失败也只是日志多留几天
    pruneCloudErrorLogs().catch(error => console.error('清理云端异常日志失败，下次同步再试', error))
    // 设置文档可能存在历史重复，统一取 updatedAt 最新的那份
    const { doc } = await readSettingsDoc()
    if (!doc) await migrateLocalToCloud()
    else await pullCloudData(doc)
    // 拉完顺手给老提醒补上 nextTriggerDate：云函数那边也有一层兜底，
    // 但用户往往在「今天不是推送时刻」的时候开小程序，光靠兜底要等下一轮才生效
    backfillNextTriggerDate()
    lastSyncAt = Date.now()
    return true
  })()
  try { return await syncPromise } finally { syncPromise = null }
}

module.exports = { CATEGORIES, TAGS, MEALS, EAT_TYPES, PRICES, PRICE_RANGES, bootstrap, syncFromCloud, getDishes, getDish, saveDish, deleteDish, getHomePick, saveHomePick, getRecords, getRecord, saveRecord, deleteRecord, normalizeClock, clockFromStamp, recordClock, exportSnapshot, writeSnapshotFile, readSnapshotFile, previewSnapshot, applySnapshot, clearAllData, storageReport, storageUsage, getRecordYears, pruneTombstones, pruneErrorLogs, computeNextTriggerDate, backfillNextTriggerDate, NEXT_TRIGGER_NONE, getCheckins, getCheckinByDate, saveCheckin, deleteCheckin, getReminders, getReminder, saveReminder, deleteReminder, toggleReminder, addPushQuota, countTodayReminders, describeCloudError, checkCloudReady, getSettings, saveSettings, onCloudError, flushCloudQueue, logError }
