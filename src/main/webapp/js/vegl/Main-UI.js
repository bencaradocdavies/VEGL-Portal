Ext.application({
    name : 'portal',

    //Here we build our GUI from existing components - this function should only be assembling the GUI
    //Any processing logic should be managed in dedicated classes - don't let this become a
    //monolithic 'do everything' function
    launch : function() {

        //Send these headers with every AJax request we make...
        Ext.Ajax.defaultHeaders = {
            'Accept-Encoding': 'gzip, deflate' //This ensures we use gzip for most of our requests (where available)
        };

        var urlParams = Ext.Object.fromQueryString(window.location.search.substring(1));
        var isDebugMode = urlParams.debug;

        //Create our CSWRecord store (holds all CSWRecords not mapped by known layers)
        var unmappedCSWRecordStore = Ext.create('Ext.data.Store', {
            model : 'portal.csw.CSWRecord',
            groupField: 'contactOrg',
            proxy : {
                type : 'ajax',
                url : 'getUnmappedCSWRecords.do',
                reader : {
                    type : 'json',
                    root : 'data'
                }
            },
            autoLoad : true
        });

        //Our custom record store holds layers that the user has
        //added to the map using a OWS URL entered through the
        //custom layers panel
        var customRecordStore = Ext.create('Ext.data.Store', {
            model : 'portal.csw.CSWRecord',
            proxy : {
                type : 'ajax',
                url : 'getCustomLayers.do',
                reader : {
                    type : 'json',
                    root : 'data'
                }
            },
            autoLoad : false,
            data : []
        });

        //Create our KnownLayer store
        var knownLayerStore = Ext.create('Ext.data.Store', {
            model : 'portal.knownlayer.KnownLayer',
            groupField: 'group',
            proxy : {
                type : 'ajax',
                url : 'getKnownLayers.do',
                reader : {
                    type : 'json',
                    root : 'data'
                }
            },
            autoLoad : true
        });

        //Create our store for holding the set of
        //layers that have been added to the map
        var layerStore = Ext.create('portal.layer.LayerStore', {});

        //We need something to handle the clicks on the map
        var queryTargetHandler = Ext.create('portal.layer.querier.QueryTargetHandler', {});


        //Create our map implementations
        var mapCfg = {
            container : null,   //We will be performing a delayed render of this map
            layerStore : layerStore,
            allowDataSelection : true,
            listeners : {
                query : function(mapWrapper, queryTargets) {
                    queryTargetHandler.handleQueryTargets(mapWrapper, queryTargets);
                }
            }
        };
        var urlParams = Ext.Object.fromQueryString(window.location.search.substring(1));
        var map = null;
        if (urlParams && urlParams.map && urlParams.map === 'googleMap') {
            map = Ext.create('portal.map.gmap.GoogleMap', mapCfg);
        } else {
            map = Ext.create('portal.map.openlayers.OpenLayersMap', mapCfg);
        }

        var layersPanel = Ext.create('portal.widgets.panel.LayerPanel', {
            id : 'vgl-layers-panel',
            title : 'Active Layers',
            region : 'south',
            flex : 2,
            split : true,
            store : layerStore,
            map : map,
            height: 250,
            split: true,
            allowDebugWindow : isDebugMode,
            listeners : {
                itemclick : function(sm,record, eOpts){
                    var allTabPanels = tabsPanel.items.items;
                    for (var i=0; i< allTabPanels.length; i++){
                        var tabPanelSelectedRecord = allTabPanels[i].getStore().getById(record.get('id'));
                        if(tabPanelSelectedRecord){
                            allTabPanels[i].getSelectionModel().select([tabPanelSelectedRecord], false);
                            tabsPanel.setActiveTab(allTabPanels[i]);
                            break;
                        }
                    }
                },
                removelayerrequest: function(sourceGrid, record) {
                    filterPanel.clearFilter();
                }
            }
        });


        var handleFilterSelectionComplete =  function(){
            var activePanel = tabsPanel.activeTab;
            activePanel.addSelectedLayerToActive();
        };
        
        /**
         * Used to show extra details for querying services
         */
        var filterPanel = Ext.create('portal.widgets.panel.FilterPanel', {
            id : 'vgl-filter-panel',
            title : 'Filter',
            region: 'center',
            width : '100%',
            //maxHeight : 350, //VT:settings for vbox layout
            height : 100,
            layerPanel : layersPanel,
            map : map,
            listeners : {
                filterselectioncomplete : handleFilterSelectionComplete
            }
        });

        var layerFactory = Ext.create('portal.layer.LayerFactory', {
            map : map,
            formFactory : Ext.create('vegl.layer.filterer.VeglFormFactory', {map : map}),
            downloaderFactory : Ext.create('vegl.layer.VeglDownloaderFactory', {map: map}),
            querierFactory : Ext.create('vegl.layer.VeglQuerierFactory', {map: map}),
            rendererFactory : Ext.create('vegl.layer.VeglRendererFactory', {map: map})
        });

        //Utility function for adding a new layer to the map
        //record must be a CSWRecord or KnownLayer
        var handleAddRecordToMap = function(sourceGrid, record) {
            if (!(record instanceof Array)) {
                record = [record];
            }

            for( var z = 0; z < record.length; z++) {
                var newLayer = null;
                
                //Ensure the layer DNE first
                var existingRecord = layerStore.getById(record[z].get('id'));
                if (existingRecord) {
                    layersPanel.getSelectionModel().select([existingRecord], false);
                    return;
                 }
    
                //Turn our KnownLayer/CSWRecord into an actual Layer
                if (record[z] instanceof portal.csw.CSWRecord) {
                    newLayer = record[z].get('layer');
                } else {
                    newLayer = record[z].get('layer');
                }
    
                //if newLayer is undefined, it must have come from some other source like mastercatalogue
                if (!newLayer){
                    newLayer = layerFactory.generateLayerFromCSWRecord(record[z])
                    //we want it to display immediately.
                    newLayer.set('displayed',true);
                }
    
                //We may need to show a popup window with copyright info
                var cswRecords = newLayer.get('cswRecords');
                for (var i = 0; i < cswRecords.length; i++) {
                    if (cswRecords[i].hasConstraints()) {
                        var popup = Ext.create('portal.widgets.window.CSWRecordConstraintsWindow', {
                            width : 625,
                            cswRecords : cswRecords
                        });
    
                        popup.show();
    
                        //HTML images may take a moment to load which stuffs up our layout
                        //This is a horrible, horrible workaround.
                        var task = new Ext.util.DelayedTask(function(){
                            popup.doLayout();
                        });
                        task.delay(1000);
    
                        break;
                    }
                }
    
                layerStore.insert(0,newLayer); //this adds the layer to our store
                layersPanel.getSelectionModel().select([newLayer], false); //this ensures it gets selected
            }
        };

        var knownLayersPanel = Ext.create('portal.widgets.panel.KnownLayerPanel', {
            title : 'Featured Layers',
            store : knownLayerStore,
            map : map,
            listeners : {
                //On selection, update our filter panel
                select : function(rowModel, record, index) {
                    var newLayer;
                    if(record.get('layer')){
                        newLayer = record.get('layer');
                    }else{
                        newLayer = layerFactory.generateLayerFromKnownLayer(record);
                        record.set('layer', newLayer);
                    }

                    filterPanel.showFilterForLayer(newLayer);
                },
                addlayerrequest : handleAddRecordToMap
            }
        });

        // basic tabs 1, built from existing content
        var tabsPanel = Ext.create('Ext.TabPanel', {
            id : 'vgl-tabs-panel',
            activeTab : 0,
            region : 'north',
            split : true,
            height : 265,
            enableTabScroll : true,
            items:[knownLayersPanel]
        });

        /**
         * Used as a placeholder for the tree and details panel on the left of screen
         */
        var westPanel = {
            layout: 'border',//VT: vbox doesn't support splitbar unless we custom it.
            region:'west',
            border: false,
            split:true,
            //margins: '100 0 0 0',
            margins:'100 0 0 3',
            width: 350,
            items:[tabsPanel , filterPanel, layersPanel ]
        };

        /**
         * This center panel will hold the google maps instance
         */
        var centerPanel = Ext.create('Ext.panel.Panel', {
            region: 'center',
            id: 'center_region',
            margins: '100 0 0 0',
            cmargins:'100 0 0 0'
        });

        /**
         * Add all the panels to the viewport
         */
        var viewport = Ext.create('Ext.container.Viewport', {
            layout:'border',
            items:[westPanel, centerPanel]
        });

        map.renderToContainer(centerPanel);   //After our centerPanel is displayed, render our map into it

        // The subset button needs a handler for when the user draws a subset bbox on the map:
        map.on('dataSelect', function(map, bbox, intersectedRecords) {
          //Show a dialog allow users to confirm the selected data sources
          if (intersectedRecords.length > 0) {
              Ext.create('Ext.Window', {
                  width : 710,
                  maxHeight : 400,
                  title : 'Confirm which datasets you wish to select',
                  modal : true,
                  autoScroll : true,
                  items : [{
                      xtype : 'dataselectionpanel',
                      region : bbox,
                      itemId : 'dataselection-panel',
                      cswRecords : intersectedRecords
                  }],
                  buttons : [{
                      text : 'Capture Data',
                      iconCls : 'add',
                      align : 'right',
                      scope : this,
                      handler : function(btn) {
                          var parentWindow = btn.findParentByType('window');
                          var panel = parentWindow.getComponent('dataselection-panel');

                          panel.saveCurrentSelection(function(totalSelected, totalErrors) {
                              if (totalSelected === 0) {
                                  Ext.Msg.alert('No selection', 'You haven\'t selected any data to capture. Please select one or more rows by checking the box alongside each row.');
                              } else if (totalErrors === 0) {
                                  Ext.Msg.alert('Request Saved', 'Your ' + totalSelected + ' dataset(s) have been saved. You can either continue selecting more data or <a href="jobbuilder.html">create a job</a> to process your existing selections.');
                                  parentWindow.close();
                              } else {
                                  Ext.Msg.alert('Error saving data', 'There were one or more errors when saving some of the datasets you selected');
                                  parentWindow.close();
                              }
                          });
                      }
                  }]
              }).show();
          }

        });
        
        //Create our permalink generation handler
        var permalinkHandler = function() {
            var mss = Ext.create('portal.util.permalink.MapStateSerializer');

            mss.addMapState(map);
            mss.addLayers(layerStore);

            mss.serialize(function(state, version) {
                var popup = Ext.create('portal.widgets.window.PermanentLinkWindow', {
                    state : state,
                    version : version
                });

                popup.show(); 
            });            
        };
        Ext.get('permalink').on('click', permalinkHandler);
        Ext.get('permalinkicon').on('click', permalinkHandler);

        //Handle deserialisation -- ONLY if we have a uri param called "state".
        var deserializationHandler;
        var urlParams = Ext.Object.fromQueryString(window.location.search.substring(1));
        if (urlParams && (urlParams.state || urlParams.s)) {
            var decodedString = urlParams.state ? urlParams.state : urlParams.s;
            var decodedVersion = urlParams.v;
            
            deserializationHandler = Ext.create('portal.util.permalink.DeserializationHandler', {
                knownLayerStore : knownLayerStore,
                cswRecordStore : unmappedCSWRecordStore,
                layerFactory : layerFactory,
                layerStore : layerStore,
                map : map,
                stateString : decodedString,
                stateVersion : decodedVersion
            });           
            
        }
    }
});