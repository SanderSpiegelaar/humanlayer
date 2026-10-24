#!/bin/sh
set -eu

: "${S3_ARTIFACTS_BUCKET:?S3_ARTIFACTS_BUCKET is required}"

if ! aws --endpoint-url http://rustfs:9000 s3api head-bucket --bucket "$S3_ARTIFACTS_BUCKET"; then
  aws --endpoint-url http://rustfs:9000 s3api create-bucket --bucket "$S3_ARTIFACTS_BUCKET"
fi
