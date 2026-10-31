/**
 * 意见反馈：写入 + 通知，一个函数干完。
 *
 * 为什么不让客户端直接写数据库：
 *   1. 集合没建时客户端 add 直接报 -502005，用户看到的是「提交失败」，而这只是部署时漏了一步；
 *      云函数是管理员权限，可以自己把集合建出来，第一次提交就通
 *   2. 校验放在服务端：长度、类型、图片数量、fileID 归属，客户端改 JS 就能绕过
 *   3. 少一次客户端 → 云函数 → 云函数的来回
 *
 * 通知走群机器人，企微和飞书都行：地址放环境变量 FEEDBACK_WEBHOOK（仓库是公开的，key 不能进代码）。
 * 渠道按 host 自动认，认不出来再用 FEEDBACK_WEBHOOK_TYPE=wecom|feishu 指定；都没有就只入库不发。
 * 飞书机器人若开了「签名校验」，密钥放 FEEDBACK_WEBHOOK_SECRET，不带签名的请求会被直接拒。
 * 没配也能用：反馈已经入库，只是少一条推送——通知失败绝不能变成「提交失败」。
 */
const cloud = require('wx-server-sdk')
const https = require('https')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'feedbacks'
const TYPE_TEXT = { idea: '功能建议', bug: '遇到问题', other: '其他' }
const CONTENT_LIMIT = 500
const CONTACT_LIMIT = 40
const IMAGE_LIMIT = 3
/** webhook 是外部请求，给 4 秒；配合函数 20 秒超时，留足余量 */
const REQUEST_TIMEOUT_MS = 4000
/** 企微 markdown 单条上限 4096 字节，中文 3 字节，正文按 800 字截断 */
const MARKDOWN_CONTENT_LIMIT = 800

const WEBHOOK = String(process.env.FEEDBACK_WEBHOOK || '').trim()
/** 飞书「签名校验」用的密钥；企微不需要 */
const WEBHOOK_SECRET = String(process.env.FEEDBACK_WEBHOOK_SECRET || '').trim()
/** 强制指定渠道，留空则按 webhook 的 host 认 */
const WEBHOOK_TYPE = String(process.env.FEEDBACK_WEBHOOK_TYPE || '').trim().toLowerCase()

/** 云函数时区不一定是东八区：先加 8 小时再按 UTC 取值，结果与运行环境无关 */
function beijingText(stamp) {
  const date = new Date((Number(stamp) || Date.now()) + 8 * 60 * 60 * 1000)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

function text(value, limit) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, limit)
}

/**
 * 集合不存在就建一个。
 * db.createCollection 在集合已存在时会抛错，那正是最常见的情况，吞掉就行。
 * 用模块级标记避免每次调用都撞一次：同一个实例热起来之后就不再试了。
 */
let collectionReady = false
async function ensureCollection() {
  if (collectionReady) return
  try {
    await db.createCollection(COLLECTION)
  } catch (error) {
    // 已存在（-502002）/ 并发创建冲突都走这里，不影响后面写入
  }
  collectionReady = true
}

/**
 * 截图转成可以直接点开的临时链接。
 *
 * 为什么不发内嵌图片：飞书/企微的图片消息要 image_key，而 image_key 得先用应用凭证
 * 调 im/v1/images 上传——群机器人没有应用身份，这条路走不通。链接是 webhook 能做到的上限。
 *
 * 链接默认 2 小时有效（云存储临时链接的默认值），过期后点开是 403。
 * 想要更久就把 maxAge 调大，但别指望永久——真要看历史截图，控制台里存着 fileID。
 */
async function resolveImageUrls(images) {
  const list = Array.isArray(images) ? images.slice(0, IMAGE_LIMIT) : []
  if (!list.length) return []
  try {
    const result = await cloud.getTempFileURL({ fileList: list })
    return (result.fileList || [])
      .filter(item => item && item.status === 0 && item.tempFileURL)
      .map(item => item.tempFileURL)
  } catch (error) {
    console.error('取截图临时链接失败', error)
    return []
  }
}

