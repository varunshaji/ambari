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
package org.apache.ambari.server.state.stack.upgrade;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;

import javax.xml.bind.annotation.XmlAttribute;
import javax.xml.bind.annotation.XmlElement;
import javax.xml.bind.annotation.XmlSeeAlso;

import org.apache.ambari.server.state.stack.UpgradePack;
import org.apache.ambari.server.state.stack.UpgradePack.ProcessingComponent;

/**
 *
 */
@XmlSeeAlso(value = { ColocatedGrouping.class })
public class Grouping {

  @XmlAttribute(name="name")
  public String name;

  @XmlAttribute(name="title")
  public String title;

  @XmlElement(name="service")
  public List<UpgradePack.OrderService> services;

  /**
   * Gets the default builder.
   */
  public StageWrapperBuilder getBuilder() {
    return new DefaultBuilder();
  }


  private static class DefaultBuilder extends StageWrapperBuilder {

    private List<StageWrapper> stages = new ArrayList<StageWrapper>();

    @Override
    public void add(Set<String> hosts, String service, ProcessingComponent pc) {
      if (null != pc.preTasks && pc.preTasks.size() > 0) {
        StageWrapper stage = new StageWrapper(
            getStageText("Preparing", pc.name, hosts),
            Collections.singletonList(new TaskWrapper(service, pc.name, hosts, pc.preTasks)));
        stages.add(stage);
      }

      // !!! FIXME upgrade definition have only one step, and it better be a restart
      if (null != pc.tasks && 1 == pc.tasks.size()) {
        Task t = pc.tasks.get(0);
        if (RestartTask.class.isInstance(t)) {
          for (String hostName : hosts) {
            StageWrapper stage = new StageWrapper(
                getStageText("Restarting", pc.name, Collections.singleton(hostName)),
                Collections.singletonList(new TaskWrapper(service, pc.name, Collections.singleton(hostName), t)));
            stages.add(stage);
          }
        }
      }

      if (null != pc.postTasks && pc.postTasks.size() > 0) {
        StageWrapper stage = new StageWrapper(
            getStageText("Completing", pc.name, hosts),
            Collections.singletonList(new TaskWrapper(service, pc.name, hosts, pc.postTasks)));
        stages.add(stage);
      }
    }

    @Override
    public List<StageWrapper> build() {
      return stages;
    }

  }


}
