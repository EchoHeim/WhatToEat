const reminderLib = require('./reminder')

const KEYS = {
  dishes: 'wte_dishes_v1',
  records: 'wte_records_v1',
  settings: 'wte_settings_v1',
  reminders: 'wte_reminders_v1',
  checkins: 'wte_checkins_v1'
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
  const dish = { ...dishes[index], ...dishStatsFromRecords(getRecords().filter(item => item.id && item.dishId === dishId)) }
  dishes[index] = dish
  set(KEYS.dishes, dishes)
  return dish
}
/** 聚合回写云端；失败只记日志——本地已经算对了，下次保存会重算 */
async function syncDishStats(dish) {
  if (!dish) return
  try {
    await upsertCloud('dishes', dish, KEYS.dishes)
  } catch (error) {
    console.error('菜品聚合回写云端失败，下次保存会重算', dish.id, error)
  }
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
  if (savedDish) await upsertCloud('dishes', savedDish, KEYS.dishes)
  return savedDish
}
async function deleteDish(id) {
  const dish = getDish(id)
  set(KEYS.dishes, getDishes().filter(item => item.id !== id))
  if (dish) await removeCloud('dishes', dish)
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
    createdAt: previous ? (previous.createdAt || now) : now,
    updatedAt: now,
    score: Number.isFinite(score) ? score : Number(previous && previous.score) || 0
  }
  if (previous) records[index] = record
  else records.unshift(record)
  set(KEYS.records, records)

  await upsertCloud('meal_records', record, KEYS.records)

  const touched = [...new Set([record.dishId, previous && previous.dishId].filter(Boolean))]
  for (const dishId of touched) await syncDishStats(recomputeDish(dishId))
  return record
}
async function deleteRecord(id) {
  const records = getRecords()
  const record = records.find(item => item.id === id)
  if (!record) return
  set(KEYS.records, records.filter(item => item.id !== id))
  // 本地先把聚合回滚，免得云同步失败时统计还挂着已删记录
  const dish = record.dishId ? recomputeDish(record.dishId) : null
  await removeCloud('meal_records', record)
  await syncDishStats(dish)
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
  if (saved) await upsertCloud(CHECKIN_COLLECTION, saved, KEYS.checkins)
  for (const item of duplicates) {
    await removeCloud(CHECKIN_COLLECTION, item).catch(error => console.error('清理重复签到失败', error))
  }
  return saved
}
async function deleteCheckin(id) {
  const checkin = getCheckins().find(item => item.id === id)
  set(KEYS.checkins, getCheckins().filter(item => item.id !== id))
  if (checkin) await removeCloud(CHECKIN_COLLECTION, checkin)
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
  if (saved) await upsertCloud('reminders', saved, KEYS.reminders)
  return saved
}
async function deleteReminder(id) {
  const reminder = getReminder(id)
  set(KEYS.reminders, getReminders().filter(item => item.id !== id))
  if (reminder) await removeCloud('reminders', reminder)
}
async function toggleReminder(id, enabled) { return saveReminder({ id, enabled }) }
/**
 * 用户完成一次订阅授权后累加推送额度。
 * 微信一次性订阅「授权一次 = 可推送一条」，云函数推送成功后会尽力递减该值。
 */
async function addPushQuota(step) {
  const settings = getSettings()
  return saveSettings({ pushQuota: Math.max(0, Number(settings.pushQuota || 0) + (step === undefined ? 1 : Number(step))) })
}
/** 今日待提醒数量，用于「我的」页面角标 */
function countTodayReminders(dateText) {
  const todayText = dateText || reminderLib.today()
  return getReminders().filter(item => item.enabled !== false && reminderLib.isTriggerOn(item, todayText)).length
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
  return result
}

