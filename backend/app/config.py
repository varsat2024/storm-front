import os
from dotenv import load_dotenv

load_dotenv()

AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_SESSION_TOKEN = os.getenv("AWS_SESSION_TOKEN")  # required for SSO / temporary credentials
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

# Must be enabled in your AWS account under Bedrock > Model access
MODEL_ID = "us.amazon.nova-2-lite-v1:0"
MAX_TOKENS = 1024
