import boto3
from app.config import AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION


def get_client():
    """
    Create a boto3 Bedrock runtime client.
    AWS_SESSION_TOKEN is included when using temporary SSO credentials.
    """
    kwargs = {
        "service_name": "bedrock-runtime",
        "region_name": AWS_REGION,
        "aws_access_key_id": AWS_ACCESS_KEY_ID,
        "aws_secret_access_key": AWS_SECRET_ACCESS_KEY,
    }
    if AWS_SESSION_TOKEN:
        kwargs["aws_session_token"] = AWS_SESSION_TOKEN

    return boto3.client(**kwargs)
