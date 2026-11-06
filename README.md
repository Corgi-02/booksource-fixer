# 源序 · Booksource Fixer

**简体中文** · [English](README_EN.md)

面向鸿蒙版开源阅读的 JSON 书源诊断与修正工具。在浏览器中选择文件，查看问题与改动，再下载修正版或分批文件。

**文件始终在浏览器内处理，不上传服务器。** 运行时无需数据库、Node.js、Python 或外部服务。

## 功能

- 识别单个书源、书源数组、普通 JSON 和混合内容，支持多文件独立诊断。
- 自动处理 BOM、JSON 字符串外的注释、末尾多余逗号和已确认的空扩展字段。
- 检查必填字段、类型、取值范围、重复标识及未知字段，逐项展示原因与修改前后值。
- 保留未知字段和所有非空解析规则，保存数字原始文本，避免大整数精度损失。
- 导出 UTF-8 无 BOM JSON、可调整数量的分批文件、排除项和诊断报告，支持 ZIP 打包。
- 提供 Windows EXE、Linux 命令行程序和 Docker 部署方式；页面适配电脑与手机。

## 快速开始

### Docker Compose

在安装了 Docker Engine 和 Compose 的机器上克隆仓库并启动：

```sh
git clone https://github.com/Corgi-02/booksource-fixer.git
cd booksource-fixer
docker compose up -d --build
```

浏览器访问 `http://localhost:8080`；其他设备使用部署机器的 IP。

```sh
docker compose logs -f       # 查看日志
docker compose down          # 停止服务
```

修改 `compose.yaml` 的端口映射即可换端口，例如 `"8088:8080"`。无需挂载数据卷。镜像使用非 root 用户，Compose 默认启用只读根文件系统并移除额外 capabilities。

### Windows

使用预编译包时，解压 Windows amd64 ZIP 后双击 `booksource-fixer.exe`。程序监听 `127.0.0.1:8080` 并自动打开浏览器，按 Ctrl+C 退出。

```powershell
.\booksource-fixer.exe --port 8088
.\booksource-fixer.exe --host 0.0.0.0 --port 8080 --no-open
```

预编译包由下文的 `npm run release` 生成，不随源码提交。

### Linux

选择匹配架构的程序：`linux-amd64` 用于 x86_64，`linux-arm64` 用于 aarch64。

```sh
chmod +x booksource-fixer
./booksource-fixer --host 0.0.0.0 --port 8080
```

Linux 不自动打开浏览器，可访问 `http://部署机器IP:8080`。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--host` | `127.0.0.1` | 监听地址；`0.0.0.0` 可供局域网访问 |
| `--port` | `8080` | 监听端口；被占用时明确报错 |
| `--no-open` | `false` | Windows 下不自动打开浏览器 |
| `--version` | — | 显示工具和兼容配置版本 |
| `--help` | — | 查看完整参数 |

### systemd

源码包含 `deploy/booksource-fixer.service`：

```sh
sudo mkdir -p /opt/booksource-fixer
sudo install -m 755 booksource-fixer /opt/booksource-fixer/booksource-fixer
sudo cp deploy/booksource-fixer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now booksource-fixer
journalctl -u booksource-fixer -f
```

### 使用预编译程序构建 Docker 镜像

不希望下载构建环境时，可以使用 `Dockerfile.prebuilt`。将对应 Linux 程序放入指定目录，再构建镜像：

```sh
mkdir -p bin/linux-amd64
cp /path/to/booksource-fixer bin/linux-amd64/
docker build -f Dockerfile.prebuilt --build-arg TARGETARCH=amd64 -t booksource-fixer:1.0.0 .
docker run -d --name booksource-fixer -p 8080:8080 \
  --restart unless-stopped --read-only --cap-drop ALL booksource-fixer:1.0.0
