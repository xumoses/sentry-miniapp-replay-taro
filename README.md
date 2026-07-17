# @xumoses/sentry-miniapp-replay-taro

为 `sentry-miniapp` 提供的实验性 Taro React Session Replay 适配层。它从 Taro
运行时的虚拟 DOM 获取快照和 mutation，并把 capture 转成 Sentry Replay envelope。

> **Experimental：** 当前为 `0.x` 验证版本，事件格式、API 和兼容边界仍可能变化。
> 不能把它视为 Sentry 浏览器 Replay 的等价实现。

[English](./README.en.md)

## 当前验证范围

- Taro `4.2.x`、React 18、微信小程序开发者工具；
- 单个 Taro 页面根节点的初始快照、DOM mutation 和 Sentry breadcrumb；
- 手动停止或达到时长上限后，通过当前 Sentry client 发送一个 Replay segment；
- 可注入社区版 `sentry-miniapp` 或内部重命名包 `@xumoses/sentry-mini` 的 SDK
  namespace。

暂不支持原生小程序 DOM、Vue/uni-app、小游戏、Canvas、WebView、原生组件内部节点、
多页面连续会话、多 segment、错误发生前缓冲、离线查看的完整 rrweb 播放体验，以及浏览器
Session Replay 的全部事件类型。在非微信平台或不同 Taro 版本上的行为也尚未经过系统验证。

## 安装

```sh
npm install @xumoses/sentry-miniapp-replay-taro
```

宿主项目还需要安装 Taro、React、`@sentry/core`，以及以下两个 SDK namespace
中的一个：

```sh
npm install sentry-miniapp
# 或
npm install @xumoses/sentry-mini
```

## React 用法

先正常初始化 SDK，然后把整个 SDK namespace 注入 hook。适配层不硬编码宿主包名，
因此同一份代码可用于社区包与内部重命名包。

```tsx
import { Button, View } from '@tarojs/components';
import * as Sentry from 'sentry-miniapp';
import { useTaroReplay } from '@xumoses/sentry-miniapp-replay-taro/react';

export default function CheckoutPage() {
  const replay = useTaroReplay({
    sdk: Sentry,
    limits: { maxDurationMs: 30_000 },
  });

  return (
    <View>
      <Button onClick={() => void replay.stop('manual')}>
        停止并发送 Replay
      </Button>
    </View>
  );
}
```

hook 会在 Taro `useReady` 时寻找当前页面的 `$taroPath` 根节点并开始录制，在
`useUnload` 时释放监听。找不到页面根节点时会安全地跳过，不会阻止页面运行。

如果不使用 React，可以从主入口导入 `createTaroReplay`，并显式提供 Taro runtime
适配对象。该入口不会静态依赖 `@tarojs/taro` 或 `@tarojs/runtime`。

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

默认只在手动停止和达到时长上限时发送。页面卸载用于停止与清理，默认不在卸载阶段启动
异步网络请求。可通过 `sendOnManualStop`、`sendOnDurationStop` 和 `sendOnDispose`
调整这些行为；在启用卸载发送前应先验证目标平台的生命周期约束。

## 本地 capture 查看器

发布包包含一个只供开发使用的内存查看器：

```sh
npx sentry-miniapp-replay-taro-viewer
# 打开 http://127.0.0.1:4178
```

在页面中选择或粘贴 recorder 生成的 capture JSON，即可查看摘要、事件和原始数据。
服务器仅监听 `127.0.0.1`，不落盘，并限制单次上传与内存总量。它不是生产 ingestion
服务，也不应该被代理到局域网或公网。查看器当前用于检查 capture，不承诺完整的可视化
回放。更多示例见 [`examples/taro-react`](./examples/taro-react/README.md)。

## 版本策略

在 `1.0.0` 前，minor 版本可能包含 API 或 envelope 结构调整。升级时应在微信开发者工具
和目标真机上重新验证隐私遮罩、页面生命周期、payload 大小及 Sentry ingestion 结果。

## License

[MIT](./LICENSE)
