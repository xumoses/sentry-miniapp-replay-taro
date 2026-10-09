# @xumoses/sentry-miniapp-replay-taro

为 `sentry-miniapp` 提供的实验性 Taro React Session Replay 适配层。它从 Taro
运行时的虚拟 DOM 获取快照和 mutation，并把 capture 转成 Sentry Replay envelope。

> **Experimental：** 当前为 `0.x` 验证版本，事件格式、API 和兼容边界仍可能变化。
> 不能把它视为 Sentry 浏览器 Replay 的等价实现。

[English](./README.en.md)

## 生产化第一阶段

- Taro `4.2.x`、React 18、微信小程序开发者工具；
- 全局 `ReplayCoordinator` 做一次稳定采样决定，并跨页面保持 replay id；
- 普通完整会话采样和错误前 30 秒有界滚动 buffer；
- 只有当前可见 Taro 页面中真正通过 SDK `beforeSend` 与错误采样的异常才会提升
  buffer；原生页和后台异常不会误关联此前的 Taro buffer；
- 首个错误沿用同一 `replay_id` 提升为 session，后续错误与递增 segment 继续归入
  同一个 Replay，达到会话上限后重新进入 error buffer；
- Taro 页面只 attach/detach root，不导入第二份 sentry-miniapp；
- 可注入社区版 `sentry-miniapp` 或内部重命名包 `@xumoses/sentry-miniapp` 的 SDK
  namespace。

暂不支持原生小程序 DOM、Vue/uni-app、小游戏、Canvas、WebView、原生组件内部节点、
离线查看的完整 rrweb 播放体验，以及浏览器
Session Replay 的全部事件类型。在非微信平台或不同 Taro 版本上的行为也尚未经过系统验证。

## 安装

```sh
pnpm add @xumoses/sentry-miniapp-replay-taro@beta
```

原生入口需要安装以下两个 SDK namespace 中的一个。Taro 子项目不应再安装它：

```sh
pnpm add sentry-miniapp
# 或
pnpm add @xumoses/sentry-miniapp@beta
```

## 推荐用法

原生 `app.js` 是唯一初始化位置，并把最小 bridge 暴露给 Taro：

```ts
import * as Sentry from '@xumoses/sentry-miniapp';
import { taroReplayIntegration } from '@xumoses/sentry-miniapp-replay-taro';

const replay = taroReplayIntegration({ sdk: Sentry });

Sentry.init({
  sampleRate: 1,
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1,
  integrations: [...Sentry.getDefaultIntegrations(), replay],
});

App({ globalData: { sentryBridge: { replay: replay.bridge } } });
```

推荐在 Taro app 入口一次安装全页面生命周期：

```ts
import Taro from '@tarojs/taro';
import { installTaroReplayPageLifecycle } from '@xumoses/sentry-miniapp-replay-taro/taro/lifecycle';
import { getReplayStyles } from './replayStyles.generated';

installTaroReplayPageLifecycle({
  bridge: Taro.getApp()?.globalData?.sentryBridge?.replay,
  getReplayStyles,
});
```

安装器在页面 ready/show 时 attach，在 hide/unload 时 detach。进入原生页或小程序后台
不会继续录制，返回 Taro 后沿用当前 Replay；任何生命周期异常都会安全降级，不改变页面
原始返回值或导航结果。

`replayStyles.generated` 由宿主构建生成，不属于适配包。Taro 虚拟 DOM 只有节点、
class 和内联样式，不包含最终 WXSS。宿主需在样式编译完成后把当前页面依赖的共享和
页面 WXSS（含 `@import`）按原顺序合并，转换成与 recorder 输出节点对应的浏览器
CSS，并提供 `getReplayStyles(route)`。参数是已去除 query/hash 的页面路由。
适配层将返回的 CSS 作为 `stylesheet` 传给 SDK；支持该选项的 SDK 把样式写入完整
快照，并按录制窗口宽度换算 `rpx`。本地候选的样式注入最低版本为
`@xumoses/sentry-miniapp@1.13.1-beta.5`；旧版 SDK 会忽略该选项。

未提供样式、返回 `undefined` 或读取样式失败时仍可录制结构和内联样式，但外部样式
无法还原。原生组件内部、平台默认控件和字体等仍需在 Sentry 与目标设备上比较验证。

单页调试也可以使用 hook：

```tsx
import Taro from '@tarojs/taro';
import { useTaroReplayRoot } from '@xumoses/sentry-miniapp-replay-taro/react/root';

export default function CheckoutPage() {
  const state = useTaroReplayRoot({
    bridge: Taro.getApp()?.globalData?.sentryBridge?.replay,
  });
  return <View>Replay: {state.state}</View>;
}
```

hook 会在 Taro `useReady` / `useDidShow` 时寻找当前页面的 `$taroPath` 根节点并开始
录制，在 `useDidHide` / `useUnload` 时释放监听。找不到页面根节点时会安全地跳过，
不会阻止页面运行。

如果不使用 React，可以从主入口导入 `createTaroReplay`，并显式提供 Taro runtime
适配对象。该入口不会静态依赖 `@tarojs/taro` 或 `@tarojs/runtime`。
显式 runtime 可通过可选的 `getReplayStyles(route)` 提供同一份编译样式。

## 隐私默认值

默认配置偏向最小采集：

- `maskAllText: true`：所有可见文本替换为遮罩；
- `maskInputValues: true`：输入值不进入 capture；
- `allowUser: false`：自定义 metadata 中的 user 被丢弃；
- breadcrumb 的敏感字段会过滤，URL 会去除 query、hash 和 userinfo；
- recorder 设有时长、事件数和字节数上限。

只有页面内的所有内容都已确认是合成测试数据时，才可以显式设置
`privacy.maskAllText: false`。不要在真实用户页面复制示例中的关闭选项。

## 发送路径

生产发送调用当前 Sentry client 的 `Client.sendEnvelope()`，因此沿用宿主 SDK 的
transport、限流、离线队列和用户授权路径。适配层不会自行解析 DSN，也不会从小程序
直接对 Sentry 发起一条旁路 `fetch` 请求。

buffer 模式无异常时绝不发送；异常提升自动发送。手动 flush 只用于 full-session
诊断。远程或本地 kill switch 可通过 integration 的 `enabled` boolean/函数接入，
disabled 状态不会创建 observer 或发送 envelope。

## 本地 capture 查看器

发布包包含一个只供开发使用的内存查看器：

```sh
pnpm dlx --package=@xumoses/sentry-miniapp-replay-taro@beta sentry-miniapp-replay-taro-viewer
# 打开 http://127.0.0.1:4178
```

在页面中选择或粘贴 recorder 生成的 capture JSON，即可查看摘要、事件和原始数据。
服务器仅监听 `127.0.0.1`，不落盘，并限制单次上传与内存总量。它不是生产 ingestion
服务，也不应该被代理到局域网或公网。查看器当前用于检查 capture，不承诺完整的可视化
回放。更多示例见 [`examples/taro-react`](./examples/taro-react/README.md)。

## 版本策略

当前只发布 `beta` dist-tag，版本号固定使用 `x.y.z-beta.N`；不会发布 `latest`
或稳定版本。在 `1.0.0` 前，minor 版本可能包含 API 或 envelope 结构调整。升级时应在
微信开发者工具和目标真机上重新验证隐私遮罩、页面生命周期、payload 大小及 Sentry
ingestion 结果。

## License

[MIT](./LICENSE)
