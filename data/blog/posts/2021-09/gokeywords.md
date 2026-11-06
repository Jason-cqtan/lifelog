---
title: 巧记go关键词
date: 2021-09-28T09:24:40+08:00
description: go关键词
tags:
    - Go
categories:
    - 开发
series:
    - Golang 代码片段
cover: /blog/media/images/cover/go-logo-blue.svg
---

按照go文件从上往下和相关性记忆

package import
var const type
struct map interface
func return
go defer
if else goto
switch case defalut fallthrough
for range continue break
select chan


`package`和`import` 用于分包和导入
`var`和`const` 是 Go语言基础里面的变量和常量申明
`type`用于声明自定义类型
`struct` 用于定义抽象数据类型
`map`用于声明map类型数据
`interface` 用于定义接口
`func` 用于定义函数和方法
`return` 用于从函数返回
`go` 用于并发
`defer` 用于类似析构函数
`if`、`else`、`goto`、`switch`、`case`、`default`、`fallthrough`、`for`、`continue`、`break` 用于流程控制
`range`用于读取slice、map、channel数据
`select` 用于选择不同类型的通讯
`chan`用于`channel`通讯
