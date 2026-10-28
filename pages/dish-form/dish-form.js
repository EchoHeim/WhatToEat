const store = require('../../utils/store')

/** 从记录页「新建菜品」带过来的名字，可能已被框架解码过，兜一层 */
function safeDecode(value) {
  try { return decodeURIComponent(value) } catch (error) { return value }
}

// 图标库：按吃的门类排，前 24 个是常用的，一次铺满不至于把表单顶到屏幕外
const EMOJI_LIST = [
  '🍽️',                                            // 餐具（新建时的默认值，放第一个免得看不到选中态）
  '🍚', '🍜', '🍝', '🍛', '🍙', '🥟', '🍞',        // 主食面饭
  '🍗', '🍖', '🥩', '🥓', '🍤', '🦐', '🦀', '🐟',  // 肉禽海鲜
  '🍲', '🥘', '🍢', '🥗', '🥬', '🥦', '🌽', '🍄',  // 锅物小炒
  '🍔', '🍕', '🌭', '🌮', '🌯', '🥪', '🍟', '🍿',  // 快餐小吃
  '🍰', '🎂', '🧁', '🍮', '🍩', '🍪', '🍫', '🥧',  // 甜品烘焙
  '🍎', '🍌', '🍉', '🍓', '🥝', '🍍', '☕', '🥛',  // 水果饮品
  '🥢', '🥄', '🍴'                                  // 其它餐具
]
const EMOJI_DEFAULT_COUNT = 24

/** 价格档位 + 区间文案，active 标记选中项 */
function priceChoices(price) {
  return store.PRICES.map(value => ({ value, range: store.PRICE_RANGES[value], active: value === price }))
}

/** 当前选中的图标如果不在常用里，补到最前面，免得用户看不到自己选了什么 */
function emojiView(selected, expanded) {
  const list = expanded ? EMOJI_LIST : EMOJI_LIST.slice(0, EMOJI_DEFAULT_COUNT)
  if (selected && list.indexOf(selected) < 0) return [selected].concat(list)
  return list
}

Page({
  data: { id: '', name: '', emoji: '🍽️', visibleEmojis: EMOJI_LIST.slice(0, EMOJI_DEFAULT_COUNT), emojiExpanded: false, category: '中餐', categoryIndex: 0, categories: store.CATEGORIES, tagsText: '', mealTypes: [], eatTypes: [], mealChoices: [], eatChoices: [], price: '普通', priceChoices: priceChoices('普通'), remark: '', enableRandom: true },
  onReady() { this.refreshChoices() },
  onLoad(options) {
    // 记录页新建入口：预填搜索框里的名字，保存后回填到那一餐
    this.fromRecord = options.from === 'record'
    if (options.name) this.setData({ name: safeDecode(options.name) })
    if (options.id) {
      const dish = store.getDish(options.id)
      if (dish) this.setData({ ...dish, visibleEmojis: emojiView(dish.emoji, false), tagsText: (dish.tags || []).join('、'), categoryIndex: Math.max(0, store.CATEGORIES.indexOf(dish.category)), priceChoices: priceChoices(dish.price) }, () => this.refreshChoices())
    }
    store.syncFromCloud().catch(error => console.error('云同步失败，使用本地数据', error))
  },
  toggleEmojiAll() {
    const expanded = !this.data.emojiExpanded
    this.setData({ emojiExpanded: expanded, visibleEmojis: emojiView(this.data.emoji, expanded) })
  },
  field(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  chooseEmoji(e) { this.setData({ emoji: e.currentTarget.dataset.value }) },
  categoryChange(e) { const index = Number(e.detail.value); this.setData({ categoryIndex: index, category: store.CATEGORIES[index] }) },
  choosePrice(e) { const price = e.currentTarget.dataset.value; this.setData({ price, priceChoices: priceChoices(price) }) },
  refreshChoices() { this.setData({ mealChoices: store.MEALS.map(value => ({ value, active: this.data.mealTypes.includes(value) })), eatChoices: store.EAT_TYPES.map(value => ({ value, active: this.data.eatTypes.includes(value) })) }) },
  toggleArray(e) { const { field, value } = e.currentTarget.dataset; const list = [...this.data[field]]; const i = list.indexOf(value); i >= 0 ? list.splice(i, 1) : list.push(value); this.setData({ [field]: list }, () => this.refreshChoices()) },
  switchRandom(e) { this.setData({ enableRandom: e.detail.value }) },
  async save() {
    const name = this.data.name.trim()
    if (!name) return wx.showToast({ title: '请填写菜品名称', icon: 'none' })
    const tags = this.data.tagsText.split(/[、,，\s]+/).map(v => v.trim()).filter(Boolean)
    wx.showLoading({ title: '保存中' })
    try {
      const saved = await store.saveDish({ id: this.data.id || undefined, name, emoji: this.data.emoji, category: this.data.category, tags, mealTypes: this.data.mealTypes, eatTypes: this.data.eatTypes, price: this.data.price, remark: this.data.remark.trim(), enableRandom: this.data.enableRandom })
      // 从记录页新建的菜，回去后自动选中它
      if (saved && !this.data.id && this.fromRecord) {
        const app = getApp()
        if (app.globalData) app.globalData.pendingDishId = saved.id
      }
      wx.showToast({ title: this.data.id ? '已保存' : '已添加' })
    } catch (error) {
      console.error(error)
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
    setTimeout(() => wx.navigateBack(), 600)
  }
})
