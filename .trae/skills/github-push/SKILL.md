---
name: github-push
description: 将本项目 commit 并 push 到 GitHub 远程仓库 123aw991/gaozikuo（使用已配置的 SSH 公钥认证）。当用户说提交到github、推送到github、commit并push、上传到远程仓库时触发。不用于推送到其他仓库或只提交不推送的场景。
---

# 提交到 GitHub

将当前项目（`d:\steam\yuan\gao\zikuo\zikuo`）commit 并 push 到 GitHub 仓库 `123aw991/gaozikuo`，使用已配置的 SSH 公钥（`~/.ssh/id_ed25519`）认证。

## 固定配置

- 远程 SSH 地址：`git@github.com:123aw991/gaozikuo.git`（一律用 SSH 地址，不要用 HTTPS）
- 项目主页：`https://github.com/123aw991/gaozikuo`
- 默认分支：`main`
- git 身份已全局配置（gzk / 1565802086@qq.com），无需重复设置

## 执行步骤

1. **验证 SSH 认证**：运行 `ssh -T git@github.com`，应返回 `Hi 123aw991!`。失败则停止，提示用户检查公钥配置。
2. **初始化仓库**：若 `git rev-parse --is-inside-work-tree` 报错，先执行 `git init -b main`。
3. **配置远程 origin**：
   - origin 不存在：`git remote add origin git@github.com:123aw991/gaozikuo.git`
   - origin 指向其他地址：`git remote set-url origin git@github.com:123aw991/gaozikuo.git`
4. **确认远程仓库可访问**：`git ls-remote origin`。若报 `Repository not found`，停止并提示用户先在 GitHub 上创建该仓库。
5. **查看变更**：运行 `git status` 和 `git diff`，据此拟定提交信息；用户已给出提交信息则直接使用。
6. **暂存文件**：按文件名逐个 `git add <file>`，不要用 `git add -A` 或 `git add .`，避免误提交 `.env`、密钥等敏感文件。发现疑似敏感文件时提醒用户。
7. **创建提交**：`git commit -m "<提交信息>"`；多段信息用多个 `-m`。一律创建新提交，禁止 `--amend`、`--no-verify`。
8. **推送**：首次执行 `git push -u origin main`，之后执行 `git push`。禁止 `push --force`。
9. **验证结果**：`git status` 确认工作区干净且本地与 `origin/main` 同步，然后向用户报告提交哈希和推送结果。

## 异常处理

- push 被拒（non-fast-forward，远程有本地没有的提交）：先 `git pull --rebase origin main`，有冲突则解决后再 push，并向用户说明情况。
- 任何失败不要原样重试，先诊断原因再换方案。
