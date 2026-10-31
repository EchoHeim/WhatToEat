const store = require('../../utils/store')
const checkinLib = require('../../utils/checkin')
const subscribe = require('../../utils/subscribe')

Page({
  data: {
    id: '',
    date: '',
    today: '',
    moods: checkinLib.MOODS,
    moodKey: '',
    moodIcon: '',
    moodLabel: '',
    note: '',
    legacyDiet: '',
    existing: false,
    dayLabel: ''
  },
  onLoad(options) {
    const today = checkinLib.today()
    const wanted = options && options.date ? options.date : today
    const date = checkinLib.isDateText(wanted) && wanted <= today ? wanted : today
    this.setData({ today, date })
    this.load(date)
    // 同步放后台；回来后只有在用户没动过表单时才补一次数据，免得覆盖正在写的内容
    store.syncThen(() => { if (!this.touched) this.load(this.data.date) })
  },
  /** 载入某一天的签到，切日期时复用 */
  load(date) {
    const existing = store.getCheckinByDate(date)
    const mood = existing ? checkinLib.moodByKey((existing.mood && existing.mood.key) || existing.moodKey) : null
    this.setData({
      date,
      dayLabel: `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日 ${checkinLib.weekdayText(date)}`,
      id: existing ? existing.id : '',
      existing: Boolean(existing),
      moodKey: mood ? mood.key : '',
      moodIcon: mood ? mood.icon : '',
      moodLabel: mood ? mood.label : '',
      note: existing ? existing.note || '' : '',
      // 旧版本签到里的手写饮食，保存时原样带走，不做破坏性清空
      legacyDiet: existing ? existing.diet || '' : ''
    })
  },
  dateChange(e) { this.touched = true; this.load(e.detail.value) },
  chooseMood(e) {
    this.touched = true
    const mood = checkinLib.moodByKey(e.currentTarget.dataset.key)
    if (!mood) return
    this.setData({ moodKey: mood.key, moodIcon: mood.icon, moodLabel: mood.label })
  },
  noteChange(e) { this.touched = true; this.setData({ note: e.detail.value }) },
  async save() {
    const mood = checkinLib.moodByKey(this.data.moodKey)
    if (!mood) {
      wx.showToast({ title: '选一个今天的心情', icon: 'none' })
      return
    }
    // 心情选好了就是要签到了，顺手补一次推送额度。
    // 卡在 showLoading 和任何 await 之前——过了点击手势，微信就不认
    subscribe.topUpIfNeeded()
    const payload = {
      date: this.data.date,
      moodKey: mood.key,
      mood: { key: mood.key, emoji: mood.emoji, label: mood.label },
      note: this.data.note.trim()
    }
    if (this.data.legacyDiet) payload.diet = this.data.legacyDiet
    if (this.data.id) payload.id = this.data.id
    wx.showLoading({ title: '保存中' })
    try {
      await store.saveCheckin(payload)
    } catch (error) {
      // 云端写失败已经由全局提示接管（数据在本机，下次同步补传），
      // 走到这里说明是本机写入出了问题
      console.error(error)
      wx.hideLoading()
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      return
    }
    wx.hideLoading()
    wx.showToast({ title: this.data.existing ? '签到已更新' : '签到成功' })
    setTimeout(() => wx.navigateBack(), 650)
  },
  remove() {
    wx.showModal({
      title: '删除这条签到？',
      confirmColor: '#C84832',
      success: async res => {
        if (!res.confirm) return
        try {
          await store.deleteCheckin(this.data.id)
          wx.showToast({ title: '已删除' })
        } catch (error) {
          console.error(error)
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        }
        setTimeout(() => wx.navigateBack(), 500)
      }
    })
  }
})
