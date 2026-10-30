/**
 * 占位组件：app.json 开着 tabBar.custom = true 时，框架会去找 /custom-tab-bar/index，缺了会编译不过。
 * 但 Skyline 下这个组件的宿主节点被排在页面原点，组件内 position: fixed 只改了绘制、
 * 没改命中区（点击全落空），所以真正的悬浮条由各 tab 页自己的 styles/tabbar.wxml 渲染，
 * 这里只留一个 0 尺寸的空壳。
 */
Component({ data: {} })
