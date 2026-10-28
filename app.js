const store = require('./utils/store')

App({
  onLaunch() {
    store.bootstrap()
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d7gua1dxyb865738c',
        traceUser: true
      })
      store.syncFromCloud().catch(error => console.error('云数据初始化失败', error))
    }
  },
  globalData: {
    store,
    /** 从记录页跳去新建菜品时，存下新菜 id，回来后自动选中 */
    pendingDishId: ''
  }
})
