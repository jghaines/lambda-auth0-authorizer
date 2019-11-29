# lambda-auth0-authorizer

An AWS Custom Authorizer for AWS API Gateway that support Auth0 Bearer tokens.

## About

### What is AWS API Gateway?
API Gateway is an AWS service that allows for the definition, configuration and deployment of REST API interfaces.
These interfaces can connect to a number of backend systems.
One popular use case is to provide an interface to AWS Lambda functions to deliver a so-called 'serverless' architecture.

### What are Custom Authorizers?
In February 2016 Amazon 
[announced](https://aws.amazon.com/blogs/compute/introducing-custom-authorizers-in-amazon-api-gateway/)
a new feature for API Gateway -
[Custom Authorizers](http://docs.aws.amazon.com/apigateway/latest/developerguide/use-custom-authorizer.html).

This allows a Lambda function to be invoked prior to an API Gateway execution to perform authentication and authorization of the request and caching of the result.
This code can then be isolated to a single function rather than replicated across every backend Lambda function.

### What is Auth0?
Auth0 is a 3rd party single-sign on service that provides single sign-on services, abstracting various login and identity services.
Auth0 offers a number of SDKs as well as integrations with AWS.

### What is lambda-auth0-authorizer?

This package gives you the code for a Custom Authorizer that will, with a little configuration, perform Auth0 authentication on API Gateway requests.

### What alternatives are there to this lambda-auth0-authorizer?

Auth0 uses JWTs. There are several Custom Authorizers for JWTs:
* https://github.com/byu-oit-appdev/aws-jwt-auth
* https://github.com/kopertop/lambda-jwt



## Configuration

### node modules

Run `npm install` to download all the dependent modules. This is a prerequisite for deployment as AWS Lambda requires these files to be included in the bundle.

### .env

Copy .env.sample to .env

Values specified in this file will set the corresponding environment variables.

You will need to set:

    AUTH0_DOMAIN=mydomain.auth0.com
    # or:
    AUTH0_DOMAIN_PARAMETER=ssm-parameter-name

    AUTH0_CLIENTID=MyClientId
    # or:
    AUTH0_CLIENTID_PARAMETER=ssm-parameter-name

You can obtain these values from your Auth0 [Application settings](https://manage.auth0.com/#/applications).

### policyDocument.json

Copy policyDocument.json.sample to policyDocument.json

This AWS Policy document is returned by the authorizer and is the permission granted to the invoke of the API Gateway.

You will need to edit it to give sufficient access for all the API Gateway functions it will use

The general form an API Gateway ARN is:

    "arn:aws:execute-api:<regionId>:<accountId>:<apiId>/<stage>/<method>/<resourcePath>"

To grant access to ALL your API Gateways you can use:

    "arn:aws:execute-api:*"

### dynamo.json

lambda-auth0-autorizer can optionally store the auth0 user info into an AWS DynamoDB table.

To do this copy dynamo.json.sample to dynamo.json. If present in the deployment bundle, it will be used as the template for the DynamoDoc Put operation. 

You should only change: 
* The value for "TableName", e.g. "Users"
* The key of the first "Items" value, which is the HashKey of that table, e.g. "userId"

## Local testing

### Bearer token

You will need to obtain a test Bearer Token.
This is the [id_token](https://auth0.com/docs/tokens/id_token) that is provided by a successful Auth0 authentication.
The id_token is valid for 10 hours (36000 seconds) by default.

You can check your id_token by passing it to Auth0's API test interface:  
https://auth0.com/docs/auth-api#post--tokeninfo

lamda-auth0-authorizer also will also auto-detect and support Auth0's depcreated 16-character v1 [access_token](https://auth0.com/docs/tokens/access_token).

### event.json

Copy event.json.sample to event.json. Provide the id_token from the previous step. 

    "authorizationToken" : "Bearer <id_token>",
    
### Local DynamoDB connection testing

If you are using the DynamoDB configuration described above, check that your local environment is configured for DynamoDB

Using the [AWS CLI](https://aws.amazon.com/cli/), run the following command with the <table_name> you configured in dynamo.json. 

    $ aws dynamodb describe-table --table-name <table_name>

The result should run without error and show the same value for TableName.KeySchema.AttributeName which the table key configured in dynamo.json. 

### lambda-local

Run `npm test` to use lambda-local test harness 

A successful run will look something like:

    $ npm test

    > lambda-auth0-authenticator@0.0.1 test ~/lambda-auth0-authorizer
    > lambda-local --timeout 300 --lambdapath index.js --eventpath event.json

    Logs
    ----
    START RequestId: bcb21d17-c3f8-2299-58d9-0400adcfe921
    Auth0 authentication successful for user_id oauth|1234567890
    END


    Message
    ------
    {
        "principalId": "oauth|1234567890",
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "Stmt1459758003000",
                    "Effect": "Allow",
                    "Action": [
                        "execute-api:Invoke"
                    ],
                    "Resource": [
                        "arn:aws:execute-api:*"
                    ]
                }
            ]
        }
    }

The Message is the authorization data that the Lambda function returns to API Gateway.

## Deployment

### Create bundle

You can create the bundle using `npm run zip`. This creates a lambda-auth0-authorizer.zip deployment package with all the source, configuration and node modules AWS Lambda needs.

### Create Lambda function

From the AWS console https://console.aws.amazon.com/lambda/home#/create?step=2

* Name : auth0_authorizer
* Description: Auth0 authorizer for API Gateway
* Runtime: Node.js 4.3
* Code entry type: Upload a .ZIP file
* Upload : < select lambda-auth0-authorizer.zip we created in the previous step >
* Handler : index.handler
* Role :  Basic with DynamoDB
  * If you aren't using DynamoDB (see above), you can also pick Basic execution role
* Memory (MB) : 128
* Timeout : 30 seconds
* VPC : No VPC

Click Next and Create

#### Testing Lambda

In the Lambda console, select Actions -> Configure Test event.

Use the following JSON as the test event data. The id_token is the same format we used in event.json above. Click Save and Test to run the Lambda.

    {
        "type": "TOKEN",
        "authorizationToken": "Bearer <id_token>",
        "methodArn":"arn:aws:execute-api:us-east-1:1234567890:apiId/stage/method/resourcePath"
    }

### Create IAM Role

You will need to create an IAM Role that has permissions to invoke the Lambda function we created above.

That Role will need to have a Policy similar to the following:

    {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Resource": [
                    "*"
                ],
                "Action": [
                    "lambda:InvokeFunction"
                ]
            }
        ]
    }

