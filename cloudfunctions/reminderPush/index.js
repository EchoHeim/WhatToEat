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
const notify = require('./lib/notify')
const { TEMPLATE_ID, TEMPLATE_FIELDS, CATEGORY_TEXT, PAGE, MINIPROGRAM_STATE, SUBSCRIBE_MODE } = require('./lib/config')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const BEIJING_OFFSET_MINUTES = 8 * 60
const PAGE_SIZE = 100
/**
 * 没有下一次触发时的哨兵日期。
 * 不能写空串：云数据库里 '' <= '2026-10-30' 成立，这条提醒会每天被扫到。
 * 写到 9999 年就不会再命中任何查询。
 */
const NO_NEXT_TRIGGER = '9999-12-31'
const QUOTA_EXHAUSTED = '43101' // 用户未订阅 / 订阅次数已用完
/**
 * 永久性错误：重试也没用，标记后当天不再尝试
 *   43101 用户未订阅 / 订阅次数已用完
 *   47003 模板参数不合法（缺 keyword、值超长）
 *   40037 模板 ID 无效（不属于本小程序 / 已删除 / 刚添加还没同步）
 */
const PERMANENT_ERRORS = ['43101', '47003', '40037']
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

/**
 * 订阅消息的 date 类字段只接受「年月日」写法（如 2026年9月25日），
 * 传 2026-09-25 会被判定为参数不合法；thing 类字段也兼容这种写法，因此统一转换。
 * 具体拼法在 lib/notify.js —— 小程序端的「提醒预览」读的是同一份逻辑，别在这里另写一套。
 */
function buildMessageData(reminder, occurrence, advance) {
  const values = notify.buildValues(reminder, occurrence, advance, CATEGORY_TEXT)
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
  // 自减是原子的，云端理论上不会负；但历史脏数据可能是负数，这里先夹平
  const entry = { quota: Math.max(0, Number(document && document.pushQuota) || 0), docId: document ? document._id : '' }
  cache[openid] = entry
  return entry
}

/**
 * 扣减额度：原子自减，不整份写回。
 * 客户端 addPushQuota 用的是 command.inc（订阅授权一次加一次），
 * 这边若写绝对值，就会把「读额度 → 推送 → 写回」这几秒里用户新加的份额静默盖掉：
 * 用户明明点了订阅，额度却没涨，要等到真推送时才报 43101 才发现。
 */
async function spendQuota(openid, cache, count) {
  if (!count) return
  const entry = await readQuota(openid, cache)
  if (!entry.docId) return
  // 云端记的额度不够扣（历史脏数据、或者某次推送漏记）：直接归零，
  // 别 inc 出一个负数——那会让「额度 -2 次」这种东西一路传到客户端显示
  if (entry.quota < count) {
    entry.quota = 0
    await db.collection('user_settings').doc(entry.docId).update({ data: { pushQuota: 0 } })
    return
  }
  entry.quota -= count
  await db.collection('user_settings').doc(entry.docId).update({ data: { pushQuota: _.inc(-count) } })
}

/**
 * 授权确实耗尽（43101）：绝对值置 0。
 * 这条路径故意不跟着改成 inc —— 报这个错说明云端记的额度和实际授权已经对不上，
 * 直接归零比再减一次更接近事实。
 */
async function clearQuota(openid, cache) {
  const entry = await readQuota(openid, cache)
  entry.quota = 0
  if (!entry.docId) return
  await db.collection('user_settings').doc(entry.docId).update({ data: { pushQuota: 0 } })
}

/**
 * 下一次触发日。触发日已过，所以从明天开始算。
 * 也没有下一次（单次提醒已结束）就写哨兵，别让它天天躺在扫描结果里。
 */
function nextTriggerAfter(reminder, dateText) {
  return reminderLib.nextTrigger(reminder, reminderLib.addDays(dateText, 1)) || NO_NEXT_TRIGGER
}

/** 推完一次就把下次触发日推进，这条提醒当天不会再被扫到 */
async function markPushed(reminder, dateText) {
  const nextTriggerDate = nextTriggerAfter(reminder, dateText)
  await db.collection('reminders').doc(reminder._id)
    .update({ data: { lastPushed: dateText, nextTriggerDate, updatedAt: Date.now() } })
    .catch(error => console.error('写入推送标记失败', reminder._id, error))
}

/**
 * 一条提醒今天要不要处理。
 * 抽出来是因为候选来自两条查询（索引命中的 + 没有 nextTriggerDate 的老数据），
 * 判断逻辑必须完全一致。
 */
