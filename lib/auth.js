/*!
 * Copyright(c) 2010 Ciaran Jessup <ciaranj@gmail.com>
 * MIT Licensed
 */

/** 
 * Module dependencies.
 */
var connect= require('connect');
var fs= require('fs');
var StrategyExecutor= require('./strategyExecutor');

/**
 * Construct the authentication middleware.
 * Construction can take 2 forms:
 *    auth(<Strategy>()/[<Strategy>()])  -  A single configured strategy, or array of strategies.
 *    auth({strategies:<Strategy>()/[<Strategy>()...]})   - More powerful variant that allows for passing in other configuration options, none yet defined.
 */
Auth= module.exports = function(optionsOrStrategy) {

  var strategies;
  var options;
  if( !optionsOrStrategy ) throw new Error("You must specify at least one strategy to use the authentication middleware, even if it is anonymous.");
  // Constructor form 1
  if(  Array.isArray(optionsOrStrategy) || ( optionsOrStrategy.authenticate !== undefined  && 
      optionsOrStrategy.strategies === undefined  ) ) {
    strategies= Array.isArray(optionsOrStrategy) ? optionsOrStrategy : [optionsOrStrategy];
    options= {};
  }
  else {
    options= optionsOrStrategy
    strategies= Array.isArray(optionsOrStrategy.strategies) ? optionsOrStrategy.strategies : [optionsOrStrategy.strategies];
  }
  var isAuthenticated = function( request, scope ) {
    if( scope === undefined ) {
      return request.getAuthDetails().user !== undefined;
    }
    else {
      return request.getAuthDetails().scopedUsers[scope].user= undefined;
    }
  };     
  
  var defaultGetPasswordForUser= function(username, password, callback) {
    callback( new Error("No mechanism specified for retrieving user passwords.") );
  }; 
  
  var server=  connect.createServer(  
    function auth(req, res, next) {
      if( req.session ) {
        // Setup the utility methods
        req.authenticate = function(strategy, opts, callback) {
          var strategy, opts, callback;
          var scope;

          //ughhh pull this rubbish somewhere tidy...
          if( strategy && opts && callback ) {
            var type= typeof strategy;
            if(  strategy.constructor != Array ) {
              strategy= [strategy]
            }
            scope= opts.scope;
          }
          else if( strategy && opts ) {
            callback= opts;
            var type= typeof strategy;
            if( strategy.constructor == Array ) {
              // do nothing
            }
            else if( type == 'string' ) {
              strategy= [strategy];
            }
            else if( type == 'object') {
              scope= strategy.scope
              strategy= undefined;
            }
          }
          else if( strategy ) {
            callback= strategy;
            strategy= undefined;
            //TODO: DEFINE DEFAULT STRATEGY(IES)
          }
          if( isAuthenticated(req, scope) ) callback(null, true);
          else strategyExecutor.authenticate(strategy, scope, req, res, function(error, executionResult){
            if(error) callback(error); // I really wish the plugins code logged errors.. 
            else {
              if( !executionResult.user ) callback(null,false)
              else {
                if( scope === undefined) {
                 req.getAuthDetails().user= executionResult.user;
                }
                else {
                  req.getAuthDetails().scopedUsers[scope].user=  executionResult.user;
                }              
                callback(null, true)
              }
            }
          }); 
        };
        req.getAuthDetails= function() {
          return req.session.auth;
        };
        req.isAuthenticated= function(scope) {
          return isAuthenticated( req, scope );
        };
        req.isUnAuthenticated= function(scope) {
          return !isAuthenticated( req, scope );
        };
        req.logout= function(scope) {
          if( scope === undefined) {
           req.getAuthDetails().user= undefined;
           req.getAuthDetails().scopedUsers= {};
          }
          else {
            req.getAuthDetails().scopedUsers[scope].user= undefined;
          }
        }
        // Create the auth holder
        if( ! req.getAuthDetails() ) { 
          var auth= { user: undefined };
          req.session.auth= auth; 
          //TODO: move this to a prototype or somesuch
          req.session.scope= function(scope) {
            return auth.scopedUsers[scope];
          };
        }
      }
      next();
  });
  
  // Some strategies require routes to be defined, so give them a chance to do so.
  for(var i=0;i< strategies.length; i++ ) {
    if( strategies[i].setupRoutes ) {
      strategies[i].setupRoutes(server);
    }
  }

  var strategyExecutor = new StrategyExecutor( strategies )
 
  return server;
};

/**
 * Auto-load bundled strategies with getters.
 */
var STRATEGY_EXCLUSIONS= {"base.js" : true,
                          "base64.js" : true};

function augmentAuthWithStrategy(filename, path) {
  if (/\.js$/.test(filename) && !STRATEGY_EXCLUSIONS[filename]) {
      var name = filename.substr(0, filename.lastIndexOf('.'));
      var camelCaseName= name.charAt(0).toUpperCase() + name.substr(1).toLowerCase();
      Object.defineProperty(Auth, camelCaseName, { 
        get: function() {
          return require('./' + path+ '/' + name);
        },
        enumerable:true});
  }
}
//TODO: Meh could make this recurse neatly over directories, but I'm lazy.
fs.readdirSync(__dirname + '/auth.strategies').forEach(function(filename){
  augmentAuthWithStrategy(filename, '/auth.strategies')
});
fs.readdirSync(__dirname + '/auth.strategies/http').forEach(function(filename){
  augmentAuthWithStrategy(filename, '/auth.strategies/http')
});