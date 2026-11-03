const crypto = require("crypto");
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const isSamLocal = process.env.AWS_SAM_LOCAL === "true";
const isLocalstackEnv = process.env.LOCALSTACK_HOSTNAME;

let endpointUrl = undefined;

if (isSamLocal) {
    endpointUrl = "http://host.docker.internal:4566";
} else if (isLocalstackEnv) {
    endpointUrl = `http://${process.env.LOCALSTACK_HOSTNAME}:4566`;
}

const ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
    endpoint: endpointUrl,
    credentials: (isSamLocal || isLocalstackEnv) ? { accessKeyId: "test", secretAccessKey: "test" } : undefined
});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const sqsClient = new SQSClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const QUEUE_URL = process.env.QUEUE_URL;

exports.handler = async (event) => {
    const { method, path } = event.requestContext.http;
    const pathParameters = event.pathParameters; 

    try {
        // POSTS handler
        if (method === "POST" && path === "/jobs") {
            const jobId = crypto.randomUUID();

            // 1. Write initial status to DynamoDB
            await docClient.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: {
                    id: jobId,
                    status: "queued",
                    createdAt: new Date().toISOString()
                }
            }));

            // 2. Push message onto the SQS Queue
            const data = await sqsClient.send(new SendMessageCommand({
                QueueUrl: QUEUE_URL,
                MessageBody: JSON.stringify({ jobId, task: "Generate Report" })
            }))

            console.log("Message ID: ", data.MessageId)
            console.log("MD5 Digest: ", data.MD5OfMessageBody)

            // 3. Immediately return 202 Accepted
            return {
                statusCode: 202,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobId, status: "queued" })
            };
        }  
    } catch (error) {
        console.log(error)
    }    
}