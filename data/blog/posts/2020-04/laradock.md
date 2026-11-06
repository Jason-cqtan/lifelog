---
title: 小玩Laradock
date: 2020-04-16T22:55:16+08:00
tags:
    - php
    - laradock
    - docker
categories:
    - 开发
    - tools
cover: /blog/media/images/cover/laradock.png
---

laradock 是一个利用docker容器编排，提供一系列包括不仅限于php环境，在不“污染”本地环境下，将开发环境搭建在docker内；需执行各种命令时，进入workspace容器内执行，workspace可以类比为电脑里的电脑，其他容器同理


官网：[https://laradock.io/](https://laradock.io/)

github:[https://github.com/laradock/laradock](https://github.com/laradock/laradock)


可替换方案
- homestead
- valet(仅支持mac)
- [在mac上安装部署多版本php环境](https://getgrav.org/blog/macos-catalina-apache-multiple-php-versions)

## 使用laradock驱动多应用

### 准备

- [docker桌面客户端](https://www.docker.com/)，安装后主要使用`docker`，`docker-compose`命令
- docker 基础知识
- laradock 项目包

### 目录结构规划

- projects
-- laradock
-- projectA
-- projectB

### 开始部署

```sh
cd projects
git clone https://github.com/laradock/laradock
cd laradock
cp env-example .env
vim .env
```

按需更改.env配置，部分参数说明
> APP_CODE_PATH_HOST 相对laradock挂载宿主目录
> APP_CODE_PATH_CONTAINER 容器内安装软件目录

### 部署lnmp

```sh
docker-compose up -d nginx mysql
```
在不指定php-fpm和workspace前提下，执行命令读取.env文件内php版本变量值（7.3）创建php-fpm容器，默认创建workspace以及docker in docker容器

若部署lamp环境，则为`docker-compose up -d apache mysql`

虚拟主机设置在对应服务器sites目录下新增即可，比如部署lamp环境，虚拟主机设置在laradock/apache2/sites目录下

#### 访问镜像很慢或构建失败，主要是镜像资源访问慢，解决方法：

- 更改.env CHANGE_SOURCE=true 更改使用阿里镜像
- 挂代理，修改.env CHANGE_SOURCE=false。让docker客户端自动获取代理，不建议再修改docker桌面端代理连接本地代理
- 在国外vps上安装好后，打包镜像，下载到本地导入（万不得已）


## 如何重启服务
- 重启镜像 docker-compose restart [nginx | apache2 | caddy]
- 进入容器内，使用服务的重启命令，例如
``` sh
docker-compose exec nginx bash
# 或者使用 docker exec -it [容器名|容器id] bash 进入容器
nginx -s reload
```


## 更换容器版本，如mysql、php

修改.env文件，重新构建容器；注意php有两个服务

- php-fpm 用于web应用的php版本，对应容器php-fpm
- workspace容器里面的php-cli版本，用于控制台应用的版本，对应容器workspace

重构`docker-compose build [容器名]`


## 重构所有服务
`docker-compose build`

## 如何添加php扩展

- 开启已编译但尚未打开的扩展，修改.env配置，找到对应扩展，更改值为`true`，重新构建对应容器
- 添加未编译的扩展：进入容器，pecl编译安装

## laradock 构建原理

使用`docker-compose`命令会读取docker-compose.yml文件，docker-compose.yml又读取.env文件变量值，一般只修改.env就可更改容器功能。若要添加docker-compose.yml没有的服务，得亲自编写docker-compose.yml了，具体可参考docker相关文档


## 了解更多

laradock文档 -> [https://laradock.io/documentation/](https://laradock.io/documentation/)
docker从入门到实践 -> [https://yeasy.gitbooks.io/docker_practice/content/](https://yeasy.gitbooks.io/docker_practice/content/)






