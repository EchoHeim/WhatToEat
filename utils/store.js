const KEYS = {
  dishes: 'wte_dishes_v1',
  records: 'wte_records_v1',
  settings: 'wte_settings_v1'
}

const CATEGORIES = ['中餐', '西餐', '日料', '韩餐', '面食', '米饭', '火锅', '烧烤', '快餐', '小吃', '甜品', '饮品', '其他']
const TAGS = ['早餐', '午餐', '晚餐', '夜宵', '自己做', '外卖', '堂食', '清淡', '辣', '高蛋白', '减脂', '快手', '聚餐']
const MEALS = ['早餐', '午餐', '晚餐', '夜宵']
const EAT_TYPES = ['自己做', '外卖', '堂食']
const PRICES = ['经济', '普通', '丰盛']
const DEFAULT_SETTINGS = { recentDays: 7, allowRepeat: false, defaultMeal: '午餐', nickname: '微信用户', avatarFileId: '' }

const seedDishes = [
  { id: 'd1', name: '番茄炒蛋', emoji: '🍅', category: '中餐', tags: ['家常菜', '快手', '下饭'], mealTypes: ['午餐', '晚餐'], eatTypes: ['自己做'], price: '经济', score: 4.6, eatCount: 3, lastEatDate: '2026-08-13', remark: '番茄多一点，汤汁拌饭很好吃。', enableRandom: true },
  { id: 'd2', name: '牛肉面', emoji: '🍜', category: '面食', tags: ['高蛋白', '热乎'], mealTypes: ['午餐', '晚餐'], eatTypes: ['外卖', '堂食'], price: '普通', score: 4.3, eatCount: 5, lastEatDate: '2026-08-07', remark: '加一份青菜。', enableRandom: true },
  { id: 'd3', name: '黄焖鸡米饭', emoji: '🍛', category: '米饭', tags: ['下饭', '外卖'], mealTypes: ['午餐', '晚餐'], eatTypes: ['外卖', '堂食'], price: '普通', score: 4.1, eatCount: 2, lastEatDate: '2026-07-29', remark: '微辣更合适。', enableRandom: true },
  { id: 'd4', name: '寿司拼盘', emoji: '🍣', category: '日料', tags: ['清淡', '聚餐'], mealTypes: ['午餐', '晚餐'], eatTypes: ['堂食', '外卖'], price: '丰盛', score: 4.7, eatCount: 2, lastEatDate: '2026-07-18', remark: '', enableRandom: true },
  { id: 'd5', name: '火锅', emoji: '🍲', category: '火锅', tags: ['辣', '聚餐'], mealTypes: ['晚餐', '夜宵'], eatTypes: ['堂食'], price: '丰盛', score: 4.8, eatCount: 4, lastEatDate: '2026-08-02', remark: '适合周末和朋友一起吃。', enableRandom: true },
  { id: 'd6', name: '鸡蛋三明治', emoji: '🥪', category: '西餐', tags: ['早餐', '快手'], mealTypes: ['早餐'], eatTypes: ['自己做'], price: '经济', score: 4.0, eatCount: 1, lastEatDate: '2026-08-10', remark: '', enableRandom: true },
  { id: 'd7', name: '麻辣烫', emoji: '🥘', category: '小吃', tags: ['辣', '外卖'], mealTypes: ['午餐', '晚餐', '夜宵'], eatTypes: ['外卖', '堂食'], price: '普通', score: 4.2, eatCount: 3, lastEatDate: '2026-07-25', remark: '多拿蔬菜和豆制品。', enableRandom: true },
  { id: 'd8', name: '酸奶水果碗', emoji: '🥣', category: '甜品', tags: ['早餐', '减脂', '清淡'], mealTypes: ['早餐'], eatTypes: ['自己做'], price: '经济', score: 4.4, eatCount: 2, lastEatDate: '2026-08-16', remark: '香蕉和蓝莓很搭。', enableRandom: true }
].map((dish, index) => ({ ...dish, createdAt: Date.now() - index * 1000 }))

const seedRecords = [
  { id: 'r1', dishId: 'd1', dishName: '番茄炒蛋', date: '2026-08-13', mealType: '晚餐', score: 4.5, status: '吃得很好', remark: '汤汁很下饭', createdAt: Date.now() - 3000 },
  { id: 'r2', dishId: 'd6', dishName: '鸡蛋三明治', date: '2026-08-10', mealType: '早餐', score: 4, status: '还不错', remark: '', createdAt: Date.now() - 2000 },
  { id: 'r3', dishId: 'd5', dishName: '火锅', date: '2026-08-02', mealType: '晚餐', score: 5, status: '吃得很好', remark: '朋友聚餐很开心', createdAt: Date.now() - 1000 }
]

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
}

function getDishes() { return get(KEYS.dishes, seedDishes) }
function getDish(id) { return getDishes().find(item => item.id === id) }
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
async function saveRecord(input) {
  const records = getRecords()
  const record = { ...input, id: uid('record'), createdAt: Date.now(), score: Number(input.score) }
  records.unshift(record)
  set(KEYS.records, records)
  if (record.dishId) {
    const dishes = getDishes()
    const index = dishes.findIndex(item => item.id === record.dishId)
    if (index >= 0) {
      const dish = dishes[index]
      const oldCount = Number(dish.eatCount || 0)
      dish.score = Number(((Number(dish.score || 0) * oldCount + record.score) / (oldCount + 1)).toFixed(1))
      dish.eatCount = oldCount + 1
      dish.lastEatDate = record.date
      set(KEYS.dishes, dishes)
      await upsertCloud('dishes', dish, KEYS.dishes)
    }
  }
  await upsertCloud('meal_records', record, KEYS.records)
  return record
}
async function deleteRecord(id) {
  const record = getRecords().find(item => item.id === id)
  set(KEYS.records, getRecords().filter(item => item.id !== id))
  if (record) await removeCloud('meal_records', record)
}
function getSettings() { return { ...DEFAULT_SETTINGS, ...get(KEYS.settings, DEFAULT_SETTINGS) } }
async function saveSettings(settings) {
  const value = { ...getSettings(), ...settings }
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
  await saveSettings(getSettings())
}
async function pullCloudData(settingsDocument) {
  const dishes = (await queryAll('dishes')).map(localData)
  const records = (await queryAll('meal_records')).map(localData)
  set(KEYS.dishes, dishes)
  set(KEYS.records, records)
  set(KEYS.settings, {
    recentDays: Number(settingsDocument.recentDays || 0),
    allowRepeat: Boolean(settingsDocument.allowRepeat),
    defaultMeal: settingsDocument.defaultMeal || '午餐',
    nickname: settingsDocument.nickname || '微信用户',
    avatarFileId: settingsDocument.avatarFileId || ''
  })
}
async function syncFromCloud() {
  if (!cloudEnabled()) return false
  if (syncPromise) return syncPromise
  syncPromise = (async () => {
    const result = await wx.cloud.database().collection('user_settings').limit(1).get()
    if (!result.data.length) await migrateLocalToCloud()
    else await pullCloudData(result.data[0])
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

module.exports = { CATEGORIES, TAGS, MEALS, EAT_TYPES, PRICES, bootstrap, syncFromCloud, getDishes, getDish, saveDish, deleteDish, getRecords, saveRecord, deleteRecord, getSettings, saveSettings, resetDemo }
