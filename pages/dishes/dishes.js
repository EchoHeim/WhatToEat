const store = require('../../utils/store')
const recipes = require('../../utils/recipes')
const tabbar = require('../../utils/tabbar')

/** 人群选项（不含「全部」：「全部」= 一个都没选，见 crowdRows 的注释） */
const CROWD_OPTIONS = recipes.CROWDS.map(item => ({ key: item.key, label: item.label, note: item.note }))
/** 两排的分组依据：年龄段一排、特殊需求一排 */
const CROWD_ROW_KEYS = ['age', 'need']

/**
 * 转成两排按钮，wxml 直接读。
 * 「全部」不是一个独立选项，它就是「一个都没选」——点它天然等于清空，互斥不用另外维护。
 * 它只出现在第一排开头（年龄段那一排）。
 */
function crowdRows(selected) {
  const picked = Array.isArray(selected) ? selected : []
  return CROWD_ROW_KEYS.map((group, index) => {
    const items = recipes.CROWDS.filter(item => item.group === group)
      .map(item => ({ key: item.key, label: item.label, active: picked.includes(item.key) }))
    // 第一排开头插「全部」，其余排不插
    if (index === 0) items.unshift({ key: 'all', label: '全部', active: !picked.length })
    return { group, items }
  })
}

Page({
  data: {
    // mine 我的菜谱 / recommend 推荐菜谱
    tab: 'mine',
    keyword: '',
    activeCategory: '全部',
    categories: ['全部', ...store.CATEGORIES],
    sort: '最近添加',
    sortOptions: ['最近添加', '名称', '评分', '吃过次数'],
    // 推荐态的筛选只到人群这一层，分类筛选在推荐态隐藏（两百多道菜里挑人群比挑菜系有用）
    crowds: [],
    crowdRows: crowdRows([]),
    recipeList: [],
    recipeTotal: 0,
    crowdNote: '',
    tabbar: tabbar.create(1)
  },
  onTabTap(e) { tabbar.go(e) },
  // 见首页同一处注释：不定义它，「转发」和「复制链接」都是灰的
  onShareAppMessage() { return { title: '今天吃什么 · 帮我决定这一顿', path: '/pages/index/index' } },
  onShow() {
    this.refresh()
    store.syncThen(() => this.refresh())
  },
  refresh() {
    if (this.data.tab === 'recommend') return this.refreshRecipes()
    const all = store.getDishes()
    // 复制一份再排序：store 现在返回的是它的读缓存对象，就地 sort 会把缓存里的顺序也改掉
    let dishes = all.slice()
    const keyword = this.data.keyword.trim().toLowerCase()
    if (keyword) dishes = dishes.filter(item => item.name.toLowerCase().includes(keyword) || (item.tags || []).join(' ').toLowerCase().includes(keyword))
    if (this.data.activeCategory !== '全部') dishes = dishes.filter(item => store.dishCategories(item).includes(this.data.activeCategory))
    const sort = this.data.sort
    // createdAt 兜底 0：早期手建 / 导入的菜没有这个字段，相减得 NaN，
    // 排序结果就变成「看引擎心情」，表现为「刚加的菜跑到列表中间」
    dishes.sort((a, b) => sort === '名称' ? a.name.localeCompare(b.name, 'zh')
      : sort === '评分' ? (b.score || 0) - (a.score || 0)
        : sort === '吃过次数' ? (b.eatCount || 0) - (a.eatCount || 0)
          : (b.createdAt || 0) - (a.createdAt || 0))
    this.setData({ dishes: dishes.map(item => ({ ...item, scoreText: item.score ? Number(item.score).toFixed(1) : '暂无', tagText: (item.tags || []).slice(0, 3).map(tag => `#${tag}`).join('  ') })), total: all.length })
  },
  /**
   * 推荐态。
   * owned 按菜名判：推荐库是版本内容，用户可能早就手打过同一道菜，
   * 这时候按钮要显示「已收藏」并点不动，而不是让他点了才被告知重复。
   */
  refreshRecipes() {
    const keyword = this.data.keyword.trim().toLowerCase()
    const crowds = this.data.crowds
    const owned = store.ownedRecipeNames()
    let list = recipes.RECIPES
    // 多选之间是「或」：选了孕妇和老年人，两道人群的菜都出来
    if (crowds.length) list = list.filter(item => crowds.some(key => (item.crowd || []).includes(key)))
    if (keyword) list = list.filter(item => item.name.toLowerCase().includes(keyword) || (item.tags || []).join(' ').toLowerCase().includes(keyword) || String(item.why || '').includes(this.data.keyword.trim()))
    // 说明只在选中一个人群时显示：多选时几条说明拼一起太长，反而挤掉列表
    const picked = CROWD_OPTIONS.filter(item => crowds.includes(item.key))
    this.setData({
      crowdRows: crowdRows(crowds),
      recipeList: list.map(item => ({
        ...item,
        owned: owned.has(item.name),
        crowdText: recipes.crowdText(item),
        tagText: (item.tags || []).slice(0, 2).map(tag => `#${tag}`).join('  ')
      })),
      recipeTotal: list.length,
      crowdNote: picked.length === 1 ? picked[0].note : ''
    })
  },
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.tab) return
    this.setData({ tab }, () => this.refresh())
  },
  /**
   * 人群多选。
   * 「全部」不是选项，是「一个都没选」——点它等于清空，这样互斥天然成立，不用额外维护。
   */
  chooseCrowd(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    if (key === 'all') {
      if (!this.data.crowds.length) return
      return this.setData({ crowds: [] }, () => this.refreshRecipes())
    }
    const current = this.data.crowds
    const next = current.includes(key) ? current.filter(item => item !== key) : current.concat(key)
    this.setData({ crowds: next }, () => this.refreshRecipes())
  },
  /** 收藏一道推荐菜；已经收藏过的（同名）直接拦掉，别让用户白点 */
  async collectRecipe(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const target = this.data.recipeList.find(item => item.id === id)
    if (!target) return
    if (target.owned) return wx.showToast({ title: '这道已经在菜谱里了', icon: 'none' })
    wx.showLoading({ title: '收藏中', mask: true })
    try {
      const result = await store.saveFromRecipe(id)
      if (result.ok) {
        wx.showToast({ title: '已收进菜谱' })
      } else if (result.reason === 'exists') {
        wx.showToast({ title: '菜谱里已经有一道同名菜', icon: 'none' })
      } else {
        wx.showToast({ title: '收藏失败', icon: 'none' })
      }
    } catch (error) {
      console.error('收藏推荐菜失败', error)
      wx.showToast({ title: '收藏失败，再试一次', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
    this.refresh()
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
