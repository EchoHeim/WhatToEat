/**
 * 云函数侧的订阅消息配置。
 *
 * 模板 ID 与「哪个槽填哪个值」都定义在 lib/notify.js —— 小程序端读的是同一份，
 * 换模板只改 utils/notify.js 再复制过来，别在这里另抄一套。
 */
const { TEMPLATE_ID, TEMPLATE_SLOTS, DEFAULT_CATEGORY } = require('./notify')

/** 模板字段映射：key 为模板关键词，value 为 lib/notify.js buildValues() 的字段名 */
const TEMPLATE_FIELDS = TEMPLATE_SLOTS.reduce((acc, slot) => {
  acc[slot.key] = slot.source
  return acc
}, {})

/** 「日程类别」槽位的固定文案（当前模板已没有这个槽，换回带类别的模板时用） */
const CATEGORY_TEXT = DEFAULT_CATEGORY

/** 点击推送消息后跳转的小程序页面 */
const PAGE = 'pages/reminders/reminders'

/** 正式版 formal / 体验版 trial / 开发版 developer */
const MINIPROGRAM_STATE = 'formal'

/**
 * 订阅类型，决定是否校验推送额度：
 *   'once'     一次性订阅（默认）— 用户授权一次只能推送一条，靠 user_settings.pushQuota 记账
 *   'longterm' 长期订阅 — 仅政务民生 / 医疗 / 交通 / 金融 / 教育等线下公共服务类目可申请，
 *                          授权一次可长期下发，推送时不再校验额度
 * 工具类小程序在公共模板库里只能选用一次性订阅，保持默认值即可。
 */
const SUBSCRIBE_MODE = 'once'

module.exports = { TEMPLATE_ID, TEMPLATE_FIELDS, TEMPLATE_SLOTS, CATEGORY_TEXT, PAGE, MINIPROGRAM_STATE, SUBSCRIBE_MODE }
