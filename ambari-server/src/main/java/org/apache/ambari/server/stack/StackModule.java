/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.apache.ambari.server.stack;

import org.apache.ambari.server.AmbariException;
import org.apache.ambari.server.api.services.AmbariMetaInfo;
import org.apache.ambari.server.state.RepositoryInfo;
import org.apache.ambari.server.state.ServiceInfo;
import org.apache.ambari.server.state.StackInfo;
import org.apache.ambari.server.state.stack.RepositoryXml;
import org.apache.ambari.server.state.stack.ServiceMetainfoXml;
import org.apache.ambari.server.state.stack.StackMetainfoXml;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Stack module which provides all functionality related to parsing and fully
 * resolving stacks from the stack definition.
 *
 * <p>
 * Each stack node is identified by name and version, contains service and configuration
 * child nodes and may extend a single parent stack.
 * </p>
 *
 * <p>
 * Resolution of a stack is a depth first traversal up the inheritance chain where each stack node
 * calls resolve on its parent before resolving itself.  After the parent resolve call returns, all
 * ancestors in the inheritance tree are fully resolved.  The act of resolving the stack includes
 * resolution of the configuration and services children of the stack as well as merging of other stack
 * state with the fully resolved parent.
 * </p>
 *
 * <p>
 * Configuration child node resolution involves merging configuration types, properties and attributes
 * with the fully resolved parent.
 * </p>
 *
 * <p>
 * Because a service may explicitly extend another service in a stack outside of the inheritance tree,
 * service child node resolution involves a depth first resolution of the stack associated with the
 * services explicit parent, if any.  This follows the same steps defined above fore stack node
 * resolution.  After the services explicit parent is fully resolved, the services state is merged
 * with it's parent.
 * </p>
 *
 * <p>
 * If a cycle in a stack definition is detected, an exception is thrown from the resolve call.
 * </p>
 *
 */
public class StackModule extends BaseModule<StackModule, StackInfo> {
  /**
   * Visitation state enum used for cycle detection
   */
  public enum State { INIT, VISITED, RESOLVED }

  /**
   * Visitation state of the stack
   */
  private State resolutionState = State.INIT;

  /**
   * Context which provides access to external functionality
   */
  private StackContext stackContext;

  /**
   * Map of child configuration modules keyed by configuration type
   */
  private Map<String, ConfigurationModule> configurationModules = new HashMap<String, ConfigurationModule>();

  /**
   * Map of child service modules keyed by service name
   */
  private Map<String, ServiceModule> serviceModules = new HashMap<String, ServiceModule>();

  /**
   * Corresponding StackInfo instance
   */
  private StackInfo stackInfo;

  /**
   * Encapsulates IO operations on stack directory
   */
  private StackDirectory stackDirectory;

  /**
   * Stack id which is in the form stackName:stackVersion
   */
  private String id;

  /**
   * Logger
   */
  private final static Logger LOG = LoggerFactory.getLogger(StackModule.class);

  /**
   * Constructor.
   * @param stackDirectory  represents stack directory
   * @param stackContext    general stack context
   */
  public StackModule(StackDirectory stackDirectory, StackContext stackContext) {
    this.stackDirectory = stackDirectory;
    this.stackContext = stackContext;
    this.stackInfo = new StackInfo();
    populateStackInfo();
  }

  /**
   * Fully resolve the stack. See stack resolution description in the class documentation.
   * If the stack has a parent, this stack will be merged against its fully resolved parent
   * if one is specified.Merging applies to all stack state including child service and
   * configuration modules.  Services may extend a service in another version in the
   * same stack hierarchy or may explicitly extend a service in a stack in a different
   * hierarchy.
   *
   * @param parentModule  not used.  Each stack determines its own parent since stacks don't
   *                      have containing modules
   * @param allStacks     all stacks modules contained in the stack definition
   *
   * @throws AmbariException if an exception occurs during stack resolution
   */
  @Override
  public void resolve(StackModule parentModule, Map<String, StackModule> allStacks) throws AmbariException {
    resolutionState = State.VISITED;
    String parentVersion = stackInfo.getParentStackVersion();
    // merge with parent version of same stack definition
    if (parentVersion != null) {
      mergeStackWithParent(allStacks, parentVersion);
    }
    mergeServicesWithExplicitParent(allStacks);
    processRepositories();
    resolutionState = State.RESOLVED;

    finalizeModule();
  }

