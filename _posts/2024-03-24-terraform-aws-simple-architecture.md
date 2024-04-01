---
title: AWS single AZ architecture using Terraform
date: 2024-03-24
categories: [AWS, Architecture]
tags: [vpc, subnets, security groups, routing table, internet gateway]
---

### We are going to create the following architecture using Terraform
![alt text](../assets/images/aws/terraform-aws/Terraform_AWS_Single_AZ.png)

My setup includes:

### Virtual Private Cloud (VPC) 🌐

- **What is it?** It's like your own private piece of the internet!
- **Features:** Default tenancy, nice and spacious at `10.0.0.0/16`
- **Tags:** Created with love by Terraform 😊

```tf
resource "aws_vpc" "main" {
  cidr_block       = "10.0.0.0/16"
  instance_tenancy = "default"

  tags = merge(local.all_tags, tomap({ Name = "main" }))
}
```
### Subnets 🔌

- **Private Subnet:** A cozy corner for my private stuff
- **Public Subnet:** Where the world can peek in (but not too much!)

```tf
resource "aws_subnet" "private-subnet" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = var.az[0]
  tags              = merge(local.all_tags, tomap({ Name = "private-subnet" }))
}

resource "aws_subnet" "public-subnet" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = var.az[0]
  tags              = merge(local.all_tags, tomap({ Name = "public-subnet" }))
}
```

### Gateways and Routes 🛣️

- **Internet Gateway:** My bridge to the big, wide internet 🌍
- **NAT Gateway:** Secretly lets private stuff talk to the internet 😎
- **Route Tables:** Making sure my traffic goes where it should 🚦

```tf
resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.all_tags, tomap({ Name = "gw" }))
}
resource "aws_eip" "ngw-ip" {
  domain   = "vpc"
}

resource "aws_nat_gateway" "ngw" {
  allocation_id = aws_eip.ngw-ip.allocation_id
  subnet_id     = aws_subnet.public-subnet.id

  tags              = merge(local.all_tags, tomap({ Name = "ngw" }))

  # To ensure proper ordering, it is recommended to add an explicit dependency
  # on the Internet Gateway for the VPC.
  depends_on = [aws_internet_gateway.gw]
}
resource "aws_route_table" "private-route-table" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "10.0.0.0/16"
    gateway_id = "local"
  }

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_nat_gateway.ngw.id
  }

  tags = merge(local.all_tags, tomap({ Name = "private-route-table" }))
}

resource "aws_route_table" "public-route-table" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "10.0.0.0/16"
    gateway_id = "local"
  }
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.gw.id
  }
  tags = merge(local.all_tags, tomap({ Name = "public-route-table" }))
}

resource "aws_route_table_association" "private-route-asso" {
  subnet_id      = aws_subnet.private-subnet.id
  route_table_id = aws_route_table.private-route-table.id

}

resource "aws_route_table_association" "public-route-asso" {
  subnet_id      = aws_subnet.public-subnet.id
  route_table_id = aws_route_table.public-route-table.id
}
```

### Instances 💻

- **Private EC2 Instance:** My workhorse for private tasks 🛠️
- **Bastian EC2 Instance:** Meet my friendly public face! 🤖

```tf
data "aws_ami" "amazon-linux" {
  most_recent = true
  # name_regex = "^ami-0748249a1ffd1b4d2"
  filter {
    name = "image-id"
    values = ["ami-0748249a1ffd1b4d2"]
  }
}

resource "aws_instance" "private-ec2" {
  ami                    = data.aws_ami.amazon-linux.id
  instance_type          = "t2.micro"
  subnet_id              = aws_subnet.private-subnet.id
  vpc_security_group_ids = [aws_security_group.private-ec2-sg.id]
  user_data              = file("user-data.sh")
  tags                   = merge(local.all_tags, tomap({ Name = "private-ec2" }))
}
resource "aws_instance" "bastian" {
  ami                    = data.aws_ami.amazon-linux.id
  instance_type          = "t2.micro"
  subnet_id              = aws_subnet.public-subnet.id
  vpc_security_group_ids = [aws_security_group.bastian-ec2-sg.id]
  tags                   = merge(local.all_tags, tomap({ Name = "bastian" }))
  key_name               = aws_key_pair.key.key_name
  provisioner "local-exec" {
    command = "chmod 600 ${local_file.private_key_pem.filename}"
  }

}
resource "aws_eip" "ec2-bastian-eip" {
  instance = aws_instance.bastian.id
  domain   = "vpc"
}
```

