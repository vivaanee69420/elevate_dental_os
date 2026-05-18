#!/usr/bin/env bash
# One-time AWS setup for S3 bucket + KMS key
# Run this once per environment (staging, prod)
set -e

ENV=${1:-staging}
BUCKET="elevate-files-${ENV}-eu-west-2"
REGION="eu-west-2"

echo "Setting up AWS for ${ENV} in ${REGION}..."

# 1. Create KMS key
echo "[1/3] Creating KMS key..."
KEY_ID=$(aws kms create-key \
  --description "Elevate Dental OS - ${ENV}" \
  --region ${REGION} \
  --query 'KeyMetadata.KeyId' \
  --output text)
aws kms create-alias \
  --alias-name "alias/elevate-${ENV}" \
  --target-key-id ${KEY_ID} \
  --region ${REGION}
echo "    KMS Key: ${KEY_ID}"

# 2. Create S3 bucket
echo "[2/3] Creating S3 bucket: ${BUCKET}..."
aws s3api create-bucket \
  --bucket ${BUCKET} \
  --region ${REGION} \
  --create-bucket-configuration LocationConstraint=${REGION}

# 3. Enable encryption + block public access
aws s3api put-bucket-encryption \
  --bucket ${BUCKET} \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "alias/elevate-'${ENV}'"
      }
    }]
  }'

aws s3api put-public-access-block \
  --bucket ${BUCKET} \
  --public-access-block-configuration '{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": true,
    "RestrictPublicBuckets": true
  }'

# 4. Lifecycle policy: delete uploads older than 7 years (HIPAA-equivalent retention)
aws s3api put-bucket-lifecycle-configuration \
  --bucket ${BUCKET} \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "Expire7Years",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "Expiration": { "Days": 2555 }
    }]
  }'

echo "[3/3] AWS setup complete"
echo "    Bucket: s3://${BUCKET}"
echo "    KMS:    alias/elevate-${ENV}"
