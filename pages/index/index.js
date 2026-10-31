const store = require('../../utils/store')
const checkinLib = require('../../utils/checkin')
const pick = require('../../utils/pick')
const subscribe = require('../../utils/subscribe')
const tabbar = require('../../utils/tabbar')

function daysAgo(dateText) {
  if (!dateText) return '还没吃过'
  const day = 24 * 60 * 60 * 1000
  const diff = Math.max(0, Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(`${dateText}T00:00:00`).getTime()) / day))
  if (diff === 0) return '今天吃过'
  if (diff === 1) return '昨天吃过'
  return `${diff} 天前吃过`
}

/** chip 上的短文案：位置小，「3 天前」比「3 天前吃过」省一半宽 */
function shortAgo(dateText, todayText) {
  if (!dateText) return ''
  const diff = pick.daysSince(dateText, todayText)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff < 30) return `${diff} 天前`
  return `${Math.floor(diff / 30)} 个月前`
}

/** 彩带配色：跟首页的暖色调对齐，掺一点草绿 */
const CONFETTI_COLORS = ['#E85D3F', '#F0906E', '#E3A228', '#F2C14E', '#C84832', '#A8C69F']
/**
 * 生成一次「撕开礼品袋」的彩带碎片：全部从菜品中心出发，向四周迸射。
 * 方向只能是 d1~d12 这 12 个样式表里的 keyframes——Skyline 下内联 animation-*
 * （哪怕只写 animation-delay）会让整条动画不播，踩过；所以只在内联里放位置、尺寸、颜色。
 */
function confettiPieces(count) {
  const total = count || 22
  const pieces = []
  for (let i = 0; i < total; i++) {
    pieces.push({
      id: `c${i}_${Math.random().toString(36).slice(2, 7)}`,
      dir: Math.floor(Math.random() * 12) + 1,
      px: Number((50 + (Math.random() * 6 - 3)).toFixed(1)),
      py: Math.round(168 + (Math.random() * 18 - 9)),
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      w: Math.round(11 + Math.random() * 8),
      h: Math.round(18 + Math.random() * 16),
      radius: Math.random() < 0.45 ? 999 : 3
    })
  }
  return pieces
}

