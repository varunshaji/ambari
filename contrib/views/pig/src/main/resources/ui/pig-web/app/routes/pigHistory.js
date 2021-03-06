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

var App = require('app');

App.PigHistoryRoute = Em.Route.extend({
  actions:{
    error:function (error) {
      this.controllerFor('pig').set('category',"");
      var trace = (error.responseJSON)?error.responseJSON.trace:null;
      this.send('showAlert', {message:Em.I18n.t('history.load_error'),status:'error',trace:trace});
    }
  },
  enter: function() {
    this.controllerFor('pig').set('category',"history");
  },
  model: function() {
    return this.store.find('job');
  },
  setupController:function (controller,model) {
    var scripts = this.modelFor('pig');
    var filtered = model.filter(function(job) {
      return job.get('status') != 'SUBMIT_FAILED' && scripts.get('content').isAny('id',job.get('scriptId').toString());
    });
    controller.set('model',model);
  }
});
