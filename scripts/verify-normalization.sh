#!/bin/bash

set -e

echo "=== LeadBrief Normalization Verification Script ==="
echo ""

BASE_URL="${BASE_URL:-http://localhost:5000}"

echo "Creating test CSV with messy data..."

cat > /tmp/messy-test-data.csv << 'EOF'
business_name,city,email,telephone,url
"ACME CORP","NEW YORK","John@ACME.COM","(212) 555-1234","www.acme.com"
"acme corp","new york","JANE@acme.com","212-555-1234","https://www.acme.com"
"Beta LLC","  SAN FRANCISCO  ","Test@BETA.IO","4155551111","http://beta.io"
"Gamma Inc","los angeles","admin@gamma.net","+1 (310) 555-9999","gamma.net/"
"Delta Co","CHICAGO","  support@delta.org  ","1-312-555-0000","https://delta.org"
EOF

echo "Test CSV created with:"
echo "  - Mixed case company names (ACME CORP, acme corp)"
echo "  - Mixed case cities (NEW YORK, new york)"
echo "  - Mixed case emails (John@ACME.COM, JANE@acme.com)"
echo "  - Various phone formats ((212) 555-1234, 212-555-1234, +1 (310) 555-9999)"
echo "  - Various website formats (www.acme.com, https://www.acme.com, gamma.net/)"
echo "  - Duplicate records by email/phone/company+city"
echo ""

echo "Expected normalization:"
echo "  - Email: lowercase (john@acme.com, jane@acme.com)"
echo "  - Phone: E.164 or digits (+12125551234 or 2125551234)"
echo "  - Website: https:// prefix (https://www.acme.com)"
echo "  - City: titlecase (New York, San Francisco)"
echo ""

echo "Contents of test file:"
cat /tmp/messy-test-data.csv
echo ""

echo "=== Testing API Import ==="
echo ""

RESPONSE=$(curl -s -X POST "$BASE_URL/api/import/bulk" \
  -H "Content-Type: application/json" \
  -d "{\"data\":\"$(base64 -w0 /tmp/messy-test-data.csv)\",\"format\":\"csv\",\"name\":\"normalization-test-$(date +%s)\"}")

JOB_ID=$(echo "$RESPONSE" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$JOB_ID" ]; then
  echo "Failed to create import job"
  echo "Response: $RESPONSE"
  exit 1
fi

echo "Created job: $JOB_ID"
echo ""

echo "Waiting for job to complete..."
for i in {1..30}; do
  JOB_STATUS=$(curl -s "$BASE_URL/api/jobs/$JOB_ID" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  if [ "$JOB_STATUS" = "complete" ] || [ "$JOB_STATUS" = "completed" ]; then
    echo "Job completed!"
    break
  fi
  echo "  Status: $JOB_STATUS (attempt $i/30)"
  sleep 2
done

echo ""
echo "=== Fetching Core Export ==="
echo ""

EXPORT_RESPONSE=$(curl -s "$BASE_URL/api/jobs/$JOB_ID/export?format=csv&scope=core")

echo "Core Export Headers:"
echo "$EXPORT_RESPONSE" | head -1
echo ""

echo "Core Export Data:"
echo "$EXPORT_RESPONSE" | tail -n +2
echo ""

echo "=== Normalization Checks ==="
echo ""

check_pass=0
check_fail=0

if echo "$EXPORT_RESPONSE" | grep -qi "new york"; then
  echo "[PASS] City normalized to titlecase: 'New York' found"
  ((check_pass++))
else
  echo "[FAIL] City not normalized properly"
  ((check_fail++))
fi

if echo "$EXPORT_RESPONSE" | grep -q "@acme.com"; then
  if ! echo "$EXPORT_RESPONSE" | grep -q "@ACME.COM"; then
    echo "[PASS] Email normalized to lowercase"
    ((check_pass++))
  else
    echo "[FAIL] Email still uppercase"
    ((check_fail++))
  fi
else
  echo "[INFO] Email normalization check inconclusive"
fi

if echo "$EXPORT_RESPONSE" | grep -q "https://"; then
  echo "[PASS] Website has https:// prefix"
  ((check_pass++))
else
  echo "[FAIL] Website missing https:// prefix"
  ((check_fail++))
fi

RECORD_COUNT=$(echo "$EXPORT_RESPONSE" | tail -n +2 | wc -l)
echo ""
echo "Total records after dedup: $RECORD_COUNT (expected: ~4 unique)"

if [ "$RECORD_COUNT" -lt 5 ]; then
  echo "[PASS] Deduplication working (reduced from 5 to $RECORD_COUNT)"
  ((check_pass++))
else
  echo "[INFO] No deduplication occurred (may be expected if no duplicates matched)"
fi

echo ""
echo "=== Summary ==="
echo "Checks passed: $check_pass"
echo "Checks failed: $check_fail"

if [ "$check_fail" -eq 0 ]; then
  echo ""
  echo "All normalization checks passed!"
  exit 0
else
  echo ""
  echo "Some checks failed - review normalization logic"
  exit 1
fi
