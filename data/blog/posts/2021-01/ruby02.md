---
title: Ruby基础语法
date: 2021-01-25T10:30:13+08:00
description: Ruby基础语法
tags:
    - ruby
categories:
    - 开发
series:
    - ruby从陌生到入门
cover: /blog/media/images/cover/Ruby_logo.png
---

## 配置工作

测试ruby，可直接在`irb`中测试，定义`irb`配置文件`~/.irbrc`，去掉缩进和多余的提示，看着清爽

```text
IRB.conf[:PROMPT_MODE] = :SIMPLE
IRB.conf[:AUTO_INDENT_MODE] = false
```

## 打印和注释

### 打印

- puts
ruby中所有方法()，可带可不带，会自动识别，puts打印并自动附加\n换行

示例：
> puts "hello world"
> puts("hello word")

- print
只打印不换行

示例：
> print "hello world"

### 注释

使用`#` 注释

- 单行注释

```ruby
puts "hello world" # 打印hello world
```

- 多行注释

```ruby
#多
#行
#注
#释
```

```ruby
=begin

puts "hello world"

=
```

- here document
用于定义多行字符串，以`<<<`开头，跟上标识，结尾处行首跟上标识

语法：

```ruby
str = <<<标识

标识
```

示例：

```ruby
<<<EOC

EOC

```

- 由` `` `包裹的，执行` `` `内命令

示例：
> print \`ls -alf \`

## 字符串

- 单引号
ruby不会对单引号字符串进行插值操作。单引号字符串的用处在于它们真的就是字面值，只包含你输入的字符

- 双引号
会解析表达式`#{}`内的变量

```ruby
var = 'test'
puts "#{var}"

# 重复3次
s = 'a'
s *= 3

# 读取索引下字符
s = 'abc'
puts s[0]

# 转小写返回副本
s = "HELLO"
s.downcase

# 转小写返回副本并更改原来的
s = 'HELLO'
s.downcase!

# 追加
s = 'a'
s << 'b' << 'c'
```

### 拼接

支持 `+`，但使用concat性能更佳，机制不一样,`+=`会赋值原来文本再尾部添加，而`concat`直接在子串尾部添加
分别使用下面demo，感受下时间，都是50000次重复追加`xxx|`，第二种`concat`明显就很快

```ruby
box = ''
50000.times{box+="xxx|"}

box = ''
50000.times{box.concat("xxx|")}
```

## 数组、hash、range

### 数组

```ruby
# 创建数组的几种方式
nums = Array.[](1,2,3,4,5)
nums = Array[1,2,3,4,5]
nums = Array(0..9)
nums = [1,2,3,4,5]

ary = [`ls -alf`,'jason'']

# 只打印值
ary.each do |item|
    puts item
end

# 打印索引和值
ary.each_with_index do |val,index|
    puts index,val
end

# 定义数组长度
ary = Array.new(14)

# 定义数组并使用相同元素
ary = Array.new(3,'nice')

# 生成时使用计算后结果填充
ary = Array.new(10){|e|e*=10}

```

### hash、关联数组

```ruby
base_info = {"name"=>"jason","email"=>"uniqueacheng@gmal.com"}
symbols_format = {:name=>"jason",:email=>"uniqueacheng@gmal.com"}
symbols_sample = {name:"jason",email:"uniqueacheng@gmal.com"}
base_info.each do |key,val|
    puts "key:#{ key} ,val: #{val}"
end
```

### range

(start..end) 两个`.`包含end值
(start...end) 三个`.`不包含end值

```ruby
# 生成8位随机字母
('a'..'z').to_a.sample(8).join
# bar bas bat bau
('bar'..'bau').to_a
```

## 其他参考

只例举了非常基础的东西，更多可参考官方[ruby api 文档](https://ruby-doc.org)
