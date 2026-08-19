const store = require('../../utils/store')

Page({
  data: { id: '', name: '', emoji: '🍽️', emojis: ['🍽️','🍅','🍜','🍛','🍣','🍲','🥪','🥘','🥗','🍔','🍕','🥟'], category: '中餐', categoryIndex: 0, categories: store.CATEGORIES, tagsText: '', mealTypes: [], eatTypes: [], mealChoices: [], eatChoices: [], price: '普通', prices: store.PRICES, priceIndex: 1, remark: '', enableRandom: true },
  onReady() { this.refreshChoices() },
  async onLoad(options) {
    await store.syncFromCloud().catch(error => console.error('云同步失败，使用本地数据', error))
    if (!options.id) return
    const dish = store.getDish(options.id)
    if (!dish) return
    this.setData({ ...dish, tagsText: (dish.tags || []).join('、'), categoryIndex: Math.max(0, store.CATEGORIES.indexOf(dish.category)), priceIndex: Math.max(0, store.PRICES.indexOf(dish.price)) }, () => this.refreshChoices())
  },
  field(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  chooseEmoji(e) { this.setData({ emoji: e.currentTarget.dataset.value }) },
  categoryChange(e) { const index = Number(e.detail.value); this.setData({ categoryIndex: index, category: store.CATEGORIES[index] }) },
  priceChange(e) { const index = Number(e.detail.value); this.setData({ priceIndex: index, price: store.PRICES[index] }) },
  refreshChoices() { this.setData({ mealChoices: store.MEALS.map(value => ({ value, active: this.data.mealTypes.includes(value) })), eatChoices: store.EAT_TYPES.map(value => ({ value, active: this.data.eatTypes.includes(value) })) }) },
  toggleArray(e) { const { field, value } = e.currentTarget.dataset; const list = [...this.data[field]]; const i = list.indexOf(value); i >= 0 ? list.splice(i, 1) : list.push(value); this.setData({ [field]: list }, () => this.refreshChoices()) },
  switchRandom(e) { this.setData({ enableRandom: e.detail.value }) },
  async save() {
    const name = this.data.name.trim()
    if (!name) return wx.showToast({ title: '请填写菜品名称', icon: 'none' })
    const tags = this.data.tagsText.split(/[、,，\s]+/).map(v => v.trim()).filter(Boolean)
    wx.showLoading({ title: '保存中' })
    try {
      await store.saveDish({ id: this.data.id || undefined, name, emoji: this.data.emoji, category: this.data.category, tags, mealTypes: this.data.mealTypes, eatTypes: this.data.eatTypes, price: this.data.price, remark: this.data.remark.trim(), enableRandom: this.data.enableRandom })
      wx.showToast({ title: this.data.id ? '已保存' : '已添加' })
    } catch (error) {
      console.error(error)
      wx.showToast({ title: '本地已保存，云同步失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
    setTimeout(() => wx.navigateBack(), 600)
  }
})
