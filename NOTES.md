# Project 3 — Async Task Queue (Notes)

**Pattern:** API Gateway → SQS → Lambda worker + DLQ
**Idea:** The API does not do the slow work itself. It drops a job on a queue and
replies `202 Accepted` right away. A separate worker Lambda picks the job off the
queue and does the slow part in the background. If a job keeps failing, it goes to
a Dead Letter Queue (DLQ) instead of being lost.

Ran everything on LocalStack with `lstk sam build / deploy / local invoke`.

---

## Bugs I hit (and what actually fixed them)

### 1. `getaddrinfo ENOTFOUND docker.internal`
- **What I saw:** Consumer crashed the moment it tried to reach DynamoDB.
- **Real cause:** I set the AWS endpoint to `http://docker.internal`. That host name
  does not exist. From inside a container, the name that points back to the host
  machine is `host.docker.internal` — and I also forgot the LocalStack port `4566`.
- **Fix:** `http://host.docker.internal:4566`.
- **Why this host at all:** Under `sam local invoke`, my Lambda runs inside its own
  container. Inside that container `localhost` means the container itself, not
  LocalStack. LocalStack is on the host machine, so the Lambda has to "step outside"
  to `host.docker.internal` to reach it.

### 2. `ResourceNotFoundException: Requested resource not found`
- **What I saw:** Endpoint worked now, but DynamoDB said the table did not exist —
  even though `list-tables` clearly showed it (`...-JobsTable-a5695c91`).
- **Real cause:** `sam local invoke` does NOT talk to my deployed CloudFormation
  stack. So it cannot turn `TABLE_NAME: !Ref JobsTable` into the real table name. It
  just puts a placeholder there, and my Lambda went looking for a table that isn't
  there.
- **Fix:** Pass the real name with an env override:
  ```json
  { "WorkerFunction": { "TABLE_NAME": "aws-async-task-queue-JobsTable-a5695c91" } }
  ```
  then `lstk sam local invoke WorkerFunction -e sqs-event.json --env-vars env.json`.
- **Gotcha:** That physical name changes if I delete and redeploy the stack, so the
  env.json needs updating then.

### 3. SQS client with no endpoint
- The DynamoDB client had endpoint + test credentials, but
  `new SQSClient({})` had nothing. It works when deployed because LocalStack injects
  `AWS_ENDPOINT_URL` into the Lambda and the SDK picks it up automatically. But under
  `sam local invoke` there is no such env var, so an empty SQS client would try to
  reach real AWS. Made both clients use the same endpoint/credentials logic.

---

## Testing the DLQ

The whole point of this project. How it works:

- When the worker **throws**, SQS does not delete the message. After the visibility
  timeout it comes back and is delivered again.
- Each delivery bumps `ApproximateReceiveCount`. My redrive policy has
  `maxReceiveCount: 3`, so: 1 original try + 2 retries = 3 failed deliveries. After
  that, SQS moves the message to the DLQ.
- This only happens on a **deployed** stack, not `sam local invoke` — retries and
  redrive are the SQS → Lambda event source mapping's job.

Steps I used:
1. Forced a guaranteed failure temporarily (`if (true) throw ...`) because the normal
   30% random failure makes DLQ testing unreliable (a job might pass on the first try).
2. `lstk sam build && lstk sam deploy`.
3. `lstk aws sqs list-queues` to get the main + dlq URLs.
4. `lstk aws sqs send-message --queue-url <MAIN> --message-body '{"jobId":"dlq-test-1","task":"Generate Report"}'`.
5. Waited (~3 × visibility timeout) and watched the consumer log — saw the same
   `dlq-test-1` fail three times.
6. `lstk aws sqs receive-message --queue-url <DLQ> --max-number-of-messages 10` →
   the message was sitting in the DLQ. 

Two things I learned the hard way:
- **To count retries, read the consumer logs** (three "Processing Started" lines for
  the same jobId). The DLQ's own `ApproximateReceiveCount` resets to 1 once the
  message lands there, so it does NOT show "3".
- `--max-number-of-messages 10` just pulls up to 10 messages per call (default is 1);
  `--attribute-names ApproximateReceiveCount` asks SQS to return that metadata along
  with the body.

After testing: reverted `if (true)` back to `Math.random() < 0.3`, rebuilt, redeployed,
and optionally purged the DLQ (`lstk aws sqs purge-queue --queue-url <DLQ>`).

---

## One-line takeaway

Fast `202` on the way in, a buffer (SQS) in the middle, a worker draining it in the
background, and a DLQ as the safety net — no request waits, no failed job disappears.
