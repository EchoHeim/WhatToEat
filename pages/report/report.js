const store = require('../../utils/store')
const reportLib = require('../../utils/report')

Page({
  data: {
    month: '',
    report: null,
    canNext: false,
    // 看的不是本月时，标题右边挂一个「回到本月」，和记录页同一个入口
    showBackToMonth: false,
    deltaText: ''
  },
  onLoad() {
    const month = reportLib.currentMonth()
    // 记住「进来时今天在哪个」：隔夜跨月后靠它判断要不要自动跳到新月
    this.lastTodayMonth = month
    this.followToday = true
    this.setData({ month })
    this.refresh()
  },
  onShow() {
    // 从别处改过记录再回来，报告要跟着变
    this.followCurrentMonth()
    this.refresh()
    store.syncThen(() => this.refresh())
  },
  /**
   * 隔夜跨月后跟到今天所在的月。
   * 页面实例常驻，this.data.month 只在 onLoad 定过一次 —— 跨月后进来还停在上个月，
   * 而且「本月」按钮的判断也一起过期了。判据同记录页：
   * 只有「当前看着的月 == 上次进来时今天所在的月」才跟随，用户自己翻过就别动他。
   */
  followCurrentMonth() {
    const todayMonth = reportLib.currentMonth()
    const lastTodayMonth = this.lastTodayMonth
    this.lastTodayMonth = todayMonth
    if (!lastTodayMonth || todayMonth === lastTodayMonth) return
    if (!this.followToday) return
    if (this.data.month !== lastTodayMonth) return
    this.setData({ month: todayMonth })
  },
  refresh() {
    const month = this.data.month || reportLib.currentMonth()
    const report = reportLib.buildReport({
      records: store.getRecords(),
      dishes: store.getDishes(),
      month
    })
    // 对比文案在这里拼好：wxml 里写负数运算容易看错，而且 -0 会显示成「-0」
    const delta = report.delta
    const deltaText = !report.hasData
      ? ''
      : delta > 0
        ? `比上月多 ${delta} 餐`
        : delta < 0
          ? `比上月少 ${0 - delta} 餐`
          : '和上月持平'
    this.setData({
      month,
      report,
      canNext: month < reportLib.currentMonth(),
      showBackToMonth: month !== reportLib.currentMonth(),
      deltaText
    })
  },
  prevMonth() {
    const month = reportLib.shiftMonth(this.data.month, -1)
    if (!month) return
    this.followToday = false
    this.setData({ month }, () => this.refresh())
  },
  nextMonth() {
    const month = reportLib.shiftMonth(this.data.month, 1)
    // 不给看未来月份：这个月还没过完，报告没意义
    if (!month || month > reportLib.currentMonth()) return
    this.followToday = false
    this.setData({ month }, () => this.refresh())
  },
  /** 直接跳回今天所在的月份；往前翻了十几页时不用一格一格点回来 */
  backToMonth() {
    const month = reportLib.currentMonth()
    this.lastTodayMonth = month
    this.followToday = true
    if (month === this.data.month) return false
    this.setData({ month }, () => this.refresh())
    return true
  },
  /**
   * 分享月度报告：这个页面本来就是「本月吃了多少、最常吃什么」的天然素材，
   * 以前全项目零分享入口，等于把唯一的传播路径关着。
   * 标题尽量具体（带上月份与顿数），落到聊天里比一句「今天吃什么」有用得多。
   */
  shareText() {
    const report = this.data.report
    if (!report || !report.hasData) return '今天吃什么 · 好好吃饭，随手记一记'
    const top = report.topDishes && report.topDishes.length ? `，最常吃「${report.topDishes[0].name}」` : ''
    return `${report.monthLabel} 吃了 ${report.mealCount} 餐${top}`
  },
  onShareAppMessage() {
    return { title: this.shareText(), path: '/pages/index/index' }
  },
  onShareTimeline() {
    return { title: this.shareText() }
  }
})