  @Override
  public StackInfo getModuleInfo() {
    return stackInfo;
  }

  @Override
  public boolean isDeleted() {
    return false;
  }

  @Override
  public String getId() {
    return id;
  }

  @Override
  public void finalizeModule() {
    finalizeChildModules(serviceModules.values());
    finalizeChildModules(configurationModules.values());
  }

  /**
   * Get the associated stack directory.
   *
   * @return associated stack directory
   */
  public StackDirectory getStackDirectory() {
    return stackDirectory;
  }

  /**
   * Stack resolution state.
   * Initial state is INIT.
   * When resolve is called state is set to VISITED.
   * When resolve completes, state is set to RESOLVED.
   *
   * @return the stacks resolution state
   */
  public State getResolutionState() {
    return resolutionState;
  }

  /**
   * Merge the stack with its parent.
   *
   * @param allStacks      all stacks in stack definition
   * @param parentVersion  version of the stacks parent
   *
   * @throws AmbariException if an exception occurs merging with the parent
   */
  private void mergeStackWithParent(Map<String, StackModule> allStacks, String parentVersion) throws AmbariException {
    String parentStackKey = stackInfo.getName() + parentVersion;
    StackModule parentStack = allStacks.get(parentStackKey);

    if (parentStack == null) {
      throw new AmbariException("Stack '" + stackInfo.getName() + ":" + stackInfo.getVersion() +
          "' specifies a parent that doesn't exist");
    }

    resolveStack(parentStack, allStacks);
    mergeConfigurations(parentStack, allStacks);
    mergeRoleCommandOrder(parentStack);

    if (stackInfo.getStackHooksFolder() == null) {
      stackInfo.setStackHooksFolder(parentStack.getModuleInfo().getStackHooksFolder());
    }
    mergeServicesWithParent(allStacks, parentStack);
  }

  /**
   * Merge child services with parent stack.
   *
   * @param stacks       all stacks in stack definition
   * @param parentStack  parent stack module
   *
   * @throws AmbariException if an exception occurs merging the child services with the parent stack
   */
  private void mergeServicesWithParent(Map<String, StackModule> stacks, StackModule parentStack) throws AmbariException {
    stackInfo.getServices().clear();
    Collection<ServiceModule> mergedModules = mergeChildModules(stacks, serviceModules, parentStack.serviceModules);
    for (ServiceModule module : mergedModules) {
      serviceModules.put(module.getId(), module);
      stackInfo.getServices().add(module.getModuleInfo());
    }
  }

  /**
   * Merge services with their explicitly specified parent if one has been specified.
   *
   * @param stacks  all stacks specified in the stack definition
   *
   * @throws AmbariException if an exception occurs while merging child services with their explicit parents
   */
  private void mergeServicesWithExplicitParent(Map<String, StackModule> stacks) throws AmbariException {
    for (ServiceModule service : serviceModules.values()) {
      ServiceInfo serviceInfo = service.getModuleInfo();
      String parent = serviceInfo.getParent();
      if (parent != null) {
        mergeServiceWithExplicitParent(stacks, service, parent);
      }
    }
  }

  /**
   * Merge a service with its explicitly specified parent.
   * @param stacks   all stacks specified in the stack definition
   * @param service  the service to merge
   * @param parent   the explicitly specified parent service
   *
   * @throws AmbariException if an exception occurs merging a service with its explicit parent
   */
  private void mergeServiceWithExplicitParent(Map<String, StackModule> stacks, ServiceModule service, String parent)
      throws AmbariException {

    ServiceInfo serviceInfo = service.getModuleInfo();
    String[] parentToks = parent.split("/");
    String baseStackKey = parentToks[0] + parentToks[1];
    StackModule baseStack = stacks.get(baseStackKey);
    if (baseStack == null) {
      throw new AmbariException("The service '" + serviceInfo.getName() + "' in stack '" + stackInfo.getName() + ":"
          + stackInfo.getVersion() + "' extends a service in a non-existent stack: '" + baseStackKey + "'");
    }

    resolveStack(baseStack, stacks);

    ServiceModule baseService = baseStack.serviceModules.get(parentToks[2]);
    if (baseService == null) {
      throw new AmbariException("The service '" + serviceInfo.getName() + "' in stack '" + stackInfo.getName() + ":"
          + stackInfo.getVersion() + "' extends a non-existent service: '" + parent + "'");
    }
    service.resolve(baseService, stacks);
  }


