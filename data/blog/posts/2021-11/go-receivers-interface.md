---
title: Go语言方法和接收器
date: 2021-11-25T14:49:07+08:00
description: 理解go语言函数、方法集以及如何实现接口
tags:
    - Go
categories:
    - 开发
series:
    - Golang 代码片段
cover: /blog/media/images/cover/go-logo-blue.svg
---

### 函数式方法

```go
func 函数名(参数列表) (返回参数) {
   // 函数体
}
```

函数一经定义都可被调用，无指定作用对象，无归属感



### “类”方法

|  比较项   | 面向对象类  |go中类型+所属方法=“伪类”  |
|  ----  | ----  |---|
| 方法放置同一文件  | 必须 | 可以不在同一源文件，但必须在同一个包中|
| 重载  | 支持 |不支持，但针对接收器方法，同一包内允许存在同名方法（不同类的同名方法）|


```go
// 普通接收器
func (接收器变量 接收器类型) 方法名(参数列表) (返回参数){
	// 方法体
}
// 指针接收器
func (接收器变量 *接收器类型) 方法名(参数列表) (返回参数){
	// 方法体
}
```

![alt go方法集](https://z4a.net/images/2021/11/25/gopng.png "go方法集")


注意：

- 接收器变量：接收器中的参数变量名在命名时，官方建议使用接收器类型名的第一个小写字母，而不是 self、this 之类的命名。例如，Socket 类型的接收器变量应该命名为 s，Connector 类型的接收器变量应该命名为 c 等。
- 接收器类型可以是（几乎）任何类型，不仅仅是结构体类型，任何类型都可以有方法，甚至可以是函数类型，可以是 int、bool、string 或数组的别名类型，但是接收器不能是一个接口类型，因为接口是一个抽象定义，而方法却是具体实现，如果这样做了就会引发一个编译错误invalid receiver type…。
- 方法名、参数列表、返回参数：格式与函数定义一致。



### 函数与方法比较

```go
package main

type Bag struct {
	items []int
}

// 普通函数
func Insert(b *Bag,id int) {
	b.items = append(b.items,id)
}

// 指针接收器
func (b *Bag) Insert(id int) {
	b.items = append(b.items,id)
}

func main()  {

	newbag := &Bag{}

	// 函数式调用
	Insert(newbag,1024)

	// “类”方法调用
	newbag.Insert(1024)

}
```


### 如何选择指针接收器或非指针接收器

区别，非指针接收器在运行时，将接收器复制一份，仅在方法内修改成员有效，方法外不会影响原接收器；若需要改变后的接收器，新返回新生成的接收器

```go
package main

import "fmt"

type apple struct {
	color string
}

type orange struct {
	color string
}

func (a apple) changeColor(color string) apple {
	a.color = color
	fmt.Printf("非指针接收器，apple方法内修改：%v\n", a)
	return a
}

func (o *orange) changeColor(color string) {
	o.color = color
	fmt.Printf("指针接收器，orange方法内修改：%v\n", o)
}

func main() {

	apple := apple{}
	orange := orange{}
	newApple := apple.changeColor("green")
	orange.changeColor("green")
	fmt.Printf("修改后获取apple:%v\n", apple)
	fmt.Printf("修改后获取orange:%v\n", orange)
	fmt.Printf("修改后获取新生成的apple:%v\n", newApple)
}
```

运行输出：

> 非指针接收器，apple方法内修改：{green}
> 指针接收器，orange方法内修改：&{green}
> 修改后获取apple:{}
> 修改后获取orange:{green}
> 修改后获取新生成的apple:{green}

小对象由于值复制时的速度较快，所以适合使用非指针接收器，大对象因为复制性能较低，适合使用指针接收器，在接收器和参数间传递时不进行复制，只是传递指针。或关注类型的本质，成员是内置类型（int，float...）,引用类型（map，slice...）使用值接受者（非指针接收器），成员是结构类型使用指针接受器。但也是根据具体需而定。（总之遇事不决用指针）



### method sets revisited

|  接收器   | 接收值  |
|  ----  | ----  |
|  (t T)  | T 和 *T|
|  (t *T)  | *T|

非指针接收接收常规类型和指针类型调用，而指针接收器只接收指针类型调用

```go
package main

import "fmt"


type orange struct {
	color string
	from string
}


func (o *orange) changeColor(color string) {
	o.color = color
	fmt.Printf("指针接收器，orange方法内修改：%v\n", o)
}

func (o orange) changeFrom(from string) orange {
	o.from = from
	return o
}

func main() {

	// 非指针类型能调用指针方法
	o1 := orange{}
	o1.changeColor("green")
	fmt.Printf("修改后获取orange:%v\n", o1)
	o2 := &orange{}
	o2.changeColor("red")
	fmt.Printf("修改后获取orange:%v\n", o2)

	o1 = o1.changeFrom("north")
	//o2 = o2.changeFrom("south") 无法运行，指针类型无法调用非指针接收器
	fmt.Printf("修改后获取orange:%v\n", o1)
	fmt.Printf("修改后获取orange:%v\n", o2)
}
```



### 接口

鸭子类型：当看到一只鸟走起来像鸭子、游泳起来像鸭子、叫起来也像鸭子，那么这只鸟就可以被称为鸭子。

go采用这种类型实现接口。

使用结构体实现接口：当一个结构体具备接口的所有的方法的时候，它就实现了这个接口

```go
package main

import (
	"fmt"
	"net/http"
)

type server interface {
	route() func(pattern string,HandlerFunc http.HandlerFunc)
	start() func(address string) error
}

// 当一个结构体具备接口的所有的方法的时候，它就实现了这个接口
type webserver struct {
	name string
}


func (w *webserver) route(pattern string,HandlerFunc http.HandlerFunc) {
	http.HandleFunc(pattern,HandlerFunc)
}

func (w *webserver) start(address string) error {
	return http.ListenAndServe(address,nil)
}

func home(w http.ResponseWriter,r *http.Request) {
	fmt.Fprintf(w,"Ciao %s",r.URL.Path[1:])
}

func main() {

	obj := &webserver{
		name: "openresty",
	}
	obj.route("/",home)
	obj.start("localhost:8099")

}
```

#### 接口总结

- 通过考虑数据类型之间共同的功能，而不是数据类型之间共同的字段，来创建抽象。
- 一个interface{}值不是任何类型的，它是interface{}类型的。
- 接口是两个字的维度；从原理上讲，它们看起来像（类型，值）。
- 接受一个interface{}值比返回一个interface{}值要好。
- 指针类型可以调用其相关值类型的方法，但反之亦然。
- 所有传递都是按值传递，甚至方法接收者
- 一个接口值并不是严格意义上的指针或不是指针，它只是一个接口。
- 如果你需要完全覆盖一个方法中的值，可以使用*操作符来手动解除对一个指针的定义。

参考：[how-to-use-interfaces-in-go](https://jordanorelli.com/post/32665860244/how-to-use-interfaces-in-go)

### 参考
- http://c.biancheng.net/view/69.html
- https://zh.wikipedia.org/wiki/%E9%B8%AD%E5%AD%90%E7%B1%BB%E5%9E%8B

