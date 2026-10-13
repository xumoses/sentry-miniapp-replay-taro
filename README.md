# @xumoses/sentry-miniapp-replay-taro

为 `sentry-miniapp` 提供的实验性 Taro React Session Replay 适配层。它从 Taro
运行时的虚拟 DOM 获取快照和 mutation，并把 capture 转成 Sentry Replay envelope。

> **Experimental：** 当前为 `0.x` 验证版本，事件格式、API 和兼容边界仍可能变化。
> 不能把它视为 Sentry 浏览器 Replay 的等价实现。

[English](./README.en.md)

## 生产化第一阶段

- Taro `4.2.x`、React 18、微信小程序开发者工具；
- 全局 `ReplayCoordinator` 对 session 采样一次；error 采样率大于 0 即持续缓冲，
  每个可接受异常独立采样，未命中不会终止后续错误机会；
- 连续会话默认每 5 秒分段，错误前 30 秒有界滚动 buffer；分段保留 observer
  与节点 ID（需要支持 `takeSegment` 的 SDK），导航维持同一 Replay；
- 异常自动提升仅接受当前可见 Taro 页面中真正通过 SDK `beforeSend` 与错误采样的
  异常；原生页和后台异常不会误关联此前的 Taro buffer；
- 首个错误沿用同一 `replay_id` 提升为 session，后续错误与递增 segment 继续归入
  同一个 Replay，达到会话上限后重新进入 error buffer；
- Taro 页面只 attach/detach root，不导入第二份 sentry-miniapp；
- 可注入社区版 `sentry-miniapp` 或 scoped fork `@xumoses/sentry-miniapp` 的 SDK
  namespace。

暂不支持原生小程序 DOM、Vue/uni-app、小游戏、自动 Canvas 录制、WebView、原生组件内部节点、
离线查看的完整 rrweb 播放体验，以及浏览器
Session Replay 的全部事件类型。在非微信平台或不同 Taro 版本上的行为也尚未经过系统验证。

### 显式 Canvas 像素桥接

支持此能力的 SDK 可通过 `taroReplayIntegration({ sdk, recordCanvas: true })`
开启像素桥接，默认关闭。目标 Taro `Canvas` 或包裹它的 `View` 必须有唯一 `id`
及 `data-sentry-canvas={true}`。绘制完成后调用
`bridge.recordCanvas?.(id, () => readPngOrJpegDataUri())`；读取函数由宿主提供，
必须同步返回当前画面的 PNG/JPEG data URI 或 `undefined`，不要在调用桥接前导出像素。

只有当前可见且正在录制的页面节点能够读取。隐藏、停止、reset、运行期开关关闭、
旧页面节点或旧 SDK 缺少此方法时返回 `false`；SDK 再检查显式遮罩/屏蔽、
每秒限频和字节预算。`bridge.subscribe` 在页面 attach/录制器重建后通知
`snapshot.recording`，宿主可据此补采已绘制的图表。即使 Replay ID 没有变化也应
重新尝试，并由宿主对重复通知限频；成功采帧本身不会触发通知。

像素无法自动识别或遮罩个人信息，默认文字/输入遮罩不会修改图片内部内容。
只对确认可公开的图表显式标记；普通图片和 CSS URL 仍使用原有媒体隐私规则，
无需关闭 `blockAllMedia`。此能力不提供绘图指令录制、连续视频或原生组件内部 DOM。

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
import { getReplayImageSources } from './replayImages.generated';

