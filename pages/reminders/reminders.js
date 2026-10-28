const store = require('../../utils/store')
const reminderLib = require('../../utils/reminder')
const subscribe = require('../../utils/subscribe')

const GROUP_DEFS = [
  { key: 'anniversary', title: '纪念日', hint: '日历上标成紫色' },
  { key: 'today', title: '今天', hint: '到点啦' },
  { key: 'soon', title: '未来 7 天', hint: '' },
  { key: 'later', title: '更远', hint: '' },
  { key: 'closed', title: '已关闭 / 已结束', hint: '' }
]

Page({
  data: {
    groups: [],
    todayCount: 0,
    total: 0,
    todayText: '',
    pushReady: false,
    pushQuota: 0,
    cloudHint: '',
    loading: true
  },
  onShow() {
    // 先画本地缓存；云环境自检和同步都放后台，不挡首屏
    this.refresh()
    this.checkCloud()
    store.syncFromCloud()
      .then(synced => { if (synced) this.refresh() })
      .catch(error => console.error('云同步失败，使用本地数据', error))
  },
  async checkCloud() {
    const result = await store.checkCloudReady()
    this.setData({ cloudHint: result.ok ? '' : result.message })
  },
  refresh() {
    const todayText = reminderLib.today()
    const settings = store.getSettings()
    const all = store.getReminders()
    // 纪念日不是在「某天推送」，而是在日历上标个日子，单独成组，别混进今天/未来 7 天
    const anniversaryViews = all.filter(reminderLib.isAnniversary).map(item => {
      const next = reminderLib.nextOccurrence(item, todayText)
      const days = next ? reminderLib.diffDays(todayText, next) : null
      return {
        id: item.id,
        content: item.content,
        enabled: item.enabled !== false,
        calendarText: reminderLib.calendarLabel(item.calendar),
        repeatText: '每年',
        timeText: reminderLib.anniversaryNotify(item) ? reminderLib.advanceText(item) : '不推送',
        advanceText: reminderLib.anniversaryNotify(item)
          ? `${item.time || reminderLib.DEFAULT_TIME} 提醒`
          : '只在日历上标记 · 数字变紫',
        eventLabel: next || '',
        dateText: days === null ? '已结束' : reminderLib.relativeText(days),
        triggerText: '',
        active: true,
        today: days === 0,
        days: days === null ? 99999 : days
      }
    })
    const views = all.filter(item => !reminderLib.isAnniversary(item)).map(item => {
      const view = reminderLib.describe(item, todayText)
      return {
        id: item.id,
        content: item.content,
        enabled: item.enabled !== false,
        calendarText: view.calendarText,
        repeatText: view.repeatText,
        timeText: view.timeText,
        advanceText: view.advanceText,
        eventLabel: view.eventLabel,
        dateText: view.dateText,
        triggerText: view.triggerText,
        active: view.active,
        today: view.active && view.days === 0,
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
    groups.forEach(group => group.items.sort((a, b) => a.days - b.days))
    this.setData({
      todayText,
      groups: groups.filter(group => group.items.length),
      todayCount: groups[1].items.length,
      total: views.length + anniversaryViews.length,
      pushReady: subscribe.configured(),
      pushQuota: Number(settings.pushQuota || 0),
      loading: false
    })
  },
  addReminder() { wx.navigateTo({ url: '/pages/reminder-form/reminder-form' }) },
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
        content: '请先在微信公众平台申请订阅消息模板，并把模板 ID 填入 utils/subscribe.js 与 cloudfunctions/reminderPush/lib/config.js，然后部署云函数。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    try {
      const accepted = await subscribe.requestSubscribe()
      if (!accepted) {
        wx.showToast({ title: '已取消授权', icon: 'none' })
        return
      }
      await store.addPushQuota(1)
      wx.showToast({ title: '已增加 1 次推送' })
    } catch (error) {
      console.error('订阅授权失败', error)
      wx.showToast({ title: '订阅授权失败', icon: 'none' })
    }
    this.refresh()
  }
})
