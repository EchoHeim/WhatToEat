const store = require('./utils/store')

// 云写失败别刷屏：10 秒内只提示一次，剩下的靠日志
let lastCloudHintAt = 0

App({
  onLaunch() {
    store.bootstrap()
    // 云端写失败统一在这里提示：数据已经落在本机，不会丢，只是云端还没跟上
    store.onCloudError((error, context) => {
      const now = Date.now()
      if (now - lastCloudHintAt < 10000) return
      lastCloudHintAt = now
      const code = String(error && (error.errCode !== undefined ? error.errCode : error.code) || '')
      // 集合没建 / 权限不对这类配置问题要给出可操作的指引，弹窗说清楚
      if (code === '-502005' || code === '-502003' || code === '-502002') {
        wx.showModal({
          title: '云端配置要改一下',
          content: `${store.describeCloudError(error)}\n\n本机数据不会丢，修好云端之后会自动补传。`,
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }
      wx.showToast({ title: '已存本机，云同步待重试', icon: 'none' })
    })
    // 未捕获异常 / Promise 拒绝：以前只有 console.error，线上白屏只能等用户截图
    if (typeof wx.onError === 'function') {
      wx.onError(error => store.logError('onError', error))
    }
    if (typeof wx.onUnhandledRejection === 'function') {
      wx.onUnhandledRejection(event => store.logError('unhandledRejection', event && (event.reason || event.message)))
    }
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d7gua1dxyb865738c',
        traceUser: true
      })
      store.syncFromCloud().catch(error => console.error('云数据初始化失败', error))
    }
  },
  onHide() {
    // 退到后台前把排队的云写跑完，减少「刚保存就切走」造成的延迟上传
    store.flushCloudQueue()
  },
  globalData: {
    store,
    /** 从记录页跳去新建菜品时，存下新菜 id，回来后自动选中 */
    pendingDishId: ''
  }
})
