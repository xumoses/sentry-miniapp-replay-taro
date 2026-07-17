# Taro React 页面接入示例

这个目录展示在 Taro `4.2.x` React 页面中使用实验性 Replay hook 的最小接入。
当前只在微信小程序开发者工具中验证过。

## 1. 初始化宿主 SDK

在应用入口按 `sentry-miniapp` 的正常方式初始化。DSN、用户授权、transport 和离线队列
都属于宿主 SDK 配置，不由 Replay 适配层重复管理。

```ts
// src/app.tsx
import * as Sentry from 'sentry-miniapp';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
});
```

如果内部项目使用重命名包，只需把 import 改成：

```ts
import * as Sentry from '@xumoses/sentry-miniapp';
```

传给 `useTaroReplay({ sdk: Sentry })` 的仍然是完整 SDK namespace，页面的其他代码
不需要变化。

## 2. 注册示例页面

把页面加入 `src/app.config.ts`：

```ts
export default defineAppConfig({
  pages: [
    // ...现有页面
    'pages/replay/index',
  ],
});
```

然后复制 [`src/pages/replay/index.tsx`](./src/pages/replay/index.tsx) 和
[`src/pages/replay/index.config.ts`](./src/pages/replay/index.config.ts) 到应用中。

## 3. 隐私说明

示例页面只渲染源码内固定文案和本地计数器，没有姓名、输入框、订单号或任何真实用户数据，
所以它特意展示了 `maskAllText: false`，方便在验证期观察 snapshot/mutation。

真实业务页面应删除整个 `privacy` 配置并使用默认值：`maskAllText: true`、
`maskInputValues: true`、`allowUser: false`。不要把示例的关闭遮罩配置复制到用户页面。

## 4. 验证

进入页面后点击“增加合成计数”产生 mutation，再点击“停止并发送 Replay”。生产发送会走
已初始化 client 的 `sendEnvelope()`。页面卸载默认只清理 observer，不发起新的异步请求。

如需检查发送前的 capture，可从 `replay.getController()?.getCapture()` 获取 JSON，手动保存
后导入本包附带的 localhost 查看器。不要把本地查看器作为生产服务。
