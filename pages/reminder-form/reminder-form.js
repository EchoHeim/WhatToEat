const store = require('../../utils/store')
const reminderLib = require('../../utils/reminder')
const notify = require('../../utils/notify')
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
    // 备注：选填，填了会拼在推送「提醒内容」的最前面
    remark: '',
    kinds: reminderLib.KINDS,
    kind: reminderLib.KIND_REMINDER,
    // 日历切换只对纪念日开放；普通提醒不区分农历公历，恒为公历。
    calendars: reminderLib.CALENDARS,
    calendar: 'solar',
    // 存量农历普通提醒编辑时保留农历语义（新建的提醒没有这个）
    legacyLunar: false,
    // 编辑存量农历数据时不顺延年份（存量 lunar.year 是权威值）
    noRoll: false,
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
    // 「每 N 天」的步长：1 就是每天；只在 repeat === 'daily' 时有意义
    intervalDays: 1,
    dailyHint: '',
    advanceOptions: [],
    advanceDays: [0],
    time: reminderLib.DEFAULT_TIME,
    pushReady: false,
    notify: false,
    previewText: '',
    // 「微信里会收到这样一条」：5 行与云函数发出的订阅消息逐字一致
    pushPreview: []
  },
  onLoad(options) {
    const today = reminderLib.today()
    const reminder = options && options.id ? store.getReminder(options.id) : null
    // 新建时按入口指定的类型走：「我的」页把提醒和纪念日拆成了两个独立按钮。
    // 编辑时类型永远以已存数据为准、不看 URL——否则改一条提醒会被 URL 带成纪念日
    const entryAnniversary = !reminder && Boolean(options && options.kind === reminderLib.KIND_ANNIVERSARY)
    const storedAnniversary = Boolean(reminder) && reminder.kind === reminderLib.KIND_ANNIVERSARY
    const kind = entryAnniversary || storedAnniversary ? reminderLib.KIND_ANNIVERSARY : reminderLib.KIND_REMINDER
    // 普通提醒不区分农历公历，一律公历；纪念日才认农历（存量的农历纪念日照旧保留）
    const calendar = kind === reminderLib.KIND_ANNIVERSARY && reminder && reminder.calendar === 'lunar' ? 'lunar' : 'solar'
    const solarDate = reminder && reminder.date ? reminder.date : today
    // 纪念日一律「每年」
    const repeat = kind === reminderLib.KIND_ANNIVERSARY ? 'yearly' : (reminder && reminder.repeat ? reminder.repeat : 'none')
    const advanceDays = reminder ? reminderLib.advanceList(reminder) : [0]
    // 纪念日默认不推送，开了「到期提醒」才推
    const notify = reminder ? Boolean(reminder.notify) : false
    // 存量的农历「普通提醒」（比如每年农历八月十五）：表单不再给新建的提醒提供农历选项，
    // 但编辑这条老数据时保留它的农历语义 —— 否则 yearly 的农历提醒会被静默降级成公历，
    // 触发日从「每年农历八月十五」变成「每年公历 9 月 25 日」。
    const legacyLunar = Boolean(kind === reminderLib.KIND_REMINDER && reminder && reminder.calendar === 'lunar' && reminder.lunar)
    // 农历纪念日的选择器初值来自它自己的 lunar 字段
    const seed = (calendar === 'lunar' || legacyLunar) && reminder && reminder.lunar
      ? { year: reminder.lunar.year, month: reminder.lunar.month, day: reminder.lunar.day, isLeap: reminder.lunar.isLeap }
      : this.lunarFromSolar(solarDate)

    // 编辑存量农历数据时不要顺延年份 —— 存量 lunar.year 是权威值，顺延会平移触发日
    const editingLunar = Boolean(reminder && (calendar === 'lunar' || legacyLunar))
    const lunarState = this.computeLunarState(seed, today, editingLunar)
    // 公历模式下用户选择的日期优先，农历选择器只作为切换农历时的初值
    if (calendar === 'solar') lunarState.solarDate = solarDate

    this.setData({
      id: reminder ? reminder.id : '',
      content: reminder ? reminder.content : '',
      remark: reminder && reminder.remark ? reminder.remark : '',
      kind,
      // 存量农历普通提醒的 calendar 也要是 lunar，日历段的高亮才对得上
      calendar: legacyLunar ? 'lunar' : calendar,
      legacyLunar,
      noRoll: editingLunar,
      today,
      repeat,
      intervalDays: reminderLib.intervalDays(reminder),
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
   *
   * noRoll 参数用于编辑存量数据：存量记录的 lunar.year 就是权威值，
   * 不能顺延 —— 否则「每天」这类提醒的触发日会被平移一年（2026-10-29 → 2027-10-18）。
   */
  computeLunarState(seed, today, noRoll) {
    const source = seed || this.lunarFromSolar(today)
    let year = Number(source.year)
    const month = Number(source.month)
    const day = Number(source.day)
    const isLeap = Boolean(source.isLeap)

    let resolved = resolveSolar(year, month, day, isLeap)
    let guard = 0
    while (!noRoll && resolved && resolved < today && guard < 4) {
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
    // 普通提醒不区分农历公历，切过去时把 calendar 收回公历
    const patch = { kind, repeat: kind === reminderLib.KIND_ANNIVERSARY ? 'yearly' : this.data.repeat }
    if (kind === reminderLib.KIND_REMINDER) patch.calendar = 'solar'
    // 切成纪念日后，农历由用户显式选，不再沿用老普通提醒的农历语义
    if (kind === reminderLib.KIND_ANNIVERSARY) patch.legacyLunar = false
    this.setData(patch, () => this.refreshDerived())
  },
  /** 纪念日的「到期提醒」开关：关掉就只在日历上标个日子 */
  notifyChange(e) { this.setData({ notify: e.detail.value }, () => this.refreshDerived()) },
  contentChange(e) { this.setData({ content: e.detail.value }, () => this.refreshDerived()) },
  remarkChange(e) { this.setData({ remark: e.detail.value }, () => this.refreshDerived()) },
  timeChange(e) { this.setData({ time: e.detail.value }, () => this.refreshDerived()) },
  calendarChange(e) {
    // 新建的普通提醒不提供农历选项；但存量农历普通提醒（legacyLunar）允许改，
    // 否则用户看得到农历选择器却动不了。
    const anniversary = this.data.kind === reminderLib.KIND_ANNIVERSARY
    if (!anniversary && !this.data.legacyLunar) return
    const calendar = e.currentTarget.dataset.value
    if (calendar === this.data.calendar) return
    if (calendar === 'lunar') {
      this.setData({ calendar, ...this.computeLunarState(this.lunarFromSolar(this.data.solarDate), this.data.today, this.data.noRoll) }, () => this.refreshDerived())
    } else {
      // 从农历切回公历：清掉 legacyLunar，这条就真的变成公历提醒了
      this.setData({ calendar, legacyLunar: false }, () => this.refreshDerived())
    }
  },
  solarDateChange(e) {
    const solarDate = e.detail.value
    this.setData({ ...this.computeLunarState(this.lunarFromSolar(solarDate), this.data.today, this.data.noRoll), solarDate }, () => this.refreshDerived())
  },
  lunarMonthChange(e) {
    const slot = this.data.lunarMonthOptions[Number(e.detail.value)]
    if (!slot) return
    const day = (this.data.lunarDayOptions[this.data.lunarDayIndex] || {}).value || 1
    this.setData(this.computeLunarState({ year: this.data.lunarYear, month: slot.month, day, isLeap: slot.isLeap }, this.data.today, this.data.noRoll), () => this.refreshDerived())
  },
  lunarDayChange(e) {
    const slot = this.data.lunarMonthOptions[this.data.lunarMonthIndex]
    const option = this.data.lunarDayOptions[Number(e.detail.value)]
    if (!slot || !option) return
    this.setData(this.computeLunarState({ year: this.data.lunarYear, month: slot.month, day: option.value, isLeap: slot.isLeap }, this.data.today, this.data.noRoll), () => this.refreshDerived())
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
  /** 「每 N 天」的加减按钮 */
  intervalStep(e) {
    const delta = Number(e.currentTarget.dataset.delta) || 0
    this.applyInterval(this.data.intervalDays + delta)
  },
  /** 直接改数字：输入过程中先原样记下（可能是空串），失焦时再夹回合法区间 */
  intervalInput(e) {
    this.setData({ intervalDays: Number(e.detail.value) || 0 }, () => this.refreshDerived())
  },
  intervalBlur() { this.applyInterval(this.data.intervalDays) },
  applyInterval(value) {
    // 统一走 reminderLib.intervalDays 夹取，坏输入（0 / 负数 / 9999）在这一处收口
    this.setData({ intervalDays: reminderLib.intervalDays({ intervalDays: value }) }, () => this.refreshDerived())
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
    // 普通提醒不区分农历公历，一律公历；只有纪念日才可能用农历。
    // 例外：存量的农历普通提醒（legacyLunar）保留农历语义，避免 yearly 的老提醒被降级。
    // lunarMode = 这一条要不要用农历选择器（纪念日选了农历，或存量农历普通提醒）
    const useLunar = anniversary ? this.data.calendar === 'lunar' : this.data.legacyLunar
    const payload = {
      content: this.data.content.trim(),
      remark: this.data.remark.trim(),
      kind: anniversary ? reminderLib.KIND_ANNIVERSARY : reminderLib.KIND_REMINDER,
      calendar: useLunar ? 'lunar' : 'solar',
      repeat: anniversary ? 'yearly' : this.data.repeat,
      // 非「每 N 天」的提醒也带上 1，免得从「每 3 天」改成每月后留个没用的旧步长
      intervalDays: daily ? reminderLib.intervalDays(this.data) : 1,
      time: this.data.time,
      date: this.data.solarDate,
      advanceDays: anniversary && !this.data.notify ? [0] : advanceDays,
      lunar: useLunar
        ? { year: this.data.lunarYear, month: slot.month, day: option.value, isLeap: Boolean(slot.isLeap) }
        : null
    }
    if (anniversary) payload.notify = this.data.notify
    if (this.data.id) payload.id = this.data.id
    return payload
  },
  refreshDerived() {
    const anniversary = this.data.kind === reminderLib.KIND_ANNIVERSARY
    const daily = !anniversary && this.data.repeat === 'daily'
    const step = reminderLib.intervalDays(this.data)
    const advanceDays = daily ? [0] : this.data.advanceDays
    const advanceOptions = reminderLib.ADVANCE_OPTIONS.map(item => ({ ...item, checked: advanceDays.includes(item.value) }))
    // 「每天」芯片跟着步长改名，避免写着「每天」其实每 3 天
    const repeats = reminderLib.REPEATS.map(item => (
      item.value === 'daily' && daily && step > 1 ? { ...item, label: `每 ${step} 天` } : item
    ))
    // 纪念日选了农历、或这条是存量农历普通提醒时，用农历选择器
    const lunarMode = anniversary ? this.data.calendar === 'lunar' : this.data.legacyLunar
    const draft = this.buildPayload()
    const next = reminderLib.nextOccurrence({ ...draft, enabled: true }, this.data.today)
    const previewText = anniversary
      ? this.describeAnniversary(draft, next)
      : this.describeReminder(draft)
    const dailyHint = daily
      ? `${step > 1 ? `每 ${step} 天提醒一次` : '每天都会提醒'}，无需设置提前天数`
      : ''
    this.setData({ dailyRepeat: daily, advanceDays, advanceOptions, repeats, dailyHint, previewText, lunarMode, pushPreview: this.buildPushPreview(draft) })
  },
  /**
   * 「微信里会收到这样一条」：行数、标签、取值全部来自 utils/notify.js 的 TEMPLATE_SLOTS，
   * 跟云函数发出去的是同一份模板定义 —— 换模板后预览自动跟着变，不用改这里。
   */
  buildPushPreview(draft) {
    if (!this.data.pushReady) return []
    const anniversary = this.data.kind === reminderLib.KIND_ANNIVERSARY
    if (anniversary && !this.data.notify) return []
    const enabled = { ...draft, enabled: true }
    const occurrence = reminderLib.nextOccurrence(enabled, this.data.today) || draft.date
    // 一条提醒可能挂多个提前节点；预览按最近的那个（当天优先）算「提醒内容」
    const advanceDays = draft.advanceDays && draft.advanceDays.length ? draft.advanceDays : [0]
    const values = notify.buildValues(enabled, occurrence, Math.min(...advanceDays))
    return notify.TEMPLATE_SLOTS.map(slot => ({
      key: slot.key,
      label: slot.label,
      value: values[slot.source],
      // 「日程标题」这格在编辑页里，提醒叫「提醒内容」、纪念日叫「名称」
      source: slot.source === 'content' ? (anniversary ? '名称' : '提醒内容') : slot.sourceLabel
    }))
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
    // 普通提醒恒定推送（表单不再提供开关）；纪念日只有开了「到期提醒」才推
    const wantPush = anniversary ? this.data.notify : true
    const pushReady = wantPush && subscribe.configured()
    // 订阅弹窗只在「新建」时出现：这是唯一能让用户勾上「总是保持以上选择」的时机，
    // 勾上之后首页抽签 / 记录 / 签到那些静默补额度才真正生效。
    // 编辑已有条目不再弹——该给的授权在新建时已经问过，缺额度去提醒页点「额度+1」
    const askSubscribe = !this.data.id && subscribe.configured()
    if (askSubscribe) {
      try {
        if (await subscribe.requestSubscribe()) await store.addPushQuota(1)
      } catch (error) {
        console.error('订阅授权失败', error)
      }
    }
    wx.showToast({ title: anniversary ? '纪念日已保存' : (pushReady ? '提醒已保存' : '已保存为应用内提醒') })
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
