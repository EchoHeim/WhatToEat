/**
 * 订阅消息：模板结构 + 槽位文案
 *
 * 这里是「模板长什么样」和「每个槽填什么」的唯一来源：
 *   - 小程序端用它渲染编辑页的「微信里会收到这样一条」预览
 *   - 云函数用它拼真正发出去的 data
 * 两边读同一份逻辑，预览才不会骗人。
 *
 * 切换模板只改下面的 ACTIVE_TEMPLATE，然后复制到
 * cloudfunctions/reminderPush/lib/notify.js（云端副本），再重部署云函数。
 * ⚠️ 换模板后用户必须在提醒页重新点「额度+1」——一次性订阅的授权绑模板，
 *    旧额度对新模板无效，不重新授权会报 43101。
 */
const reminderLib = require('./reminder')

/** thing / short_thing 类关键词最多 20 个字，超了微信报 47003 */
const THING_LIMIT = 20

/** 「日程类别」槽的固定文案（只有 legacy 模板有这个槽） */
const DEFAULT_CATEGORY = '用餐提醒'

/**
 * 两套模板预设：
 *
 * legacy  —— 5 关键词「日程提醒」，已验证可长期使用。缺点是多出「地点」「日程类别」两行：
 *            日期只能塞「地点」，类别固定「用餐提醒」。
 * compact —— 编号 571 的 3 关键词模板（日程标题 / 日程时间 / 提醒内容），少两行，**当前生效的就是它**。
 *            date4 是 date 类型，只认「2026年10月30日」这种写法，所以日期放这格；
 *            没有独立时间槽，钟点拼进「提醒内容」（timeNote）。
 *            2026-10-29 那个同编号的模板一直报 `40037 invalid template_id`（抄写与同步延迟都排除过），
 *            10-30 删掉重建了一个新 ID，立刻通了。所以遇到 40037 先怀疑模板本身，不是代码。
 */
const TEMPLATES = {
  legacy: {
    id: 'HcqoSxyPU44u5AItKZCkJY_xnhIjZDPz_yHPeDBG2_c',
    slots: [
      { key: 'thing5', label: '日程标题', source: 'content', sourceLabel: '名称' },
      { key: 'thing2', label: '提醒内容', source: 'note', sourceLabel: '提前提醒' },
      { key: 'time25', label: '时间', source: 'time', sourceLabel: '提醒时间' },
      { key: 'thing10', label: '地点', source: 'eventDate', sourceLabel: '日期' },
      { key: 'short_thing19', label: '日程类别', source: 'category', sourceLabel: '固定' }
    ]
  },
  compact: {
    // 2026-10-30 重新添加的版本（编号仍是 571，ID 与 10-29 那个不同）
    id: 'HcqoSxyPU44u5AItKZCKJVcBK9TWphDfbMmGwvh_oXM',
    slots: [
      { key: 'thing5', label: '日程标题', source: 'content', sourceLabel: '名称' },
      { key: 'date4', label: '日程时间', source: 'eventDate', sourceLabel: '日期' },
      { key: 'thing2', label: '提醒内容', source: 'timeNote', sourceLabel: '提前提醒' }
    ]
  }
}

/** 当前生效的模板：'legacy' 或 'compact' */
const ACTIVE_TEMPLATE = 'compact'

const TEMPLATE_ID = TEMPLATES[ACTIVE_TEMPLATE].id
const TEMPLATE_SLOTS = TEMPLATES[ACTIVE_TEMPLATE].slots

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

/** 提醒内容槽：提前几天 —— 这一行对应用户设置的「提前提醒」 */
function noteText(advance) {
  if (advance === 0 || advance === null || advance === undefined) return '就是今天'
  return `还有 ${advance} 天`
}

/** 一条提醒 → 模板要的值（比当前模板用到的多备几个，换模板时直接取） */
function buildValues(reminder, occurrence, advance, category) {
  const time = reminderLib.normalizeTime(reminder && reminder.time) || reminderLib.DEFAULT_TIME
  const note = noteText(advance)
  const remark = truncate(String((reminder && reminder.remark) || '').trim(), THING_LIMIT)
  return {
    content: truncate(reminder && reminder.content, THING_LIMIT),
    eventDate: toChineseDate(occurrence),
    time,
    note,
    // compact 模板没有独立时间槽，「提醒内容」这行要装三样：备注（用户要求放最前）、
    // 提前状态、钟点。整行仍受 20 字限制，超了按 truncate 截断，编辑页的预览会实时显示最终样子。
    timeNote: truncate([remark, note, time].filter(Boolean).join(' · '), THING_LIMIT),
    category: truncate(category || DEFAULT_CATEGORY, THING_LIMIT)
  }
}

module.exports = {
  THING_LIMIT,
  DEFAULT_CATEGORY,
  TEMPLATES,
  ACTIVE_TEMPLATE,
  TEMPLATE_ID,
  TEMPLATE_SLOTS,
  truncate,
  toChineseDate,
  noteText,
  buildValues
}
