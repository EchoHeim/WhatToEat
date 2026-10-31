const store = require('../../utils/store')
const reminderLib = require('../../utils/reminder')
const subscribe = require('../../utils/subscribe')

const GROUP_DEFS = [
  { key: 'anniversary', title: '纪念日', hint: '' },
  { key: 'today', title: '今天', hint: '到点啦' },
  { key: 'soon', title: '未来 7 天', hint: '' },
  { key: 'later', title: '更远', hint: '' },
  { key: 'closed', title: '已关闭 / 已过期', hint: '' }
]

/**
 * 推送卡片副标题：四种订阅状态各一句话。
 * 放在这里而不是 wxml 里堆三元——四层嵌套的三元读起来就是一团乱麻。
 */
function pushHintText(ready, auto, quota) {
  if (!ready) return '未配置订阅消息模板 ID，当前仅应用内提醒'
  if (auto === 'off') return '订阅消息总开关已关闭，点右边去设置页打开'
  if (auto === 'reject') return '订阅已被拒收，点右边去设置页改成允许'
  if (auto === 'accept') {
    return quota >= subscribe.HIGH_WATER
      ? `已达 ${subscribe.HIGH_WATER} 次上限，自动补已停 · 剩余 ${quota} 次`
      : '自动补额度已开启 · 额度会在下次点击时补上'
  }
  return '首次点「额度+1」时勾选「总是保持」，之后就能自动补'
}

/** 顶部横幅副标题：开了自动补就别再说「收到后请再次开启」，到了上限也别再承诺自动补 */
function bannerSubText(auto, quota) {
  if (auto === 'accept' && quota < subscribe.HIGH_WATER) {
    return quota > 0 ? `微信推送剩余 ${quota} 次，会自动补` : '额度会在下次点击时自动补上'
  }
  return quota > 0 ? `微信推送剩余 ${quota} 次` : '微信推送次数已用完，收到后请再次开启'
}

/** 推送卡片那几个字段的补丁：首屏 refresh 和异步回填共用一份，避免两处文案算岔 */
function pushPatch(ready, auto, quota) {
  return {
    pushReady: ready,
    pushAuto: auto,
    pushQuota: quota,
    pushHint: pushHintText(ready, auto, quota),
    bannerSub: bannerSubText(auto, quota)
  }
}

