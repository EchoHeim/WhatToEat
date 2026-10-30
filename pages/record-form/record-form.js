const store = require('../../utils/store')

function today() { const d = new Date(); const pad = n => `${n}`.padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
/** 新增时的默认时间：就是现在 */
function nowClock() { const d = new Date(); return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}` }

/** 选择面板一次最多平铺几道菜，再多就让用户搜，避免把表单顶到屏幕外 */
const SHEET_PAGE_SIZE = 8

/** 补一行副标题（分类 · 首个标签），wxml 里不写复杂表达式 */
function withMeta(dish) {
  const tag = (dish.tags || [])[0] || ''
  return { ...dish, metaText: [dish.category, tag].filter(Boolean).join(' · ') }
}

/** 菜名 / 标签 / 分类都能命中 */
function matchDishes(dishes, keyword) {
  const kw = String(keyword || '').trim().toLowerCase()
  if (!kw) return dishes
  return dishes.filter(item => `${item.name || ''} ${(item.tags || []).join(' ')} ${item.category || ''}`.toLowerCase().includes(kw))
}

Page({
  data: {
    id: '',
    pageTitle: '记录一餐',
    saveText: '保存这餐',
    dishes: [],
    dishId: '',
    dishName: '',
    dishEmoji: '',
    dishSheetOpen: false,
    dishKeyword: '',
    visibleDishes: [],
    dishMatchTotal: 0,
    date: today(),
    today: today(),
    time: nowClock(),
    mealType: '午餐',
    meals: store.MEALS,
    score: 4,
    statuses: [{ name: '吃得很好', emoji: '😋' }, { name: '还不错', emoji: '🙂' }, { name: '一般般', emoji: '😐' }, { name: '不太行', emoji: '😣' }],
    status: '还不错',
    remark: ''
  },
  onLoad(options) {
    const query = options || {}
    const dishes = store.getDishes()
    // 带 id 是改已有的一餐，不带是新增
    const editing = query.id ? store.getRecord(query.id) : null
    const wantedDishId = editing ? editing.dishId : query.dishId
    const chosen = dishes.find(item => item.id === wantedDishId) || null
    // 从日卡「＋ 一餐」进来时带上那一天，补记历史日期也走这里
    const todayText = today()
    const wantedDate = (editing && editing.date) || query.date || ''
    const date = /^\d{4}-\d{2}-\d{2}$/.test(wantedDate) && wantedDate <= todayText ? wantedDate : todayText
    // 历史记录里可能有 0 分（早先的脏数据），落到滑块上要回默认值
    const editScore = editing ? Number(editing.score) : NaN
    this.setData({
      id: editing ? editing.id : '',
      pageTitle: editing ? '修改这一餐' : '记录一餐',
      saveText: editing ? '保存修改' : '保存这餐',
      // 页面模块常驻内存，data 里那份 today 是首次加载时算的，跨天就过期了。
      // 这里用 onLoad 现算的值覆盖，否则「今天」比实际早一天，保存会被未来日期校验拦住
      today: todayText,
      dishes,
      // 菜品后来被删掉时仍保留记录里的快照，不逼用户重新选一道菜
      dishId: wantedDishId || '',
      dishName: chosen ? chosen.name : ((editing && editing.dishName) || ''),
      dishEmoji: chosen ? (chosen.emoji || '🍽️') : ((editing && editing.dishEmoji) || '🍽️'),
      visibleDishes: dishes.slice(0, SHEET_PAGE_SIZE).map(withMeta),
      dishMatchTotal: dishes.length,
      mealType: (editing && editing.mealType) || query.meal || store.getSettings().defaultMeal || '午餐',
      date,
      // 编辑老记录时按它原本的时间回填，没有 time 字段就从 createdAt 推
      time: store.recordClock(editing) || nowClock(),
      score: Number.isFinite(editScore) && editScore > 0 ? editScore : 4,
      status: (editing && editing.status) || '还不错',
      remark: (editing && editing.remark) || ''
    })
    this.loaded = true
    // 表单用本地缓存先立起来，云端同步放后台——列表页已经同步过一轮了
    store.syncFromCloud().catch(error => console.error('云同步失败，使用本地数据', error))
  },
  /** 从「新建菜品」返回时把新菜自动选中，同时刷新列表 */
  onShow() {
    if (!this.loaded) return
    const dishes = store.getDishes()
    const app = getApp()
    const pendingId = app.globalData ? app.globalData.pendingDishId : ''
    if (app.globalData) app.globalData.pendingDishId = ''
    const chosen = (pendingId && dishes.find(item => item.id === pendingId)) || dishes.find(item => item.id === this.data.dishId) || null
    const patch = {
      dishes,
      dishId: chosen ? chosen.id : this.data.dishId,
      dishName: chosen ? chosen.name : this.data.dishName,
      dishEmoji: chosen ? chosen.emoji : this.data.dishEmoji,
      dishSheetOpen: false,
      dishKeyword: '',
      visibleDishes: dishes.slice(0, SHEET_PAGE_SIZE).map(withMeta),
      dishMatchTotal: dishes.length
    }
    // 表单可能挂在后台过夜：跨天后把「今天」推到新的一天。
    // 新增态且日期还停在旧的今天（用户没手动改过）时一起跟过去，
    // 否则凌晨记的这一餐会被悄悄记到昨天。
    const todayText = today()
    if (this.data.today !== todayText) {
      patch.today = todayText
      if (!this.data.id && this.data.date === this.data.today) patch.date = todayText
    }
    // 没选中任何菜时保留当前值：编辑一条菜品已被删除的记录，快照名字不能被清空
    this.setData(patch)
  },
  toggleDishSheet() {
    if (this.data.dishSheetOpen) return this.setData({ dishSheetOpen: false })
    this.setData({ dishSheetOpen: true, dishKeyword: '', visibleDishes: this.data.dishes.slice(0, SHEET_PAGE_SIZE).map(withMeta), dishMatchTotal: this.data.dishes.length })
  },
  dishSearch(e) {
    const keyword = e.detail.value
    const matched = matchDishes(this.data.dishes, keyword)
    this.setData({ dishKeyword: keyword, visibleDishes: matched.slice(0, SHEET_PAGE_SIZE).map(withMeta), dishMatchTotal: matched.length })
  },
  clearDishKeyword() { this.dishSearch({ detail: { value: '' } }) },
  chooseDish(e) {
    const dish = this.data.dishes.find(item => item.id === e.currentTarget.dataset.id)
    if (!dish) return
    this.setData({ dishId: dish.id, dishName: dish.name, dishEmoji: dish.emoji, dishSheetOpen: false })
  },
  /** 搜索框里已经敲了名字，就带过去当新菜名；from=record 让新建的菜保存后自动回填到这里 */
  createDish() {
    const name = this.data.dishKeyword.trim()
    this.setData({ dishSheetOpen: false })
    const query = ['from=record']
    if (name) query.push(`name=${encodeURIComponent(name)}`)
    wx.navigateTo({ url: `/pages/dish-form/dish-form?${query.join('&')}` })
  },
  dateChange(e) { this.setData({ date: e.detail.value > this.data.today ? this.data.today : e.detail.value }) },
  timeChange(e) { this.setData({ time: store.normalizeClock(e.detail.value) || this.data.time }) },
  chooseMeal(e) { this.setData({ mealType: e.currentTarget.dataset.value }) },
  scoreChange(e) { this.setData({ score: e.detail.value }) },
  chooseStatus(e) { this.setData({ status: e.currentTarget.dataset.value }) },
  remarkChange(e) { this.setData({ remark: e.detail.value }) },
  async save() {
    if (!this.data.dishId) return wx.showToast({ title: '请先选择或新建一道菜品', icon: 'none' })
    if (this.data.date > this.data.today) return wx.showToast({ title: '不能记录未来日期', icon: 'none' })
    wx.showLoading({ title: '保存中' })
    let saved = false
    try {
      const payload = { dishId: this.data.dishId, dishName: this.data.dishName, date: this.data.date, time: this.data.time, mealType: this.data.mealType, score: this.data.score, status: this.data.status, remark: this.data.remark.trim() }
      if (this.data.id) payload.id = this.data.id
      await store.saveRecord(payload)
      saved = true
      wx.showToast({ title: this.data.id ? '改好了' : '这一餐记下啦' })
    } catch (error) {
      console.error(error)
      // 分片写满不是网络问题，重试一百次也一样，必须给一条能照着做的出路
      if (error && error.storageFull) {
        wx.showModal({
          title: '这一年的记录满了',
          content: `${error.year || '本机'} 这一年的记录已经到单键存储上限。\n请到「我的 → 导出数据」备份，再删掉一些旧记录后重试。`,
          showCancel: false,
          confirmText: '知道了'
        })
      } else {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
    }
    // 没存上就别退页面，否则用户以为存好了、回来找不到这一餐
    if (saved) setTimeout(() => wx.navigateBack(), 650)
  }
})
