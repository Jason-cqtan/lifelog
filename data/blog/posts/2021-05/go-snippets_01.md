---
title: 字符串拼接
date: 2021-05-25T19:54:18+08:00
description: golang 字符串拼接
tags:
    - Go
categories:
    - 开发
series:
    - Golang 代码片段
cover: /blog/media/images/cover/go-logo-blue.svg
---

```go
str := ""
```

**方法一：使用`+`**

```go
str = "hello" + " world!"
```

---

**方法二：使用fmt包Sprintf方法**

```go
str = fmt.Sprintf("abc%d", 123)
```

---

**方法三：使用string包Join方法**

```go
str = strings.Join([]string{"123", "456"}, "")
```

---

**方法四：使用buffer包**

```go
var buffer bytes.Buffer
for i := 0; i < 1000; i++ {
    buffer.WriteString("a")
}
str = buffer.String()
```
