'use strict';

// static setup that can be done at load-time

var TOO_LONG_TOKEN_LENGTH = 256; // access tokens are 16 characters; id tokens are > 256 characters 

// since AWS Lambda doesn't (yet) provide environment varibles, load them from .env
require('dotenv').config();

var fs = require('fs');
var Promise = require('bluebird');
var AWS = require('aws-sdk');
AWS.config.apiVersions = { dynamodb: '2012-08-10' };
if ( process.env.AWS_REGION ) {
    AWS.config.update( { region: process.env.AWS_REGION } );
}
var dynamo = new AWS.DynamoDB.DocumentClient();

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

if ( typeof process.env.AUTH0_DOMAIN === "undefined" ) {
    throw new Error( "Expected AUTHO_DOMAIN environment variable to be set in .env file. See https://manage.auth0.com/#/applications" )
}

if ( typeof process.env.AUTH0_CLIENTID === "undefined" ) {
    throw new Error( "Expected AUTH0_CLIENTID environment variable to be set in .env file. See https://manage.auth0.com/#/applications" )
}

var auth0 = new AuthenticationClient( {
  domain    : process.env.AUTH0_DOMAIN,
  clientId  : process.env.AUTH0_CLIENTID
} );

var userManager = auth0.users;

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
    token = match[1];

    if ( token.length > TOO_LONG_TOKEN_LENGTH ) {
        throw new Error( "Invalid Authorization token - too long. Did you pass id_token instead of access_token ?" );
    }
    
    return token;
}

// if dynamo.json is included in the package, save the userInfo to DynamoDB
var saveUserInfo = function( userInfo ) {        
    if ( dynamoParameters ) {
        var putParams =  Object.assign({}, dynamoParameters);
        var hashkeyName = Object.keys( putParams.Item )[0];
        putParams.Item = userInfo;
        putParams.Item[ hashkeyName ] = userInfo.user_id;
        return dynamo.put( putParams ).promise().then( () => userInfo );        
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

    return userManager.getInfo(token)
        .then( saveUserInfo )
        .then( getPrincipalId )
        .then( getAuthentication );
}
