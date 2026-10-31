/**
 * 批量补传：客户端一次塞几十上百条，服务端循环 upsert。
 *
 * 为什么需要这个函数：
 *   客户端补传一条要走两次往返（查云端有没有这条 + 写）。导入 1000 条历史记录时，
 *   单轮受 DIRTY_UPLOAD_PER_ROUND=40 限制，要 50 轮同步——用户得反复开关 50 次小程序才能传完。
 *   走云函数之后：100 条一次调用，服务端用 `id in [...]` 一次查出已存在的文档，
 *   省掉逐条查重，1000 条从 1000+ 次往返降到 10 次左右。
 *
 * 权限与边界：
 *   - 云函数是管理员权限，会绕过集合 ACL，所以**每一条都按调用者的 OPENID 圈定**
 *     （查重带 `_openid` 条件，写入显式带上 `_openid`），不能碰到别人的数据；
 *   - 只认白名单里的四个业务集合，别让它变成一个任意写入接口；
 *   - 冲突规则与客户端完全一致：云端 updatedAt 不比本地旧就跳过，说明云端已经有更新的版本。
 *
 * 客户端拿不到这个函数（没部署 / 名字不对）时会自己退回逐条的旧通道，不会卡住同步。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/** 只允许写这四个业务集合；user_settings 每账号一份、pushQuota 只能走 inc，不能从这个口子灌 */
const ALLOWED = ['dishes', 'meal_records', 'daily_checkins', 'reminders']
/** 单次上限。客户端按 100 条一片调用，留一倍余量 */
const MAX_BATCH = 200
/** `id in [...]` 一次最多塞 100 个：再大查询本身会超限 */
const LOOKUP_CHUNK = 100
/** 写库并发度：一次 20 个请求在飞，既快又不会把数据库打到限流 */
const WRITE_CONCURRENCY = 20

/** 剥掉客户端不该决定的字段：_id / _openid 由服务端定，cloudId 是客户端本地指针 */
function clean(doc) {
  const data = { ...doc }
  delete data._id
  delete data._openid
  delete data.cloudId
  return data
}

function stampOf(doc) {
  const value = Number(doc && doc.updatedAt)
  return Number.isFinite(value) ? value : 0
}

/** 把数组切成每片 n 个 */
function chunk(list, n) {
  const out = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

/** 查出这批 id 在云端已有的文档（只取需要的字段，别把上千条正文拉回来） */
async function lookupExisting(collection, openid, ids) {
  const found = new Map()
  for (const part of chunk(ids, LOOKUP_CHUNK)) {
    const page = await db
      .collection(collection)
      .where({ _openid: openid, id: _.in(part) })
      .field({ id: true, updatedAt: true })
      .limit(LOOKUP_CHUNK)
      .get()
    ;((page && page.data) || []).forEach(doc => {
      if (doc && doc.id) found.set(doc.id, doc)
    })
  }
  return found
}

/**
 * 写一条：云端没有就新增，有就按主键更新。
 * 新增时必须显式带上 _openid —— 云函数里 add 不会自动补，漏了这条数据客户端就再也读不到。
 */
async function writeOne(collection, openid, item, existing) {
  if (existing) {
    await db
      .collection(collection)
      .doc(existing._id)
      .update({ data: { ...item, _openid: openid } })
    return existing._id
  }
  const added = await db
    .collection(collection)
    .add({ data: { ...item, _openid: openid } })
  return (added && added._id) || ''
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const collection = String((event && event.collection) || '')
  const raw = event && Array.isArray(event.items) ? event.items : []

  if (!ALLOWED.includes(collection)) return { ok: false, message: `不支持的集合：${collection || '(空)'}` }
  if (!OPENID) return { ok: false, message: '拿不到 openid，无法确认这批数据属于谁' }

  const valid = raw.filter(item => item && item.id).slice(0, MAX_BATCH).map(clean)
  const truncated = raw.length > MAX_BATCH
  if (!valid.length) return { ok: true, results: [], failed: [], truncated: false }

  const existing = await lookupExisting(collection, OPENID, valid.map(item => item.id))

  const results = []
  const pending = []
  for (const item of valid) {
    const cloudDoc = existing.get(item.id)
    // 云端那份不比本地旧：说明已经有更新的版本，本地这份可以放心划掉
    if (cloudDoc && stampOf(cloudDoc) >= stampOf(item)) {
      results.push({ id: item.id, cloudId: cloudDoc._id, action: 'skipped' })
      continue
    }
    pending.push({ item, cloudDoc })
  }

  const failed = []
  for (const part of chunk(pending, WRITE_CONCURRENCY)) {
    await Promise.all(
      part.map(async ({ item, cloudDoc }) => {
        try {
          const cloudId = await writeOne(collection, OPENID, item, cloudDoc)
          results.push({ id: item.id, cloudId, action: cloudDoc ? 'updated' : 'added' })
        } catch (error) {
          // 单条失败不影响整批：客户端会把这几条留在待传清单里下次再试
          failed.push({ id: item.id, message: String((error && (error.errMsg || error.message)) || error).slice(0, 200) })
        }
      })
    )
  }

  return { ok: true, results, failed, truncated }
}
