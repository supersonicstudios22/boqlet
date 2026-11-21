"""Local stack only: wait for the object storage, create the bucket, allow the app's origin.

The pilot does the same with ops/pilot/configure-storage.py for https://booqlet.com.
"""
import os
import time

import boto3
from botocore.exceptions import ClientError, EndpointConnectionError

bucket = os.environ["S3_BUCKET"]
origin = os.environ["APP_ORIGIN"]
s3 = boto3.client("s3", endpoint_url=os.environ["S3_ENDPOINT"])

for attempt in range(120):
    try:
        s3.head_bucket(Bucket=bucket)
        break
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("404", "NoSuchBucket"):
            s3.create_bucket(Bucket=bucket)
            break
        time.sleep(1)
    except EndpointConnectionError:
        time.sleep(1)
else:
    raise SystemExit("object storage did not come up")

s3.put_bucket_cors(
    Bucket=bucket,
    CORSConfiguration={
        "CORSRules": [
            {
                "AllowedMethods": ["GET", "PUT"],
                "AllowedOrigins": [origin],
                "AllowedHeaders": ["Content-Type", "x-amz-*"],
                "ExposeHeaders": ["ETag", "Content-Length"],
                "MaxAgeSeconds": 600,
            }
        ]
    },
)
print(f"bucket {bucket} ready, uploads allowed from {origin}")
