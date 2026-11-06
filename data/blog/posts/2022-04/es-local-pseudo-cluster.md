---
title: es8.1.3 本地搭建伪集群
date: 2022-04-28T21:30:15+08:00
description: 最新版es8.1.3，本地搭建伪集群
tags:
    - ES
    - cluster
categories:
    - 开发
cover: /blog/media/images/cover/elastic-logo.svg
---

### 环境说明

- macOS Monterey 12.3.1
- 架构 M1 Pro

### 软件准备

- [elasticsearch](https://www.elastic.co/cn/downloads/elasticsearch)，下载对应架构软件 elasticsearch-8.1.3-darwin-aarch64.tar.gz

- [kibana](https://www.elastic.co/cn/downloads/kibana)，下载对应架构软件 kibana-8.1.3-darwin-aarch64.tar.gz


### 目录规划

../
./elastic-stack
​ ｜----node1
​ ｜----node2
​ ｜----kibana-8.1.3

#### 操作

```zsh
➜  ~ sudo mkdir elastic-stack
➜  ~ cd Downdowds/
➜  Downdowds sudo mv kibana-8.1.3-darwin-aarch64.tar.gz ~/elastic-stack/ && sudo mv elasticsearch-8.1.3-darwin-aarch64.tar.gz ~/elastic-stack/
➜  Downdowds cd ~/elastic-stack
➜  elastic-stack sudo tar xvf kibana-8.1.3-darwin-aarch64.tar.gz
➜  elastic-stack sudo tar xvf elasticsearch-8.1.3-darwin-aarch64.tar.gz
➜  elastic-stack sudo mv elasticsearch-8.1.3 node1
➜  elastic-stack sudo cp -R node1 node2
➜  elastic-stack sudo chown -R me:staff node*
➜  elastic-stack sudo chown -R me:staff kiba*
```

### 开始部署

#### 启动“master”节点

```zsh
➜  elastic-stack cd node1
➜  node1 bin/elasticsearch
```

等待完成输出，提取用户名、密码和token做备用
> ✅ Elasticsearch security features have been automatically configured!
> ✅ Authentication is enabled and cluster connections are encrypted.
> ℹ️  Password for the elastic user (reset with `bin/elasticsearch-reset-password -u elastic`):
>  gf+3ZIqHYHRNyrs7euay
>ℹ️  HTTP CA certificate SHA-256 fingerprint:
>  bdff7b15472b6b87a44d77e12695730944ae6b7ee560419ff1fc4567185dd924
>
>ℹ️  Configure Kibana to use this cluster:
>• Run Kibana and click the configuration link in the terminal when Kibana starts.
>• Copy the following enrollment token and paste it into Kibana in your browser (valid for the next 30 minutes):
>eyJ2ZXIiOiI4LjEuMyIsImFkciI6WyIxOTIuMTY4LjUwLjE4ODo5MjAwIl0sImZnciI6ImJkZmY3YjE1NDcyYjZiODdhNDRkNzdlMTI2OTU3MzA5NDRhZTZiN2VlNTYwNDE5ZmYxZm>M0NTY3MTg1ZGQ5MjQiLCJrZXkiOiJpcDRwY0lBQlc5NFU5TzdWWjM5TDp3MzdpQVJMb1RCU2prNmhZRGV3SkJBIn0=


#### 启动kibana

终端新开tab

```zsh
➜  elastic-stack kibana-8.1.3/bin/kibana
```

浏览器访问http://localhost:5601

键入启动node1输出的token

再键入用户名和密码login in

#### node2加入集群

终端新开tab，node1下生成 `<token>` 备用

```zsh
➜  elastic-stack cd node1
➜  node1 bin/elasticsearch-create-enrollment-token -s node
```

反注释config/elasticsearch.yml文件中`transport.host`设置保存

```zsh
➜  node1 vim config/elasticsearch.yml
```

> transport.host: [_local_, _site_]


重启node1，等待启动成功，node2中再启动

```zsh
➜  elastic-stack cd node2
➜  node2 bin/elasticsearch --enrollment-token <token>
```

### 其他

widnows下由于用户组、文件权限原因，本人暂时无法搭建成功，可换虚拟机或docker尝试。
还是mac香

#### 参考
[elasticsearch-complete-guide](https://www.udemy.com/share/101W9q3@cMiG43CpEGYjNBmDsO2q3gttSNG7ihJL-moRS5kxHnGz225aAKzXNiugb1nK-BHG/)
[https://www.elastic.co/guide/en/beats/libbeat/current/config-file-permissions.html](https://www.elastic.co/guide/en/beats/libbeat/current/config-file-permissions.html)
