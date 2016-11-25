'use strict';

// static setup that can be done at load-time

var ACCESS_TOKEN_LENGTH = 16; // (apparent) length of an Autho0 access_token

// Lambda now supports environment variables - http://docs.aws.amazon.com/lambda/latest/dg/tutorial-env_cli.html
// a .env file can be used as a development convenience. Real environment variables can be used in deployment and
// will override anything loaded by dotenv.
require('dotenv').config();

var fs = require('fs');
var Promise = require('bluebird');
Promise.longStackTraces();

var AWS = require('aws-sdk');
AWS.config.apiVersions = { dynamodb: '2012-08-10' };
if ( process.env.AWS_REGION ) {
    AWS.config.update( { region: process.env.AWS_REGION } );
}
var dynamo = new AWS.DynamoDB.DocumentClient();
Promise.promisifyAll( Object.getPrototypeOf( dynamo ));


///// TODO : use promises to load these asynchronously
///// return Promise.resolve to return cached values
///// see : http://bluebirdjs.com/docs/api/promise.method.html



var policyDocumentFilename = 'policyDocument.json';
var policyDocument;
try {
    policyDocument = JSON.parse(fs.readFileSync( __dirname + '/' + policyDocumentFilename, 'utf8'));
} catch (e) {
    if (e.code === 'ENOENT') {
        console.error('Expected ' + policyDocumentFilename + ' to be included in Lambda deployment package');
        // fallthrough
    }
    throw e;
}

var dynamoParametersFilename = 'dynamo.json';
var dynamoParameters = null;
try {
    dynamoParameters = JSON.parse(fs.readFileSync( __dirname + '/' + dynamoParametersFilename, 'utf8'));
} catch (e) {
    if (e.code !== 'ENOENT') {
        throw e;
    }
    // otherwise fallthrough
}

var AuthenticationClient = require('auth0').AuthenticationClient;

if ( typeof process.env.AUTH0_DOMAIN === "undefined" || ! process.env.AUTH0_DOMAIN.match( /\.auth0\.com$/ )  ) {
    throw new Error( "Expected AUTHO_DOMAIN environment variable to be set in .env file. See https://manage.auth0.com/#/applications" )
}

if ( typeof process.env.AUTH0_CLIENTID === "undefined" || process.env.AUTH0_CLIENTID.length === 0 ) {
    throw new Error( "Expected AUTH0_CLIENTID environment variable to be set in .env file. See https://manage.auth0.com/#/applications" )
}

var auth0 = new AuthenticationClient( {
  domain    : process.env.AUTH0_DOMAIN,
  clientId  : process.env.AUTH0_CLIENTID
} );


// extract and return the Bearer Token from the Lambda event parameters
var getToken = function( params ) {
    var token;
    
    if ( ! params.type || params.type !== 'TOKEN' ) {
        throw new Error( "Expected 'event.type' parameter to have value TOKEN" );
    }

    var tokenString = params.authorizationToken;
    if ( !tokenString ) {
        throw new Error( "Expected 'event.authorizationToken' parameter to be set" );
    }
    
    var match = tokenString.match( /^Bearer (.*)$/ );
    if ( ! match || match.length < 2 ) {
        throw new Error( "Invalid Authorization token - '" + tokenString + "' does not match 'Bearer .*'" );
    }
    return match[1];
}

var returnAuth0UserInfo = function( auth0return ) {
    if ( ! auth0return ) throw new Error( 'Auth0 empty return' );
    if ( auth0return === 'Unauthorized') {
        throw new Error( 'Auth0 reports Unauthorized' )
    } else if ( ! auth0return ) {

    }

    return auth0return
}

// if dynamo.json is included in the package, save the userInfo to DynamoDB
var saveUserInfo = function( userInfo ) {        
    if ( ! userInfo ) throw new Error( 'saveUserInfo - expected userInfo parameter' );
    if ( ! userInfo.user_id ) throw new Error( 'saveUserInfo - expected userInfo.user_id parameter' );

    if ( dynamoParameters ) {
        var putParams =  Object.assign({}, dynamoParameters);
        var hashkeyName = Object.keys( putParams.Item )[0];
        putParams.Item = userInfo;
        putParams.Item[ hashkeyName ] = userInfo.user_id;
        return dynamo.putAsync( putParams )
            .then( () => userInfo );        
    } else {
        return userInfo;
    }

}

// extract user_id from the autho0 userInfo and return it for AWS principalId
var getPrincipalId = function( userInfo ) {
    if ( ! userInfo || ! userInfo.user_id ) {
        throw new Error( "No user_id returned from Auth0" );
    }
    console.log( 'Auth0 authentication successful for user_id ' + userInfo.user_id );
    
    return userInfo.user_id;
}

// return the expected Custom Authorizaer JSON object
var getAuthentication = function( principalId ) {
    return {
        principalId     : principalId,
        policyDocument  : policyDocument
    }
}

module.exports.authenticate = function (params) {
    var token = getToken(params);

    var getTokenDataPromise;
    if ( token.length === ACCESS_TOKEN_LENGTH ) { // Auth0 v1 access_token (deprecated)
        getTokenDataPromise = auth0.users.getInfo( token ); 
    } else if ( token.length > ACCESS_TOKEN_LENGTH ) { // (probably) Auth0 id_token
        getTokenDataPromise = auth0.tokens.getInfo( token ); 
    } else {
        throw new TypeError( "Bearer token too short - expected >= 16 charaters" );
    }

    return getTokenDataPromise
        .then( returnAuth0UserInfo )
        .then( saveUserInfo )
        .then( getPrincipalId )
        .then( getAuthentication );
}
