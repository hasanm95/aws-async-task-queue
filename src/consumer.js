const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

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

const TABLE_NAME = process.env.TABLE_NAME;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

exports.handler = async (event) => {
    console.log("================> Consumer Init");
    
    if (!event.Records) {
        console.log("No SQS records found in this event context.");
        return;
    }

    for (const record of event.Records) {
        const {jobId, task} = JSON.parse(record.body)
        console.log(`[Processing Started] Job ID: ${jobId}, Task: ${task}`)
        
        try {
            // Update status to processing
            await updateJobStatus(jobId, "processing")

            // Simulate heavy async task
            await sleep(3000)

            // Simulate Random Flakiness (30% failure rate for DLQ testing)
            if (Math.random() < 0.3) {
                throw new Error("Simulated transient error during report generation!")
            }
            
            // For fail testing
            // if (true) { 
            //     throw new Error("Forced failure for DLQ test");
            // }

            // update status to done
            await updateJobStatus(jobId, "done")
            console.log(`[Processing Success] Job ID: ${jobId} completed successfully.`);
        } catch (error) {
            console.error(`[Processing Failed] Job ID: ${jobId} failed. Error: ${error.message}`);
            
            // Update status to failed
            await updateJobStatus(jobId, "failed", error.message);
            throw error; 
        }
    }
}

async function updateJobStatus(jobId, status, errorMessage = null) {
   const updateParams = {
        TableName: TABLE_NAME,
        Key: {
            id: jobId
        },
        UpdateExpression: "set #statusAttr = :statusVal, updatedAt = :timeVal",
        ExpressionAttributeNames: {
            "#statusAttr": "status" 
        },
        ExpressionAttributeValues: {
            ":statusVal": status,
            ":timeVal": new Date().toISOString()
        }
    };

    if (errorMessage) {
        updateParams.UpdateExpression += ", errorMsg = :errVal";
        updateParams.ExpressionAttributeValues[":errVal"] = errorMessage
    }

    await docClient.send(new UpdateCommand(updateParams))
}