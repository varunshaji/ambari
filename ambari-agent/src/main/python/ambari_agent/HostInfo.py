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

import os
import glob
import logging
import re
import time
import subprocess
import threading
import shlex
import platform
import hostname
from PackagesAnalyzer import PackagesAnalyzer
from HostCheckReportFileHandler import HostCheckReportFileHandler
from Hardware import Hardware
from ambari_commons import OSCheck, OSConst, Firewall
import socket
from ambari_commons.os_family_impl import OsFamilyImpl

logger = logging.getLogger()

# service cmd
SERVICE_CMD = "service"


class HostInfo(object):
  # Filters used to identify processed
  PROC_FILTER = [
    "hadoop", "zookeeper"
  ]

  current_umask = -1

  def __init__(self, config=None):
    self.config = config
    self.reportFileHandler = HostCheckReportFileHandler(config)

  def dirType(self, path):
    if not os.path.exists(path):
      return 'not_exist'
    elif os.path.islink(path):
      return 'sym_link'
    elif os.path.isdir(path):
      return 'directory'
    elif os.path.isfile(path):
      return 'file'
    return 'unknown'

  def checkLiveServices(self, services, result):
    osType = OSCheck.get_os_family()
    for service in services:
      svcCheckResult = {}
      if isinstance(service, dict):
        serviceName = service[osType]
      else:
        serviceName = service
      svcCheckResult['name'] = serviceName
      svcCheckResult['status'] = "UNKNOWN"
      svcCheckResult['desc'] = ""
      try:
        out, err, code = self.getServiceStatus(serviceName)
        if 0 != code:
          svcCheckResult['status'] = "Unhealthy"
          svcCheckResult['desc'] = out
          if len(out) == 0:
            svcCheckResult['desc'] = err
        else:
          svcCheckResult['status'] = "Healthy"
      except Exception, e:
        svcCheckResult['status'] = "Unhealthy"
        svcCheckResult['desc'] = repr(e)
      result.append(svcCheckResult)

  def getUMask(self):
    if (self.current_umask == -1):
      self.current_umask = os.umask(self.current_umask)
      os.umask(self.current_umask)
      return self.current_umask
    else:
      return self.current_umask

  def checkReverseLookup(self):
    """
    Check if host fqdn resolves to current host ip
    """
    try:
      host_name = socket.gethostname().lower()
      host_ip = socket.gethostbyname(host_name)
      host_fqdn = socket.getfqdn().lower()
      fqdn_ip = socket.gethostbyname(host_fqdn)
      return host_ip == fqdn_ip
    except socket.error:
      pass
    return False


