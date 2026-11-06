---
title: hugo 博客构建github pages
date: 2021-09-26T11:36:57+08:00
description: hugo 博客使用github actions构建github pages
tags:
    - hugo
    - github actions
categories:
    - 开发
cover: /blog/media/images/cover/hugo.svg
---

**原理：借助github actions，设置hugo源码actions，利用Personal access tokens关联hugo源码与github pages仓库构建，github pages仓库设置page对外访问**

步骤：

0.新建hugo构建后的静态文件仓库<username>/<username>.github.io，设置page为项目根目录

1.个人中心设置 Setting-Developer Settings-Personal access tokens 勾选repo 和 admin:repo_hook权限并生成值，临时记录后面需要

2.源码新建分支github-actions ,创建`.github/workflows/build.yml`

```yaml
name: github pages # 名字自取

on:
 push:
   branches:
     - github-actions  # todo，合并master后修改为master。这里的意思是当 main分支发生push的时候，运行下面的jobs，这里先改为github-actions

jobs:
 deploy: # 任务名自取
   runs-on: ubuntu-18.04 # 在什么环境运行任务
   steps:
     - uses: actions/checkout@v2 # 引用actions/checkout这个action，与所在的github仓库同名
       with:
         submodules: true  # Fetch Hugo themes (true OR recursive) 获取submodule主题
         fetch-depth: 0    # Fetch all history for .GitInfo and .Lastmod

     - name: Setup Hugo # 步骤名自取
       uses: peaceiris/actions-hugo@v2 # hugo官方提供的action，用于在任务环境中获取hugo
       with:
         hugo-version: 'latest' # 获取最新版本的hugo
         # extended: true

     - name: Build
       run: hugo --minify # 使用hugo构建静态网页

     - name: Deploy
       uses: peaceiris/actions-gh-pages@v3 # 一个自动发布github pages的action
       with:
         # github_token: ${{ secrets.GITHUB_TOKEN }} 该项适用于发布到源码相同repo的情况，不能用于发布到其他repo
         external_repository: username/usernmae.github.io # todo 修改成自己仓库，发布到哪个repo
         personal_token: ${{ secrets.ACTION_ACCESS_TOKEN }} # 发布到其他repo需要提供上面生成的personal access token
         publish_dir: ./public # 注意这里指的是要发布哪个文件夹的内容，而不是指发布到目的仓库的什么位置，因为hugo默认生成静态网页到public文件夹，所以这里发布public文件夹里的内容
         publish_branch: main # 发布到哪个branch
```

3. 在源码repo中添加上面的personal access token：

进入repo的Settings-Secrets一栏，选择New repository secret，名称为ACTION_ACCESS_TOKEN，值为第二步生成的值

4. 推送github-actions分支，可在hugo博客源码actions选项查看构建详情

5. 合并master分支并修改.github/workflows/build.yml

```yaml
on:
  push:
    branches:
      - github-actions # 改为master
```

6. 访问构建好的github pages,类似：https://username.github.io/

参考：[https://www.imeetyou.net/post/2020/hugo-github-actions/](https://www.imeetyou.net/post/2020/hugo-github-actions/)



