const store = require('../../utils/store')
const pad = n => `${n}`.padStart(2, '0')

Page({
  data: { selectedDate: '', weeks: ['日','一','二','三','四','五','六'] },
  onLoad() { const now = new Date(); this.year = now.getFullYear(); this.month = now.getMonth() + 1 },
  async onShow() {
    await store.syncFromCloud().catch(error => console.error('云同步失败，使用本地数据', error))
    this.refresh()
  },
  refresh() {
    const records = store.getRecords()
    const byDate = records.reduce((map, item) => { if (!map[item.date]) map[item.date] = []; map[item.date].push(item); return map }, {})
    const first = new Date(this.year, this.month - 1, 1).getDay()
    const days = new Date(this.year, this.month, 0).getDate()
    const cells = []
    for (let i = 0; i < first; i++) cells.push({ key: `e${i}`, empty: true })
    for (let day = 1; day <= days; day++) { const date = `${this.year}-${pad(this.month)}-${pad(day)}`; const dateRecords = byDate[date] || []; cells.push({ key: date, day, date, count: dateRecords.length, emoji: dateRecords.length ? (store.getDish(dateRecords[0].dishId) || {}).emoji || '●' : '' }) }
    const visible = this.data.selectedDate ? records.filter(item => item.date === this.data.selectedDate) : records.filter(item => item.date.startsWith(`${this.year}-${pad(this.month)}`))
    const groups = []; visible.forEach(item => { let group = groups.find(g => g.date === item.date); if (!group) { group = { date: item.date, label: this.dateLabel(item.date), records: [] }; groups.push(group) } group.records.push({ ...item, noteText: item.remark ? `${item.status} · ${item.remark}` : item.status }) })
    this.setData({ monthTitle: `${this.year} 年 ${this.month} 月`, cells, groups, monthCount: visible.length })
  },
  dateLabel(date) { const parts = date.split('-'); const d = new Date(`${date}T00:00:00`); return `${Number(parts[1])} 月 ${Number(parts[2])} 日 · ${['周日','周一','周二','周三','周四','周五','周六'][d.getDay()]}` },
  prevMonth() { this.month--; if (this.month < 1) { this.month = 12; this.year-- } this.setData({ selectedDate: '' }); this.refresh() },
  nextMonth() { this.month++; if (this.month > 12) { this.month = 1; this.year++ } this.setData({ selectedDate: '' }); this.refresh() },
  selectDate(e) { const date = e.currentTarget.dataset.date; if (!date) return; this.setData({ selectedDate: this.data.selectedDate === date ? '' : date }); this.refresh() },
  clearDate() { this.setData({ selectedDate: '' }); this.refresh() },
  addRecord() { wx.navigateTo({ url: '/pages/record-form/record-form' }) },
  removeRecord(e) { wx.showModal({ title: '删除这条记录？', confirmColor: '#C84832', success: async res => { if (res.confirm) { try { await store.deleteRecord(e.currentTarget.dataset.id) } catch (error) { console.error(error); wx.showToast({ title: '云同步失败', icon: 'none' }) } this.refresh() } } }) }
})
