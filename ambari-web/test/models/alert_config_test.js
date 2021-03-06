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

require('models/alert_config');

var model;

describe('App.AlertConfigProperties', function () {

  describe('Threshold', function () {

    beforeEach(function () {
      model = App.AlertConfigProperties.Threshold.create({});
    });

    describe('#apiFormattedValue', function () {

      it('should be based on showInputForValue and showInputForText', function () {

        model.setProperties({
          value: 'value',
          text: 'text',
          showInputForValue: false,
          showInputForText: false
        });
        expect(model.get('apiFormattedValue')).to.eql([]);

        model.set('showInputForValue', true);
        expect(model.get('apiFormattedValue')).to.eql(['value']);

        model.set('showInputForText', true);
        expect(model.get('apiFormattedValue')).to.eql(['value', 'text']);

      });

    });

    describe('#badgeCssClass', function () {

      it ('should be based on badge', function () {

        model.set('badge', 'OK');
        expect(model.get('badgeCssClass')).to.equal('alert-state-OK');

      });

    });

    describe('#wasChanged', function () {

      Em.A([
          {
            p: {
              previousValue: null,
              previousText: null,
              value: '',
              text: ''
            },
            e: false
          },
          {
            p: {
              previousValue: 'not null',
              previousText: null,
              value: '',
              text: ''
            },
            e: true
          },
          {
            p: {
              previousValue: null,
              previousText: 'not null',
              value: '',
              text: ''
            },
            e: true
          },
          {
            p: {
              previousValue: 'not null',
              previousText: 'not null',
              value: '',
              text: ''
            },
            e: true
          }
        ]).forEach(function (test, i) {
        it('test #' + (i + 1), function () {
          model.setProperties(test.p);
          expect(model.get('wasChanged')).to.equal(test.e);
        });
      });

    });

  });

  describe('App.AlertConfigProperties.Thresholds', function () {

    describe('OkThreshold', function () {

      beforeEach(function () {
        model = App.AlertConfigProperties.Thresholds.OkThreshold.create();
      });

      describe('#apiProperty', function () {

        it('should be based on showInputForValue and showInputForText', function () {

          model.setProperties({
            showInputForValue: false,
            showInputForText: false
          });
          expect(model.get('apiProperty')).to.eql([]);

          model.set('showInputForValue', true);
          expect(model.get('apiProperty')).to.eql(['source.reporting.ok.value']);

          model.set('showInputForText', true);
          expect(model.get('apiProperty')).to.eql(['source.reporting.ok.value', 'source.reporting.ok.text']);

        });

      });

    });

    describe('WarningThreshold', function () {

      beforeEach(function () {
        model = App.AlertConfigProperties.Thresholds.WarningThreshold.create();
      });

      describe('#apiProperty', function () {

        it('should be based on showInputForValue and showInputForText', function () {

          model.setProperties({
            showInputForValue: false,
            showInputForText: false
          });
          expect(model.get('apiProperty')).to.eql([]);

          model.set('showInputForValue', true);
          expect(model.get('apiProperty')).to.eql(['source.reporting.warning.value']);

          model.set('showInputForText', true);
          expect(model.get('apiProperty')).to.eql(['source.reporting.warning.value', 'source.reporting.warning.text']);

        });

      });

    });

    describe('CriticalThreshold', function () {

      beforeEach(function () {
        model = App.AlertConfigProperties.Thresholds.CriticalThreshold.create();
      });

      describe('#apiProperty', function () {

        it('should be based on showInputForValue and showInputForText', function () {

          model.setProperties({
            showInputForValue: false,
            showInputForText: false
          });
          expect(model.get('apiProperty')).to.eql([]);

          model.set('showInputForValue', true);
          expect(model.get('apiProperty')).to.eql(['source.reporting.critical.value']);

          model.set('showInputForText', true);
          expect(model.get('apiProperty')).to.eql(['source.reporting.critical.value', 'source.reporting.critical.text']);

        });

      });

    });

  });

});
