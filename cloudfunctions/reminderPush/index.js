/**
 * 日期提醒定时推送
 *
 * 每 5 分钟触发一次（触发器 cron 为 0 *\/5 * * * * *），扫描所有已启用的提醒：
 *   1. 当前北京时间落在提醒时间之后的那个 5 分钟窗口内（14:30 的提醒在 14:30-14:34 命中）
 *   2. 今天确实是该提醒的触发日（含提前 1 天 / 3 天）
 *   3. 该用户还有剩余推送额度（user_settings.pushQuota）
 * 满足条件则通过订阅消息下发，并写入 lastPushed 防止当天重复推送。
 *
 * 手动调试：invoke 时传 { "force": true } 可忽略时间窗口与 lastPushed，直接按今天推送一次。
 */
const cloud = require('wx-server-sdk')
const reminderLib = require('./lib/reminder')
const { TEMPLATE_ID, TEMPLATE_FIELDS, CATEGORY_TEXT, PAGE, MINIPROGRAM_STATE, SUBSCRIBE_MODE } = require('./lib/config')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const BEIJING_OFFSET_MINUTES = 8 * 60
const PAGE_SIZE = 100
const QUOTA_EXHAUSTED = '43101' // 用户未订阅 / 订阅次数已用完
/** 永久性错误：重试也没用，标记后当天不再尝试 */
const PERMANENT_ERRORS = ['43101', '47003']
/**
 * 时间窗口，需与触发器间隔配合看。
 * 触发器每 5 分钟一轮，这里给 15 分钟窗口：
 * 命中后如果推送失败（网络抖动之类），当天还能再试两次，不会因为一次失败就整天收不到。
 * 推成功了会写 lastPushed，同一条提醒当天只会真正收到一条。
 * 要是以后把触发器改成 15 分钟一轮，这里要跟着放到 45 分钟，才能保住三次重试。
 */
const WINDOW_MINUTES = 15
/** 一批同时推几条：一条一条串行推，命中多时会被云函数超时截断 */
const PUSH_CONCURRENCY = 5
// 长期订阅授权后无需再校验额度，只有一次性订阅才记账
const CHECK_QUOTA = SUBSCRIBE_MODE !== 'longterm'

/** 云函数运行时时区可能不是 UTC+8，这里统一换算成北京时间 */
function beijingNow() {
  const now = new Date()
  return new Date(now.getTime() + (BEIJING_OFFSET_MINUTES + now.getTimezoneOffset()) * 60000)
}

