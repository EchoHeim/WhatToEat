/**
 * 版本号唯一来源。
 * 以前只在「我的」页的 data 里写死一份，反馈页也要显示版本时就只能再抄一份，
 * 发版时漏改一处就会「反馈里报的版本和实际不一致」——排查线上问题最怕这个。
 *
 * 发版时跟 `cli upload -v` 传的版本号一起改这里。
 */
const APP_VERSION = 'Ver0.0.9'

module.exports = { APP_VERSION }
