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
/** 时间窗口，需与触发器间隔一致：每 5 分钟一轮，落点后的 5 分钟内算命中 */
const WINDOW_MINUTES = 5
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
  const result = await db.collection('user_settings').where({ _openid: openid }).limit(1).get()
  const document = result.data[0]
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
  const stats = { date: dateText, minutes, forced: force, scanned: 0, pushed: 0, skipped: 0, failed: 0, noQuota: 0, message: '' }

  if (!TEMPLATE_ID) {
    stats.message = '未配置订阅消息模板 ID，已跳过推送'
    return stats
  }

  const quotaCache = {}
  let skip = 0

  while (true) {
    const result = await db.collection('reminders').where({ enabled: true }).skip(skip).limit(PAGE_SIZE).get()
    if (!result.data.length) break

    for (const document of result.data) {
      stats.scanned += 1
      const reminder = { ...document }

      if (!force && !inTimeWindow(reminder.time, minutes, WINDOW_MINUTES)) { stats.skipped += 1; continue }
      if (!force && reminder.lastPushed === dateText) { stats.skipped += 1; continue }
      if (!reminderLib.isTriggerOn(reminder, dateText)) { stats.skipped += 1; continue }

      const openid = document._openid
      const entry = await readQuota(openid, quotaCache)
      if (CHECK_QUOTA && entry.quota <= 0) { stats.noQuota += 1; continue }

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
        await markPushed(document._id)
        if (CHECK_QUOTA) await applyQuota(openid, quotaCache, entry.quota - 1)
      } catch (error) {
        stats.failed += 1
        console.error('订阅消息推送失败', document._id, error)
        if (String(error.errCode) === QUOTA_EXHAUSTED) {
          entry.quota = 0
          await applyQuota(openid, quotaCache, 0).catch(() => {})
        }
        await markPushed(document._id)
      }
    }

    if (result.data.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }

  return stats
}