function isCandidate(reminder, dateText, minutes, force, stats) {
  // 纪念日默认只在日历上标个日子，不推送；只有用户开了「到期提醒」才当普通提醒处理
  if (reminderLib.isAnniversary(reminder) && !reminderLib.anniversaryNotify(reminder)) { stats.skipped += 1; return false }
  if (!force && !inTimeWindow(reminder.time, minutes, WINDOW_MINUTES)) { stats.skipped += 1; return false }
  if (!force && reminder.lastPushed === dateText) { stats.skipped += 1; return false }
  if (!reminderLib.isTriggerOn(reminder, dateText)) { stats.skipped += 1; return false }
  return true
}

exports.main = async event => {
  const force = Boolean(event && event.force)
  const dateText = beijingDateText()
  const minutes = beijingMinutes()
  const startedAt = Date.now()
  const stats = { date: dateText, minutes, forced: force, scanned: 0, pushed: 0, skipped: 0, failed: 0, noQuota: 0, candidates: 0, backfilled: 0, scanMs: 0, message: '' }

  if (!TEMPLATE_ID) {
    stats.message = '未配置订阅消息模板 ID，已跳过推送'
    return stats
  }

  const quotaCache = {}
  const candidates = []

  // ① 主查询：只捞「下次触发日 <= 今天」的。
  //    以前是 where({enabled:true}) 全表翻，成本随「提醒总数」线性涨；
  //    现在扫到的条数只跟「今天要响的提醒」有关，跟用户一共攒了多少条无关。
  //    force 手动调试时退回全表，否则未来日期的提醒根本查不出来。
  const scanCondition = force ? { enabled: true } : { enabled: true, nextTriggerDate: _.lte(dateText) }
  // force 时主查询就是全表，兜底查询会把同一条再捞一次，用它去重
  const seen = new Set()
  let skip = 0
  while (true) {
    const result = await db.collection('reminders')
      .where(scanCondition)
      .skip(skip).limit(PAGE_SIZE).get()
    if (!result.data.length) break

    for (const document of result.data) {
      seen.add(document._id)
      stats.scanned += 1
      const reminder = { ...document }

      // 触发日已经过去：多半是上次推完没写回，或者用户改过规则。
      // 先自愈一次，别让它天天占着扫描名额。
      if (!force && reminder.nextTriggerDate && reminder.nextTriggerDate < dateText) {
        const next = reminderLib.nextTrigger(reminder, dateText) || NO_NEXT_TRIGGER
        await db.collection('reminders').doc(document._id)
          .update({ data: { nextTriggerDate: next } })
          .catch(error => console.error('修正下次触发日失败', document._id, error))
        if (next > dateText) { stats.skipped += 1; continue }
      }

      if (isCandidate(reminder, dateText, minutes, force, stats)) candidates.push(reminder)
    }

    if (result.data.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }

  // ② 兜底：升级前创建的提醒没有 nextTriggerDate 字段，索引查不到。
  //    扫一轮顺手补上，之后它们就走 ① 了。正常情况下这一批第一次跑完就空了。
  const legacy = await db.collection('reminders')
    .where({ enabled: true, nextTriggerDate: _.exists(false) })
    .limit(PAGE_SIZE).get()
    .catch(error => { console.error('查询缺 nextTriggerDate 的提醒失败', error); return { data: [] } })
  for (const document of legacy.data) {
    if (seen.has(document._id)) continue
    stats.scanned += 1
    stats.backfilled += 1
    const reminder = { ...document }
    const next = reminderLib.nextTrigger(reminder, dateText) || NO_NEXT_TRIGGER
    await db.collection('reminders').doc(document._id)
      .update({ data: { nextTriggerDate: next } })
      .catch(error => console.error('补写下次触发日失败', document._id, error))
    if (isCandidate(reminder, dateText, minutes, force, stats)) candidates.push(reminder)
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
      await spendQuota(openid, quotaCache, spent[openid])
      spent[openid] = 0
    }
  }

  return stats
}

/** 推一条提醒；失败分「永久」和「临时」两种，临时失败不写 lastPushed，当天还能再试 */
async function pushOne(item, dateText, stats, quotaCache, spent) {
  const { reminder } = item
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
    await markPushed(reminder, dateText)
    if (CHECK_QUOTA) spent[openid] = (spent[openid] || 0) + 1
  } catch (error) {
    stats.failed += 1
    console.error('订阅消息推送失败', reminder._id, error)
    const code = String(error && error.errCode)
    if (code === QUOTA_EXHAUSTED) {
      await clearQuota(openid, quotaCache).catch(() => {})
    }
    if (PERMANENT_ERRORS.includes(code)) {
      // 额度用完 / 模板参数不对：重试也不会成功，标记掉当天不再试
      await markPushed(reminder, dateText)
      return
    }
    // 网络抖动、超时这类临时失败：故意不写 lastPushed，
    // 下一个窗口（15 分钟内还有两次）会重新推，避免一次失败就整天收不到
    console.warn('推送失败但原因可能是临时的，本次不标记已推送，等待下一轮重试', reminder._id, code)
  }
}