You will also need to set a "Trust Relationship for the role". This will allow the API Gateway permission to assume the role and run the lambda function. The trust relationship can be set in a separate tab in the AWS console. Click the "Edit Trust Relationship button". It should look similar to the following:

    {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Principal": {
            "Service": [
              "apigateway.amazonaws.com",
              "lambda.amazonaws.com"
            ]
          },
          "Action": "sts:AssumeRole"
        }
      ]
    }


### Configure API Gateway

From the AWS console https://console.aws.amazon.com/apigateway/home

Open your API, or Create a new one.

In the left panel, under your API name, click on **Custom Authorizers**. Click on **Create**

* Name : auth0_authorizer
* Lambda region : < from previous step >
* Execution role : < the ARN of the Role we created in the previous step > 
* Identity token source : method.request.header.Authorization
* Token validation expression : ```^Bearer [-0-9a-zA-z\.]*$```
** Cut-and-paste this regular expression from ^ to $ inclusive
* Result TTL in seconds : 3600

Click **Create**

### Testing

You can test the authorizer by supplying an Identity token and clicking **Test**

The id_token is the same format we used in event.json above.

    Bearer <id_token>
  
A successful test will look something like:

    Latency: 2270 ms
    Principal Id: oauth|1234567890
    Policy
    {
        "Version": "2012-10-17",
        "Statement": [
            {
            "Sid": "Stmt1459758003000",
            "Effect": "Allow",
            "Action": [
                "execute-api:Invoke"
            ],
            "Resource": [
                "arn:aws:execute-api:*"
            ]
            }
        ]
    }

### Configure API Gateway Methods to use the Authorizer

In the left panel, under your API name, click on **Resources**.
Under the Resource tree, select one of your Methods (POST, GET etc.)

Select **Method Request**. Under **Authorization Settings** change:

* Authorizer : auth0_authorizer

Make sure that:

* API Key Required : false

Click the tick to save the changes.

### Deploy the API

You need to Deploy the API to make the changes public.

Select **Action** and **Deploy API**. Select your **Stage**.

### Test your endpoint remotely

#### With Postman

You can use Postman to test the REST API

* Method: < matching the Method in API Gateway > 
* URL `https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/<resource>`
 * The base URL you can see in the Stages section of the API
 * Append the Resource name to get the full URL  
* Header - add an Authorization key
 * Authorization : Bearer <id_token>

#### With curl from the command line

    $ curl -X POST <url> -H 'Authorization: Bearer <id_token>'
 
#### In (modern) browsers console with fetch

    fetch( '<url>', { method: 'POST', headers: { Authorization : 'Bearer <id_token>' }}).then(response => { console.log( response );});
    
