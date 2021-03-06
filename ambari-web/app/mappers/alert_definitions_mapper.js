/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements. See the NOTICE file distributed with this
 * work for additional information regarding copyright ownership. The ASF
 * licenses this file to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

var App = require('app');

var stringUtils = require('utils/string_utils');

App.alertDefinitionsMapper = App.QuickDataMapper.create({

  model: App.AlertDefinition,
  reportModel: App.AlertReportDefinition,
  metricsSourceModel: App.AlertMetricsSourceDefinition,
  metricsUriModel: App.AlertMetricsUriDefinition,

  portModel: App.PortAlertDefinition,
  metricsModel: App.MetricsAlertDefinition,
  webModel: App.WebAlertDefinition,
  aggregateModel: App.AggregateAlertDefinition,
  scriptModel: App.ScriptAlertDefinition,

  config: {
    id: 'AlertDefinition.id',
    name: 'AlertDefinition.name',
    label: 'AlertDefinition.label',
    service_id: 'AlertDefinition.service_name',
    service_name: 'AlertDefinition.service_name',
    component_name: 'AlertDefinition.component_name',
    enabled: 'AlertDefinition.enabled',
    scope: 'AlertDefinition.scope',
    interval: 'AlertDefinition.interval',
    type: 'AlertDefinition.source.type',
    reporting_key: 'reporting',
    reporting_type: 'array',
    reporting: {
      item: 'id'
    }
  },

  portConfig: {
    default_port: 'AlertDefinition.source.default_port',
    uri: 'AlertDefinition.source.uri'
  },

  aggregateConfig: {
    alert_name: 'AlertDefinition.source.alert_name'
  },

  scriptConfig: {
    location: 'AlertDefinition.source.path'
  },

  uriConfig: {
    id: 'AlertDefinition.source.uri.id',
    http: 'AlertDefinition.source.uri.http',
    https: 'AlertDefinition.source.uri.https',
    https_property: 'AlertDefinition.source.uri.https_property',
    https_property_value: 'AlertDefinition.source.uri.https_property_value'
  },

  map: function (json) {
    if (json && json.items) {

      var self = this,
          portAlertDefinitions = [],
          metricsAlertDefinitions = [],
          webAlertDefinitions = [],
          aggregateAlertDefinitions = [],
          scriptAlertDefinitions = [],
          alertReportDefinitions = [],
          alertMetricsSourceDefinitions = [],
          alertMetricsUriDefinitions = [],
          alertGroupsMap = App.cache['previousAlertGroupsMap'],
          alertDefinitions = App.AlertDefinition.getAllDefinitions(),
          alertDefinitionsToDelete = alertDefinitions.mapProperty('id'),
          rawSourceData = {};

      json.items.forEach(function (item) {
        var convertedReportDefinitions = [];
        var reporting = item.AlertDefinition.source.reporting;
        for (var report in reporting) {
          if (reporting.hasOwnProperty(report)) {
            convertedReportDefinitions.push({
              id: item.AlertDefinition.id + report,
              type: report,
              text: reporting[report].text,
              value: reporting[report].value
            });
          }
        }

        alertReportDefinitions = alertReportDefinitions.concat(convertedReportDefinitions);
        item.reporting = convertedReportDefinitions;

        rawSourceData[item.AlertDefinition.id] = item.AlertDefinition.source;

        var alertDefinition = this.parseIt(item, this.get('config'));

        if (alertGroupsMap[alertDefinition.id]) {
          alertDefinition.groups = alertGroupsMap[alertDefinition.id];
        }

        var oldAlertDefinition = alertDefinitions.findProperty('id', alertDefinition.id);
        if (oldAlertDefinition) {
          // new values will be parsed in the another mapper, so for now just use old values
          alertDefinition.summary = oldAlertDefinition.get('summary');
          alertDefinition.last_triggered = oldAlertDefinition.get('lastTriggered');
        }

        alertDefinitionsToDelete = alertDefinitionsToDelete.without(alertDefinition.id);

        // map properties dependent on Alert Definition type
        switch (item.AlertDefinition.source.type) {
          case 'PORT':
            portAlertDefinitions.push($.extend(alertDefinition, this.parseIt(item, this.get('portConfig'))));
            break;
          case 'METRIC':
            // map App.AlertMetricsSourceDefinition's
            var jmxMetric = item.AlertDefinition.source.jmx;
            var gangliaMetric = item.AlertDefinition.source.ganglia;
            if (jmxMetric) {
              alertDefinition.jmx_id = item.AlertDefinition.id + 'jmx';
              alertMetricsSourceDefinitions.push({
                id: alertDefinition.jmx_id,
                value: jmxMetric.value,
                property_list: jmxMetric.property_list
              });
            }
            if (gangliaMetric) {
              alertDefinition.ganglia_id = item.AlertDefinition.id + 'ganglia';
              alertMetricsSourceDefinitions.push({
                id: alertDefinition.ganglia_id,
                value: gangliaMetric.value,
                property_list: gangliaMetric.property_list
              });
            }

            // map App.AlertMetricsUriDefinition
            alertDefinition.uri_id = item.AlertDefinition.id + 'uri';
            item.AlertDefinition.source.uri.id = alertDefinition.uri_id;
            alertMetricsUriDefinitions.push(this.parseIt(item, this.get('uriConfig')));
            metricsAlertDefinitions.push(alertDefinition);
            break;
          case 'WEB':
            // map App.AlertMetricsUriDefinition
            alertDefinition.uri_id = item.AlertDefinition.id + 'uri';
            item.AlertDefinition.source.uri.id = alertDefinition.uri_id;
            alertMetricsUriDefinitions.push(this.parseIt(item, this.get('uriConfig')));
            webAlertDefinitions.push(alertDefinition);
            break;
          case 'AGGREGATE':
            aggregateAlertDefinitions.push($.extend(alertDefinition, this.parseIt(item, this.get('aggregateConfig'))));
            break;
          case 'SCRIPT':
            scriptAlertDefinitions.push($.extend(alertDefinition, this.parseIt(item, this.get('scriptConfig'))));
            break;
          default:
            console.error('Incorrect Alert Definition type:', item.AlertDefinition);
        }
      }, this);

      alertDefinitionsToDelete.forEach(function(definitionId) {
        self.deleteRecord(alertDefinitions.findProperty('id', definitionId));
      });

      // load all mapped data to model
      App.store.loadMany(this.get('reportModel'), alertReportDefinitions);
      App.store.loadMany(this.get('metricsSourceModel'), alertMetricsSourceDefinitions);
      this.setMetricsSourcePropertyLists(this.get('metricsSourceModel'), alertMetricsSourceDefinitions);
      App.store.loadMany(this.get('metricsUriModel'), alertMetricsUriDefinitions);
      App.store.loadMany(this.get('portModel'), portAlertDefinitions);
      App.store.loadMany(this.get('metricsModel'), metricsAlertDefinitions);
      App.store.loadMany(this.get('webModel'), webAlertDefinitions);
      App.store.loadMany(this.get('aggregateModel'), aggregateAlertDefinitions);
      App.store.loadMany(this.get('scriptModel'), scriptAlertDefinitions);
      this.setAlertDefinitionsRawSourceData(rawSourceData);
      if (App.router.get('mainAlertDefinitionsController')) {
        App.router.set('mainAlertDefinitionsController.mapperTimestamp', (new Date()).getTime());
      }
      App.store.commit();
    }
  },

  /**
   * set propertyList properties from <code>data</code> for records in <code>model</code>
   * @param model
   * @param data
   */
  setMetricsSourcePropertyLists: function (model, data) {
    data.forEach(function (record) {
      model.find().findProperty('id', record.id).set('propertyList', record.property_list);
    });
  },

  /**
   * set rawSourceDate properties for <code>App.AlertDefinition</code> records
   * @param rawSourceData
   */
  setAlertDefinitionsRawSourceData: function (rawSourceData) {
    var allDefinitions = App.AlertDefinition.getAllDefinitions();
    for (var alertDefinitionId in rawSourceData) {
      if (rawSourceData.hasOwnProperty(alertDefinitionId)) {
        allDefinitions.findProperty('id', +alertDefinitionId).set('rawSourceData', rawSourceData[alertDefinitionId]);
      }
    }
  }
});
