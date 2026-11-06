---
title: Curl操作Elasticsearch
date: 2022-04-28T17:17:38+08:00
description: curl操作最新Elasticsearch记录，不同于之前的版本，记录相关解决方案
tags:
    - ES
    - Curl
categories:
    - 开发
cover: /blog/media/images/cover/elastic-logo.svg
---

```zsh
➜  ~ curl -X GET http://localhost:9200
curl: (52) Empty reply from server
```

返回这样的结果，有安全策略或版本大于7时默认开启，需要改用https协议



```zsh
➜  ~ curl -X GET "https://localhost:9200"
curl: (60) SSL certificate problem: self signed certificate in certificate chain
More details here: https://curl.se/docs/sslcerts.html
```

提示需要证书，增加`--insecure`选项忽略，但不建议

```zsh
➜  ~ curl --insecure -X GET "https://localhost:9200"
{"error":{"root_cause":[{"type":"security_exception","reason":"missing authentication credentials for REST request [/]","header":{"WWW-Authenticate":["Basic realm=\"security\" charset=\"UTF-8\"","Bearer realm=\"security\"","ApiKey"]}}],"type":"security_exception","reason":"missing authentication credentials for REST request [/]","header":{"WWW-Authenticate":["Basic realm=\"security\" charset=\"UTF-8\"","Bearer realm=\"security\"","ApiKey"]}},"status":401}
```



增加证书，证书在启动es后，默认会在config目录新增证书文件夹，使用`--cacert`选项增加证书

```zsh
➜  elasticsearch-8.1.3 curl --cacert config/certs/http_ca.crt -X GET "https://localhost:9200"
{"error":{"root_cause":[{"type":"security_exception","reason":"missing authentication credentials for REST request [/]","header":{"WWW-Authenticate":["Basic realm=\"security\" charset=\"UTF-8\"","Bearer realm=\"security\"","ApiKey"]}}],"type":"security_exception","reason":"missing authentication credentials for REST request [/]","header":{"WWW-Authenticate":["Basic realm=\"security\" charset=\"UTF-8\"","Bearer realm=\"security\"","ApiKey"]}},"status":401}
```



**Finnally** 但提示需要凭证，添加凭证，用户名和密码

```zsh
➜  elasticsearch-8.1.3 curl --cacert config/certs/http_ca.crt -u elastic -X GET "https://localhost:9200"
Enter host password for user 'elastic':
```



将密码直接同命令一起传入，不建议

```zsh
➜  elasticsearch-8.1.3 curl --cacert config/certs/http_ca.crt -u elastic:xb_hOsOhy3sgTRGHwow4 -X GET "https://localhost:9200"
```



发送post请求（增加`-d`选项，跟上json字符串），提示协议头不支持

```zsh
➜  elasticsearch-8.1.3 curl --cacert config/certs/http_ca.crt -u elastic:xb_hOsOhy3sgTRGHwow4 -X GET https://localhost:9200/products/_search -d '{"query":{"match_all":{}}}'
{"error":"Content-Type header [application/x-www-form-urlencoded] is not supported","status":406}
```



`-H`选项 增加协议头，使用json格式

```zsh
➜  elasticsearch-8.1.3 curl --cacert config/certs/http_ca.crt -u elastic:xb_hOsOhy3sgTRGHwow4 -X GET -H "Content-type:application/json" https://localhost:9200/products/_search -d '{"query":{"match_all":{}}}'
```

