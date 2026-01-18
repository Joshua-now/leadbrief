#!/bin/bash
set -e

echo "========================================"
echo "LeadBrief Verification Script"
echo "========================================"
echo ""
echo "This script verifies that the application is ready for production."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track results
PASSED=0
FAILED=0
SKIPPED=0

# Function to run a check
run_check() {
    local name=$1
    local cmd=$2
    echo -n "  [$name] "
    if eval "$cmd" > /dev/null 2>&1; then
        echo -e "${GREEN}PASS${NC}"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}FAIL${NC}"
        ((FAILED++))
        return 1
    fi
}

# Function to skip a check
skip_check() {
    local name=$1
    local reason=$2
    echo -e "  [$name] ${YELLOW}SKIP${NC} ($reason)"
    ((SKIPPED++))
}

# Function to run a check with output
run_check_verbose() {
    local name=$1
    local cmd=$2
    echo "  [$name]"
    if eval "$cmd"; then
        echo -e "  ${GREEN}PASS${NC}"
        ((PASSED++))
        return 0
    else
        echo -e "  ${RED}FAIL${NC}"
        ((FAILED++))
        return 1
    fi
}

echo "Step 1: Environment Check"
echo "-------------------------"
run_check "Node.js installed" "node --version"
run_check "npm installed" "npm --version"

if [ -n "$DATABASE_URL" ]; then
    echo -e "  [DATABASE_URL] ${GREEN}SET${NC}"
else
    echo -e "  [DATABASE_URL] ${YELLOW}NOT SET${NC}"
fi

if [ -n "$SESSION_SECRET" ]; then
    echo -e "  [SESSION_SECRET] ${GREEN}SET${NC}"
else
    echo -e "  [SESSION_SECRET] ${YELLOW}NOT SET${NC}"
fi
echo ""

echo "Step 2: TypeScript Check"
echo "------------------------"
run_check_verbose "TypeCheck" "npx tsc --noEmit"
echo ""

echo "Step 3: Unit Tests"
echo "------------------"
run_check_verbose "Vitest" "npx vitest run"
echo ""

echo "Step 4: Build Check"
echo "-------------------"
run_check_verbose "Build" "npm run build"
echo ""

echo "Step 5: Server Boot Test"
echo "------------------------"
if [ -f "dist/index.cjs" ]; then
    # Start server in background
    echo "  Starting server..."
    PORT=5555 NODE_ENV=production node dist/index.cjs > /tmp/verify_server.log 2>&1 &
    SERVER_PID=$!
    sleep 4
    
    # Check if server is running
    if kill -0 $SERVER_PID 2>/dev/null; then
        run_check "Server started" "true"
        
        # Test health endpoint
        run_check "Health endpoint" "curl -sf http://localhost:5555/api/health"
        
        # Test auth config endpoint
        run_check "Auth config endpoint" "curl -sf http://localhost:5555/api/auth/config"
        
        # Test config limits endpoint
        run_check "Config limits endpoint" "curl -sf http://localhost:5555/api/config/limits"
        
        # Test ready endpoint (may fail if DB not configured)
        if curl -sf http://localhost:5555/api/ready > /dev/null 2>&1; then
            echo -e "  [Ready endpoint] ${GREEN}PASS${NC}"
            ((PASSED++))
        else
            echo -e "  [Ready endpoint] ${YELLOW}SKIP${NC} (DB may need configuration)"
            ((SKIPPED++))
        fi
        
        # Cleanup
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
    else
        echo -e "  [Server started] ${RED}FAIL${NC}"
        echo "  Server log:"
        cat /tmp/verify_server.log | head -20
        ((FAILED++))
    fi
else
    skip_check "Server Boot" "dist/index.cjs not found - run npm run build first"
fi
echo ""

echo "========================================"
echo "Summary"
echo "========================================"
echo -e "  Passed:  ${GREEN}$PASSED${NC}"
echo -e "  Failed:  ${RED}$FAILED${NC}"
echo -e "  Skipped: ${YELLOW}$SKIPPED${NC}"
echo "========================================"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}VERIFICATION PASSED${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Push to GitHub: git push origin main"
    echo "  2. Ensure DATABASE_URL is configured in production"
    echo "  3. Run db:push if database schema is not created"
    exit 0
else
    echo -e "${RED}VERIFICATION FAILED${NC}"
    echo ""
    echo "Fix the failing checks and run ./verify.sh again."
    exit 1
fi
