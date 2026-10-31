const store = require('../../utils/store')
const checkinLib = require('../../utils/checkin')
const festivalLib = require('../../utils/festival')
const tabbar = require('../../utils/tabbar')
const pad = n => `${n}`.padStart(2, '0')
/** 2026-10-27 → 「10 月 27 日」，空态卡片的文案里要用 */
const shortDate = date => `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`

/**
 * 空态卡左边那个小图标。以前写死一朵「🌤️」，天天看同一朵；
 * 现在每次进页面从库里挑一个 —— 别用 Math.random 直接当 data 初值，
 * 那样 onShow 一覆盖就会闪一下，所以页面上只在 onShow 里换。
 */
const WEATHER_EMOJI = ['🌤️', '☀️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌈', '🍃', '❄️']
const randomWeather = () => WEATHER_EMOJI[Math.floor(Math.random() * WEATHER_EMOJI.length)]
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 日历可翻范围，以「今天所在的月」为锚点：
 * 往前 12 个月、往后 6 个月，加上当月共 19 页。
 * 往后翻是为了先看一眼往后的节日落在星期几，记餐本身仍然不许写未来。
 */
const MONTHS_BACK = 12
const MONTHS_FORWARD = 6

/** 判定翻页手势的最小横向位移（px） */
const SWIPE_MIN_X = 50

/** 滑完多久内的点击视为误触（ms） */
const SWIPE_TAP_GUARD = 300

/** 取触点坐标：Skyline 与 Webview 给的字段不完全一样，逐个兜一下 */
function touchPoint(list) {
  const touch = list && list[0]
  if (!touch) return null
  const x = typeof touch.clientX === 'number' ? touch.clientX : typeof touch.pageX === 'number' ? touch.pageX : touch.x
  const y = typeof touch.clientY === 'number' ? touch.clientY : typeof touch.pageY === 'number' ? touch.pageY : touch.y
  if (typeof x !== 'number' || typeof y !== 'number') return null
  return { x, y }
}

/** 年月折成月序号，翻页边界判断用它比字符串省事 */
function monthIndex(year, month) {
  return year * 12 + (month - 1)
}

function weekdayOf(dateText) {
  return WEEKDAYS[new Date(`${dateText}T00:00:00`).getDay()]
}

