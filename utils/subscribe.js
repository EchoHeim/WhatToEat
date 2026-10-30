/**
 * 微信订阅消息封装
 *
 * 模板 ID 定义在 utils/notify.js（与云函数共用同一份），改模板只改那里。
 * 申请路径：微信公众平台 → 功能 → 订阅消息 → 公共模板库。
 */

const { TEMPLATE_ID } = require('./notify')

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
