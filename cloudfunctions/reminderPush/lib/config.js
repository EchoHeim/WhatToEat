/** 微信订阅消息模板 ID，必须与小程序端 utils/subscribe.js 保持一致 */
const TEMPLATE_ID = 'HcqoSxyPU44u5AItKZCKJY_xnhIjZDPz_yHPeDBG2_c'

/**
 * 模板字段映射：key 为模板中的字段名，value 为数据来源（见 index.js 的 values）
 *
 * 当前 TEMPLATE_ID 对应的是一个「日程提醒」类模板，共 5 个关键词，
 * 缺任何一个都会报 47003 data.XXX.value is empty，多余 key 会被微信忽略。
 *
 * 2026-10-24 依据真机收到的通知（服务通知里那五行）反推确定的对应关系：
 *   日程标题 ← thing5      提醒内容 ← thing2     时间 ← time25
 *   地点     ← thing10     日程类别 ← short_thing19
 * 判定依据：当时 thing2=eventDate、thing5/time25=time、thing10/short_thing19=note，
 * 五行实际显示为「时间 / 日期 / 时间 / note / note」，且 time25 是 time 类型的关键词、
 * short_thing19 是短文本类型，正好落位「时间」与「日程类别」两个槽。
 *
 * 说明：这是日历类模板，套在用餐提醒上，「地点」「提醒内容」两个槽语义并不贴合，
 * 只能按下面这套最不违和的填法。若将来换成吃得上的用餐/待办模板，改这里即可。
 */
const TEMPLATE_FIELDS = {
  thing5: 'content', // 日程标题
  thing2: 'note', // 提醒内容：就是今天 / 还有 N 天
  time25: 'time', // 时间
  thing10: 'eventDate', // 地点（借用来放日期）
  short_thing19: 'category' // 日程类别
}

/** 「日程类别」槽位的固定文案 */
const CATEGORY_TEXT = '用餐提醒'

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

module.exports = { TEMPLATE_ID, TEMPLATE_FIELDS, CATEGORY_TEXT, PAGE, MINIPROGRAM_STATE, SUBSCRIBE_MODE }
