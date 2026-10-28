const store = require('../../utils/store')
const checkinLib = require('../../utils/checkin')
const tabbar = require('../../utils/tabbar')

function daysAgo(dateText) {
  if (!dateText) return '还没吃过'
  const day = 24 * 60 * 60 * 1000
  const diff = Math.max(0, Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(`${dateText}T00:00:00`).getTime()) / day))
  if (diff === 0) return '今天吃过'
  if (diff === 1) return '昨天吃过'
  return `${diff} 天前吃过`
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
    store.syncFromCloud()
      .then(synced => { if (synced) this.render() })
      .catch(error => console.error('云同步失败，使用本地数据', error))
  },
  /** 刷新设置与签到条，再让菜品落在「记住的那道」上 */
  render() {
    const settings = store.getSettings()
    const filters = this.data.filters
    this.setData({
      settings,
      filters,
      filterCount: Object.values(filters).filter(Boolean).length,
      checkin: this.checkinView()
    })
    this.settleDish()
  },
  /**
   * 菜品只在两种情况下换：点「帮我选一个」，或者记住的那道彻底不可用
   * （被删、被停用、或不符合当前筛选条件）。
   * 重进首页、切 tab、云同步回来都不换；刚把它记成吃过也不换——
   * 「避开最近吃过」只约束抽签，卡片上本来就有「今天吃过」。
   */
  settleDish() {
    // 摇骰子动画期间别插一脚，等它自己落定
    if (this.data.rolling) return
    const wantedId = this.data.dish ? this.data.dish.id : store.getHomePick()
    const keptPool = this.getCandidates({ ignoreRecent: true })
    const kept = keptPool.find(item => item.id === wantedId)
    if (!kept) return this.pick()
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
    const result = pool[Math.floor(Math.random() * pool.length)]
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
  openCheckins() { wx.navigateTo({ url: '/pages/checkins/checkins' }) },
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
    let list = store.getDishes().filter(item => item.enableRandom !== false)
      .filter(item => !meal || (item.mealTypes || []).includes(meal))
      .filter(item => !category || item.category === category)
      .filter(item => !eatType || (item.eatTypes || []).includes(eatType))
      .filter(item => !price || item.price === price)
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
    this.landDish(this.getCandidates(), options)
  },
  stopRolling() {
    if (this.rollTimer) clearTimeout(this.rollTimer)
    this.rollTimer = null
    if (this.burstTimer) clearTimeout(this.burstTimer)
    this.burstTimer = null
    if (this.data.rolling || this.data.burst) this.setData({ rolling: false, burst: false })
  },
  handlePick() {
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
    const meal = this.data.filters.meal || store.getSettings().defaultMeal || '午餐'
    wx.navigateTo({ url: `/pages/record-form/record-form?dishId=${this.data.dish.id}&meal=${meal}` })
  }
})
