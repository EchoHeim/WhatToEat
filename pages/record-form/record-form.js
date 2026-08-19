const store = require('../../utils/store')

function today() { const d = new Date(); const pad = n => `${n}`.padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

Page({
  data: { dishes: [], dishNames: [], dishIndex: 0, dishId: '', dishName: '', date: today(), today: today(), mealType: '午餐', meals: store.MEALS, score: 4, statuses: [{ name: '吃得很好', emoji: '😋' }, { name: '还不错', emoji: '🙂' }, { name: '一般般', emoji: '😐' }, { name: '不太行', emoji: '😣' }], status: '还不错', remark: '' },
  async onLoad(options) {
    await store.syncFromCloud().catch(error => console.error('云同步失败，使用本地数据', error))
    const dishes = store.getDishes()
    const wanted = options.dishId || ''
    const index = Math.max(0, dishes.findIndex(item => item.id === wanted))
    const chosen = dishes[index]
    this.setData({ dishes, dishNames: dishes.map(item => item.name), dishIndex: index, dishId: chosen ? chosen.id : '', dishName: chosen ? chosen.name : '', mealType: options.meal || store.getSettings().defaultMeal || '午餐' })
  },
  dishChange(e) { const index = Number(e.detail.value); const dish = this.data.dishes[index]; this.setData({ dishIndex: index, dishId: dish.id, dishName: dish.name }) },
  dateChange(e) { this.setData({ date: e.detail.value > this.data.today ? this.data.today : e.detail.value }) },
  mealChange(e) { this.setData({ mealType: store.MEALS[Number(e.detail.value)] }) },
  scoreChange(e) { this.setData({ score: e.detail.value }) },
  chooseStatus(e) { this.setData({ status: e.currentTarget.dataset.value }) },
  remarkChange(e) { this.setData({ remark: e.detail.value }) },
  async save() {
    if (!this.data.dishId) return wx.showToast({ title: '请先添加一道菜品', icon: 'none' })
    if (this.data.date > this.data.today) return wx.showToast({ title: '不能记录未来日期', icon: 'none' })
    wx.showLoading({ title: '保存中' })
    try {
      await store.saveRecord({ dishId: this.data.dishId, dishName: this.data.dishName, date: this.data.date, mealType: this.data.mealType, score: this.data.score, status: this.data.status, remark: this.data.remark.trim() })
      wx.showToast({ title: '这一餐记下啦' })
    } catch (error) {
      console.error(error)
      wx.showToast({ title: '本地已保存，云同步失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
    setTimeout(() => wx.navigateBack(), 650)
  }
})
