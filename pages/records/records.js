const store = require('../../utils/store')
const checkinLib = require('../../utils/checkin')
const festivalLib = require('../../utils/festival')
const tabbar = require('../../utils/tabbar')
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
    todayEmpty: false,
    hintDate: '',
    festivals: [],
    festivalTitle: '',
    canPrev: true,
    canNext: false,
    tabbar: tabbar.create(2)
  },
  onTabTap(e) { tabbar.go(e) },
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
    const reminders = store.getReminders()
    // 菜库建一次索引：日历格和日卡里都要按 dishId 取菜，
    // 直接调 store.getDish() 会把整份菜库反序列化 + 线性查一遍（一次刷新上百次）
    const dishMap = new Map(store.getDishes().map(item => [item.id, item]))
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
      const dish = meals.length ? dishMap.get(meals[0].dishId) || {} : {}
      cells.push({
        key: date,
        day,
        date,
        mark: mood ? mood.emoji : dish.emoji || (meals.length ? '●' : ''),
        moodIcon: mood ? mood.icon : '',
        hasMood: Boolean(mood),
        // 节日当天：数字变亮蓝。日历是回顾用的，这个月已过的节日也照样标
        hasFestival: festivalLib.festivalsOf(date).length > 0,
        // 自定义纪念日：数字变亮紫，同一天既有节日又有纪念日时紫色赢
        hasAnniversary: festivalLib.anniversariesOn(reminders, date).length > 0,
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
        const dish = dishMap.get(item.dishId) || {}
        return {
          id: item.id,
          mealType: item.mealType,
          timeText: store.recordClock(item),
          dishName: item.dishName,
          emoji: dish.emoji || '🍽',
          score: item.score,
          noteText: item.remark ? `${item.status} · ${item.remark}` : item.status
        }
      })
      // 有具体时间之后，一天里按时间先后排更像时间线；没有时间的排最后
      meals.sort((a, b) => (a.timeText || '99:99').localeCompare(b.timeText || '99:99'))
      const checkin = checkinByDate[date]
      const mood = checkin ? checkinLib.normalizeMood(checkin.mood, checkin.moodKey) : null
      return {
        date,
        label: `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`,
        weekday: weekdayOf(date),
        isToday: date === todayText,
        moodEmoji: mood ? mood.emoji : '',
        moodIcon: mood ? mood.icon : '',
        moodLabel: mood ? mood.label : '',
        note: checkin && checkin.note ? checkin.note : '',
        meals,
        mealCount: meals.length
      }
    })

    const currentIndex = monthIndex(this.year, this.month)
    // 「今天还是空白」只在看当月、且没选中某一天时才出现：
    // 翻历史月或筛了某天后，它夹在一堆别的日期卡片里，会被误读成在说那些卡片
    const viewingTodayMonth = !selected && monthPrefix === todayText.slice(0, 7)
    // 挑了某天 → 显示那一天的节日与纪念日；没挑 → 显示本周剩下的；翻到历史月且不挑日子就不挂
    // 注意别叫 days：日卡列表已经占用了这个名字
    const festivalDays = selected
      ? festivalLib.daysToShow(reminders, todayText, { date: selected })
      : viewingTodayMonth
        ? festivalLib.daysToShow(reminders, todayText, { limit: 3 })
        : []
    const title = selected
      ? `${Number(selected.slice(5, 7))} 月 ${Number(selected.slice(8, 10))} 日这天`
      : festivalLib.hasAnniversary(festivalDays)
        ? (festivalDays.every(item => item.kind === 'anniv') ? '本周纪念日' : '本周节日 · 纪念日')
        : '本周节日'
    this.setData({
      monthTitle: `${this.year} 年 ${this.month} 月`,
      cells,
      days,
      monthCount: days.reduce((sum, item) => sum + item.mealCount, 0),
      todayEmpty: viewingTodayMonth && !(mealsByDate[todayText] || []).length && !checkinByDate[todayText],
      hintDate: `${Number(todayText.slice(5, 7))} 月 ${Number(todayText.slice(8, 10))} 日`,
      festivals: festivalDays,
      festivalTitle: title,
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
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        }
        this.refresh()
      }
    })
  }
})
