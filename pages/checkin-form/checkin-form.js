const store = require('../../utils/store')
const checkinLib = require('../../utils/checkin')

Page({
  data: {
    id: '',
    date: '',
    today: '',
    moods: checkinLib.MOODS,
    moodKey: '',
    moodEmoji: '',
    moodLabel: '',
    diet: '',
    note: '',
    mealNames: '',
    mealCount: 0,
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
    store.syncFromCloud()
      .then(synced => { if (synced && !this.touched) this.load(this.data.date) })
      .catch(error => console.error('云同步失败，使用本地数据', error))
  },
  /** 载入某一天的签到与当天饮食，切日期时复用 */
  load(date) {
    const existing = store.getCheckinByDate(date)
    const mood = existing ? checkinLib.moodByKey((existing.mood && existing.mood.key) || existing.moodKey) : null
    // 饮食以「记录一餐」为准，签到里只做展示，不再单独手写
    const meals = store.getRecords().filter(item => item.date === date)
    this.setData({
      date,
      dayLabel: `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日 ${checkinLib.weekdayText(date)}`,
      id: existing ? existing.id : '',
      existing: Boolean(existing),
      moodKey: mood ? mood.key : '',
      moodEmoji: mood ? mood.emoji : '',
      moodLabel: mood ? mood.label : '',
      note: existing ? existing.note || '' : '',
      // 旧版本签到里的手写饮食，保存时原样带走，不做破坏性清空
      legacyDiet: existing ? existing.diet || '' : '',
      mealNames: meals.map(item => item.dishName).join('、'),
      mealCount: meals.length
    })
  },
  /** 从「记一餐」返回时只刷新饮食汇总，不动用户已选的心情和随笔 */
  onShow() {
    if (!this.data.date) return
    const meals = store.getRecords().filter(item => item.date === this.data.date)
    this.setData({ mealNames: meals.map(item => item.dishName).join('、'), mealCount: meals.length })
  },
  dateChange(e) { this.touched = true; this.load(e.detail.value) },
  chooseMood(e) {
    this.touched = true
    const mood = checkinLib.moodByKey(e.currentTarget.dataset.key)
    if (!mood) return
    this.setData({ moodKey: mood.key, moodEmoji: mood.emoji, moodLabel: mood.label })
  },
  noteChange(e) { this.touched = true; this.setData({ note: e.detail.value }) },
  /** 饮食去「记录一餐」补，签到这里只负责心情和随笔 */
  addMeal() { wx.navigateTo({ url: `/pages/record-form/record-form?date=${this.data.date}` }) },
  async save() {
    const mood = checkinLib.moodByKey(this.data.moodKey)
    if (!mood) {
      wx.showToast({ title: '选一个今天的心情', icon: 'none' })
      return
    }
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
      console.error(error)
      wx.hideLoading()
      // 本地缓存已写入，把云端失败原因讲清楚，便于修配置
      wx.showModal({
        title: '已保存到本机',
        content: `${store.describeCloudError(error)}\n\n本机数据不会丢失，修好云端配置后重新保存即可同步。`,
        showCancel: false,
        confirmText: '知道了',
        success: () => wx.navigateBack()
      })
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
          wx.showToast({ title: '本地已删除，云同步失败', icon: 'none' })
        }
        setTimeout(() => wx.navigateBack(), 500)
      }
    })
  }
})
