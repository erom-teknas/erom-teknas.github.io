---
title: Understanding Network IPv4, Subnet masking, CIDR basics
date: 2024-03-20
categories: [AWS]
tags: [subnets, cidr, IP, basics]
---
### **Lets understand the structure of IPv4 address** <br>
<p> IPv4 address looks something like this 192.23.9.0, this represents the decimal notation of IP address.<br>
Each part of the address is binary octet (i.e. 8 values that can be either 0 or 1)</p>

IPv4 is represented in 32 bit form hence 4 parts with 8 (octets) bits each and in binary form each part is represented as 

 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 
---|---|---|---|---|---|---|---|
128|64|32|16|8|4|2|1

So let's break down 192.23.0.9 based on the above mentioned logic:<br>


Part|Octet
---|---
192| 1 1 0 0 0 0 0 0
23|0 0 0 1 0 1 1 1
9|0 0 0 0 1 0 0 1
0|0 0 0 0 0 0 0 0

The above section is important to understand what subnet masking is.<br>

### **Now, let's see how to identify the Network ID and Host ID from IP** <br>

Considering our example IP address, let us divide it into network ID and host ID like below:<br>
<html>
<style type="text/css">
.tg  {border-collapse:collapse;border-spacing:0;}
.tg td{border-color:black;border-style:solid;border-width:1px;font-family:Arial, sans-serif;font-size:14px;
  overflow:hidden;padding:10px 5px;word-break:normal;}
.tg th{border-color:black;border-style:solid;border-width:1px;font-family:Arial, sans-serif;font-size:14px;
  font-weight:normal;overflow:hidden;padding:10px 5px;word-break:normal;}
.tg .tg-0pky{border-color:inherit;text-align:left;vertical-align:top}
</style>
<table class="tg">
<thead>
  <tr>
    <th class="tg-0pky" colspan="3">Network ID</th>
    <th class="tg-0pky">Host ID</th>
  </tr>
</thead>
<tbody>
  <tr>
    <td class="tg-0pky">192</td>
    <td class="tg-0pky">23</td>
    <td class="tg-0pky">9</td>
    <td class="tg-0pky">0</td>
  </tr>
</tbody>
</table>
</html>
<br>
Now, how did we come to know what is the Network ID and Host ID, that's where the subnet masking comes into picture, so if our subnet mask is:<br>

| 255 | 255 | 255 | 0 |

<p>
This means that first 3 parts of the IP address are all 1s in the octet 
and hence cant be changed and that is the network ID.<br>
The last octect is 0 that means that's the host ID, i.e. each machine with in the network will have a different host ID.<br>
So, this is /24 subnet mask as the first 3 octets are fixed and only the last octet can change. <br>
This means our network and subnet mask can be written as  192.23.9.0/24 (This representation is also called the CIDR, Classless Interdomain Routing), that means there are going to be 0 to 255 host machines that can be part of the this network. <br>
however, in general you dont have all 255 as host IDs, we get 254 host IDs, as the last part i.e. 255 is used as the boardcasting ID.
So, we will have host addresses from 192.23.9.1 to 192.23.9.254
</p>
