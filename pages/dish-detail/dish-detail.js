const store = require('../../utils/store')

Page({
  data: { id: '' },
  onLoad(options) { this.setData({ id: options.id || '' }) },
  async onShow() {
    await store.syncFromCloud().catch(error => console.error('云同步失败，使用本地数据', error))
    const dish = store.getDish(this.data.id)
    if (!dish) return
    const records = store.getRecords().filter(item => item.dishId === dish.id).slice(0, 5)
    this.setData({ dish: { ...dish, scoreText: dish.score ? Number(dish.score).toFixed(1) : '暂无评分', lastEatText: dish.lastEatDate || '还没吃过', mealTypesText: (dish.mealTypes || []).join(' · ') || '未设置', eatTypesText: (dish.eatTypes || []).join(' · ') || '未设置' }, records })
  },
  edit() { wx.navigateTo({ url: `/pages/dish-form/dish-form?id=${this.data.id}` }) },
  eat() { wx.navigateTo({ url: `/pages/record-form/record-form?dishId=${this.data.id}` }) },
  remove() {
    wx.showModal({ title: '删除这道菜？', content: '历史饮食记录仍会保留。', confirmColor: '#C84832', success: async res => { if (!res.confirm) return; try { await store.deleteDish(this.data.id); wx.showToast({ title: '已删除' }) } catch (error) { console.error(error); wx.showToast({ title: '本地已删除，云同步失败', icon: 'none' }) } setTimeout(() => wx.navigateBack(), 500) } })
  }
})
