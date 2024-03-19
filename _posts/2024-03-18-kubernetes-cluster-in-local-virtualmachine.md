---
title: Kubernetes Cluster using Vagrant virtual machine
date: 2024-03-18 12:00:00 -500
categories: [kubernetes]
tags: [vmclusters, kubernetes, multinodes, vagrant]
---
### **Setting Up a Kubernetes Cluster with Vagrant:** <br>
<p>This webpage provides a comprehensive guide detailing the process of setting up a Kubernetes cluster on virtual machines using Vagrant.<br>
The setup includes one master node and two worker nodes, ensuring a robust foundation for your Kubernetes environment.</p>

### **Prerequisite Software:** <br>
Before setting up the Kubernetes cluster, ensure you have the following software installed:<br>
- Vagrant: Download Vagrant from [Click here](https://developer.hashicorp.com/vagrant/downloads).<br>
- Oracle VM VirtualBox: Download Oracle VM VirtualBox from [Click here](https://www.virtualbox.org/wiki/Downloads).<br>

### **Steps for creating master and worker nodes using Vagrant VMs:** <br>
- Open command-line and run the following command, which will create a new file:
```go
	  vagrant init
```
- Update the content of the Vagrantfile with the following code, which will create a master and 2 worker nodes
```go
	# -*- mode: ruby -*-
	# vi: set ft=ruby :
	Vagrant.configure("2") do |config|
	  config.vm.provision "shell", inline: "echo Hello"
	  config.vm.box = "bento/ubuntu-22.04"
	  config.vm.define "master" do |master|
	    master.vm.network "private_network", ip: "192.168.50.4"
		master.vm.network "forwarded_port", guest: 8001, host: 8000, guest_ip: "192.168.50.4"
	    master.vm.provider "virtualbox" do |vb|
	        vb.gui = false
	        vb.name = "master"
	        vb.memory = 4096
	        vb.cpus = 4
	    end
	  end
	  config.vm.define "node1" do |node1|
	    node1.vm.network "private_network", ip: "192.168.50.6"
	    node1.vm.provider "virtualbox" do |vb|
			
	        vb.gui = false
	        vb.name = "node1"
	        vb.memory = 1024
	        vb.cpus = 2
	    end
	  end
	
	  config.vm.define "node2" do |node2|
	    node2.vm.network "private_network", ip: "192.168.50.8"
	    node2.vm.provider "virtualbox" do |vb|
	        vb.gui = false
	        vb.name = "node2"
	        vb.memory = 1024
	        vb.cpus = 2
	    end
	  end
	end
```
- Run the following command to start and configure the nodes, this will take some time to spin up the virtual machines
```go
	vagrant up
```
- login to each VM and disable swap ( because as per "The default behavior of a kubelet was to fail to start if swap memory was detected on a node")
```sh
	#To login into the VM
	vagrant ssh master
	#once logged in
	sudo vi /etc/fstab
	#Disable the line that starts with swap, this will disable the swap settings in the node
	#/swap.img      none    swap    sw      0       0
	
	#Change the name of the hostname to differentiate each VM easily
	sudo vi /etc/hostname
	#Change it to "master" when working on master node, for other nodes change it to node1 and node2 respectively.
	master
	
	#Restart the VM to make sure that the changes take effect
	sudo reboot
	#Repeat this on **ALL** other VMs as well.
```
- Once the VMs are up, we are ready to install containerd, kubeadm, kubectl and kubelet
### **Steps for installing runtime container runtime for this we will install containerd (Run the following on all VMs master, node1 and node2):** <br>
##### **pre-requisites**
- Forwarding IPV4 and letting iptables see bridged traffic
```sh
	cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
	overlay
	br_netfilter
	EOF
	
	sudo modprobe overlay
	sudo modprobe br_netfilter
	
	# sysctl params required by setup, params persist across reboots
	cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
	net.bridge.bridge-nf-call-iptables  = 1
	net.bridge.bridge-nf-call-ip6tables = 1
	net.ipv4.ip_forward                 = 1
	EOF
	
	# Apply sysctl params without reboot
	sudo sysctl --system
```
- Verify the following modules are loaded
```sh
	lsmod | grep br_netfilter
	lsmod | grep overlay
```
- Verify the following system vars are set to 1
```sh
	sysctl net.bridge.bridge-nf-call-iptables net.bridge.bridge-nf-call-ip6tables net.ipv4.ip_forward
```
##### **containerd installation**
```sh
	# Switch to root so that you are not asked password everytime
	sudo su
	# Download and extract the containerd archive under /usr/local
	wget https://github.com/containerd/containerd/releases/download/v1.7.14/containerd-1.7.14-linux-amd64.tar.gz
	tar Cxzvf /usr/local containerd-1.7.14-linux-amd64.tar.gz
	# To start containerd via systemd download containerd.service
	cd /usr/local/lib/systemd/system/ #Create folder if not present already
	wget https://raw.githubusercontent.com/containerd/containerd/main/containerd.service
	#Restart daemon and enable containerd
	systemctl daemon-reload
	systemctl enable --now containerd
	#Install runc
	wget https://github.com/opencontainers/runc/releases/download/v1.1.12/runc.amd64
	install -m 755 runc.amd64 /usr/local/sbin/runc
	#Install CNI plugins
	mkdir -p /opt/cni/bin
	wget https://github.com/containernetworking/plugins/releases/download/v1.4.1/cni-plugins-linux-amd64-v1.4.1.tgz
	tar Cxzvf /opt/cni/bin cni-plugins-linux-amd64-v1.4.1.tgz
	#Configuring the systemd cgroup driver, export the existing configuration and update it
	mkdir -p /etc/containerd/
	containerd config default > /etc/containerd/config.toml
	vi /etc/containerd/config.toml
	#Search for in the config file [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
	#Enable SystemdCgroup = true
	SystemdCgroup = true
	#Restart containerd
	sudo systemctl restart containerd
```
### **Steps for installing kubeadm, kubelet and kubectl (Run the following on all VMs master, node1 and node2):** <br>
```sh
	sudo apt-get update
	# apt-transport-https may be a dummy package; if so, you can skip that package
	sudo apt-get install -y apt-transport-https ca-certificates curl gpg
	# If the directory `/etc/apt/keyrings` does not exist, it should be created before the curl command, read the note below.
	# sudo mkdir -p -m 755 /etc/apt/keyrings
	curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.29/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
	# This overwrites any existing configuration in /etc/apt/sources.list.d/kubernetes.list
	echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
	sudo apt-get update
	sudo apt-get install -y kubelet kubeadm kubectl
	sudo apt-mark hold kubelet kubeadm kubectl
	sudo systemctl enable --now kubelet
	# This will ensure that each node will have different InternalIPs, else you will see same IP for all the nodes
	cd /etc/default/
	sudo vi kubelet
	# Add the following line in the file, in master add KUBELET_KUBEADM_ARGS="--node-ip=192.168.50.4" in node1 add KUBELET_KUBEADM_ARGS="--node-ip=192.168.50.6" and node2 add KUBELET_KUBEADM_ARGS="--node-ip=192.168.50.8"
	KUBELET_KUBEADM_ARGS="--node-ip=192.168.50.4"
	#Reload and restart daemon and kubelet
	sudo systemctl daemon-reload && systemctl restart kubelet
```
### **Steps for initializing control-plane node (Run the following only on master):** <br>
- Initializing the control-plane master node
```sh
	 sudo kubeadm init --apiserver-advertise-address=192.168.50.4 --pod-network-cidr=10.244.0.0/16
```
- Once you run the command you will see something like below in the response
```sh
	Your Kubernetes control-plane has initialized successfully!
	
	To start using your cluster, you need to run the following as a regular user:
	
	  mkdir -p $HOME/.kube
	  sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
	  sudo chown $(id -u):$(id -g) $HOME/.kube/config
	
	You should now deploy a Pod network to the cluster.
	Run "kubectl apply -f [podnetwork].yaml" with one of the options listed at:
	  /docs/concepts/cluster-administration/addons/
	
	You can now join any number of machines by running the following on each node
	as root:
	
	  kubeadm join <control-plane-host>:<control-plane-port> --token <token> --discovery-token-ca-cert-hash sha256:<hash>
```
- Create the directory and cp the kubeconfig file
```
	mkdir -p $HOME/.kube
	sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
	sudo chown $(id -u):$(id -g) $HOME/.kube/config
```
- Let's install weave net pod network [here ](https://kubernetes.io/docs/concepts/cluster-administration/addons/)
```
	kubectl apply -f https://reweave.azurewebsites.net/k8s/v1.28/net.yaml
```
- Once installed you will need to update the weave-net daemon set the range of IP addresses used by Weave Net and the subnet they are placed in, <br> by adding new env var called IPALLOC_RANGE and value as the pod-network-cidr (in weave container) set during control-plane initialization
```
kubectl -n kube-system edit ds weave-net
```
```
    spec:
      containers:
      - command:
        - /home/weave/launch.sh
        env:
        - name: IPALLOC_RANGE
          value: 10.244.0.0/16 #This cidr range is same as the pod-network-cidr
```
- This will restart the daemonset and will take few seconds.
### **Steps for joining the worker nodes to cluster (Run following on node1 and node2):** <br>
- Copy the response from the master node when you ran the kubectl init command and paste it on both worker nodes
```
	kubeadm join <control-plane-host>:<control-plane-port> --token <token> --discovery-token-ca-cert-hash sha256:<hash>
```
- Test from master node, you should see both nodes in the cluster now
```sh
	kubectl get nodes
```
![get-nodes](/assets/images/get-nodes.png)
![get-pods](/assets/images/get-pods.png)

#### **That's it congratulations on setting up your own Kubernetes cluster, try creating your own apps/pods and trying running them**

##### References
- [Kubernetes Documentation](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/)