Page({
  data: {
    groups: [],
    todayCount: 0,
    total: 0,
    todayText: '',
    pushReady: false,
    pushQuota: 0,
    /** 'accept' 自动补已开 / 'reject' 被拒收 / 'off' 总开关关了 / '' 还没勾过 */
    pushAuto: '',
    pushHint: '',
    bannerSub: '',
    cloudHint: '',
    loading: true
  },
  onShow() {
    // 先画本地缓存；同步放后台，不挡首屏
    this.refresh()
    // 探到「总是保持」的真实勾选状态再回填推送卡片，不然文案会停在上一轮的旧结论。
    // 只补那几个字段，不整份 refresh——它回来得比首屏晚，全量重建会把列表重渲一遍
    subscribe.refreshState()
      .then(() => this.paintPush())
      .catch(error => console.warn('刷新推送状态失败', error))
    store.syncFromCloud()
      .then(synced => {
        if (!synced) return
        // 这一轮同步跑通了，之前那句「云端没配好」就该撤掉
        if (this.data.cloudHint) this.setData({ cloudHint: '' })
        this.refresh()
      })
      // 只有同步真失败才去自检集合：正常路径不该为了一句提示白付五次查询
      .catch(error => {
        console.error('云同步失败，使用本地数据', error)
        this.checkCloud()
      })
  },
  async checkCloud() {
    const result = await store.checkCloudReady()
    this.setData({ cloudHint: result.ok ? '' : result.message })
  },
  refresh() {
    const todayText = reminderLib.today()
    const settings = store.getSettings()
    const all = store.getReminders()
    // 页面把「现在几点」显式传给引擎：引擎内部也有一份默认值，但列表页要能被测试固定住
    const nowText = reminderLib.nowTime()
    // 纪念日不是在「某天推送」，而是在日历上标个日子，单独成组，别混进今天/未来 7 天
    const anniversaryViews = all.filter(reminderLib.isAnniversary).map(item => {
      const next = reminderLib.nextOccurrence(item, todayText)
      const days = next ? reminderLib.diffDays(todayText, next) : null
      const dateText = days === null ? '已结束' : reminderLib.relativeText(days)
      return {
        id: item.id,
        content: item.content,
        enabled: item.enabled !== false,
        calendarText: reminderLib.calendarLabel(item.calendar),
        lunarTag: item.calendar === 'lunar' ? '农历' : '',
        repeatText: '每年',
        timeText: reminderLib.anniversaryNotify(item) ? reminderLib.advanceText(item) : '不推送',
        advanceText: reminderLib.anniversaryNotify(item)
          ? `${item.time || reminderLib.DEFAULT_TIME} 提醒`
          : '只在日历上标记 · 数字变紫',
        eventLabel: next || '',
        dateText,
        statusText: dateText,
        triggerText: '',
        active: true,
        expired: false,
        today: days === 0,
        days: days === null ? 99999 : days
      }
    })
    const views = all.filter(item => !reminderLib.isAnniversary(item)).map(item => {
      const view = reminderLib.describe(item, todayText, nowText)
      // 过期 = 单次提醒的触发日就是今天、但时刻已经过去：今天不会再响，
      // 归到最下方那组灰着显示，别在「今天 · 到点啦」里冒充待办。
      const expired = view.expired
      return {
        id: item.id,
        content: item.content,
        enabled: item.enabled !== false,
        calendarText: view.calendarText,
        lunarTag: item.calendar === 'lunar' ? '农历' : '',
        repeatText: view.repeatText,
        timeText: view.timeText,
        advanceText: view.advanceText,
        eventLabel: view.eventLabel,
        dateText: view.dateText,
        statusText: view.statusText,
        triggerText: view.triggerText,
        active: view.active && !expired,
        expired,
        today: view.active && !expired && view.days === 0,
        days: view.days === null ? 99999 : view.days
      }
    })
    const groups = GROUP_DEFS.map(def => ({ ...def, items: [] }))
    groups[0].items = anniversaryViews
    views.forEach(item => {
      if (!item.active) groups[4].items.push(item)
      else if (item.days <= 0) groups[1].items.push(item)
      else if (item.days <= 7) groups[2].items.push(item)
      else groups[3].items.push(item)
    })
    // 不再触发的（已关闭 / 已结束 / 已过期）压在组内最下方，过期的再垫底
    const rank = item => (item.expired ? 2 : item.active ? 0 : 1)
    groups.forEach(group => group.items.sort((a, b) => rank(a) - rank(b) || a.days - b.days))
    const pushReady = subscribe.configured()
    const pushAuto = subscribe.autoState()
    const pushQuota = Number(settings.pushQuota || 0)
    this.setData({
      todayText,
      groups: groups.filter(group => group.items.length),
      todayCount: groups[1].items.length,
      total: views.length + anniversaryViews.length,
      ...pushPatch(pushReady, pushAuto, pushQuota),
      loading: false
    })
  },
  /**
   * 只回填推送卡片那几行文案，不重建整份列表。
   * refreshState 比首屏慢一拍，在这里全量 refresh 会把用户正在看的列表重渲一遍。
   */
  paintPush() {
    const settings = store.getSettings()
    this.setData(pushPatch(subscribe.configured(), subscribe.autoState(), Number(settings.pushQuota || 0)))
  },
  editReminder(e) { wx.navigateTo({ url: `/pages/reminder-form/reminder-form?id=${e.currentTarget.dataset.id}` }) },
  noop() {},
  async toggleReminder(e) {
    const id = e.currentTarget.dataset.id
    try {
      await store.toggleReminder(id, e.detail.value)
    } catch (error) {
      console.error(error)
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
    this.refresh()
  },
  removeReminder(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除这条提醒？',
      confirmColor: '#C84832',
      success: async res => {
        if (!res.confirm) return
        try {
          await store.deleteReminder(id)
        } catch (error) {
          console.error(error)
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        }
        this.refresh()
      }
    })
  },
  async enablePush() {
    if (!subscribe.configured()) {
      wx.showModal({
        title: '还没有配置模板 ID',
        content: '请先在微信公众平台申请订阅消息模板，把模板 ID 与槽位映射填进 utils/notify.js，复制到 cloudfunctions/reminderPush/lib/notify.js，再部署云函数。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    // 已经拒收 / 总开关关着时，再调订阅接口只会静默返回 reject，只能去设置页改
    const auto = subscribe.autoState()
    if (auto === 'reject' || auto === 'off') {
      wx.openSetting({
        withSubscriptions: true,
        // 从设置页回来不会触发页面 onShow（它是原生页），只能靠这个回调补一次；
        // 列表没变，只回填推送卡片
        success: () => subscribe.refreshState()
          .then(() => this.paintPush())
          .catch(error => console.warn('刷新推送状态失败', error))
      })
      return
    }
    try {
      const accepted = await subscribe.requestSubscribe()
      if (!accepted) {
        wx.showToast({ title: '已取消授权', icon: 'none' })
      } else {
        await store.addPushQuota(1)
        wx.showToast({ title: '已增加 1 次推送' })
      }
    } catch (error) {
      console.error('订阅授权失败', error)
      wx.showToast({ title: '订阅授权失败', icon: 'none' })
    }
    // 授权结果可能改了「总是保持」的勾选状态，重探一遍让文案跟上
    subscribe.refreshState()
      .then(() => this.paintPush())
      .catch(error => console.warn('刷新推送状态失败', error))
  }
})
