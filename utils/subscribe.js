/**
 * 微信订阅消息封装
 *
 * 使用前需要在「微信公众平台 → 功能 → 订阅消息」里申请一个模板，
 * 并把模板 ID 填到下面的 TEMPLATE_ID。云函数侧模板 ID 配在
 * cloudfunctions/reminderPush/lib/config.js，两边必须保持一致。
 *
 * 模板字段建议（具体 key 由你申请的模板决定）：
 *   thing1  提醒内容
 *   date2   事件日期
 *   thing3  备注（还有几天 / 就是今天）
 */

const TEMPLATE_ID = 'HcqoSxyPU44u5AItKZCKJY_xnhIjZDPz_yHPeDBG2_c'

/** 是否已配置模板，未配置时前端只展示应用内提醒 */
function configured() {
  return Boolean(TEMPLATE_ID) && typeof wx !== 'undefined' && Boolean(wx.requestSubscribeMessage)
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

module.exports = { TEMPLATE_ID, configured, requestSubscribe }