@OsFamilyImpl(os_family=OsFamilyImpl.DEFAULT)
class HostInfoLinux(HostInfo):
  # List of project names to be used to find alternatives folders etc.
  DEFAULT_PROJECT_NAMES = [
    "hadoop*", "hadoop", "hbase", "hcatalog", "hive", "ganglia",
    "oozie", "sqoop", "hue", "zookeeper", "mapred", "hdfs", "flume",
    "storm", "hive-hcatalog", "tez", "falcon", "ambari_qa", "hadoop_deploy",
    "rrdcached", "hcat", "ambari-qa", "sqoop-ambari-qa", "sqoop-ambari_qa",
    "webhcat", "hadoop-hdfs", "hadoop-yarn", "hadoop-mapreduce"
  ]

  # List of live services checked for on the host, takes a map of plan strings
  DEFAULT_LIVE_SERVICES = [
    {OSConst.REDHAT_FAMILY: "ntpd", OSConst.SUSE_FAMILY: "ntp", OSConst.UBUNTU_FAMILY: "ntp"}
  ]

  # Set of default users (need to be replaced with the configured user names)
  DEFAULT_USERS = [
    "hive", "ambari-qa", "oozie", "hbase", "hcat", "mapred",
    "hdfs", "rrdcached", "zookeeper", "flume", "sqoop", "sqoop2",
    "hue", "yarn", "tez", "storm", "falcon", "kafka", "knox"
  ]

  # Default set of directories that are checked for existence of files and folders
  DEFAULT_DIRS = [
    "/etc", "/var/run", "/var/log", "/usr/lib", "/var/lib", "/var/tmp", "/tmp", "/var", "/hadoop"
  ]

  # Packages that are used to find repos (then repos are used to find other packages)
  PACKAGES = [
    "hadoop_2_2_*", "hadoop-2-2-.*", "zookeeper_2_2_*", "zookeeper-2-2-.*",
    "hadoop", "zookeeper", "webhcat", "*-manager-server-db", "*-manager-daemons"
  ]

  # Additional packages to look for (search packages that start with these)
  ADDITIONAL_PACKAGES = [
    "rrdtool", "rrdtool-python", "ganglia", "gmond", "gweb", "libconfuse",
    "ambari-log4j", "hadoop", "zookeeper", "oozie", "webhcat"
  ]

  # ignore packages from repos whose names start with these strings
  IGNORE_PACKAGES_FROM_REPOS = [
    "ambari", "installed"
  ]

  # ignore required packages
  IGNORE_PACKAGES = [
    "epel-release"
  ]

  # ignore repos from the list of repos to be cleaned
  IGNORE_REPOS = [
    "ambari", "HDP-UTILS"
  ]

  RESULT_UNAVAILABLE = "unable_to_determine"

  DEFAULT_SERVICE_NAME = "ntpd"
  SERVICE_STATUS_CMD = "%s %s status" % (SERVICE_CMD, DEFAULT_SERVICE_NAME)

  THP_FILE = "/sys/kernel/mm/redhat_transparent_hugepage/enabled"

  def __init__(self, config=None):
    super(HostInfoLinux, self).__init__(config)
    self.packages = PackagesAnalyzer()

  def osdiskAvailableSpace(self, path):
    diskInfo = {}
    try:
      df = subprocess.Popen(["df", "-kPT", path], stdout=subprocess.PIPE)
      dfdata = df.communicate()[0]
      return Hardware.extractMountInfo(dfdata.splitlines()[-1])
    except:
      pass
    return diskInfo

  def createAlerts(self, alerts):
    existingUsers = []
    self.checkUsers(self.DEFAULT_USERS, existingUsers)
    dirs = []
    self.checkFolders(self.DEFAULT_DIRS, self.DEFAULT_PROJECT_NAMES, existingUsers, dirs)
    alert = {
      'name': 'host_alert',
      'instance': None,
      'service': 'AMBARI',
      'component': 'host',
      'host': hostname.hostname(self.config),
      'state': 'OK',
      'label': 'Disk space',
      'text': 'Used disk space less than 80%'}
    message = ""
    mountinfoSet = []
    for dir in dirs:
      if dir["type"] == 'directory':
        mountinfo = self.osdiskAvailableSpace(dir['name'])
        if int(mountinfo["percent"].strip('%')) >= 80:
          if not mountinfo in mountinfoSet:
            mountinfoSet.append(mountinfo)
          message += str(dir['name']) + ";\n"

    if message != "":
      message = "These discs have low space:\n" + str(
        mountinfoSet) + "\n They include following critical directories:\n" + message
      alert['state'] = 'WARNING'
      alert['text'] = message
    alerts.append(alert)
    return alerts

  def checkUsers(self, users, results):
    f = open('/etc/passwd', 'r')
    for userLine in f:
      fields = userLine.split(":")
      if fields[0] in users:
        result = {}
        homeDir = fields[5]
        result['name'] = fields[0]
        result['homeDir'] = fields[5]
        result['status'] = "Available"
        if not os.path.exists(homeDir):
          result['status'] = "Invalid home directory"
        results.append(result)

  def checkFolders(self, basePaths, projectNames, existingUsers, dirs):
    foldersToIgnore = []
    for user in existingUsers:
      foldersToIgnore.append(user['homeDir'])
    try:
      for dirName in basePaths:
        for project in projectNames:
          path = os.path.join(dirName.strip(), project.strip())
          if not path in foldersToIgnore and os.path.exists(path):
            obj = {}
            obj['type'] = self.dirType(path)
            obj['name'] = path
            dirs.append(obj)
    except:
      pass

  def javaProcs(self, list):
    import pwd

    try:
      pids = [pid for pid in os.listdir('/proc') if pid.isdigit()]
      for pid in pids:
        cmd = open(os.path.join('/proc', pid, 'cmdline'), 'rb').read()
        cmd = cmd.replace('\0', ' ')
        if not 'AmbariServer' in cmd:
          if 'java' in cmd:
            dict = {}
            dict['pid'] = int(pid)
            dict['hadoop'] = False
            for filter in self.PROC_FILTER:
              if filter in cmd:
                dict['hadoop'] = True
            dict['command'] = cmd.strip()
            for line in open(os.path.join('/proc', pid, 'status')):
              if line.startswith('Uid:'):
                uid = int(line.split()[1])
                dict['user'] = pwd.getpwuid(uid).pw_name
            list.append(dict)
    except:
      pass
    pass

  def getReposToRemove(self, repos, ignoreList):
    reposToRemove = []
    for repo in repos:
      addToRemoveList = True
      for ignoreRepo in ignoreList:
        if self.packages.nameMatch(ignoreRepo, repo):
          addToRemoveList = False
          continue
      if addToRemoveList:
        reposToRemove.append(repo)
    return reposToRemove

  def getTransparentHugePage(self):
    # This file exist only on redhat 6
    thp_regex = "\[(.+)\]"
    if os.path.isfile(self.THP_FILE):
      with open(self.THP_FILE) as f:
        file_content = f.read()
        return re.search(thp_regex, file_content).groups()[0]
    else:
      return ""

  def checkIptables(self):
    return Firewall().getFirewallObject().check_iptables()

  def hadoopVarRunCount(self):
    if not os.path.exists('/var/run/hadoop'):
      return 0
    pids = glob.glob('/var/run/hadoop/*/*.pid')
    return len(pids)

  def hadoopVarLogCount(self):
    if not os.path.exists('/var/log/hadoop'):
      return 0
    logs = glob.glob('/var/log/hadoop/*/*.log')
    return len(logs)

  def etcAlternativesConf(self, projects, etcResults):
    if not os.path.exists('/etc/alternatives'):
      return []
    projectRegex = "'" + '|'.join(projects) + "'"
    files = [f for f in os.listdir('/etc/alternatives') if re.match(projectRegex, f)]
    for conf in files:
      result = {}
      filePath = os.path.join('/etc/alternatives', conf)
      if os.path.islink(filePath):
        realConf = os.path.realpath(filePath)
        result['name'] = conf
        result['target'] = realConf
        etcResults.append(result)

  def register(self, dict, componentsMapped=True, commandsInProgress=True):
    """ Return various details about the host
    componentsMapped: indicates if any components are mapped to this host
    commandsInProgress: indicates if any commands are in progress
    """

    dict['hostHealth'] = {}

    java = []
    self.javaProcs(java)
    dict['hostHealth']['activeJavaProcs'] = java

    liveSvcs = []
    self.checkLiveServices(self.DEFAULT_LIVE_SERVICES, liveSvcs)
    dict['hostHealth']['liveServices'] = liveSvcs

    dict['umask'] = str(self.getUMask())

    dict['transparentHugePage'] = self.getTransparentHugePage()
    dict['iptablesIsRunning'] = self.checkIptables()
    dict['reverseLookup'] = self.checkReverseLookup()
    # If commands are in progress or components are already mapped to this host
    # Then do not perform certain expensive host checks
    if componentsMapped or commandsInProgress:
      dict['existingRepos'] = [self.RESULT_UNAVAILABLE]
      dict['installedPackages'] = []
      dict['alternatives'] = []
      dict['stackFoldersAndFiles'] = []
      dict['existingUsers'] = []

    else:
      etcs = []
      self.etcAlternativesConf(self.DEFAULT_PROJECT_NAMES, etcs)
      dict['alternatives'] = etcs

      existingUsers = []
      self.checkUsers(self.DEFAULT_USERS, existingUsers)
      dict['existingUsers'] = existingUsers

      dirs = []
      self.checkFolders(self.DEFAULT_DIRS, self.DEFAULT_PROJECT_NAMES, existingUsers, dirs)
      dict['stackFoldersAndFiles'] = dirs

      installedPackages = []
      availablePackages = []
      self.packages.allInstalledPackages(installedPackages)
      self.packages.allAvailablePackages(availablePackages)

      repos = []
      self.packages.getInstalledRepos(self.PACKAGES, installedPackages + availablePackages,
                                      self.IGNORE_PACKAGES_FROM_REPOS, repos)
      packagesInstalled = self.packages.getInstalledPkgsByRepo(repos, self.IGNORE_PACKAGES, installedPackages)
      additionalPkgsInstalled = self.packages.getInstalledPkgsByNames(
        self.ADDITIONAL_PACKAGES, installedPackages)
      allPackages = list(set(packagesInstalled + additionalPkgsInstalled))
      dict['installedPackages'] = self.packages.getPackageDetails(installedPackages, allPackages)

      repos = self.getReposToRemove(repos, self.IGNORE_REPOS)
      dict['existingRepos'] = repos

      self.reportFileHandler.writeHostCheckFile(dict)
      pass

    # The time stamp must be recorded at the end
    dict['hostHealth']['agentTimeStampAtReporting'] = int(time.time() * 1000)

    pass

  def getServiceStatus(self, serivce_name):
    service_check_live = shlex.split(self.SERVICE_STATUS_CMD)
    service_check_live[1] = serivce_name
    osStat = subprocess.Popen(service_check_live, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE)
    out, err = osStat.communicate()
    return out, err, osStat.returncode


