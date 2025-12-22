# Railway 部署说明

## 当前配置

项目已配置为使用 `--omit=dev` 替代旧的 `--production` 标志：

- **`railway.json`**: 明确指定 `buildCommand: "npm install --omit=dev"`
- **`.npmrc`**: npm 配置文件
- **`.nvmrc`**: Node.js 18

## 关于 npm 警告

如果你仍然看到 `npm warn config production Use '--omit=dev' instead.` 警告：

### 可能的原因：

1. **Railway 的环境变量**: Railway 可能设置了 `NPM_CONFIG_PRODUCTION=true` 环境变量
2. **NIXPACKS 内部行为**: NIXPACKS 构建器可能在某个步骤中使用了 `--production`
3. **警告级别**: 这只是一个警告，不会导致构建失败

### 解决方案：

#### 方案 1: 在 Railway 中设置环境变量（推荐）

在 Railway 项目设置中添加环境变量：

```
NPM_CONFIG_PRODUCTION=false
```

或者：

```
NPM_CONFIG_OMIT=dev
```

#### 方案 2: 验证构建是否成功

即使看到警告，请检查：

1. **构建日志**: 查看是否显示 "Build succeeded"
2. **应用状态**: 在 Railway 仪表板中检查应用是否运行
3. **访问应用**: 尝试访问 Railway 提供的 URL

如果应用正常运行，可以安全地忽略这个警告。

#### 方案 3: 完全抑制警告（如果警告真的困扰你）

在 Railway 项目设置中添加环境变量：

```
NPM_CONFIG_LOGLEVEL=error
```

这会只显示错误，隐藏警告。

## 验证部署

部署成功后，你应该能够：

1. ✅ 访问 Railway 提供的 URL
2. ✅ 看到前端页面正常加载
3. ✅ 输入 API Key 并测试股票分析功能

## 故障排除

如果构建失败：

1. 检查完整的构建日志
2. 确认所有依赖都在 `dependencies` 中（不在 `devDependencies`）
3. 检查 Node.js 版本是否匹配 `.nvmrc`
4. 确认 `railway.json` 配置正确

## 联系支持

如果问题持续存在，请：
1. 分享完整的构建日志
2. 检查 Railway 的文档和社区支持
3. 确认 npm 和 Node.js 版本兼容性

