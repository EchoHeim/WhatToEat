const store = require('../../utils/store')

Page({
  data: { keyword: '', activeCategory: '全部', categories: ['全部', ...store.CATEGORIES], sort: '最近添加', sortOptions: ['最近添加', '名称', '评分', '吃过次数'] },
  async onShow() {
    await store.syncFromCloud().catch(error => console.error('云同步失败，使用本地数据', error))
    this.refresh()
  },
  refresh() {
    let dishes = store.getDishes()
    const keyword = this.data.keyword.trim().toLowerCase()
    if (keyword) dishes = dishes.filter(item => item.name.toLowerCase().includes(keyword) || (item.tags || []).join(' ').toLowerCase().includes(keyword))
    if (this.data.activeCategory !== '全部') dishes = dishes.filter(item => item.category === this.data.activeCategory)
    const sort = this.data.sort
    dishes.sort((a, b) => sort === '名称' ? a.name.localeCompare(b.name, 'zh') : sort === '评分' ? b.score - a.score : sort === '吃过次数' ? b.eatCount - a.eatCount : b.createdAt - a.createdAt)
    this.setData({ dishes: dishes.map(item => ({ ...item, scoreText: item.score ? Number(item.score).toFixed(1) : '暂无' })), total: store.getDishes().length })
  },
  search(e) { this.setData({ keyword: e.detail.value }); this.refresh() },
  chooseCategory(e) { this.setData({ activeCategory: e.currentTarget.dataset.value }); this.refresh() },
  changeSort(e) { this.setData({ sort: this.data.sortOptions[e.detail.value] }); this.refresh() },
  addDish() { wx.navigateTo({ url: '/pages/dish-form/dish-form' }) },
  openDish(e) { wx.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${e.currentTarget.dataset.id}` }) }
})
