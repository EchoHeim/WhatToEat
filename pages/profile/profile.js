const store = require('../../utils/store')
const reminderLib = require('../../utils/reminder')
const tabbar = require('../../utils/tabbar')
const version = require('../../utils/version')

Page({
  // appVersion 从 utils/version.js 取，跟 `cli upload -v` 传的版本号一起改；反馈页读的是同一份
  data: { recentOptions: [1, 3, 7, 14, 30], meals: store.MEALS, reminderBadge: 0, reminderText: '', storageText: '', appVersion: version.APP_VERSION, tabbar: tabbar.create(3) },
  onTabTap(e) { tabbar.go(e) },
  onShow() {
    this.refresh()
    store.syncThen(() => this.refresh())
  },
  refresh() {
    const dishes = store.getDishes(), records = store.getRecords(), settings = store.getSettings()
    const now = new Date(), monthPrefix = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`
    const scored = records.filter(item => Number(item.score) > 0)
    const favorite = [...dishes].filter(item => item.eatCount).sort((a, b) => b.score - a.score || b.eatCount - a.eatCount)[0]
    const reminders = store.getReminders()
    const todayReminders = store.countTodayReminders()
    const reminderText = !reminders.length
      ? '公历 / 农历 · 循环提醒 · 提前提醒'
      : `${reminders.length} 条提醒${todayReminders ? ` · 今天 ${todayReminders} 条` : ''}`
    // 记录里的 date 理论上一定有，但云端可能带回来旧版本的脏数据。
    // 以前直接 item.date.startsWith 会抛 TypeError，整个 refresh 挂掉、这一页白屏且不报错。
    const monthRecords = records.filter(item => String((item && item.date) || '').startsWith(monthPrefix)).length
    // 用量走系统统计（一次同步调用，不解析任何数据）；
    // 以前这里调 storageReport() 会把全部分片 stringify 一遍算字节，纯属白跑
    const usage = store.storageUsage()
    this.setData({
      settings,
      nickname: settings.nickname || '微信用户',
      avatarUrl: settings.avatarFileId || '',
      reminderBadge: todayReminders,
      reminderText,
      recentText: `${settings.recentDays} 天`,
      recentIndex: Math.max(0, this.data.recentOptions.indexOf(Number(settings.recentDays))),
      mealIndex: Math.max(0, store.MEALS.indexOf(settings.defaultMeal)),
      storageText: `${usage.usedKB} KB / ${Math.round(usage.limitKB / 1024)} MB`,
      stats: { dishes: dishes.length, monthRecords, favorite: favorite ? favorite.name : '暂无', average: scored.length ? (scored.reduce((sum, item) => sum + Number(item.score), 0) / scored.length).toFixed(1) : '—' }
    })
  },
  openReport() { wx.navigateTo({ url: '/pages/report/report' }) },
  /**
   * 导出全部数据成文件，然后直接调起微信转发面板发给联系人（发给自己也行）。
   * 为什么不用剪贴板：几千条记录约 800KB，剪贴板在部分机型会被截断或静默失败，
   * 而文件没有这个长度限制，还能真的落到电脑上。
   */
  exportData() {
    let snapshot, file
    try {
      snapshot = store.exportSnapshot()
      file = store.writeSnapshotFile(snapshot)
    } catch (error) {
      console.error('导出失败', error)
      wx.showModal({ title: '导出失败', content: '生成备份文件时出错了，稍后再试一次。', showCancel: false })
      return
    }
    const counts = snapshot.counts
    const usage = store.storageUsage()
    const percent = Math.min(100, Math.round((usage.usedKB / usage.limitKB) * 100))
    const warn = percent >= 70 ? `\n\n本地存储已用 ${percent}%，建议尽快把文件存到电脑上。` : ''
    wx.showModal({
      title: '导出数据',
      content: `${counts.dishes} 道菜 · ${counts.records} 条记录 · ${counts.checkins} 天心情 · ${counts.reminders} 条提醒\n\n文件约 ${file.sizeKB} KB，下一步会打开微信的转发面板，可以发给自己或任意联系人。${warn}`,
      confirmText: '转发文件',
      success: res => {
        if (!res.confirm) return
        this.shareSnapshot(file, snapshot)
      }
    })
  },
  /** 调起转发面板；低版本微信没有这个能力时退回剪贴板，别让用户白导一次 */
  shareSnapshot(file, snapshot) {
    if (typeof wx.shareFileMessage !== 'function') {
      wx.showModal({
        title: '当前微信不支持转发文件',
        content: '已改成复制文本。升级微信后可以重新导出成文件。',
        showCancel: false,
        success: () => wx.setClipboardData({ data: JSON.stringify(snapshot) })
      })
      return
    }
    wx.shareFileMessage({
      filePath: file.filePath,
      fileName: file.fileName,
      fail: error => {
        // 用户点「取消」也会进 fail，别当成错误弹窗吓人
        const msg = String((error && error.errMsg) || '')
        if (msg.indexOf('cancel') >= 0) return
        console.error('转发备份文件失败', error)
        wx.showModal({
          title: '转发没成功',
          content: '文件已经生成好了，可以再点一次导出重试；也可以改成复制文本备份。',
          cancelText: '知道了',
          confirmText: '复制文本',
          success: res => {
            if (res.confirm) wx.setClipboardData({ data: JSON.stringify(snapshot) })
          }
        })
      }
    })
  },
  /**
   * 从微信聊天里选一个备份文件导入。
   * 文件必须先发到某个聊天里（发给「文件传输助手」最顺手），这里只能从聊天记录里挑。
   */
  importData() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: res => {
        const picked = (res.tempFiles || [])[0]
        if (!picked) return
        this.previewImport(picked.path)
      },
      fail: error => {
        const msg = String((error && error.errMsg) || '')
        if (msg.indexOf('cancel') >= 0) return
        console.error('选择备份文件失败', error)
        wx.showToast({ title: '打不开聊天文件', icon: 'none' })
      }
    })
  },
  /** 先算一遍会改什么，让用户看清楚再动手 */
  previewImport(filePath) {
    let raw, preview
    try {
      raw = store.readSnapshotFile(filePath)
      preview = store.previewSnapshot(raw)
    } catch (error) {
      console.error('读取备份文件失败', error)
      wx.showModal({ title: '读不了这个文件', content: '它可能不是 JSON 文件，或者内容不完整。', showCancel: false })
      return
    }
    if (!preview.ok) {
      wx.showModal({ title: '不是有效的备份', content: preview.message, showCancel: false })
      return
    }
    if (!preview.total) {
      wx.showModal({
        title: '没有新数据',
        content: preview.skipped
          ? `文件里的 ${preview.skipped} 条数据本机都有，而且不比本机旧。`
          : '这个文件里没有可导入的数据。',
        showCancel: false
      })
      return
    }
    const c = preview.counts
    wx.showModal({
      title: '确认导入',
      content: `将导入 ${c.dishes} 道菜、${c.records} 条记录、${c.checkins} 天心情、${c.reminders} 条提醒。\n跳过 ${preview.skipped} 条（本机已有且不比它旧）。\n\n导入只做补充，不会删掉本机任何数据。`,
      confirmText: '导入',
      success: res => {
        if (!res.confirm) return
        let result
        try {
          result = store.applySnapshot(raw)
        } catch (error) {
          console.error('导入失败', error)
          wx.showModal({ title: '导入失败', content: String((error && error.message) || '写入本机时出错'), showCancel: false })
          return
        }
        this.refresh()
        // 导入的数据排在待传清单里，先推一轮（每轮最多 40 条），剩下的下次打开接着传
        store.syncFromCloud({ force: true }).catch(error => console.error('导入后同步失败', error))
        wx.showModal({
          title: '导入完成',
          content: `已写入 ${result.total} 条数据。\n\n正在后台分批同步到云端，数据量大时需要多打开几次小程序。`,
          showCancel: false
        })
      }
    })
  },
  /**
   * 清空全部数据（本机 + 云端）。
   * 破坏性操作，所以弹窗里把要删的东西逐项列出来——只说「确定吗」的确认框拦不住手滑，
   * 让人看见「128 条记录」「额度 14 次」这些具体数字才会真的犹豫一下。
   */
  async clearData() {
    // 手快连点两次会并发跑两遍清空，第二遍可能在 bootstrap 之后又删一轮，
    // 还会和后台同步撞上。用一个进行中标志挡住。
    if (this.clearing) return
    const records = store.getRecords()
    const checkins = store.getCheckins()
    const reminders = store.getReminders()
    const quota = Number(store.getSettings().pushQuota || 0)
    if (!records.length && !checkins.length && !reminders.length && !quota) {
      wx.showModal({ title: '已经是空的', content: '没有可清空的数据。', showCancel: false })
      return
    }
    wx.showModal({
      title: '清空全部数据？',
      content: `会删除：\n· ${records.length} 条饮食记录\n· ${checkins.length} 天心情\n· ${reminders.length} 条提醒\n· 菜品库（回到初始的 8 道预置菜）\n· 推送额度 ${quota} 次\n\n昵称和头像会保留，其余不可恢复。\n建议先「导出备份文件」。`,
      confirmText: '确认清空',
      confirmColor: '#C84832',
      cancelText: '再想想',
      success: async res => {
        if (!res.confirm || this.clearing) return
        this.clearing = true
        wx.showLoading({ title: '正在清空', mask: true })
        try {
          const result = await store.clearAllData()
          this.refresh()
          if (result.cloudOk) {
            wx.showToast({ title: '已清空', icon: 'success' })
          } else {
            // 云端没删干净时别报「成功」：数据下次可能被拉回来，得说清楚
            wx.showModal({
              title: '本机已清空',
              content: '云端数据没删干净，多半是网络问题。下次打开小程序会自动再删一次，期间先别手动改数据。',
              showCancel: false
            })
          }
        } catch (error) {
          console.error('清空失败', error)
          wx.showModal({ title: '清空失败', content: String((error && error.message) || '本机清理时出错'), showCancel: false })
        } finally {
          wx.hideLoading()
          this.clearing = false
        }
      }
    })
  },
  openReminders() { wx.navigateTo({ url: '/pages/reminders/reminders' }) },
  openFeedback() { wx.navigateTo({ url: '/pages/feedback/feedback' }) },
  /** 「提醒」区块的两个新建入口：类型钉在 URL 上，进去直接就是那一种，不用再手动切 */
  addReminder() { wx.navigateTo({ url: `/pages/reminder-form/reminder-form?kind=${reminderLib.KIND_REMINDER}` }) },
  addAnniversary() { wx.navigateTo({ url: `/pages/reminder-form/reminder-form?kind=${reminderLib.KIND_ANNIVERSARY}` }) },
  async chooseAvatar(e) {
    const tempUrl = e.detail.avatarUrl
    if (!tempUrl) return
    const suffixMatch = tempUrl.match(/\.[a-zA-Z0-9]+(?=\?|$)/)
    const suffix = suffixMatch ? suffixMatch[0] : '.jpg'
    const cloudPath = `avatars/${Date.now()}_${Math.floor(Math.random() * 10000)}${suffix}`
    const oldFileId = this.data.settings.avatarFileId
    wx.showLoading({ title: '上传头像中' })
    try {
      const result = await wx.cloud.uploadFile({ cloudPath, filePath: tempUrl })
      await store.saveSettings({ avatarFileId: result.fileID })
      this.setData({ avatarUrl: result.fileID })
      if (oldFileId && oldFileId !== result.fileID) wx.cloud.deleteFile({ fileList: [oldFileId] }).catch(() => {})
      wx.showToast({ title: '头像已保存' })
    } catch (error) {
      console.error('头像上传失败', error)
      wx.showToast({ title: '头像保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },
  async nicknameChange(e) {
    const nickname = (e.detail.value || '').trim()
    if (!nickname || nickname === this.data.nickname) return
    try {
      await store.saveSettings({ nickname })
      this.setData({ nickname })
      wx.showToast({ title: '昵称已保存' })
    } catch (error) {
      console.error('昵称同步失败', error)
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
  },
  async recentChange(e) { const index = Number(e.detail.value); try { await store.saveSettings({ recentDays: this.data.recentOptions[index] }) } catch (error) { console.error(error); wx.showToast({ title: '保存失败，请重试', icon: 'none' }) } this.refresh() },
  async mealChange(e) { const index = Number(e.detail.value); try { await store.saveSettings({ defaultMeal: store.MEALS[index] }) } catch (error) { console.error(error); wx.showToast({ title: '保存失败，请重试', icon: 'none' }) } this.refresh() },
  async repeatChange(e) { try { await store.saveSettings({ allowRepeat: e.detail.value }) } catch (error) { console.error(error); wx.showToast({ title: '保存失败，请重试', icon: 'none' }) } this.refresh() },
})
