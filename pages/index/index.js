const store = require('../../utils/store')
const checkinLib = require('../../utils/checkin')

function daysAgo(dateText) {
  if (!dateText) return '还没吃过'
  const day = 24 * 60 * 60 * 1000
  const diff = Math.max(0, Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(`${dateText}T00:00:00`).getTime()) / day))
  if (diff === 0) return '今天吃过'
  if (diff === 1) return '昨天吃过'
  return `${diff} 天前吃过`
}

Page({
  data: {
    dish: null, candidates: 0, filterOpen: false, rolling: false,
    filters: { meal: '', category: '', eatType: '', price: '' },
    meals: store.MEALS, categories: store.CATEGORIES, eatTypes: store.EAT_TYPES, prices: store.PRICES,
    filterCount: 0,
    checkin: { emoji: '🌤️', checked: false, title: '今天还没签到', sub: '记一餐、记心情，十秒搞定' }
  },
  onShow() {
    // 先把本地缓存画出来，切 tab 不再等云端往返
    this.render({ keepDish: false })
    store.syncFromCloud()
      .then(synced => { if (synced) this.render({ keepDish: true }) })
      .catch(error => console.error('云同步失败，使用本地数据', error))
  },
  /** keepDish=true：只刷新设置与签到条，不重新抽菜（避免用户看到菜品自己跳变） */
  render(options) {
    const keepDish = Boolean(options && options.keepDish)
    const settings = store.getSettings()
    const filters = this.data.filters
    this.setData({ settings, filters, filterCount: Object.values(filters).filter(Boolean).length, checkin: this.checkinView() })
    if (keepDish && this.data.dish) return
    this.pick()
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
    this.pick(false)
  },
  clearFilters() {
    this.stopRolling()
    this.setData({ filters: { meal: '', category: '', eatType: '', price: '' }, filterCount: 0 })
    this.pick(false)
  },
  getCandidates() {
    const { meal, category, eatType, price } = this.data.filters
    const settings = store.getSettings()
    const recentLimit = Date.now() - Number(settings.recentDays || 0) * 86400000
    let list = store.getDishes().filter(item => item.enableRandom !== false)
      .filter(item => !meal || (item.mealTypes || []).includes(meal))
      .filter(item => !category || item.category === category)
      .filter(item => !eatType || (item.eatTypes || []).includes(eatType))
      .filter(item => !price || item.price === price)
    if (!settings.allowRepeat && settings.recentDays > 0) {
      list = list.filter(item => !item.lastEatDate || new Date(`${item.lastEatDate}T23:59:59`).getTime() < recentLimit)
    }
    return list
  },
  formatDish(result) {
    return { ...result, lastEatText: daysAgo(result.lastEatDate), scoreText: result.score ? Number(result.score).toFixed(1) : '暂无' }
  },
  pick() {
    const list = this.getCandidates()
    if (!list.length) return this.setData({ dish: null, candidates: 0, rolling: false })
    let pool = list
    if (list.length > 1 && this.data.dish) pool = list.filter(item => item.id !== this.data.dish.id)
    const result = pool[Math.floor(Math.random() * pool.length)]
    this.setData({ dish: this.formatDish(result), candidates: list.length, rolling: false })
  },
  stopRolling() {
    if (this.rollTimer) clearTimeout(this.rollTimer)
    this.rollTimer = null
    if (this.data.rolling) this.setData({ rolling: false })
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
        let pool = list
        if (list.length > 1 && this.data.dish) pool = list.filter(item => item.id !== this.data.dish.id)
        const result = pool[Math.floor(Math.random() * pool.length)]
        this.rollTimer = null
        this.setData({ dish: this.formatDish(result), rollingDish: null, rolling: false })
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
