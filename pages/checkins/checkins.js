const store = require('../../utils/store')
const checkinLib = require('../../utils/checkin')

function dateLabel(dateText) {
  if (!checkinLib.isDateText(dateText)) return dateText
  return `${Number(dateText.slice(5, 7))} 月 ${Number(dateText.slice(8, 10))} 日`
}

Page({
  data: {
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
    // 先画本地缓存，同步在后台跑完再刷新
    this.refresh()
    store.syncFromCloud()
      .then(synced => { if (synced) this.refresh() })
      .catch(error => console.error('云同步失败，使用本地数据', error))
  },
  refresh() {
    const checkins = store.getCheckins()
    const records = store.getRecords()
    // 饮食统一从「记录一餐」汇总，旧签到里的手写文本只作为兜底
    const mealsByDate = {}
    records.forEach(item => {
      if (!item || !item.date) return
      if (!mealsByDate[item.date]) mealsByDate[item.date] = []
      mealsByDate[item.date].push(item)
    })
    const dietOf = (date, fallback) => (mealsByDate[date] ? mealsByDate[date].map(item => item.dishName).join('、') : fallback || '')
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
        moodLabel: mood.label,
        diet: dietOf(item.date, item.diet),
        note: item.note || '',
        isToday: item.date === info.today
      }
    })
    this.setData({
      today: info.today,
      checkedToday: info.checkedToday,
      todayMood: info.todayMood,
      todayRecord: info.todayRecord ? { ...info.todayRecord, diet: dietOf(info.today, info.todayRecord.diet) } : null,
      streak: info.streak,
      total: info.total,
      monthCount: info.monthCount,
      strip: checkinLib.buildStrip(checkins, info.today, 14),
      tally: tally.map(item => ({ ...item, percent: max ? Math.max(10, Math.round((item.count / max) * 100)) : 0 })),
      list,
      loading: false
    })
  },
  openToday() { wx.navigateTo({ url: `/pages/checkin-form/checkin-form?date=${this.data.today}` }) },
  goForm() { wx.navigateTo({ url: `/pages/checkin-form/checkin-form?date=${this.data.today}` }) },
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
          wx.showToast({ title: '本地已删除，云同步失败', icon: 'none' })
        }
        this.refresh()
      }
    })
  }
})