```

ARM64 主机将目录和构建参数改为 `linux-arm64`、`TARGETARCH=arm64`。此方式无需下载基础镜像；源码多阶段构建使用默认 `Dockerfile`。

## 使用流程

1. 选择或拖入 JSON 文件。单文件不超过 **50 MiB**，队列合计不超过 **100 MiB**；支持逐文件处理、取消和清空。
2. 查看 **有效书源 / 待处理 / 非书源 / 空占位** 分类，按名称、标识或问题筛选，打开详情检查改动。
3. 混合内容需确认“仅提取有效书源”后才能导出修正版；其他记录保存在可单独下载的排除项中。
4. 下载修正版或结果 ZIP。分批默认每批 **500 条**，可设置为 1–10000。报告记录工具版本、规则版本、输入摘要和改动。
5. 实际导入阅读后，可填写应用版本及实测结果，再导出报告。此信息是用户记录，不是自动设备验证。

普通 JSON、空数组及无法可靠修复的文件不会被伪装成书源。截断、损坏引号或转义、重复 JSON 键会显示错误位置；完全非书源文件仍可下载诊断报告和排除项。文件生成后如未开始下载，可点击页面提供的直接保存链接。

支持 UTF-8 和带 BOM 的 UTF-16LE/BE。清空或刷新释放内存中的文件与结果，不保存历史；原始文件不被覆盖。

## 兼容规则与边界

目标应用是 [mgz0227/legado-Harmony](https://github.com/mgz0227/legado-Harmony)。规则参考该项目链接的 [Legado 3 书源说明](https://mgz0227.github.io/The-tutorial-of-Legado/Rule/source.html)，字段类型结合已验证样本整理在 `src/compatibility.json`。

**兼容配置不是完整的官方 Schema；格式通过不等于设备导入成功或书源当前可阅读。**

- 只识别顶层书源对象或数组。`bookSourceName`、`bookSourceUrl` 需要为非空字符串；标识不强制为 HTTP 地址，缺少搜索或正文规则不直接判为非书源。
- 缺失、null 或空字符串的分组补为“未分组”。只清除 `ruleReview`、`exploreScreen`、`ruleToc.formatJs` 的空值；有内容的扩展字段和其他未知字段保留并提示。
- 已知布尔字段仅转换 `"true"` / `"false"`。整数仅转换合法的十进制整数字符串：书源类型 0–3，排序和权重为有符号 int32，响应时间与更新时间为非负 int64。其他类型冲突进入待处理列表。
- 重复书源标识只提示可能覆盖，不自动去重或重新排序。超过 128 层嵌套时停止处理。
- 不执行书源 JavaScript，不请求书源网站，不自动修复失效网站、登录或反爬问题；不转换旧版阅读、其他阅读器格式或任意嵌套备份。

## 开发与构建

需要 **Node.js 24**、**Go 1.24+**；依赖通过锁文件固定。

```sh
npm ci
npm run dev
```

构建前端后，Go 会将网页嵌入可执行文件：

```sh
npm test
npm run build
go test ./server
go run ./server --no-open
```

`server/web/` 是构建产物，不提交到 Git。直接运行 Go 构建或服务测试前，应先执行 `npm run build`。

### 生成发布包

```sh
npm run build
npm run release
```

输出到 `release/`：Windows amd64、Linux amd64/arm64 ZIP 及 `SHA256SUMS.txt`。包中附中文、英文 README 与第三方许可。Go 不在 PATH 时，可通过 `GO_BINARY` 指定完整路径。

测试仅保留核心回归：内容分类、受限修复、规则保留、数字精度、编码、导出一致性、Worker ZIP 协议和服务接口。测试使用合成数据，不依赖个人桌面文件或在线书源。

## 服务接口

| 请求 | 用途 |
| --- | --- |
| `GET /` | 静态网页 |
| `GET /healthz` | 健康检查，返回 `ok` |
| `GET /api/version` | 工具版本、规则版本、处理模式 |

没有文件上传、服务器修正或书源代理接口；POST 请求返回 405。页面 CSP 限制网络连接，资源均随程序打包。可使用 Nginx 或 Caddy 反向代理，建议部署在站点根路径。

第三方软件许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 及 `licenses/`。
