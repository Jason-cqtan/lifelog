---
title: 变量、块、对象
date: 2021-01-25T15:12:10+08:00
description: 介绍块、变量、对象相关
tags:
    - ruby
categories:
    - 开发
series:
    - ruby从陌生到入门
cover: /blog/media/images/cover/Ruby_logo.png
---

##  块

```ruby
ary = [1,2,3]

ary.each do |item|
     # 这里就是块
     puts item
end

(1..5).each { |i| puts 2 * i }
# { |i| puts 2 * i } 为块

```

## 变量

### 局部变量

块中或方法内变量，以数字字母下划线开头，块中和方法内可用

### 实例变量

类中以`@`开头，类中方法内共享

### 类变量

类中以`@@`开头，类实例后的对象间共享

### 全局变量

`$`开头，跨类使用

### 常量

以大写命名

```ruby

class User
  REGION = "china"
  $time = Time.now #全局变量，跨类使用
  @@id= 0 #类变量，类的属性,实例对象中共享
  @age = 18 # 实例变量,类中所有方法内共享
  def initialize (name,age=18) # name、age为局部变量,仅在该方法内使用
    print "我是局部变量name\n"
    @@id += 1
    @name = name
    @age = age
  end

  def display
    puts "id:#{@@id}"
    puts "name:#{@name}"
    puts "age:#{@age}"
    puts "region:#{REGION}"
    puts '-------'
  end

  def test
    puts "同类方法调另外一个方法定义的实例变量@age,#{@age}"
    puts "调用常量REGION:#{REGION}"
  end

end

class OtherClass

  def nowtime
    print "我是全局变量$time，可以跨类访问，值为#{$time}\n"
  end
end


user1 = User.new("Jason")
user1.display
user1.test

user2 = User.new('Cherry',19)
user2.display

timeobj = OtherClass.new
timeobj.nowtime

```

## 对象

ruby内一切皆对象

