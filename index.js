'use strict';

var lib = require('./lib');

// Lambda function index.handler - thin wrapper around lib.authenticate
module.exports.handler = function( event, context ) {
  lib.authenticate( event )
    .then( function( data ) {
        context.succeed( data );
    })
    .catch( function( err ) {
        context.fail( err );
    } );
};
