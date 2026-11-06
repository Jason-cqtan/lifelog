---
title: 安装ruby
date: 2021-01-25T10:02:47+08:00
description: 初识ruby，在mac上安装
tags:
    - ruby
categories:
    - 开发
series:
    - ruby从陌生到入门
cover: /blog/media/images/cover/Ruby_logo.png
---

## ruby

始于1993年，由日本计算机科学家松本行弘（Matz）设计并开发，是一种面向对象，动态语言，Ruby于2006年为TIOBE获选为年度编程语言；

## 前言

现在学习Ruby似乎已经过时，现在主要流行Python、Go、NodeJs；
在我看来，做技术的，不应该只限于某种语言，至少应该掌握3种语言，生计语言，个人使用语言；语言是工具，多掌握工具，多些解决问题的途径，多学习了解并不是坏事。
本系列主要是学习ruby、ruby on rails相关记录，不定时更新，从陌生到入门:)

## 安装

### macOs

- 使用homebrew一键安装

> brew install ruby

- 使用官方自带管理器[rvm](http://rvm.io/) （推荐）
用Ta能安装多个 版本的ruby，随时切换，而homebrew只能安装一个版本

可能会遇到的问题：

0.zsh: command not found: gpg2
解决：使用brew安装 `brew install gpg2`

```sh
gpg --recv-keys 409B6B1796C275462A1703113804BB82D39DC0E3 7D2BAF1CF37B13E2069D6956105BD0E739499BDB
```

1.提示没找到秘钥
解决：终端请挂代理

## 验证并使用

确认输入命令有输出

- 重启终端
- rvm --help
- gem --version

|命令|说明|
|:----   |-----   |
|rvm |Ruby Version Manager |
|gem |包管理器 RubyGems 提供的 gem 命令 |
|irb |ruby在控制台的交互式解析器 |

## 替换系统自带ruby

```sh
rvm install 3.0.0
rvm use 3.0.0
# 创建软链接
ln -s 安装目录 软链接目录
```

## 测试

```sh
!#/usr/local/bin/ruby
puts ("欧耶，hello world!")
```