@OsFamilyImpl(os_family=OSConst.WINSRV_FAMILY)
class HostInfoWindows(HostInfo):
  SERVICE_STATUS_CMD = 'If ((Get-Service | Where-Object {{$_.Name -eq \'{0}\'}}).Status -eq \'Running\') {{echo "Running"; $host.SetShouldExit(0)}} Else {{echo "Stopped"; $host.SetShouldExit(1)}}'
  GET_USERS_CMD = '$accounts=(Get-WmiObject -Class Win32_UserAccount -Namespace "root\cimv2" -Filter "LocalAccount=\'$True\'" -ComputerName "LocalHost" -ErrorAction Stop); foreach ($acc in $accounts) {echo $acc.Name}'
  GET_JAVA_PROC_CMD = 'foreach ($process in (gwmi Win32_Process -Filter "name = \'java.exe\'")){echo $process.ProcessId;echo $process.CommandLine; echo $process.GetOwner().User}'
  DEFAULT_LIVE_SERVICES = [
    {OSConst.WINSRV_FAMILY: "W32Time"}
  ]
  def checkUsers(self, users, results):
    get_users_cmd = ["powershell", '-noProfile', '-NonInteractive', '-nologo', "-Command", self.GET_USERS_CMD]
    try:
      osStat = subprocess.Popen(get_users_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
      out, err = osStat.communicate()
    except:
      raise Exception("Failed to get users.")
    for user in out.split(os.linesep):
      if user in users:
        result = {}
        result['name'] = user
        result['status'] = "Available"
        results.append(result)

  def checkIptables(self):
    from ambari_commons.os_windows import run_powershell_script, CHECK_FIREWALL_SCRIPT

    out = run_powershell_script(CHECK_FIREWALL_SCRIPT)
    if out[0] != 0:
      logger.warn("Unable to check firewall status:{0}".format(out[2]))
      return False
    profiles_status = [i for i in out[1].split("\n") if not i == ""]
    if "1" in profiles_status:
      return True
    return False

  def createAlerts(self, alerts):
    # TODO AMBARI-7849 Implement createAlerts for Windows
    return alerts

  def javaProcs(self, list):
    try:
      from ambari_commons.os_windows import run_powershell_script

      code, out, err = run_powershell_script(self.GET_JAVA_PROC_CMD)
      if code == 0:
        splitted_output = out.split(os.linesep)
        for i in [index for index in range(0, len(splitted_output)) if (index % 3) == 0]:
          pid = splitted_output[i]
          cmd = splitted_output[i + 1]
          user = splitted_output[i + 2]
          if not 'AmbariServer' in cmd:
            if 'java' in cmd:
              dict = {}
              dict['pid'] = int(pid)
              dict['hadoop'] = False
              for filter in self.PROC_FILTER:
                if filter in cmd:
                  dict['hadoop'] = True
              dict['command'] = cmd.strip()
              dict['user'] = user
              list.append(dict)
    except Exception as e:
      pass
    pass

  def getServiceStatus(self, serivce_name):
    from ambari_commons.os_windows import run_powershell_script
    code, out, err = run_powershell_script(self.SERVICE_STATUS_CMD.format(serivce_name))
    return out, err, code

  def register(self, dict, componentsMapped=True, commandsInProgress=True):
    """ Return various details about the host
    componentsMapped: indicates if any components are mapped to this host
    commandsInProgress: indicates if any commands are in progress
    """
    dict['hostHealth'] = {}

    java = []
    self.javaProcs(java)
    dict['hostHealth']['activeJavaProcs'] = java

    liveSvcs = []
    self.checkLiveServices(self.DEFAULT_LIVE_SERVICES, liveSvcs)
    dict['hostHealth']['liveServices'] = liveSvcs

    dict['umask'] = str(self.getUMask())

    dict['iptablesIsRunning'] = self.checkIptables()
    dict['reverseLookup'] = self.checkReverseLookup()
    # If commands are in progress or components are already mapped to this host
    # Then do not perform certain expensive host checks
    if componentsMapped or commandsInProgress:
      dict['existingRepos'] = [self.RESULT_UNAVAILABLE]
      dict['installedPackages'] = []
      dict['alternatives'] = []
      dict['stackFoldersAndFiles'] = []
      dict['existingUsers'] = []
    else:
      existingUsers = []
      self.checkUsers(self.DEFAULT_USERS, existingUsers)
      dict['existingUsers'] = existingUsers
      # TODO check HDP stack and folders here
      self.reportFileHandler.writeHostCheckFile(dict)
      pass

    # The time stamp must be recorded at the end
    dict['hostHealth']['agentTimeStampAtReporting'] = int(time.time() * 1000)



def main(argv=None):
  h = HostInfo()
  struct = {}
  h.register(struct)
  print struct


if __name__ == '__main__':
  main()
