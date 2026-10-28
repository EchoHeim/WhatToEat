const store = require('../../utils/store')

Page({
  data: { recentOptions: [0, 3, 7, 14, 30], meals: store.MEALS, reminderBadge: 0, reminderText: '', appVersion: 'Ver0.0.2' },
  async onShow() {
    await store.syncFromCloud().catch(error => console.error('云同步失败，使用本地数据', error))
    this.refresh()
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
    this.setData({
      settings,
      nickname: settings.nickname || '微信用户',
      avatarUrl: settings.avatarFileId || '',
      reminderBadge: todayReminders,
      reminderText,
      recentText: settings.recentDays ? `${settings.recentDays} 天` : '不过滤',
      recentIndex: Math.max(0, this.data.recentOptions.indexOf(Number(settings.recentDays))),
      mealIndex: Math.max(0, store.MEALS.indexOf(settings.defaultMeal)),
      stats: { dishes: dishes.length, monthRecords: records.filter(item => item.date.startsWith(monthPrefix)).length, favorite: favorite ? favorite.name : '暂无', average: scored.length ? (scored.reduce((sum, item) => sum + Number(item.score), 0) / scored.length).toFixed(1) : '—' }
    })
  },
  openReminders() { wx.navigateTo({ url: '/pages/reminders/reminders' }) },
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
      wx.showToast({ title: '昵称同步失败', icon: 'none' })
    }
  },
  async recentChange(e) { const index = Number(e.detail.value); try { await store.saveSettings({ recentDays: this.data.recentOptions[index] }) } catch (error) { console.error(error); wx.showToast({ title: '云同步失败', icon: 'none' }) } this.refresh() },
  async mealChange(e) { const index = Number(e.detail.value); try { await store.saveSettings({ defaultMeal: store.MEALS[index] }) } catch (error) { console.error(error); wx.showToast({ title: '云同步失败', icon: 'none' }) } this.refresh() },
  async repeatChange(e) { try { await store.saveSettings({ allowRepeat: e.detail.value }) } catch (error) { console.error(error); wx.showToast({ title: '云同步失败', icon: 'none' }) } this.refresh() },
})
