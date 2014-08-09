#!/usr/bin/env python

'''
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
'''
import time
import sys
from threading import Thread


def write_function(path, handle, interval):
  with open(path) as f:
      for line in f:
          handle.write(line)
          handle.flush()
          time.sleep(interval)
          
thread = Thread(target =  write_function, args = ('balancer.log', sys.stdout, 1))
thread.start()

threaderr = Thread(target =  write_function, args = ('balancer-err.log', sys.stderr, 0.3))
threaderr.start()

thread.join()  


def rebalancer_out():
  write_function('balancer.log', sys.stdout)
  
def rebalancer_err():
  write_function('balancer-err.log', sys.stdout)