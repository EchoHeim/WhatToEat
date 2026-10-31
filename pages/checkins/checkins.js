const store = require('../../utils/store')
const checkinLib = require('../../utils/checkin')
const subscribe = require('../../utils/subscribe')
const { randomQuote, randomMark } = require('../../utils/quotes')

function dateLabel(dateText) {
  if (!checkinLib.isDateText(dateText)) return dateText
  return `${Number(dateText.slice(5, 7))} 月 ${Number(dateText.slice(8, 10))} 日`
}

Page({
  data: {
    quote: '',
    mark: '',
    today: '',
    checkedToday: false,
    todayMood: null,
    todayRecord: null,
    streak: 0,
    total: 0,
    monthCount: 0,
    strip: [],
    tally: [],
    list: [],
    loading: true
  },
  onShow() {
    // 每进一次页面换一句、换一个小标记，和页面数据无关，先设好再画内容
    this.setData({ quote: randomQuote(), mark: randomMark() })
    // 先画本地缓存，同步在后台跑完再刷新
    this.refresh()
    store.syncThen(() => this.refresh())
  },
  refresh() {
    const checkins = store.getCheckins()
    const info = checkinLib.overview(checkins)
    const tally = checkinLib.moodTally(checkins, checkinLib.monthPrefix(info.today))
    const max = tally.reduce((value, item) => Math.max(value, item.count), 0)
    const list = checkins.map(item => {
      const mood = checkinLib.normalizeMood(item.mood, item.moodKey)
      return {
        id: item.id,
        date: item.date,
        dateLabel: dateLabel(item.date),
        weekday: checkinLib.weekdayText(item.date),
        emoji: mood.emoji,
        icon: mood.icon,
        moodLabel: mood.label,
        note: item.note || '',
        isToday: item.date === info.today
      }
    })
    this.setData({
      today: info.today,
      checkedToday: info.checkedToday,
      todayMood: info.todayMood,
      todayRecord: info.todayRecord ? { ...info.todayRecord, note: info.todayRecord.note || '' } : null,
      streak: info.streak,
      total: info.total,
      monthCount: info.monthCount,
      strip: checkinLib.buildStrip(checkins, info.today, 14),
      tally: tally.map(item => ({ ...item, percent: max ? Math.max(10, Math.round((item.count / max) * 100)) : 0 })),
      list,
      loading: false
    })
  },
  // 「签到 / 修改」和空态里的「去签到」都是自然点击，顺手补一次推送额度
  openToday() {
    subscribe.topUpIfNeeded()
    wx.navigateTo({ url: `/pages/checkin-form/checkin-form?date=${this.data.today}` })
  },
  goForm() {
    subscribe.topUpIfNeeded()
    wx.navigateTo({ url: `/pages/checkin-form/checkin-form?date=${this.data.today}` })
  },
  // 点列表里某条是「改过去的签到」，不算签到动作，不补
  openCheckin(e) { wx.navigateTo({ url: `/pages/checkin-form/checkin-form?date=${e.currentTarget.dataset.date}` }) },
  removeCheckin(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除这条签到？',
      confirmColor: '#C84832',
      success: async res => {
        if (!res.confirm) return
        try {
          await store.deleteCheckin(id)
          wx.showToast({ title: '已删除' })
        } catch (error) {
          console.error(error)
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        }
        this.refresh()
      }
    })
  }
})