/** 企微 markdown：引用块里每行都要带 `> `，否则换行会被吃掉 */
function quoteBlock(content) {
  return String(content || '')
    .slice(0, MARKDOWN_CONTENT_LIMIT)
    .split(/\r?\n/)
    .map(line => `> ${line}`)
    .join('\n')
}

function buildMarkdown(document, imageUrls) {
  const lines = [
    `## 新反馈 · ${TYPE_TEXT[document.type] || TYPE_TEXT.other}`,
    `<font color="comment">${beijingText(document.at)}</font>`,
    '',
    quoteBlock(document.content)
  ]
  if (document.contact) lines.push('', `**联系方式**：${document.contact}`)
  if (imageUrls && imageUrls.length) {
    lines.push(`**截图**：${imageUrls.map((url, index) => `[第 ${index + 1} 张](${url})`).join(' · ')}`)
  } else if (document.images && document.images.length) {
    lines.push(`**截图**：${document.images.length} 张（临时链接没取到，去控制台看）`)
  }
  const env = [document.version, document.model, document.system].filter(Boolean).join(' · ')
  if (env) lines.push(`**环境**：${env}`)
  if (document.page) lines.push(`**来源页**：${document.page}`)
  return lines.join('\n')
}

/** 按 webhook 的 host 认渠道；认不出来返回空串，由调用方决定是放弃还是靠环境变量兜底 */
function detectChannel(url) {
  if (WEBHOOK_TYPE === 'wecom' || WEBHOOK_TYPE === 'feishu') return WEBHOOK_TYPE
  const host = String(url || '').toLowerCase()
  if (host.indexOf('qyapi.weixin.qq.com') >= 0) return 'wecom'
  if (host.indexOf('open.feishu.cn') >= 0 || host.indexOf('open.larksuite.com') >= 0) return 'feishu'
  return ''
}

/**
 * 飞书签名：HMAC-SHA256，key 是 `${timestamp}\n${secret}`，待签数据是空串。
 * 顺序是反的（一般习惯拿 secret 当 key 去签数据），飞书就是这么定的，写成反的会一直报 19021。
 */
function signFeishu(timestamp, secret) {
  return crypto.createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64')
}

/**
 * 飞书富文本：content 是二维数组，外层一行一段、内层是一行里的多个片段。
 * 空行要塞一个空格——纯空串的 text 节点会被丢掉，段落就粘一起了。
 */
function buildFeishuPost(document, imageUrls) {
  const rows = [[{ tag: 'text', text: beijingText(document.at) }]]
  String(document.content || '')
    .slice(0, MARKDOWN_CONTENT_LIMIT)
    .split(/\r?\n/)
    .forEach(line => { rows.push([{ tag: 'text', text: line || ' ' }]) })
  if (document.contact) rows.push([{ tag: 'text', text: `联系方式：${document.contact}` }])
  // 图片只能给链接：飞书的 post 里 img 标签要 image_key，那得有应用凭证才拿得到
  if (imageUrls && imageUrls.length) {
    imageUrls.forEach((url, index) => {
      rows.push([
        { tag: 'text', text: '截图 ' },
        { tag: 'a', href: url, text: `${index + 1}` }
      ])
    })
  } else if (document.images && document.images.length) {
    rows.push([{ tag: 'text', text: `截图：${document.images.length} 张（临时链接没取到，去控制台看）` }])
  }
  const env = [document.version, document.model, document.system].filter(Boolean).join(' · ')
  if (env) rows.push([{ tag: 'text', text: `环境：${env}` }])
  if (document.page) rows.push([{ tag: 'text', text: `来源页：${document.page}` }])
  return { title: `新反馈 · ${TYPE_TEXT[document.type] || TYPE_TEXT.other}`, content: rows }
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    let target
    try {
      target = new URL(url)
    } catch (error) {
      reject(new Error('FEEDBACK_WEBHOOK 不是合法地址'))
      return
    }
    const payload = JSON.stringify(body)
    const request = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: REQUEST_TIMEOUT_MS
    }, response => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { raw += chunk })
      response.on('end', () => resolve({ status: response.statusCode || 0, body: raw }))
    })
    request.on('timeout', () => request.destroy(new Error('webhook 请求超时')))
    request.on('error', reject)
    request.write(payload)
    request.end()
  })
}

