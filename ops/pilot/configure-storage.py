"""Limit browser requests to Boqlet's origin and confirm the bucket is private."""
import os
import boto3
from botocore.exceptions import ClientError

endpoint = os.environ["ENGINE_S3_ENDPOINT"]
bucket = os.environ["ENGINE_STORAGE"].removeprefix("s3://")
s3 = boto3.client("s3", endpoint_url=endpoint)
s3.put_bucket_cors(
    Bucket=bucket,
    CORSConfiguration={
        "CORSRules": [
            {
                "AllowedMethods": ["GET", "PUT"],
                "AllowedOrigins": ["https://booqlet.com"],
                "AllowedHeaders": ["Content-Type", "x-amz-*"],
                "ExposeHeaders": ["ETag", "Content-Length"],
                "MaxAgeSeconds": 600,
            }
        ]
    },
)
try:
    s3.get_bucket_policy(Bucket=bucket)
except ClientError as exc:
    if exc.response["Error"]["Code"] != "NoSuchBucketPolicy":
        raise
else:
    raise RuntimeError("Unexpected bucket policy")
print("Boqlet bucket CORS installed and no public policy found.")
