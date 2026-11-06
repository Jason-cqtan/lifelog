---
title: Trojan从搭建到使用
date: 2019-12-14T17:12:56+08:00
description: 介绍搭建新型科学上网工具及使用
tags:
    - Trojan
categories:
    - life
cover: /blog/media/images/cover/trojan.png
---

## Trojan介绍

Trojan-GFW作为一款新兴的代理软件，相比于L2TP,PPTP,OPENVPN等传统VPN以及SS,SSR,V2ray等主流代理软件，有着轻量化，配置简单，使用方便，速度更快等优势；听说前不久某研究学院破解了ss、ssr代理，真tm一群吃饱了没事干的家伙，以后科学上网更难，寻找备用科学上网方式很有必要。本文将简单介绍Trojan的搭建以及使用方式，不会介绍的很详细，关键点不会漏，点到为止:)

项目地址:[https://github.com/trojan-gfw/trojan](https://github.com/trojan-gfw/trojan)

实现原理图解
![trojan](/blog/media/images/trojan.svg)


## 搭建准备

根据实现原理，trojan监听443端口，再配合web服务器实现伪装，访问80端口重定向443端口，所以需要https证书，同时访问域名是正常的网站，避开GFW的检测，相对难检测到。接下来介绍具体搭建需要哪些。

### 一台vps

搬瓦工、vultr、谷歌云、阿里云均可，但vps所在ip必须是非国内的，原因你懂得。

### 域名

随便注册个便宜的域名即可，.xyz后缀的很便宜，一年一美元不到。提供几个可购买域名服务商:

- [namecheap](https://www.namecheap.com/domains/registration/gtld/xyz/)
- [美橙互联](https://www.cndns.com/cn/domain/)
- [阿里云](https://wanwang.aliyun.com/?spm=5176.1830550.2.2.ckP1DO)

### 证书

方法一：去[https://letsencrypt.org/](https://letsencrypt.org/)免费申请证书，三个月后过期，可以脚本自动续期。

方法二：如果域名在阿里云买的，可以免费申请一年的证书。

看你自己情况选择，申请方法略，自己搜索相关教程，最终得到两个文件，.pem证书文件和.key密钥文件。将这个两个文件上传到vps目录下备用


### 域名解析

将域名A记录解析到vps的ip上，每个服务商界面不一样，最终效果都是这样
- A www ip地址  这样访问域名带www，比如你的域名是betterme.xin，那么访问链接就是www.betterme.xin
- A @ ip地址    这样访问域名不带www，直接访问betterme.xin即可

## 开始搭建

下面展示在Debian 9 64位安装trojan。有很多一键脚本，我尝试过一个没成功，手动配置搭建成功了，所以主要分享手动搭建。


### 搭建trojan服务

0. ssh工具连接上你的vps

1. 安装Trojan-GFW
```sh
sudo apt-get update && sudo apt-get upgrade -y && sudo apt-get install xz-utils -y
sudo bash -c "$(wget -O- https://raw.githubusercontent.com/trojan-gfw/trojan-quickstart/master/trojan-quickstart.sh)"
```

2. 替换配置文件
```sh
sed  -i 's/path/etc/g' /usr/local/etc/trojan/config.json
sed  -i 's/to/trojan/g' /usr/local/etc/trojan/config.json
sed  -i 's/certificate.crt/trojan.crt/g' /usr/local/etc/trojan/config.json
sed  -i 's/private.key/trojan.key/g' /usr/local/etc/trojan/config.json
sed  -i 's/password1/yourpasswd/g' /usr/local/etc/trojan/config.json
sed  -i 's/password2/yourpasswd/g' /usr/local/etc/trojan/config.json
```

3. 修改配置文件
```sh
sudo vim  /usr/local/etc/trojan/config.json
```
只需修改客户端连接密码和申请的域名证书文件，其他默认即可
```json
{
    "run_type": "server",
    "local_addr": "0.0.0.0",
    "local_port": 443,
    "remote_addr": "127.0.0.1",
    "remote_port": 80,
    "password": [
        "password1", //设置客户端连接密码，不支持特殊符号，可设置多个密码，用于多用户连接使用
        "password2"
    ],
    "log_level": 1,
    "ssl": {
        "cert": "/etc/trojan/trojan.crt", //申请的证书路径.pem后缀文件或.crt后缀文件
        "key": "/etc/trojan/trojan.key", //申请的密钥.key后缀文件
        "key_password": "",
        "cipher": "ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-SHA384:ECDHE-RSA-AES256-SHA384:ECDHE-ECDSA-AES128-SHA256:ECDHE-RSA-AES128-SHA256",
        "prefer_server_cipher": true,
        "alpn": [
            "http/1.1"
        ],
        "reuse_session": true,
        "session_ticket": false,
        "session_timeout": 600,
        "plain_http_response": "",
        "curves": "",
        "dhparam": ""
    },
    "tcp": {
        "prefer_ipv4": false,
        "no_delay": true,
        "keep_alive": true,
        "fast_open": false,
        "fast_open_qlen": 20
    },
    "mysql": {
        "enabled": false,
        "server_addr": "127.0.0.1",
        "server_port": 3306,
        "database": "trojan",
        "username": "trojan",
        "password": ""
    }
}
```
想了解更多参数配置，官方配置参考->[config](https://trojan-gfw.github.io/trojan/config.html)

4. 开启并启用trojan服务
```sh
sudo systemctl start trojan
sudo systemctl enable trojan
```
查看启用状态，可用于启动失败排错
```sh
journalctl -e -u trojan.service
```

### 搭建nginx服务伪装https

0. 安装nginx
```sh
sudo apt install nginx -y
```

1. 修改配置文件

删除默认配置文件，只留conf.d目录下配置文件
```sh
sudo rm -rf /etc/nginx/sites-available/
sudo rm -rf /etc/nginx/sites-enabled/
sudo rm -rf /etc/nginx/conf.d/default.conf
sudo touch /etc/nginx/conf.d/trojan.conf
sudo vim /etc/nginx/conf.d/trojan.conf
```

trojan.conf，修改时注意每句结尾的分号别漏了

```conf
server {
    listen 127.0.0.1:80; #放在Trojan后面即可做伪装也可以是真正的网站
    server_name example.com; # 申请的域名，例如betterme.xin www.betterme.xin
    location / {
        # 这里可以反向代理自己另外一个网站，比如 proxy_pass https://betterme.xin;
    	root /usr/share/nginx/html/; #默认的根目录
        index index.html; #默认的html文件
        }
	add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always; #HSTS标头
}

server {
    listen 80;
    listen [::]:80;
    server_name example.com;
    return 301 https://example.com; #301 https重定向
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}
```

检测配置文件是否正确，错误请修改正确。

```sh
nginx -t
```

软启动nginx

```sh
nginx -s reload
```

这样访问自己的域名就正常了。

### 选装bbrplus并禁用TCP慢启动提高吞吐量以及加快连接建立

使用一键脚本

```sh
wget -N --no-check-certificate "https://raw.githubusercontent.com/chiakge/Linux-NetSpeed/master/tcp.sh"
chmod +x tcp.sh
./tcp.sh
```

 TCP加速 一键安装管理脚本 [v1.3.2]
  -- 就是爱生活 | 94ish.me --

 0. 升级脚本
————————————内核管理————————————
 1. 安装 BBR/BBR魔改版内核
 2. 安装 BBRplus版内核
 3. 安装 Lotserver(锐速)内核
————————————加速管理————————————
 4. 使用BBR加速
 5. 使用BBR魔改版加速
 6. 使用暴力BBR魔改版加速(不支持部分系统)
 7. 使用BBRplus版加速
 8. 使用Lotserver(锐速)加速
————————————杂项管理————————————
 9. 卸载全部加速
 10. 系统配置优化
 11. 退出脚本
————————————————————————————————

选择2 enter，当提示是否卸载内核时，选择[否/no]，安装后重启，登录vps后，再执行一次`./tcp.sh` 选择7启用bbr plus

查看是否启用成功
`sudo sysctl -p`
当显示
`net.ipv4.tcp_congestion_control = bbrplus`表示启用bbrplus成功

### 选装dns缓存配置

备份原有配置文件、自己新建
```sh
sudo apt-get install dnsmasq -y
sudo mv /etc/dnsmasq.conf /etc/dnsmasq.conf.bak
sudo touch /etc/dnsmasq.conf
```

监听本机
```
sudo echo "port=53" >> /etc/dnsmasq.conf
sudo echo "no-resolv" >> /etc/dnsmasq.conf
sudo echo "server=1.1.1.1#53" >> /etc/dnsmasq.conf
sudo echo "interface=lo" >> /etc/dnsmasq.conf
sudo echo "listen-address=127.0.0.1" >> /etc/dnsmasq.conf
sudo echo "cache-size=1000" >> /etc/dnsmasq.conf
```

设定系统dns服务器为本机
```
chattr -i /etc/resolv.conf && echo "nameserver 127.0.0.1" > /etc/resolv.conf && chattr +i /etc/resolv.conf
```

开启服务并查看启动状态
```sh
sudo systemctl restart dnsmasq
sudo systemctl status dnsmasq
```
呼耶，服务端已经安装完毕，接下来就等客户端连接使用咯。


## 客户端连接使用
由于该科学上网还比较新颖，目前适配的客户端还不够齐全。

电脑上，不管是window还是macOs,都是先下载客户端服务，让Ta在控制台后台运行，然后再在谷歌浏览器安装[SwitchyOmega插件](https://chrome.google.com/webstore/detail/proxy-switchyomega/padekgcemlokbadohgkifijomclgjgif?hl=zh-CN)配合使用

手机端，安卓有[igniter](https://github.com/trojan-gfw/igniter/releases),仅支持全局代理，功能比较单一，安装后输入域名和密码点击连接即可

苹果设备，shadowroket支持trojan，简单配置域名，端口443，连接密码即可

注意，当我连接时，域名带了https://，这样是连接不上的，只需域名，比如申请的域名是betterme.xin，那么请填写betterme.xin，密码是服务端配置的某一个密码

自己vps线路的质量好坏决定了上网体验，如果没有特殊需求，看youtube，1080p完全没问题。

另外分享自己刚搭建的链接，拿去用吧，访问域名做了反向代理，访问[https://93jc.cn](https://93jc.cn)会显示本博客首页

本人亲自测试，电信200M，看youtube 4k60帧
![alt youtube 4k60帧](/blog/media/images/4ktrojantest.png "youtube 4k60帧")

- 域名:93jc.cn
- 端口:443
- 密码:||||小|额|打|赏|可|见|||

### Attention!!! 打赏的电报或邮箱联系告知密码，告知打赏来源，或者探索网站其他文章，有惊喜哟:)

## 参考链接
- [Trojan-GFW --一把通往自由互联网世界的万能钥匙](https://www.johnrosen1.com/trojan/)
- [自建梯子教程 --Trojan版本](https://trojan-tutor.github.io/2019/04/10/p41.html)
