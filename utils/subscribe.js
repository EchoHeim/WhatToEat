/**
 * 微信订阅消息封装
 *
 * 模板 ID 定义在 utils/notify.js（与云函数共用同一份），改模板只改那里。
 * 申请路径：微信公众平台 → 功能 → 订阅消息 → 公共模板库。
 *
 * ── 推送额度怎么「无感」变多 ─────────────────────────────
 * 微信没有永久授权，一次性订阅是「授权一次 = 可下发一条」，额度只能靠授权次数攒。
 * 唯一的自动化口子是订阅弹窗底部的「总是保持以上选择，不再询问」：用户勾上之后，
 * 同一模板再调 wx.requestSubscribeMessage 不会弹窗，直接返回 accept，微信侧再记一次
 * 订阅——等于又 +1。微信官方的小游戏指南把它明写成「推送多次消息的方案一」。
 *
 * 于是这里分两步：
 *   1. refreshState() 用 wx.getSetting({withSubscriptions:true}) 探勾选状态。
 *      itemSettings 只包含勾过「总是保持」的模板，空着就是没勾过——唯一判据。
 *   2. topUpIfNeeded() 挂在用户自然的点击动作里，静默补一次。
 *
 * ⚠️ 两条硬约束，动之前先看：
 *   - 必须在 tap 回调里同步发起（别 await 完网络再调），否则报
 *     `can only be invoked by user TAP gesture`；
 *   - 不能无场景硬刷。滥用订阅消息会被平台处罚，所以有水位上限 + 每小时封顶。
 */

const store = require('./store')
const { TEMPLATE_ID } = require('./notify')

/** 订阅勾选状态的本地缓存：{ mainSwitch, item, at }。键名由 store 统一管，清空数据时要留着 */
const STATE_KEY = store.SUBSCRIBE_STATE_KEY
/** 额度涨到这个数就停手：再多也是白攒，UI 上还显示成一长串怪数。手动点「额度+1」不受它约束 */
const HIGH_WATER = 60
/**
 * 一小时内最多补几次：正常手速到不了，纯粹防连点 / 脚本。
 * 定 40 是为了不成为瓶颈——水位 60、预期两天补满，单日得补 30 次，
 * 留三成余量才不会「人点够了、预算先没了」。
 */
const MAX_PER_HOUR = 40
const HOUR_MS = 60 * 60 * 1000

/** 防连点：上一次订阅还没回来时不发起第二次 */
let toppingUp = false
/** 滑动小时窗口里的补额度预算 */
let budget = { start: 0, count: 0 }

function hasWx() {
  return typeof wx !== 'undefined'
}

/** 是否已配置模板，未配置时前端只展示应用内提醒 */
function configured() {
  return Boolean(TEMPLATE_ID) && hasWx() && Boolean(wx.requestSubscribeMessage)
}

/** 申请订阅授权；用户每次接受可获得 1 次推送额度 */
function requestSubscribe() {
  return new Promise((resolve, reject) => {
    if (!TEMPLATE_ID) {
      reject(new Error('尚未配置订阅消息模板 ID'))
      return
    }
    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success: result => resolve(result[TEMPLATE_ID] === 'accept'),
      fail: reject
    })
  })
}

function readState() {
  if (!hasWx() || !wx.getStorageSync) return null
  try {
    const saved = wx.getStorageSync(STATE_KEY)
    return saved && typeof saved === 'object' ? saved : null
  } catch (error) {
    return null
  }
}

function writeState(patch) {
  if (!hasWx() || !wx.setStorageSync) return null
  // 首次调用时 readState() 是 null，展开它靠 ES2018 的对象展开规则兜底；
  // 写显式的 || {} 是为了让老基础库的转译也不踩空
  const next = { ...(readState() || {}), ...patch, at: Date.now() }
  try {
    wx.setStorageSync(STATE_KEY, next)
  } catch (error) {
    // 存不下就算了，下次 onShow 重新探一遍
  }
  return next
}

