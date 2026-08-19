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
    store
  }
})