installTaroReplayPageLifecycle({
  bridge: Taro.getApp()?.globalData?.sentryBridge?.replay,
  getReplayStyles,
  getReplayImageSources,
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

本版可通过可选的 `getReplayImageSources(route)` 提供同一路由引用的可信静态图片
图片映射；图片录制需要 `@xumoses/sentry-miniapp@1.13.1-beta.6`。宿主构建生成
`replayImages.generated`，以静态资源路径为精确 key、以经过大小限制的 PNG/JPEG/GIF/
WebP data URI 为值；适配层将映射作为 `staticImageSources` 传给 SDK。候选 SDK 也支持
经严格安全审计的静态 SVG；依赖匹配版本发布后再启用。不要加入远程 URL、运行时用户
图片或未审计 SVG；该映射不会放开任意 data URI，也不会改变隐私遮罩规则。
读取失败或未提供映射时安全跳过；小程序本地图片路径仍可能无法在浏览器还原。

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
显式 runtime 可通过可选的 `getReplayStyles(route)` 和 `getReplayImageSources(route)`
提供同一份编译样式与可信静态图片映射。

Replay 发送前会复用配套 SDK 客户端的 `getRuntimeContexts()` 技术信息缓存，与异常
事件共享 `device`、`os`、`browser`、`app`、`runtime` 和小程序宿主信息。录制启动仍为同步；
开发者工具中的宿主系统版本由 SDK 有界等待 Client Hints（最多 200ms），不会把模拟
iPhone 的 iOS 版本当作电脑系统，模拟参数单独放在 `miniapp_simulator`。缺少可信信息
时保留已知系统名称或未知值，不猜测版本。普通设备继续使用小程序平台 API。

`getMetadata().contexts` 的显式字段会覆盖对应默认字段；不会自动读取 Sentry scope 的
user 或其它自定义 context。SDK 的 `enableSystemInfo: false` 同样关闭 Replay 的系统
元数据补采，录制所需的页面视口尺寸仍保留。旧 SDK 无共享 provider 时使用保守的平台
API 回退，开发者工具中的真实宿主系统记为未知。显式自定义 metadata 仍受现有隐私过滤。

## 隐私默认值

默认配置偏向最小采集：

- `maskAllText: true`：所有可见文本替换为遮罩；
- `maskInputValues: true`：输入值不进入 capture；
- `allowUser: false`：自定义 metadata 中的 user 被丢弃；
- breadcrumb 的敏感字段会过滤，URL 会去除 query、hash 和 userinfo；
- `maskAllInputs` 是 `maskInputValues` 的优先别名；`blockAllMedia: true` 默认屏蔽
  媒体，宿主明确提供的可信静态图片映射是有限例外；
- `maskAttributes` 替换默认属性列表 `title` / `placeholder` / `aria-label`；
  如需追加遮罩，请在自定义列表中同时保留这三个默认属性；
- recorder 设有时长、事件、字节和单批 mutation 上限。

只有页面内的所有内容都已确认是合成测试数据时，才可以显式设置
`privacy.maskAllText: false`。不要在真实用户页面复制示例中的关闭选项。

## 可选的 Replay 网络 headers

默认不采集请求或响应 headers。需要配套 SDK 支持以下四个官方同名选项，并把同一份
配置同时传给 SDK 初始化和 `taroReplayIntegration`（或 `createTaroReplay`）：

```ts
const networkDetails = {
  networkDetailAllowUrls: [/^https:\/\/api\.example\.com\/v1(?:\/|$)/],
  networkDetailDenyUrls: [/\/private(?:\/|$)/],
  networkRequestHeaders: ['x-request-id'],
  networkResponseHeaders: ['x-request-id'],
};

Sentry.init({
  dsn: 'https://public@example.com/1',
  ...networkDetails,
  integrations: [taroReplayIntegration({ sdk: Sentry, ...networkDetails })],
});
```

- URL 先去除 userinfo、query 和 hash，再执行规则；规则只针对 origin/path，
  不支持 query/hash 条件。字符串使用子串匹配，推荐像上例一样锚定完整 origin 的正则；
  deny 优先，allow 为空时不采集。调用方的正则 `lastIndex` 不会改变。
- 只有 URL 获准时，默认允许 `content-type`、`content-length`、`accept`；
  两个 header 名称列表在对应方向增加允许项，大小写不敏感，不支持通配符。
  Authorization、Cookie、Set-Cookie、token、密码、密钥等敏感名称始终拒绝，
  即使显式加入列表也不会保存。自定义名称和值仍需宿主确认不含个人信息或业务秘密。
- 每个方向最多 20 项；名称最多 128 个 ASCII 字符、单值最多 1024 UTF-8 字节、
  名称和值合计最多 4096 UTF-8 字节。超限项跳过，不截断值。不会读取请求或响应 body。
- 配置在创建入口时复制，后续修改原数组或正则不会扩大采集范围；页面重建、buffer
  轮转和异常晋升沿用同一规则。修改策略需重建 integration。
- 配套 SDK 通过临时 breadcrumb hint 将 headers 交给 Replay，普通错误 breadcrumb
  不新增 headers；adapter 不修改原始 breadcrumb/hint。手动传入的
  `data.request_headers` / `data.response_headers` 也必须重新通过上述规则，
  其他通用 `headers`、嵌套敏感字段和 body 仍被过滤。

旧 SDK 可能忽略这些选项；发布升级后仍需分别确认 Replay 网络面板、错误 breadcrumb
和真机隐私边界。本地测试不能代替线上验收。

## 发送路径

生产发送调用当前 Sentry client 的 `Client.sendEnvelope()`，因此沿用宿主 SDK 的
transport、限流、离线队列和用户授权路径。适配层不会自行解析 DSN，也不会从小程序
直接对 Sentry 发起一条旁路 `fetch` 请求。

buffer 模式仅在已接受异常通过 Replay 采样、显式 `sendBufferedReplay()`，或用户反馈
明确设置 `includeReplay: true` 时发送；普通 `flush()` 在 buffer 中无副作用。
`flush()` 在 session 中发送当前段并继续录制。反馈关联使用官方
`contexts.feedback.replay_id`，不会进入异常的 `error_ids`；事务关联携带 Replay
context 和 `tags.replayId`，其 trace/页面名进入 Replay 的 `trace_ids`/`segment_names`。

远程或本地 kill switch 可通过 `enabled` boolean/函数接入；调用
`refreshEnabled()` 会立即检查并清理 observer、计时器及尚未交付的队列。
`bridge.reset()` 用于退出登录或身份切换：丢弃当前录制，等待下一可见页面 attach，
避免拍下旧身份页面。`stop()` 显式停止，`start()` / `startBuffering()` 手动启动；
`destroy()` 或 integration `cleanup()` 永久清理实例。不要同时安装全局生命周期和页面 hook。

队列默认至多 4 段 / 2 MiB；明确抛出的发送失败最多重试两次，HTTP 错误不盲目重发。
`getSnapshot().delivery` 区分 2xx `accepted`、SDK 未提供结果的 `handed-off`、
`rejected` 和 `cancelled`；`recording` 表示真实活动 recorder。已经交给宿主 transport
的请求或离线队列不能由 adapter 撤回。完整能力、默认限额与限制见
[官方能力对照](./docs/official-alignment.md) 和 [生命周期约定](./docs/production-phase-one.md)。

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

## 可选 Worker 压缩

微信宿主可配置 `compression: { workerPath: 'workers/sentry-replay.js' }`，并把包的 `./worker` 导出复制到 `app.json.workers` 目录。Worker 使用 Sentry 官方 zlib 录制格式，失败自动降级原始 JSON；原有内存限额保持不变。匹配 SDK 支持接近限额时提前发送增量分段，以及错误 buffer 晋升时复用 observer、避免立即重发完整快照。详见 [构建、生命周期和限制](./docs/worker-compression.md)。

## GitHub Actions CI/CD

开发使用 Node.js 26 和 `packageManager` 固定的 pnpm 版本。分支 push、PR 和手动触发
CI 会依次执行 frozen-lockfile 安装、`pnpm run check`（格式、lint、类型）、测试、
构建（包含 Worker 验证和声明生成）及 `npm pack --dry-run`。

发布与 SDK 一样由 `v*-beta.*` tag 触发，并重新执行完整检查。发布前在本仓库
Settings → Secrets and variables → Actions 配置 `NPM_TOKEN`；其他仓库的 secret
不会自动共享。tag 必须与 `package.json` 版本完全对应，例如 `v0.1.0-beta.5`。
检查通过后以 public access、provenance 和 `beta` dist-tag 发布，保持 `latest` 不变。

每个 tag 的发布串行执行。npm 版本不可覆盖：若发布步骤已成功，重跑前先核对 registry，
不要再次发布同一版本；若发布后源码有变化，必须使用新的版本和 tag。npm 提示后处理时，
仍需等待准确版本及 tarball 可下载并核对完整性，CI 成功不替代这一检查。
