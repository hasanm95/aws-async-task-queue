const crypto = require("crypto");
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const sqsClient = new SQSClient({});
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

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