  /**
   * Populate the stack module and info from the stack definition.
   */
  private void populateStackInfo() {
    stackInfo.setName(stackDirectory.getStackDirName());
    stackInfo.setVersion(stackDirectory.getName());

    id = String.format("%s:%s", stackInfo.getName(), stackInfo.getVersion());

    LOG.debug("Adding new stack to known stacks"
        + ", stackName = " + stackInfo.getName()
        + ", stackVersion = " + stackInfo.getVersion());


    //odo: give additional thought on handling missing metainfo.xml
    StackMetainfoXml smx = stackDirectory.getMetaInfoFile();
    if (smx != null) {
      stackInfo.setMinUpgradeVersion(smx.getVersion().getUpgrade());
      stackInfo.setActive(smx.getVersion().isActive());
      stackInfo.setParentStackVersion(smx.getExtends());
      stackInfo.setStackHooksFolder(stackDirectory.getHooksDir());
      stackInfo.setRcoFileLocation(stackDirectory.getRcoFilePath());
      stackInfo.setUpgradesFolder(stackDirectory.getUpgradesDir());
      stackInfo.setUpgradePacks(stackDirectory.getUpgradePacks());
      stackInfo.setRoleCommandOrder(stackDirectory.getRoleCommandOrder());
      populateConfigurationModules();
    }

    try {
      // Read the service and available configs for this stack
      populateServices();
      //todo: shouldn't blindly catch Exception, re-evaluate this.
    } catch (Exception e) {
      LOG.error("Exception caught while populating services for stack: " +
          stackInfo.getName() + "-" + stackInfo.getVersion());
      e.printStackTrace();
    }
  }

  /**
   * Populate the child services.
   */
  private void populateServices()throws AmbariException {
    for (ServiceDirectory serviceDir : stackDirectory.getServiceDirectories()) {
      populateService(serviceDir);
    }
  }

  /**
   * Populate a child service.
   *
   * @param serviceDirectory the child service directory
   */
  private void populateService(ServiceDirectory serviceDirectory)  {
    Collection<ServiceModule> serviceModules = new ArrayList<ServiceModule>();
    // unfortunately, we allow multiple services to be specified in the same metainfo.xml,
    // so we can't move the unmarshal logic into ServiceModule
    ServiceMetainfoXml metaInfoXml = serviceDirectory.getMetaInfoFile();
    List<ServiceInfo> serviceInfos = metaInfoXml.getServices();

    for (ServiceInfo serviceInfo : serviceInfos) {
      serviceModules.add(new ServiceModule(stackContext, serviceInfo, serviceDirectory));
    }
    addServices(serviceModules);
  }

  /**
   * Populate the child configurations.
   */
  private void populateConfigurationModules() {
    //todo: can't exclude types in stack config
    ConfigurationDirectory configDirectory = stackDirectory.getConfigurationDirectory(
        AmbariMetaInfo.SERVICE_CONFIG_FOLDER_NAME);

    if (configDirectory != null) {
      for (ConfigurationModule config : configDirectory.getConfigurationModules()) {
        stackInfo.getProperties().addAll(config.getModuleInfo().getProperties());
        stackInfo.setConfigTypeAttributes(config.getConfigType(), config.getModuleInfo().getAttributes());
        configurationModules.put(config.getConfigType(), config);
      }
    }
  }

  /**
   * Merge configurations with the parent configurations.
   *
   * @param parent  parent stack module
   * @param stacks  all stack modules
   */
  private void mergeConfigurations(StackModule parent, Map<String, StackModule> stacks) throws AmbariException {
    stackInfo.getProperties().clear();
    stackInfo.setAllConfigAttributes(new HashMap<String, Map<String, Map<String, String>>>());

    Collection<ConfigurationModule> mergedModules = mergeChildModules(
        stacks, configurationModules, parent.configurationModules);
    for (ConfigurationModule module : mergedModules) {
      configurationModules.put(module.getId(), module);
      stackInfo.getProperties().addAll(module.getModuleInfo().getProperties());
      stackInfo.setConfigTypeAttributes(module.getConfigType(), module.getModuleInfo().getAttributes());
    }
  }

