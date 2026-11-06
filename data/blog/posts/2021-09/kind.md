---
title: Kind创建单、多集群
date: 2021-09-29T14:21:35+08:00
tags:
    - k8s
    - kind
categories:
    - 开发
series:
    - k8s学习
cover: /blog/media/images/cover/kind.png
---

## 介绍kind
[Kind](https://github.com/kubernetes-sigs/kind/)是一个使用 Docker容器“节点”运行本地 Kubernetes 集群的工具。它主要用于测试 Kubernetes 本身，但也可用于本地开发或CI。
顾名思义，就是将 Kubernetes 所需要的所有组件，全部部署在一个 Docker 容器中，可以很方便的搭建 Kubernetes 集群。

和`minikube`的区别，看看这里->[Minikube vs. kind vs. k3s - What should I use?](https://brennerm.github.io/posts/minikube-vs-kind-vs-k3s.html)

### 原理
Kind 使用一个 container 来模拟一个 node，在 container 里面跑了 `systemd` ，并用 `systemd` 托管了 `kubelet` 以及 `containerd`，然后容器内部的 `kubelet` 把其他 `Kubernetes` 组件，比如 `kube-apiserver`，`etcd`，`cni` 等组件跑起来。
可以通过配置文件的方式，来通过创建多个 `container` 的方式，来模拟创建多个 Node，并以这些 Node 来构建一个多节点的 Kubernetes 集群。

Kind 内部使用了 `kubeadm` 这个工具来做集群的部署，包括 `ha master` 的高可用集群，也是借助 `kubeadm` 提供的aplha特性提供的。同时，在 `ha master` 下，额外部署了一个 `nginx` 用来提供负载均衡 `vip`。


### 安装

#### 依赖组件

**docker**
kind运行基石，必装√
安装参见：[docker--从入门到实践](https://yeasy.gitbook.io/docker_practice/install)

**kubectl**
用于命令行交互集群，选装
安装参见：[https://kubernetes.io/docs/tasks/tools/#install-kubectl](https://kubernetes.io/docs/tasks/tools/#install-kubectl)


#### 安装kind
安装方式有两种：

- 通过二进制文件编译安装
稳定的二进制文件在[发布页面](https://github.com/kubernetes-sigs/kind/releases)上找到。
**linux**
> curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.11.1/kind-linux-amd64
> chmod +x ./kind
> mv ./kind /some-dir-in-your-PATH/kind


- 通过Golang（1.14+）安装

> cd ~
> go get sigs.k8s.io/kind@v0.11.1

安装后的可执行文件在$GOPATH/bin目录下，注意加入环境变量使其可运用

更多参考->[https://kind.sigs.k8s.io/docs/user/quick-start/#installation](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)


#### 查看可用命令

**tips**:以下bash脚本演示中 **>** 表终端前面标识符，在你机器上可能和我的不一样

```bash

❯ kind --help
kind creates and manages local Kubernetes clusters using Docker container 'nodes'

Usage:
  kind [command]

Available Commands:
  build       Build one of [node-image]
  completion  Output shell completion code for the specified shell (bash, zsh or fish)
  create      Creates one of [cluster]
  delete      Deletes one of [cluster]
  export      Exports one of [kubeconfig, logs]
  get         Gets one of [clusters, nodes, kubeconfig]
  help        Help about any command
  load        Loads images into nodes
  version     Prints the kind CLI version

Flags:
  -h, --help              help for kind
      --loglevel string   DEPRECATED: see -v instead
  -q, --quiet             silence all stderr output
  -v, --verbosity int32   info log verbosity
      --version           version for kind

Use "kind [command] --help" for more information about a command.

```

## 安装单节点集群

> kind create cluster --name=clustername

```bash
❯ kind create cluster --name=one
Creating cluster "one" ...
 ✓ Ensuring node image (kindest/node:v1.21.1) 🖼
 ✓ Preparing nodes 📦  
 ✓ Writing configuration 📜 
 ✓ Starting control-plane 🕹️ 
 ✓ Installing CNI 🔌 
 ✓ Installing StorageClass 💾 
Set kubectl context to "kind-one"
You can now use your cluster with:

kubectl cluster-info --context kind-one

Thanks for using kind! 😊

```

> **tips**：想知命令详情，善用`--help`，如`kind create cluster --help`

### 解析安装过程
- 检查本地环境是否存在一个基础的安装镜像，默认是 kindest/node:v1.21.1，该镜像里面包含了所有需要安装的东西，包括：kubectl、kubeadm、kubelet 的二进制文件，以及安装对应版本 Kubernetes 所需要的镜像。
- 准备 Kubernetes 节点，主要就是启动容器、解压镜像这类的操作。
- 建立对应的 kubeadm 的配置，完成之后就通过 kubeadm 进行安装。安装完成后还会做一些清理操作，比如：删掉主节点上的污点，否则对于没有容忍的 Pod 无法完成部署。
- 上面所有操作都完成后，就成功启动了一个 Kubernetes 集群并输出一些操作集群的提示信息。

> 1.默认情况下，Kind 会先下载 kindest/node:v1.21.1 镜像。如果你想指定不同版本，可以使用 --image 参数，类似这样：kind create cluster --image kindest/node:v1.20.1
2.kindest/node 这个镜像目前托管于 Docker Hub 上，下载时可能会较慢。同样的问题 Kind 进行集群的创建也是存在的，Kind 实际使用 Kubeadm 进行集群的创建。对 Kubeadm 有所了解的同学都知道它默认使用的镜像在国内是不能访问的，所以一样需要自行解决网络问题。
3.如果你存在上面说的网络问题，最好配置一个国内的加速器或者镜像源。如果你还不知道如何配置加速器和镜像源可以参考：[「Docker / Kubernetes 镜像源不可用，教你几招搞定它！」](https://mp.weixin.qq.com/s?__biz=MzI3MTI2NzkxMA==&mid=2247488553&idx=1&sn=14cbe47bc50df50f536345efb4d10b5e&chksm=eac53500ddb2bc16be6bbfe69917895d0feed7c4e85d40450a5adb931ff01257d9f546c58538&token=687022088&lang=zh_CN#rd)和 [「 Docker 下使用 DaoCloud / 阿里云镜像加速」](https://mp.weixin.qq.com/s?__biz=MzI3MTI2NzkxMA==&mid=2247483698&idx=1&sn=dfb6edca74539a9a4d8228495d1c17a0&chksm=eac5201bddb2a90d5f8e6d4733ed2d0ff9466474471933e4ea5d5fc1ef6be15b86470f50eccb&token=21948731&lang=zh_CN#rd)两篇文章。

### 查看集群信息

```bash
❯ kubectl cluster-info
Kubernetes control plane is running at https://127.0.0.1:44899
CoreDNS is running at https://127.0.0.1:44899/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy

To further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.
❯ kubectl get nodes
NAME                STATUS   ROLES                  AGE   VERSION
one-control-plane   Ready    control-plane,master   44m   v1.21.1
❯ kubectl get po -n kube-system
NAME                                        READY   STATUS    RESTARTS   AGE
coredns-558bd4d5db-df46d                    1/1     Running   0          62m
coredns-558bd4d5db-xnlpg                    1/1     Running   0          62m
etcd-one-control-plane                      1/1     Running   0          62m
kindnet-msfm7                               1/1     Running   0          62m
kube-apiserver-one-control-plane            1/1     Running   0          62m
kube-controller-manager-one-control-plane   1/1     Running   0          62m
kube-proxy-zwfjc                            1/1     Running   0          62m
kube-scheduler-one-control-plane            1/1     Running   0          62m
```
若访问集群api报类似"anonymous cannot get path"，参考->https://blog.csdn.net/baidu_38432732/article/details/106469037。

从上面的输出结果，可以看到单节点的 Kubernetes 已经搭建成功。单节点集群默认方式启动的节点类型是 control-plane，该节点包含了所有的组件。
这些组件分别是：2*Coredns、Etcd、Api-Server、Controller-Manager、Kube-Proxy、Sheduler 和网络插件 kindnet

## 安装多节点集群

默认安装的集群只部署了一个控制节点，如果需要部署多节点集群，我们可以通过配置文件的方式来创建多个容器。这样就可以达到模拟多个节点目的，并以这些节点来构建一个多节点的 Kubernetes 集群。

0.创建多节点 Kubernetes 集群配置文件
Kind 在创建集群的时候，支持通过 --config 参数传递配置文件给 Kind，配置文件可修改的内容主要有 role 和 节点使用的镜像。

```bash
> vim my-cluster-multi-node.yaml
# 一共两个节点，一个主节点，一个从节点。
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
- role: worker
```

1.创建多节点 Kubernetes 集群
配置文件创建完成后，就可以使用下面的命令来完成多节点 Kubernetes 集群搭建。

```bash
❯ kind create cluster --config my-cluster-multi-node.yaml --name my-cluster-multi-node
Creating cluster "my-cluster-multi-node" ...
 ✓ Ensuring node image (kindest/node:v1.21.1) 🖼
 ✓ Preparing nodes 📦 📦  
 ✓ Writing configuration 📜 
 ✓ Starting control-plane 🕹️ 
 ✓ Installing CNI 🔌 
 ✓ Installing StorageClass 💾 
 ✓ Joining worker nodes 🚜 
Set kubectl context to "kind-my-cluster-multi-node"
You can now use your cluster with:

kubectl cluster-info --context kind-my-cluster-multi-node

Not sure what to do next? 😅  Check out https://kind.sigs.k8s.io/docs/user/quick-start/

```

### 查看集群信息

```bash
❯ kubectl get nodes
NAME                                  STATUS   ROLES                  AGE     VERSION
my-cluster-multi-node-control-plane   Ready    control-plane,master   7m18s   v1.21.1
my-cluster-multi-node-worker          Ready    <none>                 6m43s   v1.21.1
❯ kubectl get po -n kube-system
NAME                                                          READY   STATUS    RESTARTS   AGE
coredns-558bd4d5db-phwsn                                      1/1     Running   0          7m10s
coredns-558bd4d5db-wzhqc                                      1/1     Running   0          7m10s
etcd-my-cluster-multi-node-control-plane                      1/1     Running   0          7m13s
kindnet-ssx8t                                                 1/1     Running   0          7m10s
kindnet-xmjfh                                                 1/1     Running   0          6m53s
kube-apiserver-my-cluster-multi-node-control-plane            1/1     Running   0          7m13s
kube-controller-manager-my-cluster-multi-node-control-plane   1/1     Running   0          7m13s
kube-proxy-gl2gj                                              1/1     Running   0          7m10s
kube-proxy-vv7vf                                              1/1     Running   0          6m53s
kube-scheduler-my-cluster-multi-node-control-plane            1/1     Running   0          7m13s

```

## 创建高可用 Kubernetes 集群

```bash
> vim vim my-cluster-ha.yaml
# 一共六个节点，三个 control-plane 节点，三个 workers 节点
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
kubeadmConfigPatches:
- |
  apiVersion: kubeadm.k8s.io/v1beta2
  kind: ClusterConfiguration
  metadata:
    name: config
  networking:
    serviceSubnet: 10.0.0.0/16
  imageRepository: registry.aliyuncs.com/google_containers
  nodeRegistration:
    kubeletExtraArgs:
      pod-infra-container-image: registry.aliyuncs.com/google_containers/pause:3.1
- |
  apiVersion: kubeadm.k8s.io/v1beta2
  kind: InitConfiguration
  metadata:
    name: config
  networking:
    serviceSubnet: 10.0.0.0/16
  imageRepository: registry.aliyuncs.com/google_containers
nodes:
- role: control-plane
- role: control-plane
- role: control-plane
- role: worker
- role: worker
- role: worker


❯ kind create cluster --name my-cluster-ha --config my-cluster-ha.yaml
Creating cluster "my-cluster-ha" ...
 ✓ Ensuring node image (kindest/node:v1.21.1) 🖼
 ✓ Preparing nodes 📦 📦 📦 📦 📦 📦  
 ✓ Configuring the external load balancer ⚖️ 
 ✓ Writing configuration 📜 
 ✓ Starting control-plane 🕹️ 
 ✓ Installing CNI 🔌 
 ✓ Installing StorageClass 💾 
 ✓ Joining more control-plane nodes 🎮 
 ✓ Joining worker nodes 🚜 
Set kubectl context to "kind-my-cluster-ha"
You can now use your cluster with:

kubectl cluster-info --context kind-my-cluster-ha

Have a question, bug, or feature request? Let us know! https://kind.sigs.k8s.io/#community 🙂

```

### 查看集群信息

```bash
❯ kubectl get nodes
NAME                           STATUS   ROLES                  AGE     VERSION
my-cluster-ha-control-plane    Ready    control-plane,master   4m53s   v1.21.1
my-cluster-ha-control-plane2   Ready    control-plane,master   4m20s   v1.21.1
my-cluster-ha-control-plane3   Ready    control-plane,master   3m13s   v1.21.1
my-cluster-ha-worker           Ready    <none>                 2m57s   v1.21.1
my-cluster-ha-worker2          Ready    <none>                 2m57s   v1.21.1
my-cluster-ha-worker3          Ready    <none>                 2m57s   v1.21.1

```

## 其它相关知识

### Kind 的镜像里的秘密

Kind 镜像一共分为两类，一类是 Base 镜像，另一类是 Node 镜像。

0.Base 镜像
Base 镜像目前使用了 ubuntu:19.04 作为基础镜像，并做了下面的调整：

- 安装 Systemd 相关的包，并调整一些配置以适应在容器内运行。
- 安装 Kubernetes 运行时的依赖包，比如: Conntrack、Socat、CNI 等。
- 安装容器运行环境，比如: Containerd、Crictl 等。
- 配置自己的 ENTRYPOINT 脚本，以适应和调整容器内运行的问题。

更多具体的构建逻辑可以参考：https://github.com/kubernetes-sigs/kind/blob/master/images/base/Dockerfile

1.Node 镜像
Node 镜像的构建比较复杂，目前是通过运行 Base 镜像并在 Base 镜像内执行操作，再保存此容器内容为镜像的方式来构建的，包含的操作有：

- 构建 Kubernetes 相关资源，比如：二进制文件和镜像。
- 运行一个用于构建的容器
- 把构建的 Kubernetes 相关资源复制到容器里
- 调整部分组件配置参数，以支持在容器内运行
- 预先拉去运行环境需要的镜像
- 通过 docker commit 方式保存当前的构建容器为 Node 镜像

### 如何快速删除一个集群

```bash
❯ kind get clusters
my-cluster-ha
my-cluster-multi-node
one
❯ kind delete cluster --name=one
Deleting cluster "one" ...
❯ kind get clusters
my-cluster-ha
my-cluster-multi-node

```

## 参考
- https://www.hi-linux.com/posts/42332.html
- http://dockone.io/article/8974
- https://cloud-atlas.readthedocs.io/zh_CN/latest/docker/docker_in_docker/kind_multi_node.html
- https://kind.sigs.k8s.io/
- https://blog.csdn.net/baidu_38432732/article/details/106469037
- https://k8s.networkop.co.uk/cni/kindnet/