Page({
  data: {
    selectedDate: '',
    weeks: ['日', '一', '二', '三', '四', '五', '六'],
    cells: [],
    days: [],
    // 搜索：输入关键词后日历让位给结果列表，日历只能按时间翻，翻不到「上次那家店叫什么」
    keyword: '',
    searching: false,
    hits: [],
    monthCount: 0,
    todayEmpty: false,
    hintDate: '',
    festivals: [],
    festivalTitle: '',
    canPrev: true,
    canNext: false,
    // 查看的不是本月时，月份标题右边挂一个「回到本月」，翻远了不用一格一格点回来
    showBackToMonth: false,
    // 空态卡左边那个天气图标，每次进页面换一个（见 onShow）
    weatherEmoji: WEATHER_EMOJI[0],
    emptyTitle: '',
    emptySub: '',
    tabbar: tabbar.create(2)
  },
  onTabTap(e) {
    tabbar.go(e)
  },
  onLoad() {
    const now = new Date()
    this.year = now.getFullYear()
    this.month = now.getMonth() + 1
    // 今天所在月是锚点：最早能翻到 12 个月前，最远能翻到 6 个月后
    this.currentMonthIndex = monthIndex(this.year, this.month)
    this.earliestMonthIndex = this.currentMonthIndex - MONTHS_BACK
    this.latestMonthIndex = this.currentMonthIndex + MONTHS_FORWARD
    // 「上次进来时今天在哪个」+「还跟不跟今天」：隔夜跨月靠这两个值判断要不要自动跳月
    this.lastTodayMonth = this.currentMonthIndex
    this.followToday = true
    this.swipeStart = null
  },
  onShow() {
    // 必须在 refresh 之前：跨月了要先把这个月换掉，否则刷出来的还是上个月的日历
    this.followCurrentMonth()
    this.refresh()
    store.syncThen(() => this.refresh())
  },
  /**
   * 隔夜跨月后自动跟到今天所在的月。
   *
   * tab 页实例常驻内存，this.year / this.month 只在 onLoad 算过一次 ——
   * 10 月 31 号把它放后台，11 月 1 号再点「记录」，看到的还是 10 月的日历，
   * 得手动点标题右边那个「本月」胶囊才回来。
   *
   * 判据是「当前看着的月 == 上次进来时今天所在的月」：
   * 用户自己翻去看 3 月的记录，就不该被拽回来。手动翻月会关掉 followToday，
   * 点「回到本月」再打开。可翻范围的锚点无论跟不跟随都要挪，否则新月份会卡在边界外。
   */
  followCurrentMonth() {
    const now = new Date()
    const todayMonth = monthIndex(now.getFullYear(), now.getMonth() + 1)
    const lastTodayMonth = this.lastTodayMonth
    this.lastTodayMonth = todayMonth
    this.currentMonthIndex = todayMonth
    this.earliestMonthIndex = todayMonth - MONTHS_BACK
    this.latestMonthIndex = todayMonth + MONTHS_FORWARD
    if (todayMonth === lastTodayMonth) return
    if (!this.followToday) return
    if (monthIndex(this.year, this.month) !== lastTodayMonth) return
    this.year = now.getFullYear()
    this.month = now.getMonth() + 1
    this.setData({ selectedDate: '' })
  },
  /**
   * 饮食记录与每日签到在这里合并成「一天一张卡」：
   * 日历格优先显示当天心情，日卡里心情、随笔与当天各餐放在同一块。
   */
  refresh() {
    this.monthView = this.buildMonthView()
    this.paint(this.monthView, true)
  },
  /**
   * 当月的数据模型：日历格子 + 整月的日期卡片。
   * 选中 / 取消选中某一天只是换筛选条件，模型本身没变 ——
   * 以前这两步都要把全月记录重新 map 一遍，现在选中态只重算展示层。
   * 数据变了（删除记录、从别的页面回来）由 refresh 重建，不走这里。
   */
  buildMonthView() {
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
    checkins.forEach(item => {
      if (item && item.date) checkinByDate[item.date] = item
    })

    const monthPrefix = `${this.year}-${pad(this.month)}`

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
        // 读屏用：日历格只有数字，光念「28」没有意义，得把月份和当天有几餐一起说清
        label: `${this.month} 月 ${day} 日${meals.length ? `，${meals.length} 餐` : ''}`,
        mark: mood ? mood.emoji : dish.emoji || (meals.length ? '●' : ''),
        moodIcon: mood ? mood.icon : '',
        hasMood: Boolean(mood),
        // 节日当天：数字变亮蓝。日历是回顾用的，这个月已过的节日也照样标
        hasFestival: festivalLib.festivalsOf(date).length > 0,
        // 自定义纪念日：数字变亮紫，同一天既有节日又有纪念日时紫色赢
        hasAnniversary: festivalLib.anniversariesOn(reminders, date).length > 0,
        // 有提醒的日子：数字下面点一个红点（纪念日不点，它已经有紫色数字了）
        hasReminder: festivalLib.hasReminderOn(reminders, date),
        count: meals.length,
        isToday: date === todayText,
        future: date > todayText
      })
    }

    // 日卡：有餐或有心情的日期，按时间倒序
    // 用 Set 去重：以前是 filter + indexOf，数据攒到几年后这里会变成 O(n²)
    const datePool = [...new Set(Object.keys(mealsByDate).concat(Object.keys(checkinByDate)))]
    const days = datePool
      .filter(date => date.slice(0, 7) === monthPrefix)
      .sort((a, b) => b.localeCompare(a))
      .map(date => {
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

    const viewIndex = monthIndex(this.year, this.month)
    const todayPrefix = todayText.slice(0, 7)
    // 「今天还是空白」只在看当月时才出现：翻到历史月，它夹在一堆别的日期卡片里会被误读
    const viewingTodayMonth = monthPrefix === todayPrefix
    return {
      monthPrefix,
      cells,
      days,
      reminders,
      todayText,
      todayEmpty: viewingTodayMonth && !(mealsByDate[todayText] || []).length && !checkinByDate[todayText],
      canPrev: viewIndex > this.earliestMonthIndex,
      canNext: viewIndex < this.latestMonthIndex,
      // 只有翻到别的月份才需要这个入口；本月不显示，免得平白多一个按钮
      canBackToMonth: !viewingTodayMonth,
      hintDate: `${Number(todayText.slice(5, 7))} 月 ${Number(todayText.slice(8, 10))} 日`
    }
  },
  /**
   * 把月模型画到页面上。withCells=false 时不重传日历格子：
   * 选中态是靠 wxml 里 selectedDate === item.date 比出来的，数据没变就别推一遍。
   */
  paint(view, withCells) {
    const selected = this.data.selectedDate
    const days = selected ? view.days.filter(item => item.date === selected) : view.days
    // 挑某天 → 显示那一天的节日与纪念日；当月不挑 → 本周剩下的；翻到别的月份且不挑日子就不挂
    // 注意别叫 days：日卡列表已经占用了这个名字
    const festivalDays = selected
      ? festivalLib.daysToShow(view.reminders, view.todayText, {
          date: selected
        })
      : view.monthPrefix === view.todayText.slice(0, 7)
        ? festivalLib.daysToShow(view.reminders, view.todayText, { limit: 3 })
        : []
    const title = selected
      ? `${Number(selected.slice(5, 7))} 月 ${Number(selected.slice(8, 10))} 日这天`
      : festivalLib.hasAnniversary(festivalDays)
        ? festivalDays.every(item => item.kind === 'anniv')
          ? '本周纪念日'
          : '本周节日 · 纪念日'
        : '本周节日'
    // 空列表提示分五种：挑中的未来日 / 挑中的空白日 / 当月还没记录 / 过去的空月 / 还没到的月份
    const emptyCopy = selected
      ? selected > view.todayText
        ? { title: '这天还没到', sub: '先看看节日和纪念日，到了那天再来记' }
        : {
            title: '这一天还没有记录',
            sub: '点月份旁的「月」回到整月'
          }
      : view.monthPrefix > view.todayText.slice(0, 7)
        ? { title: '这个月还没到', sub: '先记下今天，日子到了自然就有内容' }
        : view.monthPrefix < view.todayText.slice(0, 7)
          ? { title: '本月没有记录', sub: '   再翻翻别的月份看看呗~' }
          : { title: '今天还是空白哦', sub: '留下一点生活的痕迹呗~' }
    // 空态卡：整月视图且今天空白、或选中某天且那天空白（未来日除外），都给一个「写心情」入口。
    // 以前只在「今天空白」时给，选中一个空日子就只剩一句「这一天还没有记录」，得自己去点「记一餐」。
    const selectedEmpty = Boolean(selected) && !days.length && selected <= view.todayText
    const hintTargetDate = selected || view.todayText
    const hintIsToday = hintTargetDate === view.todayText
    // 注意 view.todayEmpty 是「整月视图下今天空白」，选中某天时不能拿它当条件 ——
    // 否则选一个明明有记录的日子，也会因为「今天空着」而冒出这张卡
    const emptyHint =
      (!selected && view.todayEmpty) || selectedEmpty
        ? {
            title: hintIsToday ? '今天还是空白' : '这天还是空白',
            desc: `${shortDate(hintTargetDate)}还没有记录，${hintIsToday ? '写一句心情或先记一餐' : '补一句心情或记一餐'}`
          }
        : null
    const patch = {
      monthTitle: `${this.year} 年 ${this.month} 月`,
      days,
      // 选中某天时这里就是那一天的餐数，和列表里看到的一致
      monthCount: days.reduce((sum, item) => sum + item.mealCount, 0),
      // 选中某天时那张卡片不该出现：它夹在别人的日期卡片里会被误读成在说那一天
      todayEmpty: view.todayEmpty && !selected,
      emptyHint,
      hintTargetDate,
      hintDate: shortDate(hintTargetDate),
      festivals: festivalDays,
      festivalTitle: title,
      emptyTitle: emptyCopy.title,
      emptySub: emptyCopy.sub,
      canPrev: view.canPrev,
      canNext: view.canNext,
      showBackToMonth: view.canBackToMonth
    }
    if (withCells) patch.cells = view.cells
    // 天气图标跟着空态卡走：卡片这次要显示就换一个，不显示就不动。
    // 放在这里而不是 onShow —— 选中某天、翻月、取消选中都会重绘，
    // 用户每看到一次这张卡，左边的天气就该是新的。
    if (emptyHint) patch.weatherEmoji = randomWeather()
    this.setData(patch)
    // 搜索态下刷新数据（比如刚删了一条），结果要跟着变
    if (this.data.searching) this.applySearch()
  },
  /** 只换选中态：复用月模型，不重读 storage、不重建日历 */
  repaint() {
    if (!this.monthView) return this.refresh()
    this.paint(this.monthView, false)
  },
  /** 搜索框输入：只在有关键词时才铺结果，清空即回到日历 */
  onSearchInput(e) {
    const keyword = e.detail.value || ''
    this.setData({ keyword, searching: Boolean(keyword.trim()) })
    if (keyword.trim()) this.applySearch()
  },
  clearSearch() {
    this.setData({ keyword: '', searching: false, hits: [] })
  },
  /**
   * 按关键词捞记录：菜名 / 备注 / 状态 / 餐次都能命中。
   * 菜名是记下那一刻的快照（菜品删了也还在），所以搜「上周那家店」找得回来。
   */
  applySearch(inputRecords, inputDishMap) {
    const keyword = String(this.data.keyword || '').trim()
    if (!keyword) return this.setData({ hits: [] })
    const records = inputRecords || store.getRecords()
    const dishMap = inputDishMap || new Map(store.getDishes().map(item => [item.id, item]))
    const kw = keyword.toLowerCase()
    const hits = []
    for (const item of records) {
      if (!item) continue
      const text =
        `${item.dishName || ''} ${item.remark || ''} ${item.status || ''} ${item.mealType || ''}`.toLowerCase()
      if (!text.includes(kw)) continue
      const dish = dishMap.get(item.dishId) || {}
      const date = String(item.date || '')
      hits.push({
        id: item.id,
        date,
        dateText: /^\d{4}-\d{2}-\d{2}$/.test(date)
          ? `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`
          : '未标注日期',
        weekday: weekdayOf(date),
        mealType: item.mealType || '',
        timeText: store.recordClock(item),
        dishName: item.dishName || '（菜品已删除）',
        emoji: dish.emoji || '🍽',
        score: item.score,
        noteText: item.remark || item.status || ''
      })
      // 结果太多反而找不到，先给最近 50 条；真要更多就收窄关键词
      if (hits.length >= 50) break
    }
    return this.setData({ hits })
  },
  /** 翻到上一个月；到头了就停住，不越过 12 个月的下限 */
  prevMonth() {
    if (monthIndex(this.year, this.month) <= this.earliestMonthIndex) return false
    // 用户主动翻月了：从此不再自动跟到今天所在的月，免得他正看着旧月份时被拽走
    this.followToday = false
    this.month--
    if (this.month < 1) {
      this.month = 12
      this.year--
    }
    this.setData({ selectedDate: '' })
    this.refresh()
    return true
  },
  /** 翻到下一个月；上限是当前月 + 6 */
  nextMonth() {
    if (monthIndex(this.year, this.month) >= this.latestMonthIndex) return false
    this.followToday = false
    this.month++
    if (this.month > 12) {
      this.month = 1
      this.year++
    }
    this.setData({ selectedDate: '' })
    this.refresh()
    return true
  },
  /**
   * 直接跳回今天所在的月份（「回到本月」按钮）。
   * 点一下顶替连点十次箭头；同时把可翻范围的锚点重算到真正的今天 ——
   * 页面可能在后台挂了一夜跨了月，旧边界会把新月份卡在外面。
   * 回到本月即恢复「跟随今天」，下次隔夜跨月会自动跳过去。
   */
  backToMonth() {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const index = monthIndex(year, month)
    this.currentMonthIndex = index
    this.earliestMonthIndex = index - MONTHS_BACK
    this.latestMonthIndex = index + MONTHS_FORWARD
    this.lastTodayMonth = index
    this.followToday = true
    this.year = year
    this.month = month
    this.setData({ selectedDate: '' })
    this.refresh()
    return true
  },
  /** 日历区左滑 / 右滑翻页：横向位移要压过纵向，免得列表滚动时手一歪就翻月 */
  onCalendarTouchStart(e) {
    this.swipeStart = touchPoint(e.touches)
  },
  onCalendarTouchEnd(e) {
    const start = this.swipeStart
    this.swipeStart = null
    const end = touchPoint(e.changedTouches)
    if (!start || !end) return
    const dx = end.x - start.x
    const dy = end.y - start.y
    if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dx) < Math.abs(dy) * 1.5) return
    // 手势结束后系统还可能补一个 tap，记个时间戳让 selectDate 把它吞掉
    this.lastSwipeAt = Date.now()
    if (dx < 0) this.nextMonth()
    else this.prevMonth()
  },
  selectDate(e) {
    const date = e.currentTarget.dataset.date
    // 空白天数格不接；未来日子照样能点开——只是看那天有什么节日 / 提醒，
    // 签到与记餐在各自的表单里还会再拦一次（都不许写未来）
    if (!date) return
    // 刚滑完那一下的点击不算选日期（手指从格子上划过会落到某一格）
    if (this.lastSwipeAt && Date.now() - this.lastSwipeAt < SWIPE_TAP_GUARD) return
    this.setData({ selectedDate: this.data.selectedDate === date ? '' : date })
    this.repaint()
  },
  clearDate() {
    this.setData({ selectedDate: '' })
    this.repaint()
  },
  /** 点心情图标或日期 → 写 / 改当天心情；未来日子只给看，不给签 */
  openCheckin(e) {
    const date = e.currentTarget.dataset.date
    if (!date) return
    if (date > checkinLib.today())
      return wx.showToast({
        title: '这天还没到，签到从当天开始',
        icon: 'none'
      })
    wx.navigateTo({ url: `/pages/checkin-form/checkin-form?date=${date}` })
  },
  /** 给某一天加一餐；同样不放行未来日期 */
  addMeal(e) {
    const date = e.currentTarget.dataset.date || checkinLib.today()
    if (date > checkinLib.today()) return wx.showToast({ title: '这天还没到，不能提前记餐', icon: 'none' })
    wx.navigateTo({ url: `/pages/record-form/record-form?date=${date}` })
  },
  addToday() {
    wx.navigateTo({
      url: `/pages/record-form/record-form?date=${checkinLib.today()}`
    })
  },
  /** 点空态卡：去那天的签到页。选中某天就跳那天，没选中就是今天 */
  openHintCheckin(e) {
    const date = (e && e.currentTarget && e.currentTarget.dataset.date) || checkinLib.today()
    // 未来日子不签也记不了，直接吞掉（正常情况下这类卡片压根不显示）
    if (date > checkinLib.today()) return
    wx.navigateTo({
      url: `/pages/checkin-form/checkin-form?date=${date}`
    })
  },
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
