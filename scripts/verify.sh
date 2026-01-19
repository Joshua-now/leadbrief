#!/bin/bash

# Production Verification Script for LeadBrief
# Checks: boot, login, health, exports, API responses

set -e

echo "=========================================="
echo "LeadBrief Production Verification"
echo "=========================================="

# Configuration
BASE_URL="${BASE_URL:-http://localhost:5000}"
TIMEOUT=10

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

# Helper functions
check_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    PASSED=$((PASSED + 1))
}

check_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    FAILED=$((FAILED + 1))
}

check_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Test 1: Health endpoint
echo ""
echo "1. Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" --max-time $TIMEOUT "$BASE_URL/api/health" 2>/dev/null)
HEALTH_CODE=$(echo "$HEALTH_RESPONSE" | tail -n1)
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | head -n -1)

if [ "$HEALTH_CODE" = "200" ]; then
    if echo "$HEALTH_BODY" | grep -q '"ok":true'; then
        check_pass "Health endpoint returns 200 with ok:true"
    else
        check_fail "Health endpoint returned 200 but body is unexpected: $HEALTH_BODY"
    fi
else
    check_fail "Health endpoint returned $HEALTH_CODE"
fi

# Test 2: Ready endpoint
echo ""
echo "2. Testing readiness endpoint..."
READY_RESPONSE=$(curl -s -w "\n%{http_code}" --max-time $TIMEOUT "$BASE_URL/api/ready" 2>/dev/null)
READY_CODE=$(echo "$READY_RESPONSE" | tail -n1)
READY_BODY=$(echo "$READY_RESPONSE" | head -n -1)

if [ "$READY_CODE" = "200" ]; then
    check_pass "Readiness endpoint returns 200"
else
    check_warn "Readiness endpoint returned $READY_CODE (may need database)"
fi

# Test 3: Auth config endpoint returns JSON
echo ""
echo "3. Testing auth config endpoint..."
AUTH_RESPONSE=$(curl -s -w "\n%{http_code}" --max-time $TIMEOUT "$BASE_URL/api/auth/config" 2>/dev/null)
AUTH_CODE=$(echo "$AUTH_RESPONSE" | tail -n1)
AUTH_BODY=$(echo "$AUTH_RESPONSE" | head -n -1)

if [ "$AUTH_CODE" = "200" ]; then
    if echo "$AUTH_BODY" | grep -q '"provider"'; then
        check_pass "Auth config returns JSON with provider field"
    else
        check_fail "Auth config returns 200 but unexpected format"
    fi
else
    check_fail "Auth config returned $AUTH_CODE"
fi

# Test 4: Protected endpoint returns 401 JSON (not HTML)
echo ""
echo "4. Testing protected endpoint returns JSON error..."
PROTECTED_RESPONSE=$(curl -s -w "\n%{http_code}" --max-time $TIMEOUT "$BASE_URL/api/jobs" 2>/dev/null)
PROTECTED_CODE=$(echo "$PROTECTED_RESPONSE" | tail -n1)
PROTECTED_BODY=$(echo "$PROTECTED_RESPONSE" | head -n -1)

if [ "$PROTECTED_CODE" = "401" ]; then
    if echo "$PROTECTED_BODY" | grep -q '"error"'; then
        check_pass "Protected endpoint returns 401 with JSON error"
    elif echo "$PROTECTED_BODY" | grep -qi 'html'; then
        check_fail "Protected endpoint returns HTML instead of JSON"
    else
        check_warn "Protected endpoint returns 401 but format unclear"
    fi
else
    check_warn "Protected endpoint returned $PROTECTED_CODE (expected 401 for unauthenticated)"
fi

# Test 5: Invalid API route returns 404 JSON
echo ""
echo "5. Testing 404 error returns JSON..."
NOTFOUND_RESPONSE=$(curl -s -w "\n%{http_code}" --max-time $TIMEOUT "$BASE_URL/api/nonexistent-route-xyz" 2>/dev/null)
NOTFOUND_CODE=$(echo "$NOTFOUND_RESPONSE" | tail -n1)
NOTFOUND_BODY=$(echo "$NOTFOUND_RESPONSE" | head -n -1)

if [ "$NOTFOUND_CODE" = "404" ]; then
    if echo "$NOTFOUND_BODY" | grep -q '"error"'; then
        check_pass "404 error returns JSON format"
    elif echo "$NOTFOUND_BODY" | grep -qi 'html'; then
        check_fail "404 error returns HTML instead of JSON"
    else
        check_warn "404 error format unclear"
    fi
else
    check_warn "Invalid route returned $NOTFOUND_CODE (expected 404)"
fi

# Test 6: Config limits endpoint
echo ""
echo "6. Testing config limits endpoint..."
LIMITS_RESPONSE=$(curl -s -w "\n%{http_code}" --max-time $TIMEOUT "$BASE_URL/api/config/limits" 2>/dev/null)
LIMITS_CODE=$(echo "$LIMITS_RESPONSE" | tail -n1)

if [ "$LIMITS_CODE" = "200" ]; then
    check_pass "Config limits endpoint accessible"
else
    check_fail "Config limits returned $LIMITS_CODE"
fi

# Test 7: Exports endpoint auth protection
echo ""
echo "7. Testing exports endpoint auth protection..."
EXPORTS_RESPONSE=$(curl -s -w "\n%{http_code}" --max-time $TIMEOUT "$BASE_URL/api/exports" 2>/dev/null)
EXPORTS_CODE=$(echo "$EXPORTS_RESPONSE" | tail -n1)
EXPORTS_BODY=$(echo "$EXPORTS_RESPONSE" | head -n -1)

if [ "$EXPORTS_CODE" = "401" ]; then
    if echo "$EXPORTS_BODY" | grep -q '"error"'; then
        check_pass "Exports endpoint properly protected (401 JSON)"
    else
        check_warn "Exports endpoint returns 401 but format unclear"
    fi
else
    check_warn "Exports endpoint returned $EXPORTS_CODE (expected 401 for unauthenticated)"
fi

# Summary
echo ""
echo "=========================================="
echo "Verification Summary"
echo "=========================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -gt 0 ]; then
    echo -e "${RED}Verification FAILED with $FAILED failures${NC}"
    exit 1
else
    echo -e "${GREEN}Verification PASSED${NC}"
    exit 0
fi