### Security Stuff 🔒

- **Security Groups:** Like bouncers for my instances 🕶️
- **Key Pair:** My secret key to access the instances 🔑

```tf
resource "aws_security_group" "private-ec2-sg" {
  name        = "private-ec2-sg"
  description = "Allow HTTP traffic"
  vpc_id      = aws_vpc.main.id

  tags = merge(local.all_tags, tomap({ Name = "private-ec2-sg" }))
}

resource "aws_vpc_security_group_ingress_rule" "allow_http_ipv4" {
  security_group_id = aws_security_group.private-ec2-sg.id
  cidr_ipv4         = aws_vpc.main.cidr_block
  from_port         = 80
  ip_protocol       = "tcp"
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "allow_all_traffic_ipv4" {
  security_group_id = aws_security_group.private-ec2-sg.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1" # semantically equivalent to all ports
}

resource "aws_key_pair" "key" {
  public_key = tls_private_key.rsa-2046-bastian.public_key_openssh
  key_name   = "AWSKey"
}
resource "aws_security_group" "bastian-ec2-sg" {
  name        = "bastian-ec2-sg"
  description = "Allow ssh traffic"
  vpc_id      = aws_vpc.main.id
  tags        = merge(local.all_tags, tomap({ Name = "bastian-ec2-sg" }))
}

resource "aws_vpc_security_group_ingress_rule" "bastian-ssh" {
  security_group_id = aws_security_group.bastian-ec2-sg.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 22
  ip_protocol       = "tcp"
  to_port           = 22
}

resource "aws_vpc_security_group_egress_rule" "bastian-all-traffic" {
  security_group_id = aws_security_group.bastian-ec2-sg.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1" # semantically equivalent to all ports
}
```
## Fun Extras 🎉

- **TLS Private Key:** It's a secret... shh! 🤫
- **Elastic IP:** Gives my Bastian instance a cool, fixed address 🌟
- **Private Key PEM File:** A secret file just for me! 📜

```tf
# RSA key of size 4096 bits
resource "tls_private_key" "rsa-2046-bastian" {
  algorithm = "RSA"
  rsa_bits  = 2046
}
resource "local_file" "private_key_pem" {
  content  = tls_private_key.rsa-2046-bastian.private_key_pem
  filename = "AWSKey.pem"
}
```
## Usage 🛠️

To apply this infrastructure setup to your system, follow these steps:

1. **Clone the Repository:** Start by cloning this repository to your local machine. 📥

2. **Set Up AWS Credentials:** Ensure you have AWS credentials configured on your system, either by exporting them as environment variables or using AWS CLI configuration. 🔑

3. **Customize Configuration:** Modify the `terraform.tfvars` file to match your requirements, including region and availability zones. 🛠️

4. **Initialize Terraform:** Run `terraform init` in your terminal to initialize Terraform and download necessary plugins. 🔄

5. **Preview Changes:** Use `terraform plan` to see what Terraform plans to create, modify, or destroy. 📝

6. **Apply Changes:** Once satisfied with the plan, execute `terraform apply` to create the infrastructure on AWS. 🚀

7. **Enjoy Your AWS Setup:** Voila! Your AWS infrastructure is now up and running. 🎉

8. **SSH into the Public Bastian Host:** Use the public IP printed in the output to SSH into the Bastian EC2 instance. 🖥️

9. **Get the Private IP of the Host in the Private Subnet:** Once logged into the Bastian instance, retrieve the private IP address of the host in the private subnet. 🕵️‍♂️

10. **Download index.html Using Wget:** Try using wget to download the index.html file from the private IP address. You should see the file downloaded onto the Bastian instance. (Example: `wget private_ip:80`) 📥

Remember to manage your infrastructure responsibly and destroy resources when they are no longer needed to avoid unnecessary costs. ♻️

That's it! Have fun exploring my awesome setup! If you need anything, just give me a shout! 😊

## If you need the repository access to make it easy, please find the repo link below (With detailed instructions):
[GITHUB](https://github.com/erom-teknas/Terraform-single-az)