function getSettings() { return normalizeSettings(get(KEYS.settings, DEFAULT_SETTINGS)) }
async function saveSettings(settings) {
  const value = normalizeSettings({ ...getSettings(), ...settings })
  set(KEYS.settings, value)
  if (!cloudEnabled()) return value
  const db = wx.cloud.database()
  const result = await db.collection('user_settings').limit(1).get()
  const data = { ...cloudData(value), initialized: true, updatedAt: Date.now() }
  if (result.data.length) await db.collection('user_settings').doc(result.data[0]._id).update({ data })
  else await db.collection('user_settings').add({ data })
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
  const targets = Array.isArray(names) && names.length ? names : ['reminders']
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
 * 云端拉取后合并「只在本机、从没同步成功」的条目。
 * 集合没建好时保存会落到本地，下次同步如果直接拿云端覆盖，这条数据就没了。
 * dedupeKey 用于按业务唯一键兜底去重（例如签到按 date 一天一条），本地为准。
 */
async function mergeLocalOnly(collectionName, key, cloudList, dedupeKey) {
  const cloudKeys = new Set(cloudList.map(item => item && item.id).filter(Boolean))
  const extras = get(key, []).filter(item => {
    if (!item || !item.id || cloudKeys.has(item.id)) return false
    if (!dedupeKey) return true
    const value = item[dedupeKey]
    return !value || !cloudList.some(other => other && other[dedupeKey] === value)
  })
  if (!extras.length) return cloudList
  const merged = []
  for (const item of extras) {
    try {
      merged.push(await upsertCloud(collectionName, item, key))
    } catch (error) {
      console.error(`${collectionName} 补传失败，先留在本机`, error)
      merged.push(item)
    }
  }
  return [...merged, ...cloudList]
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
  const [dishesResult, recordsResult, remindersResult, checkinsResult] = await Promise.allSettled([
    queryAll('dishes'),
    queryAll('meal_records'),
    queryAll('reminders'),
    queryAll(CHECKIN_COLLECTION)
  ])
  // dishes / meal_records 是核心集合，拉不到就整体失败，让调用方走本地降级
  if (dishesResult.status === 'rejected') throw dishesResult.reason
  if (recordsResult.status === 'rejected') throw recordsResult.reason
  set(KEYS.dishes, await mergeLocalOnly('dishes', KEYS.dishes, dishesResult.value.map(localData)))
  set(KEYS.records, await mergeLocalOnly('meal_records', KEYS.records, recordsResult.value.map(localData)))
  recomputeAllDishStats()
  if (remindersResult.status === 'fulfilled') {
    set(KEYS.reminders, await mergeLocalOnly('reminders', KEYS.reminders, remindersResult.value.map(localData)))
  } else {
    console.error('提醒数据拉取失败，继续使用本地缓存', remindersResult.reason)
  }
  if (checkinsResult.status === 'fulfilled') {
    set(KEYS.checkins, await mergeLocalOnly(CHECKIN_COLLECTION, KEYS.checkins, checkinsResult.value.map(localData), 'date'))
  } else {
    console.error('签到数据拉取失败，继续使用本地缓存', checkinsResult.reason)
  }
  set(KEYS.settings, normalizeSettings(settingsDocument))
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
    const result = await wx.cloud.database().collection('user_settings').limit(1).get()
    if (!result.data.length) await migrateLocalToCloud()
    else await pullCloudData(result.data[0])
    lastSyncAt = Date.now()
    return true
  })()
  try { return await syncPromise } finally { syncPromise = null }
}
async function deleteAllCloud(name) {
  const documents = await queryAll(name)
  const collection = wx.cloud.database().collection(name)
  for (const document of documents) await collection.doc(document._id).remove()
}
async function resetDemo() {
  set(KEYS.dishes, clone(seedDishes))
  set(KEYS.records, clone(seedRecords))
  if (cloudEnabled()) {
    await deleteAllCloud('dishes')
    await deleteAllCloud('meal_records')
    for (const dish of getDishes()) await upsertCloud('dishes', dish, KEYS.dishes)
    for (const record of getRecords()) await upsertCloud('meal_records', record, KEYS.records)
  }
  return true
}

module.exports = { CATEGORIES, TAGS, MEALS, EAT_TYPES, PRICES, PRICE_RANGES, bootstrap, syncFromCloud, getDishes, getDish, saveDish, deleteDish, getRecords, getRecord, saveRecord, deleteRecord, getCheckins, getCheckinByDate, saveCheckin, deleteCheckin, getReminders, getReminder, saveReminder, deleteReminder, toggleReminder, addPushQuota, countTodayReminders, describeCloudError, checkCloudReady, getSettings, saveSettings, resetDemo }
