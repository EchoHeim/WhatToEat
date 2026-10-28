const store = require('../../utils/store')
const checkinLib = require('../../utils/checkin')
const pad = n => `${n}`.padStart(2, '0')
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 日历往回翻的最大跨度（月）：含当月共 24 个月 */
const MAX_MONTH_BACK = 24

/** 年月折成月序号，翻页边界判断用它比字符串省事 */
function monthIndex(year, month) { return year * 12 + (month - 1) }

function weekdayOf(dateText) {
  return WEEKDAYS[new Date(`${dateText}T00:00:00`).getDay()]
}

Page({
  data: {
    selectedDate: '',
    weeks: ['日', '一', '二', '三', '四', '五', '六'],
    cells: [],
    days: [],
    monthCount: 0,
    moodCount: 0,
    todayEmpty: false,
    canPrev: true,
    canNext: false
  },
  onLoad() {
    const now = new Date()
    this.year = now.getFullYear()
    this.month = now.getMonth() + 1
    // 今天所在月是最新可看的一页，最早只能翻到 24 个月前的那个月
    this.currentMonthIndex = monthIndex(this.year, this.month)
    this.earliestMonthIndex = this.currentMonthIndex - (MAX_MONTH_BACK - 1)
  },
  onShow() {
    this.refresh()
    store.syncFromCloud()
      .then(synced => { if (synced) this.refresh() })
      .catch(error => console.error('云同步失败，使用本地数据', error))
  },
  /**
   * 饮食记录与每日签到在这里合并成「一天一张卡」：
   * 日历格优先显示当天心情，日卡里心情、随笔与当天各餐放在同一块。
   */
  refresh() {
    const records = store.getRecords()
    const checkins = store.getCheckins()
    const todayText = checkinLib.today()
    const mealsByDate = {}
    records.forEach(item => {
      if (!item || !item.date) return
      if (!mealsByDate[item.date]) mealsByDate[item.date] = []
      mealsByDate[item.date].push(item)
    })
    const checkinByDate = {}
    checkins.forEach(item => { if (item && item.date) checkinByDate[item.date] = item })

    const monthPrefix = `${this.year}-${pad(this.month)}`
    const selected = this.data.selectedDate
    const inScope = date => (selected ? date === selected : date.slice(0, 7) === monthPrefix)

    // 日历：一天一格，有心情显示心情图标，否则退回当天第一道菜的图标
    const first = new Date(this.year, this.month - 1, 1).getDay()
    const monthDays = new Date(this.year, this.month, 0).getDate()
    const cells = []
    for (let i = 0; i < first; i++) cells.push({ key: `e${i}`, empty: true })
    for (let day = 1; day <= monthDays; day++) {
      const date = `${monthPrefix}-${pad(day)}`
      const meals = mealsByDate[date] || []
      const checkin = checkinByDate[date]
      const mood = checkin ? checkinLib.normalizeMood(checkin.mood, checkin.moodKey) : null
      const dish = meals.length ? store.getDish(meals[0].dishId) || {} : {}
      cells.push({
        key: date,
        day,
        date,
        mark: mood ? mood.emoji : dish.emoji || (meals.length ? '●' : ''),
        hasMood: Boolean(mood),
        count: meals.length,
        isToday: date === todayText,
        future: date > todayText
      })
    }

    // 日卡：有餐或有心情的日期，按时间倒序
    const datePool = Object.keys(mealsByDate).concat(Object.keys(checkinByDate))
    const dates = datePool.filter((date, index) => datePool.indexOf(date) === index && inScope(date))
    const days = dates.sort((a, b) => b.localeCompare(a)).map(date => {
      const meals = (mealsByDate[date] || []).map(item => {
        const dish = store.getDish(item.dishId) || {}
        return {
          id: item.id,
          mealType: item.mealType,
          dishName: item.dishName,
          emoji: dish.emoji || '🍽',
          score: item.score,
          noteText: item.remark ? `${item.status} · ${item.remark}` : item.status
        }
      })
      const checkin = checkinByDate[date]
      const mood = checkin ? checkinLib.normalizeMood(checkin.mood, checkin.moodKey) : null
      return {
        date,
        label: `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`,
        weekday: weekdayOf(date),
        isToday: date === todayText,
        moodEmoji: mood ? mood.emoji : '',
        moodLabel: mood ? mood.label : '',
        note: checkin && checkin.note ? checkin.note : '',
        meals,
        mealCount: meals.length
      }
    })

    const currentIndex = monthIndex(this.year, this.month)
    this.setData({
      monthTitle: `${this.year} 年 ${this.month} 月`,
      cells,
      days,
      monthCount: days.reduce((sum, item) => sum + item.mealCount, 0),
      moodCount: days.filter(item => item.moodEmoji).length,
      todayEmpty: !(mealsByDate[todayText] || []).length && !checkinByDate[todayText],
      canPrev: currentIndex > this.earliestMonthIndex,
      canNext: currentIndex < this.currentMonthIndex
    })
  },
  prevMonth() {
    if (monthIndex(this.year, this.month) <= this.earliestMonthIndex) return
    this.month--
    if (this.month < 1) { this.month = 12; this.year-- }
    this.setData({ selectedDate: '' })
    this.refresh()
  },
  nextMonth() {
    if (monthIndex(this.year, this.month) >= this.currentMonthIndex) return
    this.month++
    if (this.month > 12) { this.month = 1; this.year++ }
    this.setData({ selectedDate: '' })
    this.refresh()
  },
  selectDate(e) {
    const date = e.currentTarget.dataset.date
    // 空白天数格、未来日期都不接
    if (!date || date > checkinLib.today()) return
    this.setData({ selectedDate: this.data.selectedDate === date ? '' : date })
    this.refresh()
  },
  clearDate() { this.setData({ selectedDate: '' }); this.refresh() },
  /** 点心情图标或日期 → 写 / 改当天心情 */
  openCheckin(e) {
    const date = e.currentTarget.dataset.date
    if (!date) return
    wx.navigateTo({ url: `/pages/checkin-form/checkin-form?date=${date}` })
  },
  /** 给某一天加一餐 */
  addMeal(e) {
    const date = e.currentTarget.dataset.date || checkinLib.today()
    wx.navigateTo({ url: `/pages/record-form/record-form?date=${date}` })
  },
  addToday() { wx.navigateTo({ url: `/pages/record-form/record-form?date=${checkinLib.today()}` }) },
  openTodayCheckin() { wx.navigateTo({ url: `/pages/checkin-form/checkin-form?date=${checkinLib.today()}` }) },
  /** 连续天数、本月心情分布与心情历史都在这个页里 */
  openCheckins() { wx.navigateTo({ url: '/pages/checkins/checkins' }) },
  /** 点某一餐 → 改评分 / 备注 / 日期 / 菜品 */
  editRecord(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/record-form/record-form?id=${id}` })
  },
  removeRecord(e) {
    wx.showModal({
      title: '删除这条记录？',
      confirmColor: '#C84832',
      success: async res => {
        if (!res.confirm) return
        try {
          await store.deleteRecord(e.currentTarget.dataset.id)
        } catch (error) {
          console.error(error)
          wx.showToast({ title: '云同步失败', icon: 'none' })
        }
        this.refresh()
      }
    })
  }
})