  /**
   * Resolve another stack module.
   *
   * @param stackToBeResolved  stack module to be resolved
   * @param stacks             all stack modules in stack definition
   * @throws AmbariException if unable to resolve the stack
   */
  private void resolveStack(StackModule stackToBeResolved, Map<String, StackModule> stacks) throws AmbariException {
    if (stackToBeResolved.getResolutionState() == State.INIT) {
      stackToBeResolved.resolve(null, stacks);
    } else if (stackToBeResolved.getResolutionState() == State.VISITED) {
      //todo: provide more information to user about cycle
      throw new AmbariException("Cycle detected while parsing stack definition");
    }
  }

  /**
   * Add a child service module to the stack.
   *
   * @param service  service module to add
   */
  private void addService(ServiceModule service) {
    ServiceInfo serviceInfo = service.getModuleInfo();
    Object previousValue = serviceModules.put(service.getId(), service);
    if (previousValue == null) {
      stackInfo.getServices().add(serviceInfo);
    }
  }

  /**
   * Add child service modules to the stack.
   *
   * @param services  collection of service modules to add
   */
  private void addServices(Collection<ServiceModule> services) {
    for (ServiceModule service : services) {
      addService(service);
    }
  }

  /**
   * Process repositories associated with the stack.
   * @throws AmbariException if unable to fully process the stack repositories
   */
  private void processRepositories() throws AmbariException {
    RepositoryXml rxml = stackDirectory.getRepoFile();
    if (rxml == null) {
      return;
    }

    LOG.debug("Adding repositories to stack" +
        ", stackName=" + stackInfo.getName() +
        ", stackVersion=" + stackInfo.getVersion() +
        ", repoFolder=" + stackDirectory.getRepoDir());

    List<RepositoryInfo> repos = new ArrayList<RepositoryInfo>();

    for (RepositoryXml.Os o : rxml.getOses()) {
      String osFamily = o.getFamily();
      for (String os : osFamily.split(",")) {
        for (RepositoryXml.Repo r : o.getRepos()) {
          repos.add(processRepository(osFamily, os, r));
        }
      }
    }

    stackInfo.getRepositories().addAll(repos);

    if (null != rxml.getLatestURI() && repos.size() > 0) {
      stackContext.registerRepoUpdateTask(rxml.getLatestURI(), this);
    }
  }

  /**
   * Process a repository associated with the stack.
   *
   * @param osFamily  OS family
   * @param osType    OS type
   * @param r         repo
   */
  private RepositoryInfo processRepository(String osFamily, String osType, RepositoryXml.Repo r) {
    RepositoryInfo ri = new RepositoryInfo();
    ri.setBaseUrl(r.getBaseUrl());
    ri.setDefaultBaseUrl(r.getBaseUrl());
    ri.setMirrorsList(r.getMirrorsList());
    ri.setOsType(osType.trim());
    ri.setRepoId(r.getRepoId());
    ri.setRepoName(r.getRepoName());
    ri.setLatestBaseUrl(r.getBaseUrl());

    LOG.debug("Checking for override for base_url");
    String updatedUrl = stackContext.getUpdatedRepoUrl(stackInfo.getName(), stackInfo.getVersion(),
        osFamily, r.getRepoId());

    if (null != updatedUrl) {
      ri.setBaseUrl(updatedUrl);
    }

    if (LOG.isDebugEnabled()) {
      LOG.debug("Adding repo to stack"
          + ", repoInfo=" + ri.toString());
    }
    return ri;
  }

  /**
   * Merge role command order with the parent stack
   *
   * @param parentStack parent stack
   */

  private void mergeRoleCommandOrder(StackModule parentStack) {

    stackInfo.getRoleCommandOrder().merge(parentStack.stackInfo.getRoleCommandOrder());

  }
}
