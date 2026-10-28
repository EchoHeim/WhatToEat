const store = require('../../utils/store')
const reminderLib = require('../../utils/reminder')
const lunar = require('../../utils/lunar')
const subscribe = require('../../utils/subscribe')

function resolveSolar(year, month, day, isLeap) {
  const solar = lunar.lunarToSolar(year, month, day, isLeap)
  if (!solar) return ''
  return `${solar.year}-${reminderLib.pad(solar.month)}-${reminderLib.pad(solar.day)}`
}

Page({
  data: {
    id: '',
    content: '',
    calendars: reminderLib.CALENDARS,
    calendar: 'solar',
    solarDate: '',
    today: '',
    lunarYear: 0,
    lunarMonthOptions: [],
    lunarMonthLabels: [],
    lunarMonthIndex: 0,
    lunarDayOptions: [],
    lunarDayLabels: [],
    lunarDayIndex: 0,
    repeats: reminderLib.REPEATS,
    repeat: 'none',
    dailyRepeat: false,
    advanceOptions: [],
    advanceDays: [0],
    time: reminderLib.DEFAULT_TIME,
    pushReady: false,
    wantPush: true,
    previewText: ''
  },
  onLoad(options) {
    const today = reminderLib.today()
    const reminder = options && options.id ? store.getReminder(options.id) : null
    const calendar = reminder && reminder.calendar === 'lunar' ? 'lunar' : 'solar'
    const solarDate = reminder && reminder.date ? reminder.date : today
    const repeat = reminder && reminder.repeat ? reminder.repeat : 'none'
    const advanceDays = reminder ? reminderLib.advanceList(reminder) : [0]
    const seed = calendar === 'lunar' && reminder && reminder.lunar
      ? { year: reminder.lunar.year, month: reminder.lunar.month, day: reminder.lunar.day, isLeap: reminder.lunar.isLeap }
      : this.lunarFromSolar(solarDate)

    const lunarState = this.computeLunarState(seed, today)
    // 公历模式下用户选择的日期优先，农历选择器只作为切换农历时的初值
    if (calendar === 'solar') lunarState.solarDate = solarDate

    this.setData({
      id: reminder ? reminder.id : '',
      content: reminder ? reminder.content : '',
      calendar,
      today,
      repeat,
      advanceDays,
      time: reminder && reminder.time ? reminder.time : reminderLib.DEFAULT_TIME,
      pushReady: subscribe.configured(),
      ...lunarState
    }, () => this.refreshDerived())
  },

  // ---------- 农历选择器状态 ----------
  lunarFromSolar(solarDate) {
    const target = lunar.fromDateText(solarDate)
    return target || { year: lunar.MIN_YEAR, month: 1, day: 1, isLeap: false }
  },
  buildDayOptions(year, month, isLeap) {
    const total = lunar.lunarMonthDayCount(year, month, isLeap)
    const options = []
    for (let day = 1; day <= total; day++) options.push({ value: day, label: lunar.dayText(day) })
    return options
  },
  /**
   * 归一化农历选择：当年该闰月不存在时回退到常规月；
   * 选中的农历日期早于今天时顺延到下一年，保证「不重复」也能命中未来。
   */
  computeLunarState(seed, today) {
    const source = seed || this.lunarFromSolar(today)
    let year = Number(source.year)
    const month = Number(source.month)
    const day = Number(source.day)
    const isLeap = Boolean(source.isLeap)

    let resolved = resolveSolar(year, month, day, isLeap)
    let guard = 0
    while (resolved && resolved < today && guard < 4) {
      year += 1
      resolved = resolveSolar(year, month, day, isLeap)
      guard += 1
    }

    const months = lunar.monthsOfYear(year).map(item => ({
      month: item.month,
      isLeap: item.isLeap,
      label: lunar.monthText(item.month, item.isLeap)
    }))
    let monthIndex = months.findIndex(item => item.month === month && item.isLeap === isLeap)
    if (monthIndex < 0) monthIndex = months.findIndex(item => item.month === month)
    if (monthIndex < 0) monthIndex = 0

    const slot = months[monthIndex]
    const dayOptions = this.buildDayOptions(year, slot.month, slot.isLeap)
    let dayIndex = dayOptions.findIndex(item => item.value === day)
    if (dayIndex < 0) dayIndex = dayOptions.length - 1

    const solarDate = resolveSolar(year, slot.month, dayOptions[dayIndex].value, slot.isLeap)
    return {
      lunarYear: year,
      lunarMonthOptions: months,
      lunarMonthLabels: months.map(item => item.label),
      lunarMonthIndex: monthIndex,
      lunarDayOptions: dayOptions,
      lunarDayLabels: dayOptions.map(item => item.label),
      lunarDayIndex: dayIndex,
      solarDate: solarDate || resolved || today
    }
  },

  // ---------- 表单交互 ----------
  contentChange(e) { this.setData({ content: e.detail.value }, () => this.refreshDerived()) },
  wantPushChange(e) { this.setData({ wantPush: e.detail.value }) },
  timeChange(e) { this.setData({ time: e.detail.value }) },
  calendarChange(e) {
    const calendar = e.currentTarget.dataset.value
    if (calendar === this.data.calendar) return
    if (calendar === 'lunar') {
      this.setData({ calendar, ...this.computeLunarState(this.lunarFromSolar(this.data.solarDate), this.data.today) }, () => this.refreshDerived())
    } else {
      this.setData({ calendar }, () => this.refreshDerived())
    }
  },
  solarDateChange(e) {
    const solarDate = e.detail.value
    this.setData({ ...this.computeLunarState(this.lunarFromSolar(solarDate), this.data.today), solarDate }, () => this.refreshDerived())
  },
  lunarMonthChange(e) {
    const slot = this.data.lunarMonthOptions[Number(e.detail.value)]
    if (!slot) return
    const day = (this.data.lunarDayOptions[this.data.lunarDayIndex] || {}).value || 1
    this.setData(this.computeLunarState({ year: this.data.lunarYear, month: slot.month, day, isLeap: slot.isLeap }, this.data.today), () => this.refreshDerived())
  },
  lunarDayChange(e) {
    const slot = this.data.lunarMonthOptions[this.data.lunarMonthIndex]
    const option = this.data.lunarDayOptions[Number(e.detail.value)]
    if (!slot || !option) return
    this.setData(this.computeLunarState({ year: this.data.lunarYear, month: slot.month, day: option.value, isLeap: slot.isLeap }, this.data.today), () => this.refreshDerived())
  },
  repeatChange(e) {
    const repeat = e.currentTarget.dataset.value
    if (repeat === this.data.repeat) return
    if (repeat === 'daily') {
      this.cachedAdvanceDays = this.data.advanceDays
      this.setData({ repeat, advanceDays: [0] }, () => this.refreshDerived())
      return
    }
    const restore = this.data.repeat === 'daily' && this.cachedAdvanceDays && this.cachedAdvanceDays.length
      ? this.cachedAdvanceDays
      : this.data.advanceDays
    this.setData({ repeat, advanceDays: restore }, () => this.refreshDerived())
  },
  toggleAdvance(e) {
    if (this.data.repeat === 'daily') return
    const value = Number(e.currentTarget.dataset.value)
    if (this.data.advanceDays.includes(value) && this.data.advanceDays.length === 1) {
      wx.showToast({ title: '至少保留一个提醒节点', icon: 'none' })
      return
    }
    const advanceDays = this.data.advanceDays.includes(value)
      ? this.data.advanceDays.filter(item => item !== value)
      : [...this.data.advanceDays, value].sort((a, b) => a - b)
    this.setData({ advanceDays }, () => this.refreshDerived())
  },

  // ---------- 派生状态与保存 ----------
  buildPayload() {
    const daily = this.data.repeat === 'daily'
    const slot = this.data.lunarMonthOptions[this.data.lunarMonthIndex] || { month: 1, isLeap: false }
    const option = this.data.lunarDayOptions[this.data.lunarDayIndex] || { value: 1 }
    const advanceDays = daily || !this.data.advanceDays.length ? [0] : [...this.data.advanceDays].sort((a, b) => a - b)
    const payload = {
      content: this.data.content.trim(),
      calendar: this.data.calendar,
      repeat: this.data.repeat,
      time: this.data.time,
      date: this.data.solarDate,
      advanceDays,
      lunar: this.data.calendar === 'lunar'
        ? { year: this.data.lunarYear, month: slot.month, day: option.value, isLeap: Boolean(slot.isLeap) }
        : null
    }
    if (this.data.id) payload.id = this.data.id
    return payload
  },
  refreshDerived() {
    const daily = this.data.repeat === 'daily'
    const advanceDays = daily ? [0] : this.data.advanceDays
    const advanceOptions = reminderLib.ADVANCE_OPTIONS.map(item => ({ ...item, checked: advanceDays.includes(item.value) }))
    const draft = this.buildPayload()
    const view = reminderLib.describe({ ...draft, enabled: true }, this.data.today)
    this.setData({
      dailyRepeat: daily,
      advanceDays,
      advanceOptions,
      previewText: view.active
        ? `下次提醒 ${view.triggerText} · 事件日 ${view.eventLabel || view.occurrence}`
        : '这个日期已经过去了，换一个日期吧'
    })
  },
  async save() {
    const payload = this.buildPayload()
    if (!payload.content) {
      wx.showToast({ title: '请填写提醒内容', icon: 'none' })
      return
    }
    wx.showLoading({ title: '保存中' })
    try {
      await store.saveReminder(payload)
    } catch (error) {
      console.error(error)
      wx.hideLoading()
      // 本地缓存已经写入，这里把云端出错的原因直接讲清楚，便于修复配置
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
    const pushRequested = this.data.wantPush && subscribe.configured()
    if (pushRequested) {
      try {
        if (await subscribe.requestSubscribe()) await store.addPushQuota(1)
      } catch (error) {
        console.error('订阅授权失败', error)
      }
    }
    wx.showToast({ title: pushRequested ? '提醒已保存' : '已保存为应用内提醒' })
    setTimeout(() => wx.navigateBack(), 650)
  },
  remove() {
    wx.showModal({
      title: '删除这条提醒？',
      confirmColor: '#C84832',
      success: async res => {
        if (!res.confirm) return
        try {
          await store.deleteReminder(this.data.id)
        } catch (error) {
          console.error(error)
          wx.showToast({ title: '本地已删除，云同步失败', icon: 'none' })
        }
        setTimeout(() => wx.navigateBack(), 400)
      }
    })
  }
})
