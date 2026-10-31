# dsh-approval-comment

## 原项目

[MaYiFei1995/dsh-approval-comment](https://github.com/MaYiFei1995/dsh-approval-comment)

DSH 默认审批流程选择「拒绝」时，支持填写拒绝的理由（附言），类似 Claude Code CLI 的 Tab to amend。

## 本项目

修复了原项目在 0.1.2-rc.1 上启动失败的问题。截止 0.2.1-rc.2 均可正常运行；更高版本尚未测试。

## 安装与卸载

```powershell
# 进入本项目目录

# 打包 .tgz
npm pack

# 安装（建议用绝对路径）
dsh plugin --profile web add C:\path\to\dsh-approval-comment-0.1.2.tgz

# 安装后需重启 DSH

# 卸载
dsh plugin --profile web remove dsh-approval-comment
```

## License

[MIT](./LICENSE)