function beijingDateText() {
  const date = beijingNow()
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 当前北京时间距零点的分钟数，用于分钟级匹配 */
function beijingMinutes() {
  const date = beijingNow()
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * 提醒时间是否落在当前 5 分钟窗口内。
 * 例如提醒 14:30、窗口 5 分钟：14:30 那轮命中，14:35 那轮已超出，不会重复。
 */
function inTimeWindow(timeText, nowMinutes, windowMinutes) {
  const parts = String(timeText || reminderLib.DEFAULT_TIME).split(':')
  const hour = Number(parts[0])
  const minute = Number(parts[1] === undefined ? 0 : parts[1])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  const diff = nowMinutes - (hour * 60 + minute)
  return diff >= 0 && diff < windowMinutes
}

function truncate(text, limit) {
  const value = String(text === undefined || text === null ? '' : text)
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

/**
 * 订阅消息的 date 类字段只接受「年月日」写法（如 2026年9月25日），
 * 传 2026-09-25 会被判定为参数不合法；thing 类字段也兼容这种写法，因此统一转换。
 */
function toChineseDate(dateText) {
  const parts = String(dateText || '').split('-')
  if (parts.length !== 3) return String(dateText || '')
  return `${Number(parts[0])}年${Number(parts[1])}月${Number(parts[2])}日`
}

function buildMessageData(reminder, occurrence, advance) {
  const values = {
    content: truncate(reminder.content, 20),
    eventDate: toChineseDate(occurrence),
    time: reminder.time || reminderLib.DEFAULT_TIME,
    note: advance === 0 || advance === null ? '就是今天' : `还有 ${advance} 天`,
    // 模板里的「日程类别」槽位，本小程序统一填固定文案
    category: truncate(CATEGORY_TEXT, 20)
  }
  const data = {}
  Object.keys(TEMPLATE_FIELDS).forEach(key => {
    const value = values[TEMPLATE_FIELDS[key]]
    if (value) data[key] = { value: String(value) }
  })
  return data
}

/** 读取并缓存用户可用推送额度 */
async function readQuota(openid, cache) {
  if (cache[openid]) return cache[openid]
  // 用户设置理论上只有一份，但历史上有过重复文档；
  // 统一按 updatedAt 最新的那份算额度，不然会和客户端记到不同文档上
  const result = await db.collection('user_settings').where({ _openid: openid }).limit(10).get()
  const list = (result.data || []).slice().sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
  const document = list[0]
  const entry = { quota: document ? Number(document.pushQuota || 0) : 0, docId: document ? document._id : '' }
  cache[openid] = entry
  return entry
}

async function applyQuota(openid, cache, quota) {
  const entry = await readQuota(openid, cache)
  entry.quota = Math.max(0, quota)
  if (!entry.docId) return
  await db.collection('user_settings').doc(entry.docId).update({ data: { pushQuota: entry.quota } })
}

async function markPushed(docId) {
  await db.collection('reminders').doc(docId)
    .update({ data: { lastPushed: beijingDateText(), updatedAt: Date.now() } })
    .catch(error => console.error('写入推送标记失败', docId, error))
}

exports.main = async event => {
  const force = Boolean(event && event.force)
  const dateText = beijingDateText()
  const minutes = beijingMinutes()
  const startedAt = Date.now()
  const stats = { date: dateText, minutes, forced: force, scanned: 0, pushed: 0, skipped: 0, failed: 0, noQuota: 0, candidates: 0, scanMs: 0, message: '' }

  if (!TEMPLATE_ID) {
    stats.message = '未配置订阅消息模板 ID，已跳过推送'
    return stats
  }

  const quotaCache = {}
  let skip = 0

  // 先把候选挑出来：扫描量记在 stats 里，哪天真变慢了看这里
  const candidates = []
  while (true) {
    const result = await db.collection('reminders').where({ enabled: true }).skip(skip).limit(PAGE_SIZE).get()
    if (!result.data.length) break

    for (const document of result.data) {
      stats.scanned += 1
      const reminder = { ...document }

      // 纪念日默认只在日历上标个日子，不推送；只有用户开了「到期提醒」才当普通提醒处理
      // （老数据没有 kind 字段，一律按普通提醒走）
      if (reminderLib.isAnniversary(reminder) && !reminderLib.anniversaryNotify(reminder)) { stats.skipped += 1; continue }
      if (!force && !inTimeWindow(reminder.time, minutes, WINDOW_MINUTES)) { stats.skipped += 1; continue }
      if (!force && reminder.lastPushed === dateText) { stats.skipped += 1; continue }
      if (!reminderLib.isTriggerOn(reminder, dateText)) { stats.skipped += 1; continue }
      candidates.push(reminder)
    }

    if (result.data.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }
  stats.candidates = candidates.length
  stats.scanMs = Date.now() - startedAt

  // 额度先串行查清楚：并发读同一份额度容易算错（两条提醒都看到还剩 1 次）
  const ready = []
  for (const reminder of candidates) {
    const entry = await readQuota(reminder._openid, quotaCache)
    if (CHECK_QUOTA && entry.quota <= 0) { stats.noQuota += 1; continue }
    ready.push({ reminder, entry })
  }

  // 并发推送：一条条串行推，命中多的时候光等待就能把云函数拖到超时，后面的直接不推了
  const spent = {}
  for (let index = 0; index < ready.length; index += PUSH_CONCURRENCY) {
    const batch = ready.slice(index, index + PUSH_CONCURRENCY)
    await Promise.all(batch.map(item => pushOne(item, dateText, stats, quotaCache, spent)))
    // 额度按用户结算一次：并发时两条提醒都拿到同一份额度，逐条扣会算错
    for (const openid of Object.keys(spent)) {
      const entry = await readQuota(openid, quotaCache)
      await applyQuota(openid, quotaCache, entry.quota - spent[openid])
      spent[openid] = 0
    }
  }

  return stats
}

/** 推一条提醒；失败分「永久」和「临时」两种，临时失败不写 lastPushed，当天还能再试 */
async function pushOne(item, dateText, stats, quotaCache, spent) {
  const { reminder, entry } = item
  const openid = reminder._openid
  const occurrence = reminderLib.occurrenceForTrigger(reminder, dateText) || dateText
  const advance = reminderLib.advanceForTrigger(reminder, dateText)

  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: TEMPLATE_ID,
      page: PAGE,
      miniprogramState: MINIPROGRAM_STATE,
      lang: 'zh_CN',
      data: buildMessageData(reminder, occurrence, advance)
    })
    stats.pushed += 1
    await markPushed(reminder._id)
    if (CHECK_QUOTA) spent[openid] = (spent[openid] || 0) + 1
  } catch (error) {
    stats.failed += 1
    console.error('订阅消息推送失败', reminder._id, error)
    const code = String(error && error.errCode)
    if (code === QUOTA_EXHAUSTED) {
      entry.quota = 0
      await applyQuota(openid, quotaCache, 0).catch(() => {})
    }
    if (PERMANENT_ERRORS.includes(code)) {
      // 额度用完 / 模板参数不对：重试也不会成功，标记掉当天不再试
      await markPushed(reminder._id)
      return
    }
    // 网络抖动、超时这类临时失败：故意不写 lastPushed，
    // 下一个窗口（15 分钟内还有两次）会重新推，避免一次失败就整天收不到
    console.warn('推送失败但原因可能是临时的，本次不标记已推送，等待下一轮重试', reminder._id, code)
  }
}
