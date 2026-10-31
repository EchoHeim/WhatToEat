const store = require('../../utils/store')
const tabbar = require('../../utils/tabbar')

Page({
  data: { keyword: '', activeCategory: '全部', categories: ['全部', ...store.CATEGORIES], sort: '最近添加', sortOptions: ['最近添加', '名称', '评分', '吃过次数'], tabbar: tabbar.create(1) },
  onTabTap(e) { tabbar.go(e) },
  onShow() {
    this.refresh()
    store.syncThen(() => this.refresh())
  },
  refresh() {
    const all = store.getDishes()
    // 复制一份再排序：store 现在返回的是它的读缓存对象，就地 sort 会把缓存里的顺序也改掉
    let dishes = all.slice()
    const keyword = this.data.keyword.trim().toLowerCase()
    if (keyword) dishes = dishes.filter(item => item.name.toLowerCase().includes(keyword) || (item.tags || []).join(' ').toLowerCase().includes(keyword))
    if (this.data.activeCategory !== '全部') dishes = dishes.filter(item => item.category === this.data.activeCategory)
    const sort = this.data.sort
    // createdAt 兜底 0：早期手建 / 导入的菜没有这个字段，相减得 NaN，
    // 排序结果就变成「看引擎心情」，表现为「刚加的菜跑到列表中间」
    dishes.sort((a, b) => sort === '名称' ? a.name.localeCompare(b.name, 'zh')
      : sort === '评分' ? (b.score || 0) - (a.score || 0)
        : sort === '吃过次数' ? (b.eatCount || 0) - (a.eatCount || 0)
          : (b.createdAt || 0) - (a.createdAt || 0))
    this.setData({ dishes: dishes.map(item => ({ ...item, scoreText: item.score ? Number(item.score).toFixed(1) : '暂无', tagText: (item.tags || []).slice(0, 3).map(tag => `#${tag}`).join('  ') })), total: all.length })
  },
  search(e) { this.setData({ keyword: e.detail.value }); this.refresh() },
  chooseCategory(e) { this.setData({ activeCategory: e.currentTarget.dataset.value }); this.refresh() },
  changeSort(e) { this.setData({ sort: this.data.sortOptions[e.detail.value] }); this.refresh() },
  addDish() { wx.navigateTo({ url: '/pages/dish-form/dish-form' }) },
  openDish(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    // 页面切换有个过渡期，连点会叠出两个详情页
    if (this.lastOpenAt && Date.now() - this.lastOpenAt < 600) return
    this.lastOpenAt = Date.now()
    wx.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${id}` })
  }
})
