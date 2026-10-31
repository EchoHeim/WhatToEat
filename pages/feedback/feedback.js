const version = require('../../utils/version')

/**
 * 意见反馈：写进云数据库 `feedbacks` 集合，再叫一次云函数把内容推给开发者。
 *
 * 为什么不让用户直接发微信客服会话：
 * 客服消息没有上下文（哪个页面、什么机型、什么版本全靠用户手打），
 * 而且历史消息在后台只留一段时间。结构化入库才能攒下来慢慢看。
 */
const KINDS = [
  { value: 'idea', label: '功能建议' },
  { value: 'bug', label: '遇到问题' },
  { value: 'other', label: '其他' }
]
const PLACEHOLDER = {
  idea: '想要什么功能？平时怎么用的，说下场景更好改',
  bug: '哪一步出的问题？点哪里、看到什么，越具体越好',
  other: '想说什么都行'
}
const MAX_SHOTS = 3
const CONTENT_LIMIT = 500
// 同一台设备一分钟内只放一条：手滑连点、或者反馈页被反复打开，都不该在库里刷出一串重复
const COOLDOWN_KEY = 'wte_feedback_at_v1'
const COOLDOWN_MS = 60 * 1000

Page({
  data: {
    kinds: KINDS,
    type: 'idea',
    placeholder: PLACEHOLDER.idea,
    content: '',
    contact: '',
    images: [],
    maxShots: MAX_SHOTS,
    env: { version: version.APP_VERSION, model: '', system: '' },
    submitting: false
  },
  onLoad() {
    // 记一下从哪进来的：从「记录」页点的反馈，多半就跟记录有关，看的时候有上下文
    const pages = getCurrentPages()
    this.fromPage = pages.length > 1 ? String(pages[pages.length - 2].route || '') : ''
    this.setData({ env: this.readEnv() })
  },
  /**
   * 版本 / 机型 / 系统：排查线上问题最小的信息集。
   * 新接口（getDeviceInfo / getAppBaseInfo）优先，老基础库回退 getSystemInfoSync——
   * 项目跑 Skyline 不可能真的很老，但回退不贵，省得某个机型上整页崩掉。
   */
  readEnv() {
    let device = {}
    let base = {}
    try { if (typeof wx.getDeviceInfo === 'function') device = wx.getDeviceInfo() || {} } catch (error) { console.error('读取设备信息失败', error) }
    try { if (typeof wx.getAppBaseInfo === 'function') base = wx.getAppBaseInfo() || {} } catch (error) { console.error('读取微信信息失败', error) }
    let legacy = {}
    if (!device.model || !base.SDKVersion) {
      try { legacy = wx.getSystemInfoSync() || {} } catch (error) { console.error('读取系统信息失败', error) }
    }
    const system = device.system || legacy.system || ''
    const wechat = base.version || legacy.version || ''
    return {
      version: version.APP_VERSION,
      model: device.model || legacy.model || '未知机型',
      system: `${system || '未知系统'}${wechat ? ` · 微信 ${wechat}` : ''}`,
      sdk: base.SDKVersion || legacy.SDKVersion || '',
      page: this.fromPage || ''
    }
  },
  typeChange(e) {
    const type = String(e.currentTarget.dataset.value || 'idea')
    this.setData({ type, placeholder: PLACEHOLDER[type] || PLACEHOLDER.other })
  },
  contentChange(e) { this.setData({ content: e.detail.value }) },
  contactChange(e) { this.setData({ contact: e.detail.value }) },
  addShot() {
    const remain = MAX_SHOTS - this.data.images.length
    if (remain <= 0) return
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        const picked = (res.tempFiles || []).map((file, index) => ({
          // key 给 wx:for 用，别拿 path 当 key：同一次选两张同图会撞
          key: `${Date.now()}_${index}_${Math.floor(Math.random() * 10000)}`,
          path: file.tempFilePath
        }))
        if (!picked.length) return
        this.setData({ images: this.data.images.concat(picked).slice(0, MAX_SHOTS) })
      },
      fail: error => {
        const message = String((error && error.errMsg) || '')
        if (message.indexOf('cancel') >= 0) return
        console.error('选择截图失败', error)
        wx.showToast({ title: '打不开相册', icon: 'none' })
      }
    })
  },
  previewShot(e) {
    const urls = this.data.images.map(item => item.path)
    const current = urls[Number(e.currentTarget.dataset.index)]
    if (!current) return
    wx.previewImage({ current, urls })
  },
  removeShot(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },
  /** 截图逐张上传，返回 fileID 列表；中途失败就整体重来，不做断点续传（最多 3 张，不值当） */
  async uploadImages() {
    const fileIDs = []
    const list = this.data.images
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index]
      const suffix = (String(item.path).match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0]
      const cloudPath = `feedback/${Date.now()}_${index}_${Math.floor(Math.random() * 10000)}${suffix}`
      const result = await wx.cloud.uploadFile({ cloudPath, filePath: item.path })
      fileIDs.push(result.fileID)
    }
    return fileIDs
  },
  buildPayload(content, images) {
    const env = this.data.env
    return {
      type: this.data.type,
      content,
      contact: String(this.data.contact || '').trim(),
      images,
      version: env.version,
      model: env.model,
      system: env.system,
      sdk: env.sdk,
      page: env.page
    }
  },
  async submit() {
    if (this.data.submitting) return
    const content = String(this.data.content || '').trim().slice(0, CONTENT_LIMIT)
    if (content.length < 2) {
      wx.showToast({ title: '先写两句再发吧', icon: 'none' })
      return
    }
    const lastAt = Number(wx.getStorageSync(COOLDOWN_KEY) || 0)
    if (lastAt && Date.now() - lastAt < COOLDOWN_MS) {
      wx.showToast({ title: '刚发过一条，稍等一下', icon: 'none' })
      return
    }
    if (!wx.cloud) {
      wx.showModal({ title: '发不出去', content: '当前微信版本不支持云端提交，升级微信后再试。', showCancel: false })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: this.data.images.length ? '正在上传截图' : '正在提交', mask: true })
    try {
      const images = await this.uploadImages()
      wx.showLoading({ title: '正在提交', mask: true })
      // 写入交给云函数：集合没建时它能自己建，校验也在服务端做一遍
      const response = await wx.cloud.callFunction({ name: 'feedbackSubmit', data: this.buildPayload(content, images) })
      const result = (response && response.result) || {}
      if (!result.ok) throw new Error(result.message || '提交失败')
      wx.setStorageSync(COOLDOWN_KEY, Date.now())
      wx.hideLoading()
      this.setData({ submitting: false, content: '', contact: '', images: [] })
      wx.showModal({
        title: '收到了',
        content: '谢谢，会认真看。留了联系方式的话，需要时我会找你。',
        showCancel: false,
        confirmText: '好',
        success: () => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/profile' }) })
      })
    } catch (error) {
      wx.hideLoading()
      this.setData({ submitting: false })
      console.error('提交反馈失败', error)
      const message = String((error && (error.errMsg || error.message)) || '')
      const missing = message.indexOf('FunctionName') >= 0 || message.indexOf('not found') >= 0
      wx.showModal({
        title: '没发出去',
        content: missing
          ? '反馈的云函数还没部署，内容先留在页面上，跟开发者说一声。'
          : '多半是网络问题，内容还在，稍后再点一次。',
        showCancel: false
      })
    }
  }
})