/**
 * 探测订阅勾选状态，结果落本地缓存。
 * 内部要发一次异步查询，只能在 onShow / 同步流程里调——塞进 tap 会把真正的
 * 订阅调用挤出点击窗口。
 */
function refreshState() {
  if (!configured() || typeof wx.getSetting !== 'function') return Promise.resolve(readState())
  return new Promise(resolve => {
    try {
      wx.getSetting({
        withSubscriptions: true,
        success: res => {
          const setting = (res && res.subscriptionsSetting) || {}
          resolve(writeState({
            // 老基础库不一定带 mainSwitch，缺省当作开着
            mainSwitch: setting.mainSwitch !== false,
            // itemSettings 只包含勾过「总是保持以上选择」的模板，空串表示没勾过
            item: (setting.itemSettings || {})[TEMPLATE_ID] || ''
          }))
        },
        fail: error => {
          // 查询失败不动缓存：上次的状态比「未知」有用
          console.warn('读取订阅设置失败', error)
          resolve(readState())
        }
      })
    } catch (error) {
      // 同步抛（参数不被支持之类）也只当作「没探到」，别把 onShow 拖垮
      console.warn('读取订阅设置失败', error)
      resolve(readState())
    }
  })
}

/** UI 用：'accept' 自动补已开 / 'reject' 被拒收 / 'off' 总开关关了 / '' 还没勾过 */
function autoState() {
  const state = readState()
  if (!state) return ''
  if (!state.mainSwitch) return 'off'
  return state.item || ''
}

/** 能不能静默补：勾过「总是保持」且选了同意，主开关没关 */
function silentReady() {
  return autoState() === 'accept'
}

/** 滑动小时窗口里的预算，防连点把订阅接口刷爆 */
function takeBudget() {
  const now = Date.now()
  if (now - budget.start >= HOUR_MS) budget = { start: now, count: 0 }
  if (budget.count >= MAX_PER_HOUR) return false
  budget.count += 1
  return true
}

/**
 * 静默补一次额度。不弹窗、不提示、失败也不打扰用户。
 * **必须在 tap 回调里同步调用**，返回值不用等。
 * @returns {Promise<'added'|'skip'|'reject'|'error'>}
 */
function autoTopUp() {
  if (toppingUp || !silentReady()) return Promise.resolve('skip')
  toppingUp = true
  return requestSubscribe()
    .then(accepted => {
      if (!accepted) {
        // 勾了「总是保持」却返回 reject，说明用户在设置页改成了拒收
        toppingUp = false
        writeState({ item: 'reject' })
        return 'reject'
      }
      return store.addPushQuota(1).then(() => {
        toppingUp = false
        return 'added'
      })
    })
    .catch(error => {
      toppingUp = false
      // 20004 = 订阅消息总开关被关，记下来别再白调
      if (Number(error && error.errCode) === 20004) writeState({ mainSwitch: false })
      console.warn('静默补推送额度失败', error)
      return 'error'
    })
}

/**
 * 水位不足时静默补一次。页面里直接调，别 await——等它回来就错过点击手势了。
 * 额度到 HIGH_WATER 就停手，一小时最多补 MAX_PER_HOUR 次。
 * 手动点「额度+1」走 requestSubscribe()，不受这两条约束。
 *
 * 整体包一层 try/catch：它被挂在抽签、保存、签到这些主流程的第一行，
 * 补额度出任何岔子都不能反过来把主流程弄断。
 */
function topUpIfNeeded() {
  try {
    if (toppingUp || !silentReady()) return Promise.resolve('skip')
    if (Number(store.getSettings().pushQuota || 0) >= HIGH_WATER) return Promise.resolve('skip')
    if (!takeBudget()) return Promise.resolve('skip')
    return autoTopUp()
  } catch (error) {
    console.warn('检查推送额度失败', error)
    return Promise.resolve('error')
  }
}

module.exports = {
  TEMPLATE_ID,
  HIGH_WATER,
  MAX_PER_HOUR,
  configured,
  requestSubscribe,
  refreshState,
  autoState,
  silentReady,
  topUpIfNeeded
}
