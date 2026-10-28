/**
 * 悬浮 tabBar 的数据与跳转。
 * 为什么不放在 custom-tab-bar 组件里：Skyline 下自定义 tabBar 的宿主节点被排在页面原点，
 * 组件内的 fixed 只挪了绘制位置、没挪命中区，点击会全部落空。
 * 所以条子直接写在各 tab 页的 wxml 里（页面级 fixed 在本项目验证过能点）。
 */
const LIST = [
  { pagePath: '/pages/index/index', text: '首页', icon: 'home' },
  { pagePath: '/pages/dishes/dishes', text: '菜谱', icon: 'dishes' },
  { pagePath: '/pages/records/records', text: '记录', icon: 'records' },
  { pagePath: '/pages/profile/profile', text: '我的', icon: 'mine' }
]

/** 每个 tab 页往 data 里放一份，高亮只看自己这份 selected */
function create(selected) {
  return { list: LIST, selected }
}

/** 模板里的 bindtap 落到页面的 onTabTap（页面里转调这里） */
function go(e) {
  const index = Number(e.currentTarget.dataset.index)
  const item = LIST[index]
  if (!item) return
  wx.switchTab({ url: item.pagePath })
}

module.exports = { LIST, create, go }
