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
    kinds: reminderLib.KINDS,
    kind: reminderLib.KIND_REMINDER,
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
    notify: false,
    previewText: ''
  },
  onLoad(options) {
    const today = reminderLib.today()
    const reminder = options && options.id ? store.getReminder(options.id) : null
    const kind = reminder && reminder.kind === reminderLib.KIND_ANNIVERSARY ? reminderLib.KIND_ANNIVERSARY : reminderLib.KIND_REMINDER
    const calendar = reminder && reminder.calendar === 'lunar' ? 'lunar' : 'solar'
    const solarDate = reminder && reminder.date ? reminder.date : today
    // 纪念日一律「每年」，公历按同月日、农历按农历同月日
    const repeat = kind === reminderLib.KIND_ANNIVERSARY ? 'yearly' : (reminder && reminder.repeat ? reminder.repeat : 'none')
    const advanceDays = reminder ? reminderLib.advanceList(reminder) : [0]
    // 纪念日默认不推送，开了「到期提醒」才推
    const notify = reminder ? Boolean(reminder.notify) : false
    const seed = calendar === 'lunar' && reminder && reminder.lunar
      ? { year: reminder.lunar.year, month: reminder.lunar.month, day: reminder.lunar.day, isLeap: reminder.lunar.isLeap }
      : this.lunarFromSolar(solarDate)

    const lunarState = this.computeLunarState(seed, today)
    // 公历模式下用户选择的日期优先，农历选择器只作为切换农历时的初值
    if (calendar === 'solar') lunarState.solarDate = solarDate

    this.setData({
      id: reminder ? reminder.id : '',
      content: reminder ? reminder.content : '',
      kind,
      calendar,
      today,
      repeat,
      advanceDays,
      time: reminder && reminder.time ? reminder.time : reminderLib.DEFAULT_TIME,
      notify,
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
  kindChange(e) {
    const kind = e.currentTarget.dataset.value
    if (kind === this.data.kind) return
    // 纪念日是「每年」的，切过去就把循环固定成 yearly
    this.setData({ kind, repeat: kind === reminderLib.KIND_ANNIVERSARY ? 'yearly' : this.data.repeat }, () => this.refreshDerived())
  },
  /** 纪念日的「到期提醒」开关：关掉就只在日历上标个日子 */
  notifyChange(e) { this.setData({ notify: e.detail.value }, () => this.refreshDerived()) },
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
    const anniversary = this.data.kind === reminderLib.KIND_ANNIVERSARY
    const daily = !anniversary && this.data.repeat === 'daily'
    const slot = this.data.lunarMonthOptions[this.data.lunarMonthIndex] || { month: 1, isLeap: false }
    const option = this.data.lunarDayOptions[this.data.lunarDayIndex] || { value: 1 }
    const advanceDays = daily || !this.data.advanceDays.length ? [0] : [...this.data.advanceDays].sort((a, b) => a - b)
    const payload = {
      content: this.data.content.trim(),
      kind: anniversary ? reminderLib.KIND_ANNIVERSARY : reminderLib.KIND_REMINDER,
      calendar: this.data.calendar,
      repeat: anniversary ? 'yearly' : this.data.repeat,
      time: this.data.time,
      date: this.data.solarDate,
      advanceDays: anniversary && !this.data.notify ? [0] : advanceDays,
      lunar: this.data.calendar === 'lunar'
        ? { year: this.data.lunarYear, month: slot.month, day: option.value, isLeap: Boolean(slot.isLeap) }
        : null
    }
    // 只有纪念日才有 notify 这个开关，普通提醒别把 undefined 写进去
    if (anniversary) payload.notify = this.data.notify
    if (this.data.id) payload.id = this.data.id
    return payload
  },
  refreshDerived() {
    const anniversary = this.data.kind === reminderLib.KIND_ANNIVERSARY
    const daily = !anniversary && this.data.repeat === 'daily'
    const advanceDays = daily ? [0] : this.data.advanceDays
    const advanceOptions = reminderLib.ADVANCE_OPTIONS.map(item => ({ ...item, checked: advanceDays.includes(item.value) }))
    const draft = this.buildPayload()
    const next = reminderLib.nextOccurrence({ ...draft, enabled: true }, this.data.today)
    const previewText = anniversary
      ? this.describeAnniversary(draft, next)
      : this.describeReminder(draft)
    this.setData({ dailyRepeat: daily, advanceDays, advanceOptions, previewText })
  },
  describeAnniversary(draft, next) {
    if (!next) return '这个日期算不出来，换一个日期吧'
    const when = reminderLib.relativeText(reminderLib.diffDays(this.data.today, next))
    if (!this.data.notify) return `每年都有 · 下一次 ${next}（${when}）· 不推送，只在日历上标紫`
    const view = reminderLib.describe({ ...draft, enabled: true }, this.data.today)
    return `每年都有 · 下一次 ${next}（${when}）· ${view.timeText} 提醒（${reminderLib.advanceText(draft)}）`
  },
  describeReminder(draft) {
    const view = reminderLib.describe({ ...draft, enabled: true }, this.data.today)
    return view.active
      ? `下次提醒 ${view.triggerText} · 事件日 ${view.eventLabel || view.occurrence}`
      : '这个日期已经过去了，换一个日期吧'
  },
  async save() {
    const payload = this.buildPayload()
    const anniversary = this.data.kind === reminderLib.KIND_ANNIVERSARY
    if (!payload.content) {
      wx.showToast({ title: anniversary ? '请填写纪念日名称' : '请填写提醒内容', icon: 'none' })
      return
    }
    wx.showLoading({ title: '保存中' })
    try {
      await store.saveReminder(payload)
    } catch (error) {
      // 云端写失败已经由全局提示接管（数据在本机，下次同步补传），
      // 走到这里说明是本机写入出了问题
      console.error(error)
      wx.hideLoading()
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      return
    }
    wx.hideLoading()
    // 纪念日只有开了「到期提醒」才需要订阅授权；普通提醒沿用那个微信推送开关
    const wantPush = anniversary ? this.data.notify : this.data.wantPush
    const pushRequested = wantPush && subscribe.configured()
    if (pushRequested) {
      try {
        if (await subscribe.requestSubscribe()) await store.addPushQuota(1)
      } catch (error) {
        console.error('订阅授权失败', error)
      }
    }
    wx.showToast({ title: anniversary ? '纪念日已保存' : (pushRequested ? '提醒已保存' : '已保存为应用内提醒') })
    setTimeout(() => wx.navigateBack(), 650)
  },
  remove() {
    wx.showModal({
      title: this.data.kind === reminderLib.KIND_ANNIVERSARY ? '删除这个纪念日？' : '删除这条提醒？',
      confirmColor: '#C84832',
      success: async res => {
        if (!res.confirm) return
        try {
          await store.deleteReminder(this.data.id)
        } catch (error) {
          console.error(error)
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        }
        setTimeout(() => wx.navigateBack(), 400)
      }
    })
  }
})
