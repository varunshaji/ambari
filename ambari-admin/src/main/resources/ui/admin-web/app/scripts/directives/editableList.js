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
'use strict';

angular.module('ambariAdminConsole')
.directive('editableList', ['$q', '$document', '$location', function($q, $document, $location) {
  return {
    restrict: 'E',
    templateUrl: 'views/directives/editableList.html',
    scope: {
      itemsSource: '=',
      resourceType: '@',
      editable: '='
    },
    link: function($scope, $elem, $attr, $ctrl) {
      var $editBox = $elem.find('[contenteditable]');

      var readInput = function() {
        $scope.$apply(function() {
          $scope.input = $editBox.text();
        });
      };

      $scope.$watch(function() {
        return $scope.input;
      }, function(newValue) {
        if(newValue === ''){
          $scope.clearInput();
        }
      });

      $scope.clearInput = function() {
        $editBox.html('').blur();
      };

      $scope.focusOnInput = function() {
        setTimeout(function() {
          var elem = $editBox[0];
          var selection = window.getSelection(),
              range = document.createRange();
          elem.innerHTML = '\u00a0';
          range.selectNodeContents(elem);
          selection.removeAllRanges();
          selection.addRange(range);
          document.execCommand('delete', false, null);
        }, 0);
      };

      $editBox.on('input', readInput);
      $editBox.on('keydown', function(e) {
        switch(e.which){
          case 27: // ESC
            $editBox.html('').blur();
            readInput();
            break;
          case 13: // Enter
            $scope.$apply(function() {
              $scope.addItem();
              $scope.focusOnInput();
            });
            return false;
            break;
          case 40: // Down arrow
            $scope.downArrowHandler();
            break;
          case 38: // Up arrow
            $scope.upArrowHandler();
            break;
        }
      });
    },
    controller: ['$scope', '$injector', '$modal', function($scope, $injector, $modal) {
      var $resource = $injector.get($scope.resourceType);

      $scope.identity = angular.identity; // Sorting function

      $scope.items = angular.copy($scope.itemsSource);
      $scope.editMode = false;
      $scope.input = '';
      $scope.typeahead = [];
      $scope.selectedTypeahed = 0;

      // Watch source of items
      $scope.$watch(function() {
        return $scope.itemsSource;
      }, function(newValue) {
        $scope.items = angular.copy($scope.itemsSource);
      }, true);

      // When input has changed - load typeahead items
      $scope.$watch(function() {
        return $scope.input;
      }, function(newValue) {
        if(newValue){
          var newValue = newValue.split(',').filter(function(i){ 
            i = i.replace('&nbsp;', ''); // Sanitize from spaces
            return !!i.trim();
          });
          if( newValue.length > 1){
            // If someone paste coma separated string, then just add all items to list
            angular.forEach(newValue, function(item) {
              $scope.addItem(item);
            });
            $scope.clearInput();
            $scope.focusOnInput();
            
          } else {
            // Load typeahed items based on current input
            $resource.listByName(encodeURIComponent(newValue)).then(function(data) {
              var items = [];
              angular.forEach(data.data.items, function(item) {
                var name;
                if($scope.resourceType === 'User'){
                  name = item.Users.user_name;
                } else if($scope.resourceType === 'Group'){
                  name = item.Groups.group_name;
                }
                if($scope.items.indexOf(name) < 0){ // Only if item not in list
                  items.push(name);
                }
              });
              $scope.typeahead = items.slice(0, 5);
              $scope.selectedTypeahed = 0;
            });
          }
        } else {
          $scope.typeahead = [];
          $scope.selectedTypeahed = 0;
          $scope.focusOnInput();
        }
      });

      $scope.enableEditMode = function(event) {
        if( $scope.editable && !$scope.editMode){
          $scope.editMode = true;
          $scope.focusOnInput();
        }
        event.stopPropagation();
      };

      $scope.cancel = function(event) {
        $scope.editMode = false;
        $scope.items = angular.copy($scope.itemsSource);
        $scope.input = '';
        event.stopPropagation();
      };
      $scope.save = function(event) {
        if( $scope.input ){
          $scope.addItem($scope.input);
        }
        $scope.itemsSource = $scope.items;
        $scope.editMode = false;
        $scope.input = '';
        if(event){
          event.stopPropagation();
        }
      };


      $scope.downArrowHandler = function() {
        $scope.$apply(function() {
          $scope.selectedTypeahed = ($scope.selectedTypeahed+1) % $scope.typeahead.length;
        });
      };
      $scope.upArrowHandler = function() {
        $scope.$apply(function() {
          $scope.selectedTypeahed -= 1;
          $scope.selectedTypeahed = $scope.selectedTypeahed < 0 ? $scope.typeahead.length-1 : $scope.selectedTypeahed;
        });
      };

      $scope.addItem = function(item) {
        item = item ? item : $scope.typeahead.length ? $scope.typeahead[$scope.selectedTypeahed] : $scope.input;
        
        if(item && $scope.items.indexOf(item) < 0){
          $scope.items.push(item);
          $scope.input = '';
        }
      };

      $scope.removeFromItems = function(item) {
        $scope.items.splice( $scope.items.indexOf(item), 1);
      };

      $scope.$on('$locationChangeStart', function(event, targetUrl) {
        targetUrl = targetUrl.split('#').pop();
        if( $scope.input ){
          $scope.addItem($scope.input);
        }
        if( $scope.editMode && !angular.equals($scope.items, $scope.itemsSource)){
          var modalInstance = $modal.open({
            template: '<div class="modal-header"><h3 class="modal-title">Warning</h3></div><div class="modal-body">You have unsaved changes. Save changes or discard?</div><div class="modal-footer"><div class="btn btn-default" ng-click="cancel()">Cancel</div><div class="btn btn-warning" ng-click="discard()">Discard</div><div class="btn btn-primary" ng-click="save()">Save</div></div>',
            controller: ['$scope', '$modalInstance', function($scope, $modalInstance) {
              $scope.save = function() {
                $modalInstance.close('save');
              };
              $scope.discard = function() {
                $modalInstance.close('discard');
              };
              $scope.cancel = function() {
                $modalInstance.close('cancel');
              };
            }]
          });
          modalInstance.result.then(function(action) {
            switch(action){
              case 'save':
                $scope.save();
                break;
              case 'discard':
                $scope.editMode = false;
                $location.path(targetUrl);
                break;
            }
          });
          event.preventDefault();
        }
      });
    }]
  };
}]);