Page({
  data: {
    dish: null, candidates: 0, filterOpen: false, rolling: false,
    burst: false, confetti: [],
    // 最近吃过的那几道：首页的「一键再记一次」入口，把记一餐从 5 步压到 2 步
    recentDishes: [],
    filters: { meal: '', category: '', eatType: '', price: '' },
    meals: store.MEALS, categories: store.CATEGORIES, eatTypes: store.EAT_TYPES, prices: store.PRICES,
    filterCount: 0,
    checkin: { emoji: '🌤️', checked: false, title: '今天还没签到', sub: '记一餐、记心情，十秒搞定' },
    tabbar: tabbar.create(0)
  },
  onTabTap(e) { tabbar.go(e) },
  onShow() {
    // 先把本地缓存画出来，切 tab 不再等云端往返
    this.render()
    // 顺手探一下「总是保持以上选择」的勾选状态：静默补推送额度靠它做判据，
    // 放 onShow 是因为这里不挑手势，塞进 tap 会把订阅调用挤出点击窗口
    subscribe.refreshState()
    store.syncThen(() => this.render())
  },
  /** 刷新设置与签到条，再让菜品落在「记住的那道」上 */
  render() {
    // 一次 render 里每份数据只反序列化一次，往下传。
    // 以前是 getSettings ×2、getDishes ×2、getRecords ×1、getCheckins ×1，
    // 数据攒到几千条之后切一次 tab 就有明显的黏手感
    const settings = store.getSettings()
    const dishes = store.getDishes()
    const records = store.getRecords()
    const filters = this.data.filters
    this.setData({
      settings,
      filters,
      filterCount: Object.values(filters).filter(Boolean).length,
      checkin: this.checkinView(),
      recentDishes: this.recentViews(dishes, records, settings)
    })
    this.settleDish(dishes)
  },
  /**
   * 最近吃过的 6 道，按记录时间倒序去重。
   * 记录本身是日期倒序的，扫到第六个不同的菜就停——不用给整份记录排序。
   * 六道刚好铺两行（每行三个），再多就顶到屏幕外了。
   */
  recentViews(inputDishes, inputRecords, inputSettings) {
    // 参数由 render 传进来；单独调用（比如测试）时自己读
    const settings = inputSettings || store.getSettings()
    const dishes = inputDishes || store.getDishes()
    const records = inputRecords || store.getRecords()
    const todayText = checkinLib.today()
    const dishMap = new Map(dishes.map(item => [item.id, item]))
    const seen = new Set()
    const list = []
    for (const record of records) {
      if (!record || !record.dishId || seen.has(record.dishId)) continue
      const dish = dishMap.get(record.dishId)
      // 菜品已被删掉的记录跳过：点进去也记不了这道菜
      if (!dish) continue
      seen.add(record.dishId)
      list.push({
        id: dish.id,
        name: dish.name,
        emoji: dish.emoji || '🍽️',
        agoText: shortAgo(record.date, todayText),
        mealText: record.mealType || settings.defaultMeal
      })
      if (list.length >= 6) break
    }
    return list
  },
  /** 点「最近吃过」里的一道：直接进记录页，菜品 / 餐次 / 日期都预填好 */
  quickLog(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const meal = this.data.filters.meal || store.getSettings().defaultMeal || '午餐'
    wx.navigateTo({
      url: `/pages/record-form/record-form?dishId=${id}&meal=${encodeURIComponent(meal)}&date=${checkinLib.today()}`
    })
  },
  /**
   * 菜品只在两种情况下换：点「开始随机选」，或者记住的那道彻底不可用
   * （被删、被停用、或不符合当前筛选条件）。
   * 重进首页、切 tab、云同步回来都不换；刚把它记成吃过也不换——
   * 「避开最近吃过」只约束抽签，卡片上本来就有「今天吃过」。
   */
  settleDish(inputDishes) {
    // 摇骰子动画期间别插一脚，等它自己落定
    if (this.data.rolling) return
    const wantedId = this.data.dish ? this.data.dish.id : store.getHomePick()
    // 菜库由 render 传进来，抽签与找菜共用同一份
    const dishes = inputDishes || store.getDishes()
    const keptPool = this.getCandidates({ ignoreRecent: true, dishes })
    const kept = keptPool.find(item => item.id === wantedId)
    if (!kept) return this.pick({ dishes })
    // 还是同一道菜，但从库里重取一次：评分 / 吃过次数可能被别的页面改过
    this.setData({ dish: this.formatDish(kept), candidates: keptPool.length, rolling: false })
  },
  /** 落定一道菜并记住它，下次进首页还显示这道；celebrate=true 时放一次彩带 */
  landDish(list, options) {
    if (!list.length) return this.setData({ dish: null, candidates: 0, rolling: false })
    let pool = list
    if (list.length > 1 && this.data.dish) {
      const others = list.filter(item => item.id !== this.data.dish.id)
      if (others.length) pool = others
    }
    // 按权重抽：评分高、久没吃的更容易中；「允许重复」时最近吃过的降权而非直接入选
    const settings = store.getSettings()
    const result = pick.pickWeighted(pool, checkinLib.today(), { recentDays: Number(settings.recentDays) || 0 })
    if (!result) return this.setData({ dish: null, candidates: 0, rolling: false })
    store.saveHomePick(result.id)
    const celebrate = Boolean(options && options.celebrate)
    this.setData({
      dish: this.formatDish(result),
      candidates: list.length,
      rolling: false,
      burst: celebrate,
      confetti: celebrate ? confettiPieces() : []
    })
    if (celebrate) this.scheduleBurstEnd()
  },
  /** 彩带放完就撤节点，别让一堆全透明碎片一直挂在树上 */
  scheduleBurstEnd() {
    if (this.burstTimer) clearTimeout(this.burstTimer)
    this.burstTimer = setTimeout(() => {
      this.burstTimer = null
      this.setData({ burst: false })
    }, 1300)
  },
  /** 首页顶部的签到提示条 */
  checkinView() {
    const info = checkinLib.overview(store.getCheckins())
    let sub = '记一餐、记心情，十秒搞定'
    if (info.checkedToday) sub = `连续签到 ${info.streak} 天`
    else if (info.streak) sub = `昨天签过 · 连续 ${info.streak} 天，别断哦`
    else if (info.total) sub = '今天签一下，接着记'
    return {
      emoji: info.checkedToday ? info.todayMood.emoji : '🌤️',
      icon: info.checkedToday ? info.todayMood.icon : '',
      checked: info.checkedToday,
      title: info.checkedToday ? `今天已签到 · ${info.todayMood.label}` : '今天还没签到',
      sub
    }
  },
  /**
   * 顶部签到条：按「今天签没签」分流。
   * 已经签了就没必要再进表单，直接去看记录（列表页里点某天还能回头改）；
   * 没签就直接进今天那张表单，少一步。
   */
  openCheckin() {
    // 顶部签到条：点它就是要去签到，顺手补一次
    subscribe.topUpIfNeeded()
    const url = this.data.checkin.checked
      ? '/pages/checkins/checkins'
      : `/pages/checkin-form/checkin-form?date=${checkinLib.today()}`
    wx.navigateTo({ url })
  },
  onHide() { this.stopRolling() },
  onUnload() { this.stopRolling() },
  toggleFilters() { this.setData({ filterOpen: !this.data.filterOpen }) },
  chooseFilter(e) {
    this.stopRolling()
    const { type, value } = e.currentTarget.dataset
    const filters = { ...this.data.filters, [type]: this.data.filters[type] === value ? '' : value }
    this.setData({ filters, filterCount: Object.values(filters).filter(Boolean).length })
    this.pick()
  },
  clearFilters() {
    this.stopRolling()
    this.setData({ filters: { meal: '', category: '', eatType: '', price: '' }, filterCount: 0 })
    this.pick()
  },
  /** ignoreRecent=true：不套「避开最近吃过」这条规则，只按筛选条件筛 */
  getCandidates(options) {
    const { meal, category, eatType, price } = this.data.filters
    const settings = store.getSettings()
    const recentLimit = Date.now() - Number(settings.recentDays || 0) * 86400000
    // dishes 可由调用方传入：一次抽签会问两遍候选，没必要反序列化两遍菜库
    const source = options && options.dishes ? options.dishes : store.getDishes()
    let list = source.filter(item => item.enableRandom !== false)
      .filter(item => !meal || (item.mealTypes || []).includes(meal))
      .filter(item => !category || item.category === category)
      .filter(item => !eatType || (item.eatTypes || []).includes(eatType))
      .filter(item => !price || item.price === price)
    // allowRepeat=false 时硬过滤（用户预期就是「最近吃过的不出现」）；
    // =true 时不在这里排除，改由 pick 的权重压一档——允许重复不等于优先重复
    if (!(options && options.ignoreRecent) && !settings.allowRepeat && settings.recentDays > 0) {
      list = list.filter(item => !item.lastEatDate || new Date(`${item.lastEatDate}T23:59:59`).getTime() < recentLimit)
    }
    return list
  },
  formatDish(result) {
    return { ...result, lastEatText: daysAgo(result.lastEatDate), scoreText: result.score ? Number(result.score).toFixed(1) : '暂无' }
  },
  /** 立刻重抽一道（筛选变化、点骰子落定时用），会覆盖记住的那道 */
  pick(options) {
    // options 要透传：里面可能带着调用方已经读好的 dishes，别在这里又反序列化一遍菜库
    this.landDish(this.getCandidates(options), options)
  },
  stopRolling() {
    if (this.rollTimer) clearTimeout(this.rollTimer)
    this.rollTimer = null
    if (this.burstTimer) clearTimeout(this.burstTimer)
    this.burstTimer = null
    if (this.data.rolling || this.data.burst) this.setData({ rolling: false, burst: false })
  },
  handlePick() {
    // 首页最高频的一下点击，正好拿来静默补推送额度。必须放在最前面同步发起：
    // 等后面跑完一轮 setTimeout / await，就出了点击手势窗口，微信会直接报错
    subscribe.topUpIfNeeded()
    if (this.data.rolling) return
    const list = this.getCandidates()
    if (!list.length) return this.setData({ dish: null, candidates: 0, rolling: false })
    let step = 0
    const totalSteps = 12
    this.setData({ rolling: true, candidates: list.length, rollingDish: list[Math.floor(Math.random() * list.length)] })
    const spin = () => {
      if (step >= totalSteps) {
        this.rollTimer = null
        this.setData({ rollingDish: null })
        // 落定的这一下才放彩带：像礼品袋被撕开，菜品跳出来
        this.pick({ celebrate: true })
        return
      }
      this.setData({ rollingDish: list[Math.floor(Math.random() * list.length)] })
      step += 1
      this.rollTimer = setTimeout(spin, 100)
    }
    this.rollTimer = setTimeout(spin, 100)
  },
  viewDetail() { if (this.data.dish) wx.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${this.data.dish.id}` }) },
  confirmDish() {
    if (!this.data.dish) return
    // 同一个手势里顺手补一次：用户点「就吃这个」是明确要记这一餐了
    subscribe.topUpIfNeeded()
    const meal = this.data.filters.meal || store.getSettings().defaultMeal || '午餐'
    wx.navigateTo({ url: `/pages/record-form/record-form?dishId=${this.data.dish.id}&meal=${meal}` })
  }
})