/**
 * 有些渠道即使 HTTP 200 也可能在 body 里报错：
 *   企微 {errcode:0}；飞书 {code:0}（新版）/ {StatusCode:0}（旧版）。
 * 不认这个的话，「webhook 地址错了」会被记成「已推送」。
 */
function bodyAccepted(channel, raw) {
  let parsed = null
  try { parsed = JSON.parse(raw) } catch (error) { parsed = null }
  if (!parsed || typeof parsed !== 'object') return true
  if (channel === 'wecom') return Number(parsed.errcode || 0) === 0
  const code = parsed.code !== undefined ? parsed.code : parsed.StatusCode
  return code === undefined || Number(code) === 0
}

/** 通知开发者：任何异常都吞掉，返回 false 让调用方知道没推成 */
async function notify(document) {
  if (!WEBHOOK) return false
  const channel = detectChannel(WEBHOOK)
  if (!channel) {
    console.warn('不认识的 webhook 地址，跳过推送（可用 FEEDBACK_WEBHOOK_TYPE 指定 wecom / feishu）')
    return false
  }
  // 截图链接在构造消息体之前取，两条渠道共用同一份
  const imageUrls = await resolveImageUrls(document.images)
  let body
  if (channel === 'feishu') {
    body = { msg_type: 'post', content: { post: { zh_cn: buildFeishuPost(document, imageUrls) } } }
    if (WEBHOOK_SECRET) {
      // 飞书要的是秒级时间戳，且签名必须和 timestamp 一起放进 body
      const timestamp = String(Math.floor(Date.now() / 1000))
      body.timestamp = timestamp
      body.sign = signFeishu(timestamp, WEBHOOK_SECRET)
    }
  } else {
    body = { msgtype: 'markdown', markdown: { content: buildMarkdown(document, imageUrls) } }
  }
  try {
    const response = await postJson(WEBHOOK, body)
    if (response.status < 200 || response.status >= 300) {
      console.error('webhook 返回异常', channel, response.status, response.body)
      return false
    }
    if (!bodyAccepted(channel, response.body)) {
      console.error('webhook 业务报错', channel, response.body)
      return false
    }
    return true
  } catch (error) {
    console.error('推送反馈通知失败', channel, error)
    return false
  }
}

exports.main = async event => {
  const openid = String((cloud.getWXContext() || {}).OPENID || '')
  if (!openid) return { ok: false, message: '拿不到用户身份' }

  const type = TYPE_TEXT[event && event.type] ? event.type : 'other'
  const content = text(event && event.content, CONTENT_LIMIT)
  if (content.length < 2) return { ok: false, message: '内容太短，写两句再发' }

  // 图片只认本环境的 fileID：传任意 http 地址进来会把通知变成钓鱼链接的载体
  const images = Array.isArray(event && event.images)
    ? event.images.filter(item => typeof item === 'string' && item.indexOf('cloud://') === 0).slice(0, IMAGE_LIMIT)
    : []

  const document = {
    _openid: openid,
    type,
    content,
    contact: text(event && event.contact, CONTACT_LIMIT),
    images,
    version: text(event && event.version, 40),
    model: text(event && event.model, 80),
    system: text(event && event.system, 120),
    sdk: text(event && event.sdk, 40),
    page: text(event && event.page, 120),
    at: Date.now(),
    notified: false
  }

  try {
    await ensureCollection()
    const result = await db.collection(COLLECTION).add({ data: document })
    document._id = result._id
  } catch (error) {
    console.error('写入反馈失败', error)
    return { ok: false, message: '写入失败，稍后再试' }
  }

  // 先落库再推送：推送这一步无论成败，用户的反馈都已经在库里了
  const notified = await notify(document)
  if (notified) {
    db.collection(COLLECTION).doc(document._id).update({ data: { notified: true } })
      .catch(error => console.error('回写通知标记失败', error))
  }
  return { ok: true, notified }
}
