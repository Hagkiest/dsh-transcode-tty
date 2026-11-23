# dsh-transcode-tty

[![test](https://github.com/Hagkiest/dsh-transcode-tty/actions/workflows/test.yml/badge.svg)](https://github.com/Hagkiest/dsh-transcode-tty/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4B6BFB.svg)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) · **简体中文**

一个 DeepSeek Harness 插件：把终端工具的输出转码成终端视图能正常显示的文本。

---

## 问题

Harness 会把命令输出当作纯文本来渲染，无论是工具卡片还是对话记录。这段文本里经常夹带着渲染器不会解释的东西，于是你看到的不是命令的真实输出，而是乱码：

| 命令实际发出的内容 | 你看到的内容 |
| --- | --- |
| `ERROR` 前面的 `ESC[1;31m` | 字面的 `[1;31mERROR` |
| 同一行重绘 40 次的加载动画 | 40 帧挤成一行，无法阅读 |
| CP936 控制台输出的 `构建成功` | `鏋勫缓鎴愬姛` |
| 同一段文本被当作 ISO-8859-1 读取 | `æå»ºæç«` |
| 被错误字符集丢掉的字节 | 一串 `���` |
| 零宽空格或双向标记 | 看着对、复制出来是错的 |
| 表意空格 | 列对不齐 |

这些既不是命令的错，也不是模型的错。它们是字节流与文本视图交界处的转码失败，而这个交界处正是可以自动修好的地方。

## 它做什么

`dsh-transcode-tty` 挂在 Host 的 `tools/post-execute` 瀑布钩子上。对允许列表内的工具（默认 `pwsh`、`bash`、`job_output`），它在结果渲染之前重写每一个文本内容块：

```js
ctx.on('tools/post-execute', async (exec, result, next) => {
  if (!enabled || !tools.has(exec.name)) return next();
  const content = normalizeContent(result?.content, options);
  if (content === undefined) return next();
  return { kind: 'accept', content };
});
```

这段代码有三点是刻意为之，而且缺一不可：

- **只替换 `content`。** 运行时合并 `accept` 决策的方式是展开原结果，所以结构化的 `value`——退出码、stdout/stderr、沙箱元数据——对下游消费者保持原样。同时带 `content` 和 `value` 的决策会直接抛错。
- **没变化就 `next()`。** 不需要改写的结果直接放行，而不是替换成一份一模一样的副本，所以未受影响的输出零成本。
- **不碰其他东西。** 图片块、附件、未知块类型都按引用透传。

## 转换链

顺序很重要，而且不是随意的。

```text
原始输出
   │
   ├─ stripAnsi                   ESC[1;31m  →  （移除）
   ├─ collapseCarriageReturns     10%\r50%\r100%  →  100%
   ├─ repairMojibake              鏋勫缓鎴愬姛  →  构建成功
   ├─ stripControlChars           a\u200Bb  →  ab
   ├─ normalizeSpaces             a\u00A0b  →  a b
   ├─ foldFullwidth       （可选）  Ａ１  →  A1
   ├─ collapseReplacementRuns （可选）  ���  →  �
   └─ trimTrailingWhitespace  （可选）
```

ANSI 排在最前，免得转义参数被当成正文。**乱码修复排在控制字符清理之前**，因为“UTF-8 被读成 Latin-1”这种损坏，载荷本身就是 C1 控制字节（`U+0080`–`U+009F`）——先清理就等于销毁证据，只留下修不回来的碎片。

### 怎么避免把正常文本改坏

真正危险的失败不是“没修好”，而是“把本来没坏的东西改了”。两道规则拦住它。

**1. 候选必须是精确的逆变换。** 用“当初造成乱码的那个字符集”把候选重新编码，必须逐字节还原输入。否则一律丢弃，所以只是看着奇怪的文本不会被碰。

**2. GBK 方向需要更强的判据。** GBK 不是 UTF-8，有损解码不会留下 `U+FFFD` 供检测。真正的信号是统计性的：

- “UTF-8 被读成 GBK”的乱码，绝大多数落在 GBK **二级字**（`0xD8A1`–`0xF7FE`，人名里的生僻字）或根本不在两级之内。
- 真正的中文正文，以 GBK **一级字**（`0xB0A1`–`0xD7FE`，3755 个常用字）为主。

评分器比较的就是这个分布，所以 `张燚 李鑫 王淼`、`編譯成功`、`ビルドが成功しました` 都能原样保留，而 `鏋勫缓鎴愬姛` 会被修好。

### 无法恢复的时候

如果错误字符集已经丢掉了某个字节，那个字节就真的没了。插件会恢复能读的部分，并为每个丢失的字符留下**一个 `U+FFFD`**：

```text
文件未找到  →  （GBK 误解码，字节数为奇数）
鏂囦欢鏈壘鍒  →  文件未找�
```

这是诚实的，而且渲染干净。另一种做法——猜一些看起来像的中文——会产出一本正经的错误内容，比一个看得见的标记更糟。修复同时也是幂等的：再跑一次不会有任何变化。

> **实现细节。** CP936 是变长编码：单字节 `0x80` 解码为 `€`，而双字节 `A2 E3` 解码为同一个字符。只用双字节构建的反向表会把那个单字节反转成两个字节，导致整个字节流错位、往返校验失败。`src/normalize.js` 先枚举单字节形式，让它在歧义中胜出。

## 安装

需要 **Node.js 20 或更新版本**，以及一个 DeepSeek Harness 配置（profile）。

### Windows（PowerShell）

```powershell
git clone https://github.com/Hagkiest/dsh-transcode-tty.git
cd dsh-transcode-tty
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### macOS / Linux

```sh
git clone https://github.com/Hagkiest/dsh-transcode-tty.git
cd dsh-transcode-tty
chmod +x install.sh && ./install.sh
```

### 跨平台

```sh
npm install
npm run install:plugin
```

三种方式做的是同样五件事：

1. 定位 profile 目录（依次看 `--profile-dir`、`DSH_PROFILE_DIR`、`~/.dsh/profiles/<profile>`）。
2. 安装插件自身的依赖，这一步决定了设置表单能否渲染。
3. 把包注册为 profile 的 `link:` 依赖，并加入 `dsh.profile.bundles`。
4. 用 pnpm 重新协调 profile。
5. 校验链接后的包确实包含 `index.js` 和 `cordis.patch.yml`。

然后**重启 DeepSeek Harness**，让 Loader 加载新的组合。之后终端输出就会自动规范化，不需要其他操作。

> 更喜欢图形界面？Harness 的插件管理器支持按目录安装 bundle，指向仓库根目录即可。

### 卸载

```powershell
node scripts/uninstall.mjs          # 或：.\uninstall.ps1
```

它会移除条目、协调 profile，并恢复安装时备份的 `package.json`——但只在期间没有其他改动时才恢复，所以不会悄悄丢掉你后来的编辑。

### 自检

```powershell
npm run verify
```

当插件“看起来没生效”时，跑这一条命令。它会检查清单文件、依赖、入口、每个转换、测试套件，以及当前 profile 是否真的包含这个条目。

### 看它怎么工作

```powershell
npm run demo
```

复刻插件要修的每一种损坏——GBK 与 Latin-1 误解码、ANSI 转义、进度条重绘、不可见字符——每个案例打印三行：损坏的输入、插件的期望结果、以及实际渲染结果。在 Harness 里运行时，实际结果那一行会在渲染前被已安装的插件改写，所以它应该是干净文本，而输入行显示损坏原貌。

## 配置

每个转换都有开关。默认值的取向是**不去改动正确的输出**，所以三个有风险的转换默认关闭。

| 选项 | 默认 | 理由 |
| --- | --- | --- |
| `enabled` | `true` | 总开关，不影响你其他设置。 |
| `tools` | `["pwsh","bash","job_output"]` | 按终端文本渲染的工具。 |
| `stripAnsi` | `true` | 没被解释的转义序列永远没有用。 |
| `collapseCarriageReturns` | `true` | 终端本来也只显示最后一段。 |
| `repairMojibake` | `true` | 下面三个方向的总开关。 |
| `repairUtf8AsGbk` | `true` | 最常见的 CP936 控制台情形。 |
| `repairUtf8AsLatin1` | `true` | UTF-8 被读成 ISO-8859-1。 |
| `repairGbkAsLatin1` | `true` | GBK 被读成 ISO-8859-1。 |
| `stripControlChars` | `true` | 不可见字符破坏对齐和复制粘贴。 |
| `normalizeSpaces` | `true` | 空格变体会让列错位。 |
| `foldFullwidth` | `false` | 可能改变有意为之的中文排版。 |
| `collapseReplacementRuns` | `false` | 会掩盖丢了多少数据。 |
| `trimTrailingWhitespace` | `false` | 会掩盖细节；diff 输出有时需要它。 |
| `maxTextLength` | `262144` | 超过就跳过，限制单次结果的开销。 |

在**设置 → 插件 → 终端文本转码**里配置，或在自己的 profile `cordis.patch.yml` 里覆盖该行：

```yaml
- id: dsh-transcode-tty
  config:
    foldFullwidth: true
    tools:
      - pwsh
```

## 架构

```text
index.js               薄门面：重新导出公开接口
src/config.js          声明的默认值、schema、配置解析
src/plugin.js          tools/post-execute 监听器
src/normalize.js       纯 string → string 转换，零 import
cordis.patch.yml       Loader 应用的 bundle 补丁
locale/{en,zh}.json    设置界面用的插件元数据
scripts/               安装、卸载、自检、共享工具
test/                  三个套件，不依赖测试框架
```

`src/normalize.js` **完全没有 import**——不用 Node 内置模块，不用任何依赖。每个函数都是纯 `string → string`，所以整块逻辑不需要 Harness 运行时就能测试，热路径也安全。

## 开发

```sh
npm install
npm test          # 3 个套件，117 条断言
npm run verify    # 端到端安装健康检查
```

```text
test/normalize.test.mjs    逐个转换单独测试        41 条
test/realworld.test.mjs    真实控制台产物          52 条
test/plugin.test.mjs       针对假上下文的接线测试   24 条
```

不用测试框架是刻意的：转换都是纯函数，`node:assert` 加一个小 harness 就够覆盖，而且从一个干净检出就能直接 `npm test`。

改动必须守住的不变量见 [CONTRIBUTING.md](CONTRIBUTING.md)，运行时契约的细节见 [docs/architecture.md](docs/architecture.md)。

## 文档

- [架构](docs/architecture.md)——Cordis 扩展点与决策契约
- [转换链](docs/transforms.md)——每个转换及其前后对比
- [乱码](docs/mojibake.md)——三种损坏方向如何被识别与逆转
- [配置](docs/configuration.md)——每个选项、默认值及其理由
- [排错](docs/troubleshooting.md)——输出仍然不对时怎么办

## 边界

本插件修的是**已经产出的文本如何显示**。它不会：

- 用不同代码页重跑命令（请改用 `chcp 65001` 或等价设置）。
- 改变模型看到的工具输出中文本块以外的部分。
- 触碰允许列表之外工具的输出。

如果命令的*输出本身*在源头就是错的——某个遗留工具往 UTF-8 管道里写 GBK——正解是在源头修。本插件面向的是你改不了那个工具的情况。

## 许可证

[MIT](LICENSE)
