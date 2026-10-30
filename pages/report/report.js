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
    this.setData({ month: reportLib.currentMonth() })
    this.refresh()
  },
  onShow() {
    // 从别处改过记录再回来，报告要跟着变
    this.refresh()
    store.syncFromCloud()
      .then(synced => { if (synced) this.refresh() })
      .catch(error => console.error('云同步失败，使用本地数据', error))
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
    this.setData({ month }, () => this.refresh())
  },
  nextMonth() {
    const month = reportLib.shiftMonth(this.data.month, 1)
    // 不给看未来月份：这个月还没过完，报告没意义
    if (!month || month > reportLib.currentMonth()) return
    this.setData({ month }, () => this.refresh())
  },
  /** 直接跳回今天所在的月份；往前翻了十几页时不用一格一格点回来 */
  backToMonth() {
    const month = reportLib.currentMonth()
    if (month === this.data.month) return false
    this.setData({ month }, () => this.refresh())
    return true
  }
})
