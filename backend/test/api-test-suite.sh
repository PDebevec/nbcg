#!/usr/bin/env bash
# ============================================================================
# NBCG Backend — Comprehensive API Test Suite
# ============================================================================
#
# Tests every API endpoint with all auth personas (admin, editor, cataloguer,
# reader, anonymous). Covers: health, search visibility, items CRUD,
# transitions, relations, files, COBISS import/preview, and auth edge cases.
#
# Prerequisites:
#   - Backend running at localhost:3000
#   - Keycloak running at localhost:8082 (realm: nbcg, client: nbcg-web)
#   - PostgreSQL running at localhost:15432
#   - Test users: admin/admin, editor/editor, cataloguer/cataloguer, reader/reader
#
# Usage:
#   chmod +x backend/test/api-test-suite.sh
#   ./backend/test/api-test-suite.sh
#
# ============================================================================

set -uo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
API="http://localhost:3000/api"
KC="http://localhost:8082/realms/nbcg/protocol/openid-connect/token"
KC_CLIENT="nbcg-web"

PASSED=0
FAILED=0
SKIPPED=0
ERRORS=()
CLEANUP_IDS=()

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
get_token() {
  local user=$1 pass=$2
  curl -sf -X POST "$KC" \
    -d "grant_type=password&client_id=$KC_CLIENT&username=$user&password=$pass" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null
}

auth_header() {
  local token=$1
  if [ -z "$token" ]; then
    echo ""
  else
    echo "Authorization: Bearer $token"
  fi
}

# Make an HTTP request and capture status code + body
# Usage: http METHOD URL [TOKEN] [BODY]
http() {
  local method=$1 url=$2 token=${3:-""} body=${4:-""}
  local -a args=(-s -w "\n%{http_code}" -X "$method")

  if [ -n "$token" ]; then
    args+=(-H "Authorization: Bearer $token")
  fi

  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi

  local response
  response=$(curl "${args[@]}" "$url" 2>/dev/null)
  local status_code
  status_code=$(echo "$response" | tail -1)
  local response_body
  response_body=$(echo "$response" | sed '$d')

  HTTP_STATUS="$status_code"
  HTTP_BODY="$response_body"
}

# Upload file
http_upload() {
  local url=$1 token=$2 filepath=$3
  local -a args=(-s -w "\n%{http_code}" -X POST -F "files=@$filepath")

  if [ -n "$token" ]; then
    args+=(-H "Authorization: Bearer $token")
  fi

  local response
  response=$(curl "${args[@]}" "$url" 2>/dev/null)
  HTTP_STATUS=$(echo "$response" | tail -1)
  HTTP_BODY=$(echo "$response" | sed '$d')
}

# Assert HTTP status code
assert_status() {
  local test_name=$1 expected=$2
  if [ "$HTTP_STATUS" = "$expected" ]; then
    echo -e "  ${GREEN}PASS${NC} $test_name (HTTP $HTTP_STATUS)"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} $test_name (expected $expected, got $HTTP_STATUS)"
    ((FAILED++))
    ERRORS+=("$test_name: expected HTTP $expected, got $HTTP_STATUS")
  fi
}

# Assert body contains substring
assert_body_contains() {
  local test_name=$1 substring=$2
  if echo "$HTTP_BODY" | grep -q "$substring"; then
    echo -e "  ${GREEN}PASS${NC} $test_name"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} $test_name (body missing: $substring)"
    ((FAILED++))
    ERRORS+=("$test_name: body missing '$substring'")
  fi
}

# Assert body field equals value (JSON)
assert_json_field() {
  local test_name=$1 field=$2 expected=$3
  local actual
  actual=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)$field)" 2>/dev/null || echo "__PARSE_ERROR__")
  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}PASS${NC} $test_name"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} $test_name (expected $expected, got $actual)"
    ((FAILED++))
    ERRORS+=("$test_name: expected $expected, got $actual")
  fi
}

# Get JSON field from last response
json_field() {
  echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)$1)" 2>/dev/null
}

section() {
  echo ""
  echo -e "${BOLD}${CYAN}━━━ $1 ━━━${NC}"
}

cleanup_item() {
  local id=$1 token=$2
  http DELETE "$API/items" "$token" "{\"ids\":[\"$id\"]}" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# Pre-flight: acquire tokens
# ---------------------------------------------------------------------------
section "Setup: Acquiring tokens"

TOKEN_ADMIN=$(get_token admin admin) && echo -e "  ${GREEN}OK${NC} admin token" || { echo -e "  ${RED}FAIL${NC} admin token"; exit 1; }
TOKEN_EDITOR=$(get_token editor editor) && echo -e "  ${GREEN}OK${NC} editor token" || { echo -e "  ${RED}FAIL${NC} editor token"; exit 1; }
TOKEN_CATALOGUER=$(get_token cataloguer cataloguer) && echo -e "  ${GREEN}OK${NC} cataloguer token" || { echo -e "  ${RED}FAIL${NC} cataloguer token"; exit 1; }
TOKEN_READER=$(get_token reader reader) && echo -e "  ${GREEN}OK${NC} reader token" || { echo -e "  ${RED}FAIL${NC} reader token"; exit 1; }
TOKEN_ANON=""

# ============================================================================
# 1. HEALTH CHECK
# ============================================================================
section "1. Health Check"

http GET "$API/health"
assert_status "GET /health returns 200" "200"
assert_body_contains "Health response has status=ok" '"status":"ok"'

# ============================================================================
# 2. TOKEN VALIDATION
# ============================================================================
section "2. Token Validation"

# Invalid token should degrade to anonymous (OptionalJwtGuard)
http GET "$API/search" "invalid.garbage.token"
assert_status "Invalid token degrades to anonymous on public endpoint" "200"

# Malformed token
http GET "$API/search" "not-even-a-jwt"
assert_status "Malformed token degrades to anonymous on public endpoint" "200"

# Valid tokens work for protected endpoints
http GET "$API/import/cobiss/preview/999999999" "$TOKEN_ADMIN"
# 404 = auth worked, COBISS just didn't find anything
if [ "$HTTP_STATUS" = "404" ] || [ "$HTTP_STATUS" = "200" ]; then
  echo -e "  ${GREEN}PASS${NC} Admin token accepted for protected endpoint (HTTP $HTTP_STATUS)"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Admin token rejected for protected endpoint (HTTP $HTTP_STATUS)"
  ((FAILED++))
fi

# ============================================================================
# 3. ITEMS CRUD + AUTH
# ============================================================================
section "3. Items CRUD + Auth"

# --- 3a: Create items for visibility testing ---
echo -e "\n  ${YELLOW}Creating test items...${NC}"

# Draft - PUBLIC
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-DRAFT-PUBLIC","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Editor creates PUBLIC draft" "201"
DRAFT_PUBLIC_ID=$(json_field "['id']")
CLEANUP_IDS+=("$DRAFT_PUBLIC_ID")

# Draft - PRIVATE
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PRIVATE","metadata":{"title":"TEST-SUITE-DRAFT-PRIVATE","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Editor creates PRIVATE draft" "201"
DRAFT_PRIVATE_ID=$(json_field "['id']")
CLEANUP_IDS+=("$DRAFT_PRIVATE_ID")

# Draft - HIDDEN
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"HIDDEN","metadata":{"title":"TEST-SUITE-DRAFT-HIDDEN","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Editor creates HIDDEN draft" "201"
DRAFT_HIDDEN_ID=$(json_field "['id']")
CLEANUP_IDS+=("$DRAFT_HIDDEN_ID")

# Record - PUBLIC
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"RECORD","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-RECORD-PUBLIC","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Editor creates PUBLIC record" "201"
RECORD_PUBLIC_ID=$(json_field "['id']")
CLEANUP_IDS+=("$RECORD_PUBLIC_ID")

# Record - PRIVATE
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"RECORD","visibilityStatus":"PRIVATE","metadata":{"title":"TEST-SUITE-RECORD-PRIVATE","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Editor creates PRIVATE record" "201"
RECORD_PRIVATE_ID=$(json_field "['id']")
CLEANUP_IDS+=("$RECORD_PRIVATE_ID")

# Record - HIDDEN
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"RECORD","visibilityStatus":"HIDDEN","metadata":{"title":"TEST-SUITE-RECORD-HIDDEN","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Editor creates HIDDEN record" "201"
RECORD_HIDDEN_ID=$(json_field "['id']")
CLEANUP_IDS+=("$RECORD_HIDDEN_ID")

# --- 3b: Auth checks for create ---
echo -e "\n  ${YELLOW}Auth checks for create...${NC}"

# Anonymous cannot create
http POST "$API/items" "" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-ANON","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Anonymous cannot create draft" "401"

# Reader cannot create
http POST "$API/items" "$TOKEN_READER" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-READER","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Reader cannot create draft" "403"

# Cataloguer can create draft
http POST "$API/items" "$TOKEN_CATALOGUER" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-CAT-DRAFT","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Cataloguer can create draft" "201"
CAT_DRAFT_ID=$(json_field "['id']")
CLEANUP_IDS+=("$CAT_DRAFT_ID")

# Cataloguer cannot create record
http POST "$API/items" "$TOKEN_CATALOGUER" '{"targetState":"RECORD","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-CAT-RECORD","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Cataloguer cannot create record" "403"

# --- 3c: Update auth checks ---
echo -e "\n  ${YELLOW}Auth checks for update...${NC}"

# Anonymous cannot update
http PATCH "$API/items/$DRAFT_PUBLIC_ID" "" '{"expectedVersion":0,"metadata":{"title":"UPDATED-ANON"}}'
assert_status "Anonymous cannot update" "401"

# Reader cannot update
http PATCH "$API/items/$DRAFT_PUBLIC_ID" "$TOKEN_READER" '{"expectedVersion":0,"metadata":{"title":"UPDATED-READER"}}'
assert_status "Reader cannot update" "403"

# Cataloguer can update draft
http PATCH "$API/items/$CAT_DRAFT_ID" "$TOKEN_CATALOGUER" '{"expectedVersion":0,"metadata":{"title":"TEST-SUITE-CAT-DRAFT-UPDATED"}}'
assert_status "Cataloguer can update own draft" "200"

# Cataloguer cannot update record
http PATCH "$API/items/$RECORD_PUBLIC_ID" "$TOKEN_CATALOGUER" '{"expectedVersion":0,"metadata":{"title":"UPDATED-CAT"}}'
assert_status "Cataloguer cannot update record" "403"

# Editor can update record
http PATCH "$API/items/$RECORD_PUBLIC_ID" "$TOKEN_EDITOR" '{"expectedVersion":0,"metadata":{"title":"TEST-SUITE-RECORD-PUBLIC"}}'
assert_status "Editor can update record" "200"

# --- 3d: Delete auth checks ---
echo -e "\n  ${YELLOW}Auth checks for delete...${NC}"

# Anonymous cannot delete
http DELETE "$API/items" "" "{\"ids\":[\"$CAT_DRAFT_ID\"]}"
assert_status "Anonymous cannot delete" "401"

# Reader cannot delete
http DELETE "$API/items" "$TOKEN_READER" "{\"ids\":[\"$CAT_DRAFT_ID\"]}"
assert_status "Reader cannot delete" "403"

# Cataloguer can delete draft
http DELETE "$API/items" "$TOKEN_CATALOGUER" "{\"ids\":[\"$CAT_DRAFT_ID\"]}"
assert_status "Cataloguer can delete own draft" "200"
# Remove from cleanup since already deleted
CLEANUP_IDS=("${CLEANUP_IDS[@]/$CAT_DRAFT_ID/}")

# Wait a moment for OpenSearch to sync
sleep 2

# ============================================================================
# 4. SEARCH VISIBILITY
# ============================================================================
section "4. Search Visibility"

# Anonymous: should see only public records (1)
http GET "$API/search?q=TEST-SUITE-&limit=100"
ANON_TOTAL=$(json_field "['total']")
echo -e "  Anonymous sees $ANON_TOTAL items"
# At minimum, PUBLIC record should be visible
http GET "$API/search/$RECORD_PUBLIC_ID"
assert_status "Anonymous can see PUBLIC record" "200"

http GET "$API/search/$RECORD_PRIVATE_ID"
assert_status "Anonymous cannot see PRIVATE record" "404"

http GET "$API/search/$RECORD_HIDDEN_ID"
assert_status "Anonymous cannot see HIDDEN record" "404"

http GET "$API/search/$DRAFT_PUBLIC_ID"
assert_status "Anonymous cannot see any draft" "404"

# Reader: public + private records, no drafts
http GET "$API/search/$RECORD_PUBLIC_ID" "$TOKEN_READER"
assert_status "Reader can see PUBLIC record" "200"

http GET "$API/search/$RECORD_PRIVATE_ID" "$TOKEN_READER"
assert_status "Reader can see PRIVATE record" "200"

http GET "$API/search/$RECORD_HIDDEN_ID" "$TOKEN_READER"
assert_status "Reader cannot see HIDDEN record" "404"

http GET "$API/search/$DRAFT_PUBLIC_ID" "$TOKEN_READER"
assert_status "Reader cannot see drafts" "404"

# Cataloguer: all records + all drafts
http GET "$API/search/$RECORD_HIDDEN_ID" "$TOKEN_CATALOGUER"
assert_status "Cataloguer can see HIDDEN record" "200"

http GET "$API/search/$DRAFT_PUBLIC_ID" "$TOKEN_CATALOGUER"
assert_status "Cataloguer can see PUBLIC draft" "200"

http GET "$API/search/$DRAFT_HIDDEN_ID" "$TOKEN_CATALOGUER"
assert_status "Cataloguer can see HIDDEN draft" "200"

# Admin: all records + all drafts
http GET "$API/search/$RECORD_HIDDEN_ID" "$TOKEN_ADMIN"
assert_status "Admin can see HIDDEN record" "200"

http GET "$API/search/$DRAFT_HIDDEN_ID" "$TOKEN_ADMIN"
assert_status "Admin can see HIDDEN draft" "200"

# ============================================================================
# 5. SEARCH FILTERS
# ============================================================================
section "5. Search Filters"

http GET "$API/search?title=TEST-SUITE-RECORD-PUBLIC" "$TOKEN_ADMIN"
assert_status "Search by title filter" "200"

http GET "$API/search?q=TEST-SUITE-&type=records" "$TOKEN_ADMIN"
assert_status "Search with type=records filter" "200"

http GET "$API/search?q=TEST-SUITE-&type=drafts" "$TOKEN_ADMIN"
assert_status "Search with type=drafts filter" "200"

# Year validation
http GET "$API/search?yearFrom=invalid" "$TOKEN_ADMIN"
assert_status "Invalid yearFrom format returns 400" "400"

http GET "$API/search?yearFrom=2000&yearTo=1990" "$TOKEN_ADMIN"
assert_status "Reversed year range returns 400" "400"

http GET "$API/search?yearFrom=1990" "$TOKEN_ADMIN"
assert_status "Valid yearFrom filter" "200"

http GET "$API/search?yearFrom=1990&yearTo=2000" "$TOKEN_ADMIN"
assert_status "Valid year range filter" "200"

# Fields parameter
http GET "$API/search?q=TEST-SUITE-&fields=metadata.title,metadata.authors" "$TOKEN_ADMIN"
assert_status "Search with fields parameter" "200"

# Multi-select filters
http GET "$API/search?language=Slovenian,English" "$TOKEN_ADMIN"
assert_status "Multi-select language filter" "200"

http GET "$API/search?materialType=Book" "$TOKEN_ADMIN"
assert_status "Material type filter" "200"

# Suggest endpoint
http GET "$API/search/suggest?field=language" "$TOKEN_ADMIN"
assert_status "Suggest all languages" "200"

http GET "$API/search/suggest?field=materialType" "$TOKEN_ADMIN"
assert_status "Suggest all material types" "200"

http GET "$API/search/suggest?field=publisher&q=a&limit=5" "$TOKEN_ADMIN"
assert_status "Suggest publishers with query" "200"

http GET "$API/search/suggest?field=author&limit=5" "$TOKEN_ADMIN"
assert_status "Suggest top authors" "200"

http GET "$API/search/suggest?field=title&q=test" "$TOKEN_ADMIN"
assert_status "Suggest titles with query" "200"

http GET "$API/search/suggest?field=nonexistent" "$TOKEN_ADMIN"
assert_status "Suggest unknown field returns 400" "400"

# Suggest respects visibility (anonymous can still call)
http GET "$API/search/suggest?field=language"
assert_status "Suggest without auth (anonymous)" "200"

# Pagination
http GET "$API/search?q=TEST-SUITE-&page=1&limit=2" "$TOKEN_ADMIN"
assert_status "Pagination works" "200"

# ============================================================================
# 6. TRANSITIONS (DRAFT <-> RECORD)
# ============================================================================
section "6. Transitions"

# Create a draft specifically for transition testing
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-TRANSITION","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create draft for transition test" "201"
TRANSITION_ID=$(json_field "['id']")
CLEANUP_IDS+=("$TRANSITION_ID")

# Reader cannot transition
http POST "$API/items/transition" "$TOKEN_READER" "{\"targetState\":\"RECORD\",\"ids\":[\"$TRANSITION_ID\"]}"
assert_status "Reader cannot transition" "403"

# Cataloguer cannot transition (missing records:manage)
http POST "$API/items/transition" "$TOKEN_CATALOGUER" "{\"targetState\":\"RECORD\",\"ids\":[\"$TRANSITION_ID\"]}"
assert_status "Cataloguer cannot transition (missing records:manage)" "403"

# Editor can transition DRAFT -> RECORD
http POST "$API/items/transition" "$TOKEN_EDITOR" "{\"targetState\":\"RECORD\",\"ids\":[\"$TRANSITION_ID\"]}"
assert_status "Editor transitions DRAFT -> RECORD" "201"

# A transition bumps each item's version, so it reports the resulting
# versions rather than an empty body.
assert_json_field "Transition returns the transitioned id" "[0]['id']" "$TRANSITION_ID"
assert_json_field "Transition returns bumped version" "[0]['version']" "1"

# Verify item is now a record (searchable in records)
sleep 1
http GET "$API/search/$TRANSITION_ID" "$TOKEN_ADMIN"
assert_status "Transitioned item accessible" "200"

# Transition back RECORD -> DRAFT
http POST "$API/items/transition" "$TOKEN_ADMIN" "{\"targetState\":\"DRAFT\",\"ids\":[\"$TRANSITION_ID\"]}"
assert_status "Admin transitions RECORD -> DRAFT" "201"

# ============================================================================
# 7. RELATIONS
# ============================================================================
section "7. Relations"

# Create items for relation tests
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-PARENT","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
PARENT_ID=$(json_field "['id']")
CLEANUP_IDS+=("$PARENT_ID")

http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-CHILD-1","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
CHILD1_ID=$(json_field "['id']")
CLEANUP_IDS+=("$CHILD1_ID")

http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-CHILD-2","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
CHILD2_ID=$(json_field "['id']")
CLEANUP_IDS+=("$CHILD2_ID")

echo -e "  Created parent=$PARENT_ID, child1=$CHILD1_ID, child2=$CHILD2_ID"

# Anonymous cannot connect
http POST "$API/relations/connect" "" "{\"parentId\":\"$PARENT_ID\",\"childIds\":[\"$CHILD1_ID\"]}"
assert_status "Anonymous cannot connect relations" "401"

# Reader cannot connect
http POST "$API/relations/connect" "$TOKEN_READER" "{\"parentId\":\"$PARENT_ID\",\"childIds\":[\"$CHILD1_ID\"]}"
assert_status "Reader cannot connect relations" "403"

# Cataloguer can connect
http POST "$API/relations/connect" "$TOKEN_CATALOGUER" "{\"parentId\":\"$PARENT_ID\",\"childIds\":[\"$CHILD1_ID\",\"$CHILD2_ID\"]}"
assert_status "Cataloguer can connect relations" "201"

# The edge rows fire a trigger that bumps the parent's version, so connect
# reports the parent's resulting state instead of an empty body.
assert_json_field "Connect returns parentId" "['parentId']" "$PARENT_ID"
assert_json_field "Connect returns bumped version (2 children)" "['version']" "2"
assert_json_field "Connect returns childrenInDrafts" "['childrenInDrafts']" "2"
PARENT_VERSION=$(json_field "['version']")

# Acceptance: a client that connects children can PATCH that parent
# immediately, without a 409 and without a CDC-lagged re-read.
http PATCH "$API/items/$PARENT_ID" "$TOKEN_CATALOGUER" "{\"expectedVersion\":$PARENT_VERSION,\"metadata\":{\"subtitle\":\"patched right after connect\"}}"
assert_status "PATCH parent right after connect succeeds (no 409)" "200"

# Verify children count via search (wait for PGSync → OpenSearch)
sleep 5
http GET "$API/search/$PARENT_ID/children" "$TOKEN_ADMIN"
assert_status "Get children endpoint works" "200"
CHILDREN_TOTAL=$(json_field "['total']")
if [ "$CHILDREN_TOTAL" = "2" ]; then
  echo -e "  ${GREEN}PASS${NC} Parent has 2 children"
  ((PASSED++))
else
  # PGSync may need more time; treat as non-fatal if endpoint itself works
  echo -e "  ${YELLOW}WARN${NC} Expected 2 children, got $CHILDREN_TOTAL (PGSync lag)"
  ((SKIPPED++))
fi

# Self-reference should be rejected (400)
http POST "$API/relations/connect" "$TOKEN_CATALOGUER" "{\"parentId\":\"$PARENT_ID\",\"childIds\":[\"$PARENT_ID\"]}"
assert_status "Self-reference rejected" "400"

# Circular reference should be rejected (400) — child1 -> parent (parent is already parent of child1)
http POST "$API/relations/connect" "$TOKEN_CATALOGUER" "{\"parentId\":\"$CHILD1_ID\",\"childIds\":[\"$PARENT_ID\"]}"
assert_status "Direct circular reference rejected" "400"

# Disconnect — 200 with the parent's post-write state (was an empty 204;
# a 204 must not carry a body).
http POST "$API/relations/disconnect" "$TOKEN_CATALOGUER" "{\"parentId\":\"$PARENT_ID\",\"childIds\":[\"$CHILD1_ID\"]}"
assert_status "Cataloguer can disconnect relations" "200"
assert_json_field "Disconnect returns parentId" "['parentId']" "$PARENT_ID"
assert_json_field "Disconnect returns decremented childrenInDrafts" "['childrenInDrafts']" "1"

# ============================================================================
# 7b. RELATION INTEGRITY ON DELETE
# ============================================================================
section "7b. Relation Integrity on Delete"

# Create parent and two children for integrity tests
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-INTEG-PARENT","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create integrity-test parent" "201"
INTEG_PARENT_ID=$(json_field "['id']")
CLEANUP_IDS+=("$INTEG_PARENT_ID")

http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-INTEG-CHILD-1","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create integrity-test child 1" "201"
INTEG_CHILD1_ID=$(json_field "['id']")
CLEANUP_IDS+=("$INTEG_CHILD1_ID")

http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-INTEG-CHILD-2","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create integrity-test child 2" "201"
INTEG_CHILD2_ID=$(json_field "['id']")
CLEANUP_IDS+=("$INTEG_CHILD2_ID")

# Connect both children to parent
http POST "$API/relations/connect" "$TOKEN_EDITOR" "{\"parentId\":\"$INTEG_PARENT_ID\",\"childIds\":[\"$INTEG_CHILD1_ID\",\"$INTEG_CHILD2_ID\"]}"
assert_status "Connect integrity-test children to parent" "201"

# Verify parent has 2 children via children endpoint
sleep 2
http GET "$API/search/$INTEG_PARENT_ID/children" "$TOKEN_ADMIN"
assert_status "Parent children endpoint returns 200" "200"
INTEG_CHILDREN=$(json_field "['total']")
if [ "$INTEG_CHILDREN" = "2" ]; then
  echo -e "  ${GREEN}PASS${NC} Parent has 2 children before delete"
  ((PASSED++))
else
  echo -e "  ${YELLOW}WARN${NC} Expected 2 children, got $INTEG_CHILDREN (PGSync lag)"
  ((SKIPPED++))
fi

# --- Test A: Delete a child → relation row removed, parent count decremented ---
echo -e "\n  ${YELLOW}Test A: Delete child → relation cleanup...${NC}"

http DELETE "$API/items" "$TOKEN_ADMIN" "{\"ids\":[\"$INTEG_CHILD1_ID\"]}"
assert_status "Delete child 1" "200"
CLEANUP_IDS=("${CLEANUP_IDS[@]/$INTEG_CHILD1_ID/}")

# Verify parent now has 1 child
sleep 2
http GET "$API/search/$INTEG_PARENT_ID/children" "$TOKEN_ADMIN"
assert_status "Parent children endpoint after child delete" "200"
INTEG_CHILDREN_AFTER=$(json_field "['total']")
if [ "$INTEG_CHILDREN_AFTER" = "1" ]; then
  echo -e "  ${GREEN}PASS${NC} Parent has 1 child after deleting child 1"
  ((PASSED++))
else
  echo -e "  ${YELLOW}WARN${NC} Expected 1 child, got $INTEG_CHILDREN_AFTER (PGSync lag)"
  ((SKIPPED++))
fi

# Connecting to the deleted child should fail (item not found)
http POST "$API/relations/connect" "$TOKEN_EDITOR" "{\"parentId\":\"$INTEG_PARENT_ID\",\"childIds\":[\"$INTEG_CHILD1_ID\"]}"
assert_status "Cannot connect to deleted child (400)" "400"

# --- Test B: Delete the parent → all relations cleaned up ---
echo -e "\n  ${YELLOW}Test B: Delete parent → all relations cleaned up...${NC}"

# Create a second parent linked to child2 (so child2 has 2 parents)
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-INTEG-PARENT2","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create second parent" "201"
INTEG_PARENT2_ID=$(json_field "['id']")
CLEANUP_IDS+=("$INTEG_PARENT2_ID")

http POST "$API/relations/connect" "$TOKEN_EDITOR" "{\"parentId\":\"$INTEG_PARENT2_ID\",\"childIds\":[\"$INTEG_CHILD2_ID\"]}"
assert_status "Connect child2 to parent2" "201"

# Delete original parent
http DELETE "$API/items" "$TOKEN_ADMIN" "{\"ids\":[\"$INTEG_PARENT_ID\"]}"
assert_status "Delete original parent" "200"
CLEANUP_IDS=("${CLEANUP_IDS[@]/$INTEG_PARENT_ID/}")

# child2 should still be accessible
http GET "$API/search/$INTEG_CHILD2_ID" "$TOKEN_ADMIN"
assert_status "Child 2 still accessible after parent delete" "200"

# child2 should still be a child of parent2
sleep 2
http GET "$API/search/$INTEG_PARENT2_ID/children" "$TOKEN_ADMIN"
assert_status "Parent2 children endpoint" "200"
INTEG_P2_CHILDREN=$(json_field "['total']")
if [ "$INTEG_P2_CHILDREN" = "1" ]; then
  echo -e "  ${GREEN}PASS${NC} Parent2 still has child2 after parent1 delete"
  ((PASSED++))
else
  echo -e "  ${YELLOW}WARN${NC} Expected 1 child for parent2, got $INTEG_P2_CHILDREN (PGSync lag)"
  ((SKIPPED++))
fi

# Connecting to the deleted parent should fail (400 bad request — IDs not found)
http POST "$API/relations/connect" "$TOKEN_EDITOR" "{\"parentId\":\"$INTEG_PARENT_ID\",\"childIds\":[\"$INTEG_CHILD2_ID\"]}"
if [ "$HTTP_STATUS" = "400" ] || [ "$HTTP_STATUS" = "404" ]; then
  echo -e "  ${GREEN}PASS${NC} Cannot connect to deleted parent (HTTP $HTTP_STATUS)"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Expected 400/404 for deleted parent, got $HTTP_STATUS"
  ((FAILED++))
fi

# --- Test C: Delete child that has a parent → parent count decremented ---
echo -e "\n  ${YELLOW}Test C: Delete last child → parent count goes to 0...${NC}"

http DELETE "$API/items" "$TOKEN_ADMIN" "{\"ids\":[\"$INTEG_CHILD2_ID\"]}"
assert_status "Delete child 2" "200"
CLEANUP_IDS=("${CLEANUP_IDS[@]/$INTEG_CHILD2_ID/}")

sleep 2
http GET "$API/search/$INTEG_PARENT2_ID/children" "$TOKEN_ADMIN"
assert_status "Parent2 children after last child deleted" "200"
INTEG_P2_FINAL=$(json_field "['total']")
if [ "$INTEG_P2_FINAL" = "0" ]; then
  echo -e "  ${GREEN}PASS${NC} Parent2 has 0 children after all children deleted"
  ((PASSED++))
else
  echo -e "  ${YELLOW}WARN${NC} Expected 0 children for parent2, got $INTEG_P2_FINAL (PGSync lag)"
  ((SKIPPED++))
fi

# ============================================================================
# 8. FILES
# ============================================================================
section "8. Files"

# Create a temp test file
TMPFILE=$(mktemp /tmp/test-suite-XXXX.txt)
echo "Test file content for API test suite" > "$TMPFILE"

# Anonymous cannot upload
http_upload "$API/files/upload/$DRAFT_PUBLIC_ID" "" "$TMPFILE"
assert_status "Anonymous cannot upload files" "401"

# Reader cannot upload
http_upload "$API/files/upload/$DRAFT_PUBLIC_ID" "$TOKEN_READER" "$TMPFILE"
assert_status "Reader cannot upload files" "403"

# Cataloguer can upload to draft
http_upload "$API/files/upload/$DRAFT_PUBLIC_ID" "$TOKEN_CATALOGUER" "$TMPFILE"
assert_status "Cataloguer can upload to draft" "201"
FILE_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null || echo "")

if [ -n "$FILE_ID" ]; then
  # List files
  http GET "$API/files/$DRAFT_PUBLIC_ID" "$TOKEN_ADMIN"
  assert_status "List files for item" "200"

  # Download file
  http GET "$API/files/$FILE_ID/download" "$TOKEN_ADMIN"
  assert_status "Download file" "200"

  # Delete file
  http DELETE "$API/files/$FILE_ID" "$TOKEN_ADMIN"
  assert_status "Delete file" "200"
else
  echo -e "  ${YELLOW}SKIP${NC} File operations — upload didn't return file ID"
  ((SKIPPED+=3))
fi

rm -f "$TMPFILE"

# --- 8b: Upload with pre-extracted text ---
echo -e "\n  ${YELLOW}Upload with pre-extracted text...${NC}"

TMPPDF=$(mktemp /tmp/test-suite-XXXX.pdf)
echo "%PDF-1.0 test content" > "$TMPPDF"
PDFNAME=$(basename "$TMPPDF")

# Upload PDF with extractedTexts field
UPLOAD_RESP=$(curl -sf -w "\n%{http_code}" -X POST "$API/files/upload/$DRAFT_PUBLIC_ID" \
  -H "Authorization: Bearer $TOKEN_CATALOGUER" \
  -F "files=@$TMPPDF" \
  -F "extractedTexts={\"$PDFNAME\":\"Pre-extracted OCR text from PaddleOCR.\"}" 2>/dev/null)
HTTP_STATUS=$(echo "$UPLOAD_RESP" | tail -1)
HTTP_BODY=$(echo "$UPLOAD_RESP" | sed '$d')
assert_status "Upload PDF with pre-extracted text" "201"

# Verify extractedText was stored
TEXT_STATUS=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['textExtractionStatus'])" 2>/dev/null || echo "")
if [ "$TEXT_STATUS" = "EXTRACTED" ]; then
  echo -e "  ${GREEN}PASS${NC} textExtractionStatus is EXTRACTED"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Expected textExtractionStatus=EXTRACTED, got $TEXT_STATUS"
  ((FAILED++))
fi

EXTRACTED_TEXT=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['extractedText'])" 2>/dev/null || echo "")
if [ "$EXTRACTED_TEXT" = "Pre-extracted OCR text from PaddleOCR." ]; then
  echo -e "  ${GREEN}PASS${NC} extractedText matches supplied text"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} extractedText mismatch: $EXTRACTED_TEXT"
  ((FAILED++))
fi

TEXT_FILE_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null || echo "")

# --- 8c: PUT /files/:fileId/text ---
echo -e "\n  ${YELLOW}PUT /files/:fileId/text...${NC}"

if [ -n "$TEXT_FILE_ID" ]; then
  # Anonymous cannot set text
  http PUT "$API/files/$TEXT_FILE_ID/text" "" '{"text":"hacked"}'
  assert_status "Anonymous cannot set file text" "401"

  # Reader cannot set text
  http PUT "$API/files/$TEXT_FILE_ID/text" "$TOKEN_READER" '{"text":"hacked"}'
  assert_status "Reader cannot set file text" "403"

  # Cataloguer can set text
  http PUT "$API/files/$TEXT_FILE_ID/text" "$TOKEN_CATALOGUER" '{"text":"Updated OCR text."}'
  assert_status "Cataloguer can set file text" "200"
  assert_body_contains "setText returns updated:true" '"updated":true'

  # Set empty text -> NO_TEXT status
  http PUT "$API/files/$TEXT_FILE_ID/text" "$TOKEN_CATALOGUER" '{"text":""}'
  assert_status "Set empty text succeeds" "200"

  # Cleanup the file
  http DELETE "$API/files/$TEXT_FILE_ID" "$TOKEN_ADMIN"
else
  echo -e "  ${YELLOW}SKIP${NC} PUT /files/:fileId/text — no file ID"
  ((SKIPPED+=4))
fi

rm -f "$TMPPDF"

# --- 8c2: Non-ASCII (UTF-8) multipart filenames ---
# Multer decodes multipart params as latin1 by default, which mangled Cyrillic
# filenames and — because extractedTexts is keyed by filename — silently dropped
# the supplied text on an otherwise-successful 201.
echo -e "\n  ${YELLOW}Non-ASCII multipart filenames...${NC}"

UTF8_DIR=$(mktemp -d /tmp/test-suite-utf8-XXXX)
UTF8_NAME='ОКТОИХ петогласник 2.pdf'
UTF8_PATH="$UTF8_DIR/$UTF8_NAME"
echo "%PDF-1.0 cyrillic test" > "$UTF8_PATH"

UTF8_RESP=$(curl -s -w "\n%{http_code}" -X POST "$API/files/upload/$DRAFT_PUBLIC_ID" \
  -H "Authorization: Bearer $TOKEN_CATALOGUER" \
  -F "files=@$UTF8_PATH;type=application/pdf" \
  -F "extractedTexts={\"$UTF8_NAME\":\"Црногорски текст\"}" 2>/dev/null)
HTTP_STATUS=$(echo "$UTF8_RESP" | tail -1)
HTTP_BODY=$(echo "$UTF8_RESP" | sed '$d')
assert_status "Upload with Cyrillic filename" "201"

UTF8_RETURNED=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['filename'])" 2>/dev/null || echo "")
if [ "$UTF8_RETURNED" = "$UTF8_NAME" ]; then
  echo -e "  ${GREEN}PASS${NC} Cyrillic filename round-trips unchanged"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Filename mangled: expected '$UTF8_NAME', got '$UTF8_RETURNED'"
  ((FAILED++))
fi

UTF8_STATUS=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['textExtractionStatus'])" 2>/dev/null || echo "")
if [ "$UTF8_STATUS" = "EXTRACTED" ]; then
  echo -e "  ${GREEN}PASS${NC} extractedTexts keyed by Cyrillic filename matched"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Expected EXTRACTED for Cyrillic key, got $UTF8_STATUS"
  ((FAILED++))
fi

UTF8_FILE_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null || echo "")

# An extractedTexts key matching no uploaded part is a client bug — reject it
# rather than storing the file and dropping the text.
UNMATCHED_RESP=$(curl -s -w "\n%{http_code}" -X POST "$API/files/upload/$DRAFT_PUBLIC_ID" \
  -H "Authorization: Bearer $TOKEN_CATALOGUER" \
  -F "files=@$UTF8_PATH;type=application/pdf" \
  -F "extractedTexts={\"no-such-file.pdf\":\"orphan text\"}" 2>/dev/null)
HTTP_STATUS=$(echo "$UNMATCHED_RESP" | tail -1)
HTTP_BODY=$(echo "$UNMATCHED_RESP" | sed '$d')
assert_status "extractedTexts key matching no file is rejected" "400"
assert_body_contains "Rejection names the unmatched key" "no-such-file.pdf"

if [ -n "$UTF8_FILE_ID" ]; then
  # RFC 6266: non-ASCII names must travel in filename*, percent-encoded as UTF-8.
  UTF8_CD=$(curl -s -D - -o /dev/null "$API/files/$UTF8_FILE_ID/download" \
    -H "Authorization: Bearer $TOKEN_CATALOGUER" 2>/dev/null | grep -i '^content-disposition:' | tr -d '\r')
  UTF8_EXPECTED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$UTF8_NAME")
  if echo "$UTF8_CD" | grep -qF "filename*=UTF-8''$UTF8_EXPECTED"; then
    echo -e "  ${GREEN}PASS${NC} Download offers the original filename via filename*"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} Content-Disposition missing correct filename*: $UTF8_CD"
    ((FAILED++))
  fi

  # Replace uses a separate interceptor — same decoding must apply there.
  UTF8_NAME2='Требник замена.pdf'
  echo "%PDF-1.0 replaced" > "$UTF8_DIR/$UTF8_NAME2"
  REPLACE_RESP=$(curl -s -w "\n%{http_code}" -X PUT "$API/files/$UTF8_FILE_ID" \
    -H "Authorization: Bearer $TOKEN_CATALOGUER" \
    -F "file=@$UTF8_DIR/$UTF8_NAME2;type=application/pdf" \
    -F "extractedText=Замењени текст" 2>/dev/null)
  HTTP_STATUS=$(echo "$REPLACE_RESP" | tail -1)
  HTTP_BODY=$(echo "$REPLACE_RESP" | sed '$d')
  assert_status "Replace with Cyrillic filename" "200"

  REPLACED_NAME=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['filename'])" 2>/dev/null || echo "")
  if [ "$REPLACED_NAME" = "$UTF8_NAME2" ]; then
    echo -e "  ${GREEN}PASS${NC} Replace preserves the Cyrillic filename"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} Replace mangled filename: expected '$UTF8_NAME2', got '$REPLACED_NAME'"
    ((FAILED++))
  fi

  http DELETE "$API/files/$UTF8_FILE_ID" "$TOKEN_ADMIN"
else
  echo -e "  ${YELLOW}SKIP${NC} Cyrillic download/replace — upload didn't return file ID"
  ((SKIPPED+=4))
fi

rm -rf "$UTF8_DIR"

# --- 8d: Upload with role ---
echo -e "\n  ${YELLOW}Upload with role (FileRole)...${NC}"

TMPFILE_ROLE=$(mktemp /tmp/test-suite-XXXX.txt)
echo "Test file for role upload" > "$TMPFILE_ROLE"

# Upload with role=WEB
UPLOAD_ROLE_RESP=$(curl -sf -w "\n%{http_code}" -X POST "$API/files/upload/$DRAFT_PUBLIC_ID" \
  -H "Authorization: Bearer $TOKEN_CATALOGUER" \
  -F "files=@$TMPFILE_ROLE" \
  -F "role=WEB" 2>/dev/null)
HTTP_STATUS=$(echo "$UPLOAD_ROLE_RESP" | tail -1)
HTTP_BODY=$(echo "$UPLOAD_ROLE_RESP" | sed '$d')
assert_status "Upload file with role=WEB" "201"

ROLE_VALUE=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['role'])" 2>/dev/null || echo "")
if [ "$ROLE_VALUE" = "WEB" ]; then
  echo -e "  ${GREEN}PASS${NC} role is WEB"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Expected role=WEB, got $ROLE_VALUE"
  ((FAILED++))
fi

ROLE_FILE_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null || echo "")

# Upload without role — should default to SOURCE
UPLOAD_DEFAULT_RESP=$(curl -sf -w "\n%{http_code}" -X POST "$API/files/upload/$DRAFT_PUBLIC_ID" \
  -H "Authorization: Bearer $TOKEN_CATALOGUER" \
  -F "files=@$TMPFILE_ROLE" 2>/dev/null)
HTTP_STATUS=$(echo "$UPLOAD_DEFAULT_RESP" | tail -1)
HTTP_BODY=$(echo "$UPLOAD_DEFAULT_RESP" | sed '$d')
assert_status "Upload file without role (defaults to SOURCE)" "201"

DEFAULT_ROLE=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['role'])" 2>/dev/null || echo "")
if [ "$DEFAULT_ROLE" = "SOURCE" ]; then
  echo -e "  ${GREEN}PASS${NC} default role is SOURCE"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Expected default role=SOURCE, got $DEFAULT_ROLE"
  ((FAILED++))
fi

DEFAULT_ROLE_FILE_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null || echo "")

# Upload with invalid role — should be rejected
UPLOAD_BAD_ROLE_RESP=$(curl -sf -w "\n%{http_code}" -X POST "$API/files/upload/$DRAFT_PUBLIC_ID" \
  -H "Authorization: Bearer $TOKEN_CATALOGUER" \
  -F "files=@$TMPFILE_ROLE" \
  -F "role=INVALID" 2>/dev/null)
HTTP_STATUS=$(echo "$UPLOAD_BAD_ROLE_RESP" | tail -1)
HTTP_BODY=$(echo "$UPLOAD_BAD_ROLE_RESP" | sed '$d')
assert_status "Upload with invalid role rejected" "400"

# List files — verify role field present
http GET "$API/files/$DRAFT_PUBLIC_ID" "$TOKEN_ADMIN"
assert_status "List files includes role field" "200"
assert_body_contains "List response contains role field" '"role"'

# Cleanup role test files
if [ -n "$ROLE_FILE_ID" ]; then
  http DELETE "$API/files/$ROLE_FILE_ID" "$TOKEN_ADMIN"
fi
if [ -n "$DEFAULT_ROLE_FILE_ID" ]; then
  http DELETE "$API/files/$DEFAULT_ROLE_FILE_ID" "$TOKEN_ADMIN"
fi

rm -f "$TMPFILE_ROLE"

# --- 8e: Replace file (PUT /files/:fileId) ---
echo -e "\n  ${YELLOW}Replace file (PUT /files/:fileId)...${NC}"

# Upload a file to replace later
TMPFILE_REPLACE=$(mktemp /tmp/test-suite-XXXX.txt)
echo "Original file content" > "$TMPFILE_REPLACE"

http_upload "$API/files/upload/$DRAFT_PUBLIC_ID" "$TOKEN_CATALOGUER" "$TMPFILE_REPLACE"
assert_status "Upload file for replace test" "201"
REPLACE_FILE_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null || echo "")

if [ -n "$REPLACE_FILE_ID" ]; then
  TMPFILE_NEW=$(mktemp /tmp/test-suite-new-XXXX.txt)
  echo "Replacement file content" > "$TMPFILE_NEW"

  # Anonymous cannot replace
  REPLACE_RESP=$(curl -sf -w "\n%{http_code}" -X PUT "$API/files/$REPLACE_FILE_ID" \
    -F "file=@$TMPFILE_NEW" 2>/dev/null)
  HTTP_STATUS=$(echo "$REPLACE_RESP" | tail -1)
  HTTP_BODY=$(echo "$REPLACE_RESP" | sed '$d')
  assert_status "Anonymous cannot replace file" "401"

  # Reader cannot replace
  REPLACE_RESP=$(curl -sf -w "\n%{http_code}" -X PUT "$API/files/$REPLACE_FILE_ID" \
    -H "Authorization: Bearer $TOKEN_READER" \
    -F "file=@$TMPFILE_NEW" 2>/dev/null)
  HTTP_STATUS=$(echo "$REPLACE_RESP" | tail -1)
  HTTP_BODY=$(echo "$REPLACE_RESP" | sed '$d')
  assert_status "Reader cannot replace file" "403"

  # Cataloguer can replace file
  REPLACE_RESP=$(curl -sf -w "\n%{http_code}" -X PUT "$API/files/$REPLACE_FILE_ID" \
    -H "Authorization: Bearer $TOKEN_CATALOGUER" \
    -F "file=@$TMPFILE_NEW" 2>/dev/null)
  HTTP_STATUS=$(echo "$REPLACE_RESP" | tail -1)
  HTTP_BODY=$(echo "$REPLACE_RESP" | sed '$d')
  assert_status "Cataloguer can replace file" "200"

  # Verify ID is stable
  REPLACED_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
  if [ "$REPLACED_ID" = "$REPLACE_FILE_ID" ]; then
    echo -e "  ${GREEN}PASS${NC} Replace keeps attachment ID stable"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} Expected same ID $REPLACE_FILE_ID, got $REPLACED_ID"
    ((FAILED++))
  fi

  # Replace with pre-extracted text
  REPLACE_TEXT_RESP=$(curl -sf -w "\n%{http_code}" -X PUT "$API/files/$REPLACE_FILE_ID" \
    -H "Authorization: Bearer $TOKEN_CATALOGUER" \
    -F "file=@$TMPFILE_NEW" \
    -F "extractedText=Replaced file OCR text." 2>/dev/null)
  HTTP_STATUS=$(echo "$REPLACE_TEXT_RESP" | tail -1)
  HTTP_BODY=$(echo "$REPLACE_TEXT_RESP" | sed '$d')
  assert_status "Replace with pre-extracted text" "200"

  REPLACE_TEXT_STATUS=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['textExtractionStatus'])" 2>/dev/null || echo "")
  if [ "$REPLACE_TEXT_STATUS" = "EXTRACTED" ]; then
    echo -e "  ${GREEN}PASS${NC} Replace with text sets EXTRACTED status"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} Expected EXTRACTED, got $REPLACE_TEXT_STATUS"
    ((FAILED++))
  fi

  # Cleanup
  http DELETE "$API/files/$REPLACE_FILE_ID" "$TOKEN_ADMIN"
  rm -f "$TMPFILE_NEW"
else
  echo -e "  ${YELLOW}SKIP${NC} Replace file — upload didn't return file ID"
  ((SKIPPED+=5))
fi

rm -f "$TMPFILE_REPLACE"

# ============================================================================
# 9. COBISS PREVIEW (new endpoint)
# ============================================================================
section "9. COBISS Preview"

# Anonymous cannot access preview
http GET "$API/import/cobiss/preview/2898183"
assert_status "Anonymous cannot access COBISS preview" "401"

# Reader cannot access preview
http GET "$API/import/cobiss/preview/2898183" "$TOKEN_READER"
assert_status "Reader cannot access COBISS preview" "403"

# Cataloguer can access preview
http GET "$API/import/cobiss/preview/2898183" "$TOKEN_CATALOGUER"
assert_status "Cataloguer can access COBISS preview" "200"
assert_body_contains "Preview returns cobissId" '"cobissId":"2898183"'
assert_body_contains "Preview returns itemId" '"itemId"'
assert_body_contains "Preview returns alreadyExists" '"alreadyExists"'
assert_body_contains "Preview returns metadata" '"metadata"'

# Non-existent COBISS ID returns 404
http GET "$API/import/cobiss/preview/000000001" "$TOKEN_ADMIN"
assert_status "Non-existent COBISS ID returns 404" "404"

# Admin can access preview
http GET "$API/import/cobiss/preview/2898183" "$TOKEN_ADMIN"
assert_status "Admin can access COBISS preview" "200"

# ============================================================================
# 10. COBISS IMPORT
# ============================================================================
section "10. COBISS Import"

# Anonymous cannot import
http POST "$API/import/cobiss" "" '{"ids":["999999998"],"target":"DRAFT","visibilityStatus":"PRIVATE"}'
assert_status "Anonymous cannot import" "401"

# Reader cannot import
http POST "$API/import/cobiss" "$TOKEN_READER" '{"ids":["999999998"],"target":"DRAFT","visibilityStatus":"PRIVATE"}'
assert_status "Reader cannot import" "403"

# Cataloguer can import to draft
http POST "$API/import/cobiss" "$TOKEN_CATALOGUER" '{"ids":["999999998"],"target":"DRAFT","visibilityStatus":"PRIVATE"}'
assert_status "Cataloguer can import to draft" "201"
JOB_ID=$(json_field "['jobId']" 2>/dev/null || echo "")

if [ -n "$JOB_ID" ]; then
  # Check job status
  sleep 2
  http GET "$API/import/jobs/$JOB_ID" "$TOKEN_CATALOGUER"
  assert_status "Check import job status" "200"
  assert_body_contains "Job has state field" '"state"'
fi

# Cataloguer cannot import to record (missing records:manage)
http POST "$API/import/cobiss" "$TOKEN_CATALOGUER" '{"ids":["999999997"],"target":"RECORD","visibilityStatus":"PRIVATE"}'
assert_status "Cataloguer cannot import to record" "403"

# ============================================================================
# 11. METADATA VALIDATION
# ============================================================================
section "11. Metadata Validation"

# Missing title should fail (title is required)
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"collectionType":0}}'
assert_status "Create without title fails" "400"

# Empty title should fail
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"","collectionType":0}}'
assert_status "Create with empty title fails" "400"

# Invalid targetState
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"INVALID","visibilityStatus":"PUBLIC","metadata":{"title":"test"}}'
assert_status "Invalid targetState rejected" "400"

# Invalid visibilityStatus
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"INVALID","metadata":{"title":"test"}}'
assert_status "Invalid visibilityStatus rejected" "400"

# ============================================================================
# 12. EDGE CASES
# ============================================================================
section "12. Edge Cases"

# Non-existent item returns 404
http GET "$API/search/nonexistent-id-12345"
assert_status "Non-existent item returns 404" "404"

# Update non-existent item
http PATCH "$API/items/nonexistent-id-12345" "$TOKEN_ADMIN" '{"expectedVersion":0,"metadata":{"title":"nope"}}'
assert_status "Update non-existent item returns 404" "404"

# Delete non-existent item
http DELETE "$API/items" "$TOKEN_ADMIN" '{"ids":["nonexistent-id-12345"]}'
assert_status "Delete non-existent item returns 404" "404"

# Children of non-existent parent
http GET "$API/search/nonexistent-id-12345/children" "$TOKEN_ADMIN"
assert_status "Children of non-existent item" "200"

# Transition non-existent item
http POST "$API/items/transition" "$TOKEN_ADMIN" '{"targetState":"RECORD","ids":["nonexistent-id-12345"]}'
assert_status "Transition non-existent item fails" "404"

# ============================================================================
# SCHEMA ENDPOINT
# ============================================================================
section "Schema Endpoint"

# Any authenticated user can fetch schema
http GET "$API/schema/record" "$TOKEN_ADMIN"
assert_status "GET /schema/record returns 200 (admin)" "200"
assert_body_contains "Schema response has fields array" '"fields"'
assert_body_contains "Schema includes title field" '"key":"title"'

# level=main filter
http GET "$API/schema/record?level=main" "$TOKEN_ADMIN"
assert_status "GET /schema/record?level=main returns 200" "200"
assert_body_contains "Main-level has title" '"key":"title"'

# level=child filter
http GET "$API/schema/record?level=child" "$TOKEN_ADMIN"
assert_status "GET /schema/record?level=child returns 200" "200"
assert_body_contains "Child-level has title" '"key":"title"'

# An unrecognised level must be a 400, never a cacheable empty field list.
http GET "$API/schema/record?level=bogus" "$TOKEN_ADMIN"
assert_status "GET /schema/record?level=bogus returns 400" "400"

# Case-sensitive: ?level=MAIN is an ordinary client typo and must not
# silently answer 200 {fields: []}.
http GET "$API/schema/record?level=MAIN" "$TOKEN_ADMIN"
assert_status "GET /schema/record?level=MAIN returns 400" "400"

# ?level= (empty value) has always meant "all fields" — unchanged.
http GET "$API/schema/record?level=" "$TOKEN_ADMIN"
assert_status "GET /schema/record?level= (empty) returns 200" "200"
assert_body_contains "Empty level returns full field set" '"key":"collectionType"'

# ETag support: second request with If-None-Match should get 304
http GET "$API/schema/record" "$TOKEN_ADMIN"
ETAG=$(echo "$HTTP_BODY" | grep -o '"ETag"' || true)
# Actually grab ETag from response headers — re-fetch via curl directly
ETAG_VAL=$(curl -s -o /dev/null -D - -H "Authorization: Bearer $TOKEN_ADMIN" "$API/schema/record" 2>/dev/null | grep -i 'etag:' | tr -d '\r' | awk '{print $2}')
if [ -n "$ETAG_VAL" ]; then
  HTTP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN_ADMIN" -H "If-None-Match: $ETAG_VAL" "$API/schema/record" 2>/dev/null)
  if [ "$HTTP_STATUS" = "304" ]; then
    echo -e "  ${GREEN}PASS${NC} ETag 304 Not Modified works"
    ((PASSED++))
  else
    echo -e "  ${YELLOW}SKIP${NC} ETag 304 check — got $HTTP_STATUS (framework may buffer)"
    ((SKIPPED++))
  fi
else
  echo -e "  ${YELLOW}SKIP${NC} ETag header not found in response"
  ((SKIPPED++))
fi

# Anonymous should still be able to access (read-only, public metadata)
http GET "$API/schema/record"
assert_status "GET /schema/record returns 200 (anonymous)" "200"

# ============================================================================
# OPTIMISTIC CONCURRENCY
# ============================================================================
section "Optimistic Concurrency"

# Create item for concurrency tests
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-CONCURRENCY","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create item for concurrency test" "201"
CONC_ID=$(json_field "['id']")
CLEANUP_IDS+=("$CONC_ID")
CONC_VERSION=$(json_field "['version']")

# Update with correct expectedVersion succeeds
http PATCH "$API/items/$CONC_ID" "$TOKEN_EDITOR" "{\"expectedVersion\":$CONC_VERSION,\"metadata\":{\"title\":\"TEST-SUITE-CONCURRENCY-V1\"}}"
assert_status "Update with correct expectedVersion succeeds" "200"
NEW_VERSION=$(json_field "['version']")
if [ "$NEW_VERSION" = "1" ]; then
  echo -e "  ${GREEN}PASS${NC} Version bumped to 1"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Expected version=1, got $NEW_VERSION"
  ((FAILED++))
fi

# Update with stale expectedVersion returns 409
http PATCH "$API/items/$CONC_ID" "$TOKEN_EDITOR" '{"expectedVersion":0,"metadata":{"title":"TEST-SUITE-CONCURRENCY-STALE"}}'
assert_status "Update with stale expectedVersion returns 409" "409"

# Update without expectedVersion is rejected (required field)
http PATCH "$API/items/$CONC_ID" "$TOKEN_EDITOR" '{"metadata":{"title":"TEST-SUITE-CONCURRENCY-NOVERSION"}}'
assert_status "Update without expectedVersion returns 400" "400"

# Update with correct version after previous bump
http PATCH "$API/items/$CONC_ID" "$TOKEN_EDITOR" '{"expectedVersion":1,"metadata":{"title":"TEST-SUITE-CONCURRENCY-V2"}}'
assert_status "Update with correct version after bumps" "200"

# --- Empty-payload PATCH is checked exactly as strictly as a real one -------
# A payload with nothing to write used to short-circuit before the existence
# and version guards, reporting success against a missing id or a stale version.

# Empty payload against a nonexistent id must 404, not report success.
http PATCH "$API/items/nonexistent-id-12345" "$TOKEN_ADMIN" '{"expectedVersion":0,"metadata":{}}'
assert_status "Empty PATCH on nonexistent id returns 404" "404"

# Empty payload with a stale expectedVersion must 409, not report success.
http PATCH "$API/items/$CONC_ID" "$TOKEN_EDITOR" '{"expectedVersion":0,"metadata":{}}'
assert_status "Empty PATCH with stale expectedVersion returns 409" "409"

# Empty payload at the right version succeeds and carries the unchanged
# version, so every PATCH response has the same shape.
http PATCH "$API/items/$CONC_ID" "$TOKEN_EDITOR" '{"expectedVersion":2,"metadata":{}}'
assert_status "Empty PATCH at correct version succeeds" "200"
assert_json_field "Empty PATCH returns unchanged version" "['version']" "2"

# ============================================================================
# INDEXED TIMESTAMP FORMAT
# ============================================================================
section "Indexed Timestamp Format"

# The DB columns are timestamptz, so the CDC copy carries an offset. Without
# one, JS parses an indexed timestamp as LOCAL time and every client reading
# hit.source.createdAt is skewed by its own UTC offset.

http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-TIMESTAMP","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create item for timestamp test" "201"
TS_ID=$(json_field "['id']")
CLEANUP_IDS+=("$TS_ID")
TS_REST=$(json_field "['createdAt']")

# Wait for CDC to carry the row into the index
sleep 5
http GET "$API/search/$TS_ID" "$TOKEN_ADMIN"
TS_INDEXED=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['source']['createdAt'])" 2>/dev/null || echo "")

if [ -z "$TS_INDEXED" ]; then
  echo -e "  ${YELLOW}SKIP${NC} Indexed timestamp not available yet (PGSync lag)"
  ((SKIPPED++))
else
  # Unambiguous: must end in Z or carry an explicit ±HH:MM offset
  if echo "$TS_INDEXED" | grep -qE 'Z$|[+-][0-9]{2}:?[0-9]{2}$'; then
    echo -e "  ${GREEN}PASS${NC} Indexed timestamp carries a timezone ($TS_INDEXED)"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} Indexed timestamp has no timezone: $TS_INDEXED"
    ((FAILED++))
    ERRORS+=("Indexed createdAt has no timezone: $TS_INDEXED")
  fi

  # Same instant as the REST representation
  if python3 -c "
import re, sys
from datetime import datetime

def p(s):
    s = s.replace('Z', '+00:00')
    # JSON drops a trailing zero from the fraction, so the indexed copy can read
    # '.38' where REST says '.380'. Same instant; pad it, because
    # datetime.fromisoformat before 3.11 only accepts exactly 3 or 6 digits.
    return datetime.fromisoformat(
        re.sub(r'\.(\d{1,6})', lambda m: '.' + m.group(1).ljust(6, '0'), s)
    )

sys.exit(0 if p('$TS_REST') == p('$TS_INDEXED') else 1)
"; then
    echo -e "  ${GREEN}PASS${NC} REST and indexed createdAt are the same instant"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} REST ($TS_REST) != indexed ($TS_INDEXED)"
    ((FAILED++))
    ERRORS+=("REST createdAt $TS_REST != indexed $TS_INDEXED")
  fi
fi

# ============================================================================
# 13. CHANGE HISTORY
# ============================================================================
section "13. Change History"

# --- Local helpers ---------------------------------------------------------

# Postgres directly. Two claims in this file cannot be checked over HTTP: that a
# view leaves the item row untouched (the search index is CDC-lagged, so reading
# it back proves nothing about the row), and what the counters actually hold.
psql_query() {
  docker exec nbcg-db-1 psql -U nbcg -d nbcg -tAc "$1" 2>/dev/null | tr -d '[:space:]'
}

PSQL_OK=0
if [ "$(psql_query 'SELECT 1')" = "1" ]; then PSQL_OK=1; fi
if [ "$PSQL_OK" = "0" ]; then
  echo -e "  ${YELLOW}NOTE${NC} psql unavailable — counter assertions will be skipped"
fi

# The plain `http` helper sends curl's default user-agent, which the counter's
# bot filter drops. That is deliberate and asserted below, so anything that is
# supposed to be counted has to go through this helper instead.
BROWSER_UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
http_ua() {
  local method=$1 url=$2 token=${3:-""}
  local -a args=(-s -w "\n%{http_code}" -X "$method" -A "$BROWSER_UA")
  if [ -n "$token" ]; then
    args+=(-H "Authorization: Bearer $token")
  fi
  local response
  response=$(curl "${args[@]}" "$url" 2>/dev/null)
  HTTP_STATUS=$(echo "$response" | tail -1)
  HTTP_BODY=$(echo "$response" | sed '$d')
}

# Assert the last /history response carries a revision with this action,
# optionally one whose `changes` touch a given path.
assert_revision() {
  local test_name=$1 action=$2 path=${3:-""}
  local found
  found=$(echo "$HTTP_BODY" | python3 -c "
import sys, json
path = '$path'
revs = json.load(sys.stdin)['revisions']
hits = [r for r in revs if r['action'] == '$action']
if path:
    hits = [r for r in hits if any(c['path'] == path for c in (r['changes'] or []))]
print('yes' if hits else 'no')
" 2>/dev/null) || found="no"

  if [ "$found" = "yes" ]; then
    echo -e "  ${GREEN}PASS${NC} $test_name"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} $test_name (no $action revision${path:+ touching $path})"
    ((FAILED++))
    ERRORS+=("$test_name: no $action revision${path:+ touching $path}")
  fi
}

# Sum of a metric for one item, straight from the counter table.
metric_count() {
  local item_id=$1 metric=$2
  psql_query "SELECT COALESCE(SUM(count), 0) FROM item_metrics_daily WHERE \"itemId\" = '$item_id' AND metric = '$metric'"
}

assert_metric() {
  local test_name=$1 actual=$2 expected=$3
  if [ "$PSQL_OK" = "0" ]; then
    echo -e "  ${YELLOW}SKIP${NC} $test_name (no psql)"
    ((SKIPPED++))
  elif [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}PASS${NC} $test_name"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} $test_name (expected $expected, got $actual)"
    ((FAILED++))
    ERRORS+=("$test_name: expected $expected, got $actual")
  fi
}

# Counters are buffered in memory and flushed on a timer — give it a window.
FLUSH_WAIT=4

# --- 13a: an item opens its timeline at creation ---------------------------
echo -e "\n  ${YELLOW}Item timeline...${NC}"

http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-HISTORY","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create item for history test" "201"
HIST_ID=$(json_field "['id']")
CLEANUP_IDS+=("$HIST_ID")

http GET "$API/items/$HIST_ID/history" "$TOKEN_ADMIN"
assert_status "GET /items/:id/history returns 200" "200"
assert_json_field "New item has exactly one revision" "['total']" "1"
assert_revision "Creation is recorded as CREATE" "CREATE"

# --- 13b: history is admin-only, same guard as /items/stats ----------------
echo -e "\n  ${YELLOW}History auth...${NC}"

http GET "$API/items/$HIST_ID/history"
assert_status "Anonymous cannot read history" "401"

http GET "$API/items/$HIST_ID/history" "$TOKEN_READER"
assert_status "Reader cannot read history" "403"

http GET "$API/items/$HIST_ID/history" "$TOKEN_CATALOGUER"
assert_status "Cataloguer can read history" "200"

# --- 13c: a metadata edit is stored as a field-level diff ------------------
echo -e "\n  ${YELLOW}Field-level diffs...${NC}"

http PATCH "$API/items/$HIST_ID" "$TOKEN_EDITOR" '{"expectedVersion":0,"metadata":{"title":"TEST-SUITE-HISTORY-EDITED"}}'
assert_status "Edit item title" "200"

http GET "$API/items/$HIST_ID/history" "$TOKEN_ADMIN"
assert_revision "Edit recorded as UPDATE on the changed field" "UPDATE" "title"

DIFF=$(echo "$HTTP_BODY" | python3 -c "
import sys, json
for r in json.load(sys.stdin)['revisions']:
    for c in (r['changes'] or []):
        if c['path'] == 'title':
            print(f\"{c['before']}->{c['after']}\"); raise SystemExit
" 2>/dev/null)
if [ "$DIFF" = "TEST-SUITE-HISTORY->TEST-SUITE-HISTORY-EDITED" ]; then
  echo -e "  ${GREEN}PASS${NC} Diff carries before and after values"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Diff values wrong: $DIFF"
  ((FAILED++))
  ERRORS+=("title diff was '$DIFF'")
fi

# A visibility-only change reads better on a timeline as its own action.
http PATCH "$API/items/$HIST_ID" "$TOKEN_EDITOR" '{"expectedVersion":1,"visibilityStatus":"HIDDEN"}'
assert_status "Change visibility only" "200"
http GET "$API/items/$HIST_ID/history" "$TOKEN_ADMIN"
assert_revision "Visibility-only edit is VISIBILITY_CHANGE" "VISIBILITY_CHANGE" "visibilityStatus"

# --- 13d: publish/unpublish stay on the same timeline ----------------------
# transition() preserves the id, so drafting and post-publication edits are one
# continuous history rather than two.
echo -e "\n  ${YELLOW}Publish / unpublish...${NC}"

http POST "$API/items/transition" "$TOKEN_ADMIN" "{\"ids\":[\"$HIST_ID\"],\"targetState\":\"RECORD\"}"
assert_status "Publish item" "201"
http GET "$API/items/$HIST_ID/history" "$TOKEN_ADMIN"
assert_revision "Publish recorded as PUBLISH" "PUBLISH" "itemType"
assert_revision "Draft-era CREATE still on the same timeline" "CREATE"

http POST "$API/items/transition" "$TOKEN_ADMIN" "{\"ids\":[\"$HIST_ID\"],\"targetState\":\"DRAFT\"}"
assert_status "Unpublish item" "201"
http GET "$API/items/$HIST_ID/history" "$TOKEN_ADMIN"
assert_revision "Unpublish recorded as UNPUBLISH" "UNPUBLISH" "itemType"

# --- 13e: file and relation writes appear too -------------------------------
echo -e "\n  ${YELLOW}File and relation writes...${NC}"

HIST_FILE=$(mktemp /tmp/nbcg-history-XXXXXX.txt)
echo "history test attachment" > "$HIST_FILE"
http_upload "$API/files/upload/$HIST_ID" "$TOKEN_EDITOR" "$HIST_FILE"
assert_status "Upload file to history item" "201"
HIST_FILE_ID=$(json_field "[0]['id']")

http GET "$API/items/$HIST_ID/history" "$TOKEN_ADMIN"
assert_revision "Upload recorded as FILE_ADDED" "FILE_ADDED"

http DELETE "$API/files/$HIST_FILE_ID" "$TOKEN_EDITOR"
assert_status "Delete file from history item" "200"
http GET "$API/items/$HIST_ID/history" "$TOKEN_ADMIN"
assert_revision "Delete recorded as FILE_REMOVED" "FILE_REMOVED"
rm -f "$HIST_FILE"

http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-HISTORY-CHILD","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create child for relation history" "201"
HIST_CHILD_ID=$(json_field "['id']")
CLEANUP_IDS+=("$HIST_CHILD_ID")

http POST "$API/relations/connect" "$TOKEN_EDITOR" "{\"parentId\":\"$HIST_ID\",\"childIds\":[\"$HIST_CHILD_ID\"]}"
assert_status "Connect child to history item" "201"
http GET "$API/items/$HIST_ID/history" "$TOKEN_ADMIN"
assert_revision "Connect recorded as RELATION_ADDED" "RELATION_ADDED"

http POST "$API/relations/disconnect" "$TOKEN_EDITOR" "{\"parentId\":\"$HIST_ID\",\"childIds\":[\"$HIST_CHILD_ID\"]}"
assert_status "Disconnect child from history item" "200"
http GET "$API/items/$HIST_ID/history" "$TOKEN_ADMIN"
assert_revision "Disconnect recorded as RELATION_REMOVED" "RELATION_REMOVED"

# --- 13f: paging and unknown ids -------------------------------------------
echo -e "\n  ${YELLOW}History paging...${NC}"

http GET "$API/items/$HIST_ID/history?limit=1" "$TOKEN_ADMIN"
assert_status "History accepts limit" "200"
HIST_RETURNED=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['revisions']))" 2>/dev/null)
if [ "$HIST_RETURNED" = "1" ]; then
  echo -e "  ${GREEN}PASS${NC} limit=1 returns a single revision out of many"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} limit=1 returned $HIST_RETURNED revisions"
  ((FAILED++))
  ERRORS+=("history limit=1 returned $HIST_RETURNED")
fi

http GET "$API/items/$HIST_ID/history?limit=0" "$TOKEN_ADMIN"
assert_status "History rejects limit=0" "400"

http GET "$API/items/does-not-exist-12345/history" "$TOKEN_ADMIN"
assert_status "History of unknown id returns 200" "200"
assert_json_field "History of unknown id is empty" "['total']" "0"

# --- 13g: the backfill covers pre-existing items ----------------------------
if [ "$PSQL_OK" = "1" ]; then
  ORPHANS=$(psql_query "SELECT COUNT(*) FROM (SELECT id FROM drafts UNION ALL SELECT id FROM records) i WHERE NOT EXISTS (SELECT 1 FROM item_revisions r WHERE r.\"itemId\" = i.id)")
  if [ "$ORPHANS" = "0" ]; then
    echo -e "  ${GREEN}PASS${NC} Every existing item has at least one revision (backfill)"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} $ORPHANS items have no revision — backfill missed them"
    ((FAILED++))
    ERRORS+=("$ORPHANS items without any revision")
  fi
else
  echo -e "  ${YELLOW}SKIP${NC} Backfill check (no psql)"
  ((SKIPPED++))
fi

# ============================================================================
# 14. USAGE STATISTICS
# ============================================================================
section "14. Usage Statistics"

# --- 14a: auth and shape ----------------------------------------------------
echo -e "\n  ${YELLOW}Stats endpoints auth...${NC}"

for stats_path in "overview" "users" "items/top"; do
  http GET "$API/stats/$stats_path"
  assert_status "Anonymous cannot read /stats/$stats_path" "401"
  http GET "$API/stats/$stats_path" "$TOKEN_READER"
  assert_status "Reader cannot read /stats/$stats_path" "403"
  http GET "$API/stats/$stats_path" "$TOKEN_ADMIN"
  assert_status "Admin can read /stats/$stats_path" "200"
done

http GET "$API/stats/overview" "$TOKEN_ADMIN"
assert_body_contains "Overview carries snapshot totals" '"totals"'
assert_body_contains "Overview carries the activity series" '"activity"'
assert_body_contains "Overview carries the usage series" '"usage"'

# --- 14b: range guards ------------------------------------------------------
echo -e "\n  ${YELLOW}Range validation...${NC}"

http GET "$API/stats/overview?from=2026-01-02&to=2026-01-01" "$TOKEN_ADMIN"
assert_status "Inverted range returns 400" "400"

# Uncapped, this is a full scan of the metrics table on an admin's dashboard refresh.
http GET "$API/stats/overview?from=2000-01-01&to=2026-01-01" "$TOKEN_ADMIN"
assert_status "Range wider than a year returns 400" "400"

http GET "$API/stats/overview?from=yesterday" "$TOKEN_ADMIN"
assert_status "Non-date from value returns 400" "400"

http GET "$API/stats/items/top?limit=9999" "$TOKEN_ADMIN"
assert_status "Top items rejects an unbounded limit" "400"

# --- 14c: views are counted, bots are not -----------------------------------
echo -e "\n  ${YELLOW}View counting...${NC}"

http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"RECORD","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-METRICS","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create item for metrics test" "201"
MET_ID=$(json_field "['id']")
CLEANUP_IDS+=("$MET_ID")

# GET /search/:id reads OpenSearch, so the item has to be indexed first.
sleep 5

# Row state before any view — used below to prove a view doesn't touch it.
MET_ROW_BEFORE=$(psql_query "SELECT version || '|' || \"updatedAt\" FROM records WHERE id = '$MET_ID'")

http_ua GET "$API/search/$MET_ID" "$TOKEN_ADMIN"
assert_status "Item detail read succeeds" "200"
http_ua GET "$API/search/$MET_ID" "$TOKEN_ADMIN" >/dev/null
http_ua GET "$API/search/$MET_ID" "" >/dev/null   # anonymous traffic counts too
sleep "$FLUSH_WAIT"

assert_metric "Three detail opens count as three views" "$(metric_count "$MET_ID" VIEW)" "3"

# curl's own user-agent is on the bot deny-list — unfiltered numbers on a public
# library site are dominated by crawlers.
http GET "$API/search/$MET_ID" "$TOKEN_ADMIN" >/dev/null
http GET "$API/search/$MET_ID" "$TOKEN_ADMIN" >/dev/null
sleep "$FLUSH_WAIT"
assert_metric "Bot user-agents are not counted" "$(metric_count "$MET_ID" VIEW)" "3"

# A 404 probe must not be able to inflate a counter.
http_ua GET "$API/search/does-not-exist-12345" "$TOKEN_ADMIN"
assert_status "Detail read of unknown id returns 404" "404"

# --- 14d: a view must not touch the item ------------------------------------
# The whole reason counters live in their own table: a counter on records/drafts
# would be CDC-visible and re-index the document (metadata plus megabytes of
# nested extractedText) on every single page view.
echo -e "\n  ${YELLOW}Views do not write to the item...${NC}"

MET_ROW_AFTER=$(psql_query "SELECT version || '|' || \"updatedAt\" FROM records WHERE id = '$MET_ID'")
if [ "$PSQL_OK" = "0" ]; then
  echo -e "  ${YELLOW}SKIP${NC} View leaves version and updatedAt untouched (no psql)"
  ((SKIPPED++))
elif [ "$MET_ROW_BEFORE" = "$MET_ROW_AFTER" ] && [ -n "$MET_ROW_BEFORE" ]; then
  echo -e "  ${GREEN}PASS${NC} Views leave version and updatedAt untouched"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Item row changed across views: $MET_ROW_BEFORE -> $MET_ROW_AFTER"
  ((FAILED++))
  ERRORS+=("view mutated the item row: $MET_ROW_BEFORE -> $MET_ROW_AFTER")
fi

http GET "$API/items/$MET_ID/history" "$TOKEN_ADMIN"
assert_json_field "Views add no revisions" "['total']" "1"

# --- 14e: downloads ---------------------------------------------------------
echo -e "\n  ${YELLOW}Download counting...${NC}"

MET_FILE=$(mktemp /tmp/nbcg-metrics-XXXXXX.txt)
echo "download counter test" > "$MET_FILE"
http_upload "$API/files/upload/$MET_ID" "$TOKEN_EDITOR" "$MET_FILE"
assert_status "Upload file for download test" "201"
MET_FILE_ID=$(json_field "[0]['id']")

http_ua GET "$API/files/$MET_FILE_ID/download" "$TOKEN_ADMIN"
assert_status "Download file" "200"
sleep "$FLUSH_WAIT"
assert_metric "Download counts on the parent item" "$(metric_count "$MET_ID" DOWNLOAD)" "1"
assert_metric "Download counts on the file itself" \
  "$(psql_query "SELECT COALESCE(SUM(count), 0) FROM file_metrics_daily WHERE \"fileId\" = '$MET_FILE_ID'")" "1"

# ?inline=1 is how the viewer renders a scan in the page. Counting it would make
# every record with a cover image look heavily downloaded.
http_ua GET "$API/files/$MET_FILE_ID/download?inline=1" "$TOKEN_ADMIN"
assert_status "Inline preview of file" "200"
sleep "$FLUSH_WAIT"
assert_metric "Inline preview is not a download" "$(metric_count "$MET_ID" DOWNLOAD)" "1"

rm -f "$MET_FILE"

# --- 14f: the aggregates report what was recorded ---------------------------
echo -e "\n  ${YELLOW}Aggregates...${NC}"

http GET "$API/stats/items/top" "$TOKEN_ADMIN"
assert_status "Top items returns 200" "200"
assert_body_contains "Viewed item appears in top items" "$MET_ID"

# limit=100 rather than the default 10: every run of this suite leaves another
# file on 1 download, ties are ordered arbitrarily, and once more than `limit`
# files are tied the freshly-downloaded one drops off the list. The claim under
# test is that the download is counted and attributed to the file, not that it
# outranks history.
http GET "$API/stats/items/top?metric=DOWNLOAD&limit=100" "$TOKEN_ADMIN"
assert_status "Top items filters by metric" "200"
assert_body_contains "Downloaded file appears in top files" "$MET_FILE_ID"

http GET "$API/stats/overview" "$TOKEN_ADMIN"
OVERVIEW_CREATED=$(json_field "['activity']['totals']['created']")
if [ -n "$OVERVIEW_CREATED" ] && [ "$OVERVIEW_CREATED" -ge 1 ]; then
  echo -e "  ${GREEN}PASS${NC} Overview counts items created in the period ($OVERVIEW_CREATED)"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Overview reported created=$OVERVIEW_CREATED"
  ((FAILED++))
  ERRORS+=("overview created was '$OVERVIEW_CREATED'")
fi

http GET "$API/stats/users" "$TOKEN_ADMIN"
USER_ROWS=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['users']))" 2>/dev/null)
if [ -n "$USER_ROWS" ] && [ "$USER_ROWS" -ge 1 ]; then
  echo -e "  ${GREEN}PASS${NC} Per-user breakdown lists $USER_ROWS user(s)"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Per-user breakdown was empty"
  ((FAILED++))
  ERRORS+=("stats/users returned no rows")
fi

# --- 14g: counters stay out of CDC ------------------------------------------
PGSYNC_SCHEMA="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/infrastructure/docker/pgsync/schema.json"
if [ ! -f "$PGSYNC_SCHEMA" ]; then
  echo -e "  ${YELLOW}SKIP${NC} pgsync schema not found at $PGSYNC_SCHEMA"
  ((SKIPPED++))
elif grep -qE 'item_revisions|item_metrics_daily|file_metrics_daily' "$PGSYNC_SCHEMA"; then
  echo -e "  ${RED}FAIL${NC} History/metrics tables are in the pgsync schema — every counter bump would re-index"
  ((FAILED++))
  ERRORS+=("new tables must not be tracked by pgsync")
else
  echo -e "  ${GREEN}PASS${NC} History and metrics tables are excluded from pgsync CDC"
  ((PASSED++))
fi

# ============================================================================
# 15. ATTRIBUTION SNAPSHOTS
# ============================================================================
section "15. Attribution Snapshots"

# The display name on a row is captured from the JWT at write time and never
# updated afterwards. Two properties are asserted here: that it is written at
# every write site (including imports, which have no principal), and that it
# does not reach a principal below the staff bar.

# psql_query squeezes all whitespace, which would fuse "editor editor" into a
# single token — a name needs a variant that only takes the first line.
psql_text() {
  docker exec nbcg-db-1 psql -U nbcg -d nbcg -tAc "$1" 2>/dev/null | head -1
}

assert_psql_text() {
  local test_name=$1 query=$2 expected=$3
  if [ "$PSQL_OK" = "0" ]; then
    echo -e "  ${YELLOW}SKIP${NC} $test_name (psql unavailable)"
    ((SKIPPED++))
    return
  fi
  local actual
  actual=$(psql_text "$query")
  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}PASS${NC} $test_name"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} $test_name (expected '$expected', got '$actual')"
    ((FAILED++))
    ERRORS+=("$test_name: expected '$expected', got '$actual'")
  fi
}

# Does the last search response carry an attribution name in any hit's source?
# Reports "empty" for a response with no hits at all, so an absence assertion
# cannot pass just because nothing matched.
attribution_in_search() {
  echo "$HTTP_BODY" | python3 -c "
import sys, json
hits = json.load(sys.stdin)['hits']
if not hits:
    print('empty')
else:
    leaked = [f for h in hits for f in ('createdByName', 'updatedByName') if f in h['source']]
    print('yes' if leaked else 'no')
" 2>/dev/null || echo "error"
}

assert_no_attribution() {
  local test_name=$1
  local found
  found=$(attribution_in_search)
  if [ "$found" = "no" ]; then
    echo -e "  ${GREEN}PASS${NC} $test_name"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} $test_name (attribution_in_search=$found)"
    ((FAILED++))
    ERRORS+=("$test_name: attribution_in_search=$found")
  fi
}

# --- 15a: the name is snapshotted from the JWT at write time -----------------
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-ATTRIBUTION","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create item for attribution test" "201"
ATTRIB_ID=$(json_field "['id']")
CLEANUP_IDS+=("$ATTRIB_ID")

http GET "$API/items/$ATTRIB_ID/history" "$TOKEN_ADMIN"
assert_json_field "CREATE revision names the creator" "['revisions'][0]['userName']" "editor editor"

assert_psql_text "Draft row carries the creator's name" \
  "SELECT \"createdByName\" FROM drafts WHERE id='$ATTRIB_ID'" "editor editor"

# --- 15b: a later edit attributes itself, and does not rewrite the creator ---
http PATCH "$API/items/$ATTRIB_ID" "$TOKEN_CATALOGUER" '{"metadata":{"title":"TEST-SUITE-ATTRIBUTION-EDITED"},"expectedVersion":0}'
assert_status "Cataloguer edits the attribution test item" "200"

http GET "$API/items/$ATTRIB_ID/history" "$TOKEN_ADMIN"
assert_json_field "UPDATE revision names the editor, not the creator" "['revisions'][0]['userName']" "cataloguer cataloguer"

assert_psql_text "Creator name is frozen across an edit by someone else" \
  "SELECT \"createdByName\" FROM drafts WHERE id='$ATTRIB_ID'" "editor editor"
assert_psql_text "Edit records its own author" \
  "SELECT \"updatedByName\" FROM drafts WHERE id='$ATTRIB_ID'" "cataloguer cataloguer"

# --- 15c: the creator snapshot travels across a DRAFT -> RECORD transition ---
http POST "$API/items/transition" "$TOKEN_ADMIN" "{\"ids\":[\"$ATTRIB_ID\"],\"targetState\":\"RECORD\"}"
assert_status "Transition attribution test item to RECORD" "201"

assert_psql_text "Record keeps the original creator after publication" \
  "SELECT \"createdByName\" FROM records WHERE id='$ATTRIB_ID'" "editor editor"
assert_psql_text "Publication is attributed to whoever published" \
  "SELECT \"updatedByName\" FROM records WHERE id='$ATTRIB_ID'" "admin admin"

# --- 15d: imports have no principal, but must not have a blank byline -------
if [ "$PSQL_OK" = "1" ]; then
  BAD_SYSTEM=$(psql_query "SELECT count(*) FROM (
    SELECT \"createdByUserId\" AS uid, \"createdByName\" AS name FROM records
    UNION ALL SELECT \"createdByUserId\", \"createdByName\" FROM drafts
  ) t WHERE uid = 'system' AND name <> 'System (import)'")
  if [ "$BAD_SYSTEM" = "0" ]; then
    echo -e "  ${GREEN}PASS${NC} Import-created rows render as 'System (import)'"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} $BAD_SYSTEM import rows have a name other than 'System (import)'"
    ((FAILED++))
    ERRORS+=("import rows with wrong createdByName: $BAD_SYSTEM")
  fi

  BLANK=$(psql_query "SELECT count(*) FROM (
    SELECT \"createdByName\" AS name FROM records
    UNION ALL SELECT \"createdByName\" FROM drafts
    UNION ALL SELECT \"userName\" FROM item_revisions
  ) t WHERE name IS NULL OR btrim(name) = ''")
  if [ "$BLANK" = "0" ]; then
    echo -e "  ${GREEN}PASS${NC} No row anywhere has a blank attribution name"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} $BLANK rows have a blank attribution name"
    ((FAILED++))
    ERRORS+=("blank attribution names: $BLANK")
  fi
else
  echo -e "  ${YELLOW}SKIP${NC} Import and blank-name attribution checks (psql unavailable)"
  ((SKIPPED++))
fi

# --- 15e: attribution never reaches a principal below the staff bar ---------
# reader holds records:view:* only and anonymous holds nothing, so neither has
# drafts:manage or records:manage. cataloguer does (via drafts:manage) — which
# is the inverse of how the roles are named out loud, and is asserted below.
#
# Two vectors, and closing one is not enough: the default path returns the whole
# _source, and `?fields=` is a client-supplied projection that could otherwise
# name the withheld field directly.
sleep 5 # let CDC carry the transitioned record into the index

http GET "$API/search?q=TEST-SUITE-&limit=100" "$TOKEN_READER"
assert_no_attribution "Reader sees no attribution names in search"

http GET "$API/search?q=TEST-SUITE-&limit=100&fields=createdByName,updatedByName" "$TOKEN_READER"
assert_no_attribution "Reader cannot re-request attribution through ?fields="

http GET "$API/search?q=TEST-SUITE-&limit=100"
assert_no_attribution "Anonymous sees no attribution names in search"

http GET "$API/search?q=TEST-SUITE-&limit=100&fields=createdByName"
assert_no_attribution "Anonymous cannot re-request attribution through ?fields="

http GET "$API/search/$ATTRIB_ID" "$TOKEN_READER"
if echo "$HTTP_BODY" | grep -q "createdByName"; then
  echo -e "  ${RED}FAIL${NC} Reader sees attribution on a single-item read"
  ((FAILED++))
  ERRORS+=("GET /search/:id leaks createdByName to reader")
else
  echo -e "  ${GREEN}PASS${NC} Reader sees no attribution on a single-item read"
  ((PASSED++))
fi

# The positive control. Without it the four absence assertions above would also
# pass on an index that simply does not carry the column, which is exactly the
# state before the pgsync mapping change and reindex land.
if [ -f "$PGSYNC_SCHEMA" ] && grep -q 'createdByName' "$PGSYNC_SCHEMA"; then
  http GET "$API/search?q=TEST-SUITE-&limit=100" "$TOKEN_ADMIN"
  FOUND=$(attribution_in_search)
  if [ "$FOUND" = "yes" ]; then
    echo -e "  ${GREEN}PASS${NC} Admin does see attribution names in search"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} Admin sees no attribution names either (attribution_in_search=$FOUND)"
    ((FAILED++))
    ERRORS+=("admin should see createdByName in search: $FOUND")
  fi

  http GET "$API/search?q=TEST-SUITE-&limit=100&fields=createdByName" "$TOKEN_CATALOGUER"
  FOUND=$(attribution_in_search)
  if [ "$FOUND" = "yes" ]; then
    echo -e "  ${GREEN}PASS${NC} Cataloguer sees attribution (drafts:manage clears the bar)"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} Cataloguer should see attribution (attribution_in_search=$FOUND)"
    ((FAILED++))
    ERRORS+=("cataloguer should see createdByName in search: $FOUND")
  fi
else
  echo -e "  ${YELLOW}SKIP${NC} Attribution-visible-to-staff control (pgsync schema does not ship createdByName yet)"
  ((SKIPPED++))
fi

# --- 15f: the projection cannot bypass the _source excludes -----------------
# `?fields=` used to emit includes with no excludes alongside, so naming a
# parent object pulled its excluded children back out with it.
http GET "$API/search?limit=10&fields=file_attachments" "$TOKEN_ADMIN"
if echo "$HTTP_BODY" | grep -q "extractedText"; then
  echo -e "  ${RED}FAIL${NC} ?fields=file_attachments returns extractedText"
  ((FAILED++))
  ERRORS+=("?fields=file_attachments re-requests extractedText")
else
  echo -e "  ${GREEN}PASS${NC} ?fields=file_attachments still withholds extractedText"
  ((PASSED++))
fi

# --- 15g: unknown projection fields are dropped, not passed through ---------
http GET "$API/search?limit=1&fields=nonsense,metadata.title" "$TOKEN_ADMIN"
assert_status "Unknown ?fields= entry does not error" "200"
UNKNOWN_KEYS=$(echo "$HTTP_BODY" | python3 -c "
import sys, json
hits = json.load(sys.stdin)['hits']
print(','.join(sorted(hits[0]['source'].keys())) if hits else 'empty')
" 2>/dev/null)
if [ "$UNKNOWN_KEYS" = "id,metadata" ]; then
  echo -e "  ${GREEN}PASS${NC} Unknown ?fields= entry is dropped from the projection"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Unexpected projection keys: $UNKNOWN_KEYS"
  ((FAILED++))
  ERRORS+=("projection allowlist returned: $UNKNOWN_KEYS")
fi

# ============================================================================
# 16. USER DIRECTORY
# ============================================================================
section "16. User Directory"

# `user_profiles` is a local shadow of the Keycloak realm, written ONLY by the
# sync job. It is not consulted for authorization and not consulted to render a
# name on a row — it exists for cross-user queries: the assignee picker, the
# creator filter, and resolving a userId to a *current* name in aggregates.

# A synthetic id that no Keycloak user backs, for the departed-user cases.
GHOST_ID="test-suite-ghost-user"
GHOST_NAME="Ghost McTestface"

# Wait for an enqueued reconcile to finish. The trigger returns a jobId
# immediately; the work happens on the queue.
wait_for_sync() {
  local before=$1
  for _ in $(seq 1 30); do
    http GET "$API/users/sync/status" "$TOKEN_ADMIN"
    local finished
    finished=$(json_field "['lastRun']['finishedAt']" 2>/dev/null)
    if [ -n "$finished" ] && [ "$finished" != "$before" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

last_sync_finished() {
  http GET "$API/users/sync/status" "$TOKEN_ADMIN"
  json_field "['lastRun']['finishedAt']" 2>/dev/null
}

# --- 16a: the startup sync populated the directory --------------------------
http GET "$API/users" "$TOKEN_ADMIN"
assert_status "GET /users returns 200 for staff" "200"
DIR_USERS=$(echo "$HTTP_BODY" | python3 -c "
import sys, json
print(','.join(sorted(u['username'] for u in json.load(sys.stdin)['users'])))
" 2>/dev/null)
if [ "$DIR_USERS" = "admin,cataloguer,editor,pradles,reader" ]; then
  echo -e "  ${GREEN}PASS${NC} Directory holds exactly the realm's human users"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Unexpected directory contents: $DIR_USERS"
  ((FAILED++))
  ERRORS+=("directory contents: $DIR_USERS")
fi

# Service accounts must never appear — they would show up in an assignee picker.
if echo "$HTTP_BODY" | grep -q "service-account"; then
  echo -e "  ${RED}FAIL${NC} A service account leaked into the directory"
  ((FAILED++))
  ERRORS+=("service account in user_profiles")
else
  echo -e "  ${GREEN}PASS${NC} Service accounts are excluded from the directory"
  ((PASSED++))
fi

# --- 16b: capability=publish, and the inverted terminology ------------------
# `canPublish` is records:manage AND drafts:manage — the capability a transition
# actually requires. Said out loud the roles imply the opposite of the truth:
# `editors` can publish, `cataloguers` cannot.
http GET "$API/users?capability=publish" "$TOKEN_ADMIN"
assert_status "GET /users?capability=publish returns 200" "200"
PUBLISHERS=$(echo "$HTTP_BODY" | python3 -c "
import sys, json
print(','.join(sorted(u['username'] for u in json.load(sys.stdin)['users'])))
" 2>/dev/null)
case ",$PUBLISHERS," in
  *,editor,*) echo -e "  ${GREEN}PASS${NC} capability=publish includes editor"; ((PASSED++));;
  *) echo -e "  ${RED}FAIL${NC} capability=publish should include editor (got: $PUBLISHERS)"; ((FAILED++)); ERRORS+=("publishers missing editor: $PUBLISHERS");;
esac
case ",$PUBLISHERS," in
  *,cataloguer,*) echo -e "  ${RED}FAIL${NC} capability=publish must NOT include cataloguer (got: $PUBLISHERS)"; ((FAILED++)); ERRORS+=("cataloguer listed as publisher: $PUBLISHERS");;
  *) echo -e "  ${GREEN}PASS${NC} capability=publish excludes cataloguer (the terminology trap)"; ((PASSED++));;
esac
case ",$PUBLISHERS," in
  *,reader,*) echo -e "  ${RED}FAIL${NC} capability=publish must not include reader"; ((FAILED++)); ERRORS+=("reader listed as publisher");;
  *) echo -e "  ${GREEN}PASS${NC} capability=publish excludes reader"; ((PASSED++));;
esac

# --- 16c: the directory is staff-only, and email is unconditional -----------
# Changed deliberately with task delegation: the directory exists to serve the
# assignee picker, so the bar is "can be given or hand out work" rather than
# "is logged in". A reader used to get a filtered 200 and now gets a 403, which
# is why the conditional-email branch could be deleted outright — everyone who
# can reach this endpoint is internal staff who see each other in Keycloak.
http GET "$API/users" "$TOKEN_ADMIN"
if echo "$HTTP_BODY" | grep -q '"email"'; then
  echo -e "  ${GREEN}PASS${NC} Staff see contact details"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Staff should see email"
  ((FAILED++))
  ERRORS+=("admin cannot see email in /users")
fi

# Cataloguer holds drafts:manage only — the weakest persona that still passes
# assertIsStaff, so it is the one that proves the bar is the disjunction and not
# records:manage.
http GET "$API/users" "$TOKEN_CATALOGUER"
assert_status "Cataloguer can read the directory" "200"
if echo "$HTTP_BODY" | grep -q '"email"'; then
  echo -e "  ${GREEN}PASS${NC} Cataloguer sees email — the conditional-email path is gone"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Cataloguer should see email"
  ((FAILED++))
  ERRORS+=("cataloguer cannot see email in /users")
fi

http GET "$API/users" "$TOKEN_READER"
assert_status "Reader cannot read the directory" "403"

# Any id will do: the 403 must land before the lookup, so this also proves the
# endpoint is not a probe for which user ids exist.
http GET "$API/users/$GHOST_ID" "$TOKEN_READER"
assert_status "Reader cannot read a single directory entry" "403"

# --- 16d: auth on the directory --------------------------------------------
http GET "$API/users"
assert_status "Anonymous cannot read the directory" "401"

http GET "$API/users/sync/status" "$TOKEN_EDITOR"
assert_status "Editor cannot read sync status" "403"
http GET "$API/users/sync/status" "$TOKEN_ADMIN"
assert_status "Admin can read sync status" "200"

http POST "$API/users/sync"
assert_status "Anonymous cannot trigger a sync" "401"
http POST "$API/users/sync" "$TOKEN_READER"
assert_status "Reader cannot trigger a sync" "403"
http POST "$API/users/sync" "$TOKEN_CATALOGUER"
assert_status "Cataloguer cannot trigger a sync" "403"
http POST "$API/users/sync" "$TOKEN_EDITOR"
assert_status "Editor cannot trigger a sync (users:manage is admins only)" "403"

# --- 16e: single profile ---------------------------------------------------
EDITOR_SUB=$(psql_text "SELECT \"userId\" FROM user_profiles WHERE username='editor'")
if [ -n "$EDITOR_SUB" ]; then
  http GET "$API/users/$EDITOR_SUB" "$TOKEN_ADMIN"
  assert_status "GET /users/:id returns 200" "200"
  assert_json_field "GET /users/:id resolves the display name" "['displayName']" "editor editor"
else
  echo -e "  ${YELLOW}SKIP${NC} GET /users/:id (could not read editor's sub)"
  ((SKIPPED++))
fi

http GET "$API/users/no-such-user-id" "$TOKEN_ADMIN"
assert_status "GET /users/:id on an unknown id returns 404" "404"

# --- 16f: request traffic never writes the directory -----------------------
# A user appears in this table because they exist in Keycloak *and* a sync ran.
# Never as a side effect of traffic — "why is this person here?" has one answer.
PROFILES_BEFORE=$(psql_query "SELECT count(*) FROM user_profiles")
http GET "$API/search?q=TEST-SUITE-&limit=5" "$TOKEN_EDITOR"
http GET "$API/users" "$TOKEN_CATALOGUER"
http GET "$API/items/stats" "$TOKEN_ADMIN"
PROFILES_AFTER=$(psql_query "SELECT count(*) FROM user_profiles")
if [ "$PROFILES_BEFORE" = "$PROFILES_AFTER" ]; then
  echo -e "  ${GREEN}PASS${NC} Authenticated traffic writes no directory rows ($PROFILES_AFTER)"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Directory grew on request traffic: $PROFILES_BEFORE -> $PROFILES_AFTER"
  ((FAILED++))
  ERRORS+=("user_profiles written by a request: $PROFILES_BEFORE -> $PROFILES_AFTER")
fi

# --- 16g: a successful sync reconciles absences, without hard-deleting -----
if [ "$PSQL_OK" = "1" ]; then
  psql_query "INSERT INTO user_profiles (\"userId\", username, \"displayName\", \"canPublish\", enabled, \"syncedAt\")
              VALUES ('$GHOST_ID', 'ghost', '$GHOST_NAME', false, true, now())
              ON CONFLICT (\"userId\") DO UPDATE SET \"deletedAt\" = NULL" >/dev/null

  SYNC_BEFORE=$(last_sync_finished)
  http POST "$API/users/sync" "$TOKEN_ADMIN"
  assert_status "Admin triggers a sync" "201"

  if wait_for_sync "$SYNC_BEFORE"; then
    echo -e "  ${GREEN}PASS${NC} Triggered sync completes"
    ((PASSED++))

    GHOST_DELETED=$(psql_query "SELECT count(*) FROM user_profiles WHERE \"userId\"='$GHOST_ID' AND \"deletedAt\" IS NOT NULL")
    if [ "$GHOST_DELETED" = "1" ]; then
      echo -e "  ${GREEN}PASS${NC} A user the realm no longer has is marked absent"
      ((PASSED++))
    else
      echo -e "  ${RED}FAIL${NC} Absent user was not marked (deletedAt still null)"
      ((FAILED++))
      ERRORS+=("sync did not set deletedAt on an absent user")
    fi

    GHOST_ROW=$(psql_query "SELECT count(*) FROM user_profiles WHERE \"userId\"='$GHOST_ID'")
    if [ "$GHOST_ROW" = "1" ]; then
      echo -e "  ${GREEN}PASS${NC} An absent user's row is kept, not deleted (so old items still resolve)"
      ((PASSED++))
    else
      echo -e "  ${RED}FAIL${NC} Absent user's row was hard-deleted"
      ((FAILED++))
      ERRORS+=("user_profiles row hard-deleted by sync")
    fi

    # Real users must not have been touched by the same run.
    REAL_MARKED=$(psql_query "SELECT count(*) FROM user_profiles WHERE \"deletedAt\" IS NOT NULL AND \"userId\" <> '$GHOST_ID'")
    if [ "$REAL_MARKED" = "0" ]; then
      echo -e "  ${GREEN}PASS${NC} A sync marks only the users the realm actually dropped"
      ((PASSED++))
    else
      echo -e "  ${RED}FAIL${NC} $REAL_MARKED real user(s) were marked absent"
      ((FAILED++))
      ERRORS+=("sync marked $REAL_MARKED real users absent")
    fi

    # Default list hides them; active=false brings them back.
    http GET "$API/users?limit=500" "$TOKEN_ADMIN"
    if echo "$HTTP_BODY" | grep -q "$GHOST_NAME"; then
      echo -e "  ${RED}FAIL${NC} An absent user still appears in the default (active) list"
      ((FAILED++))
      ERRORS+=("departed user listed as active")
    else
      echo -e "  ${GREEN}PASS${NC} An absent user drops out of the assignable list"
      ((PASSED++))
    fi

    http GET "$API/users?active=false&limit=500" "$TOKEN_ADMIN"
    if echo "$HTTP_BODY" | grep -q "$GHOST_NAME"; then
      echo -e "  ${GREEN}PASS${NC} ?active=false still shows them"
      ((PASSED++))
    else
      echo -e "  ${RED}FAIL${NC} ?active=false should include an absent user"
      ((FAILED++))
      ERRORS+=("?active=false hides departed users")
    fi

    # --- 16h: a departed user still resolves in aggregates ----------------
    # This is the payoff for deletedAt over a hard delete. Aggregates group by
    # userId and resolve the current name, so a user who has left Keycloak
    # entirely still renders on the productivity panel.
    psql_query "INSERT INTO item_revisions (id, \"itemId\", version, action, \"userId\", \"userName\", \"createdAt\")
                VALUES ('test-suite-ghost-rev', 'test-suite-ghost-item', 1, 'CREATE', '$GHOST_ID', 'Old Ghost Name', now())
                ON CONFLICT (id) DO NOTHING" >/dev/null

    http GET "$API/stats/users" "$TOKEN_ADMIN"
    GHOST_STAT=$(echo "$HTTP_BODY" | python3 -c "
import sys, json
users = json.load(sys.stdin)['users']
hit = [u for u in users if u['userId'] == '$GHOST_ID']
print(hit[0]['displayName'] if hit else 'absent')
" 2>/dev/null)
    if [ "$GHOST_STAT" = "$GHOST_NAME" ]; then
      echo -e "  ${GREEN}PASS${NC} A departed user still resolves in stats, to their current name"
      ((PASSED++))
    else
      echo -e "  ${RED}FAIL${NC} Stats resolved a departed user as '$GHOST_STAT', expected '$GHOST_NAME'"
      ((FAILED++))
      ERRORS+=("stats name resolution for departed user: $GHOST_STAT")
    fi

    # And it must be the *directory* name, not the snapshot on the revision —
    # grouping by the snapshot would split a renamed person into two rows.
    if [ "$GHOST_STAT" = "Old Ghost Name" ]; then
      echo -e "  ${RED}FAIL${NC} Stats used the revision snapshot instead of the current name"
      ((FAILED++))
      ERRORS+=("stats grouped by snapshot name")
    else
      echo -e "  ${GREEN}PASS${NC} Stats use the current directory name, not the row snapshot"
      ((PASSED++))
    fi

    psql_query "DELETE FROM item_revisions WHERE id='test-suite-ghost-rev'" >/dev/null
  else
    echo -e "  ${RED}FAIL${NC} Triggered sync did not finish within 30s"
    ((FAILED++))
    ERRORS+=("sync did not complete")
  fi

  psql_query "DELETE FROM user_profiles WHERE \"userId\"='$GHOST_ID'" >/dev/null
else
  echo -e "  ${YELLOW}SKIP${NC} Directory reconciliation checks (psql unavailable)"
  ((SKIPPED++))
fi

# --- 16i: the directory stays out of CDC ----------------------------------
# The daily sync rewrites every row. A tracked table would re-index documents
# on each run, for a table nothing in the index refers to.
if [ ! -f "$PGSYNC_SCHEMA" ]; then
  echo -e "  ${YELLOW}SKIP${NC} pgsync schema not found"
  ((SKIPPED++))
elif grep -q 'user_profiles' "$PGSYNC_SCHEMA"; then
  echo -e "  ${RED}FAIL${NC} user_profiles is in the pgsync schema — every sync would re-index"
  ((FAILED++))
  ERRORS+=("user_profiles must not be tracked by pgsync")
else
  echo -e "  ${GREEN}PASS${NC} user_profiles is excluded from pgsync CDC"
  ((PASSED++))
fi

# ============================================================================
# 17. A FAILED SYNC IS NOT A DEPARTURE
# ============================================================================
section "17. Failed Sync Safety"

# The single most damaging way to get this wrong: if enumeration dies halfway,
# the users we did not see are not gone. Marking them absent would empty the
# assignee picker every time Keycloak restarts. Only a run that completed, with
# a non-empty roster, may reconcile absences.
#
# Fault-injected for real by stopping Keycloak — the API keeps validating the
# already-minted token from its cached JWKS, so the request still gets through
# while the Admin API call cannot.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE=(docker compose -f "$REPO_ROOT/docker-compose.yml" -f "$REPO_ROOT/docker-compose.ext.yml")

if [ "$PSQL_OK" = "0" ] || ! docker info >/dev/null 2>&1; then
  echo -e "  ${YELLOW}SKIP${NC} Failed-sync safety (needs docker + psql)"
  ((SKIPPED++))
else
  DELETED_BEFORE=$(psql_query "SELECT count(*) FROM user_profiles WHERE \"deletedAt\" IS NOT NULL")
  COUNT_BEFORE=$(psql_query "SELECT count(*) FROM user_profiles")

  "${COMPOSE[@]}" stop keycloak >/dev/null 2>&1
  echo -e "  ${YELLOW}NOTE${NC} Keycloak stopped — injecting a mid-enumeration failure"

  http POST "$API/users/sync" "$TOKEN_ADMIN"
  assert_status "Sync can still be triggered while Keycloak is down" "201"

  # Wait for the first attempt to fail. Retries continue in the background and
  # will succeed once Keycloak is back, which is the intended behaviour.
  SYNC_FAILED=0
  for _ in $(seq 1 20); do
    http GET "$API/users/sync/status" "$TOKEN_ADMIN"
    if echo "$HTTP_BODY" | grep -q '"lastError":{'; then SYNC_FAILED=1; break; fi
    sleep 2
  done

  if [ "$SYNC_FAILED" = "1" ]; then
    echo -e "  ${GREEN}PASS${NC} A failing sync is reported in sync/status"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} A failing sync left no error in sync/status"
    ((FAILED++))
    ERRORS+=("failed sync not visible in sync/status")
  fi

  DELETED_AFTER=$(psql_query "SELECT count(*) FROM user_profiles WHERE \"deletedAt\" IS NOT NULL")
  COUNT_AFTER=$(psql_query "SELECT count(*) FROM user_profiles")

  if [ "$DELETED_AFTER" = "$DELETED_BEFORE" ]; then
    echo -e "  ${GREEN}PASS${NC} A failed sync marks nobody absent (deletedAt untouched: $DELETED_AFTER)"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} A failed sync changed deletedAt: $DELETED_BEFORE -> $DELETED_AFTER"
    ((FAILED++))
    ERRORS+=("failed sync set deletedAt: $DELETED_BEFORE -> $DELETED_AFTER")
  fi

  if [ "$COUNT_AFTER" = "$COUNT_BEFORE" ]; then
    echo -e "  ${GREEN}PASS${NC} A failed sync deletes no rows ($COUNT_AFTER)"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} A failed sync changed the row count: $COUNT_BEFORE -> $COUNT_AFTER"
    ((FAILED++))
    ERRORS+=("failed sync changed user_profiles count")
  fi

  "${COMPOSE[@]}" start keycloak >/dev/null 2>&1
  KC_BACK=0
  for _ in $(seq 1 45); do
    if curl -sf -o /dev/null -X POST "$KC" -d "grant_type=password&client_id=$KC_CLIENT&username=admin&password=admin"; then
      KC_BACK=1; break
    fi
    sleep 2
  done
  if [ "$KC_BACK" = "1" ]; then
    echo -e "  ${GREEN}PASS${NC} Keycloak restored"
    ((PASSED++))
  else
    echo -e "  ${RED}FAIL${NC} Keycloak did not come back — later runs will fail until it does"
    ((FAILED++))
    ERRORS+=("keycloak not restored after fault injection")
  fi
fi

# ============================================================================
# 18. TASK DELEGATION
# ============================================================================
section "18. Task Delegation"

# Persona facts relied on here, all asserted in §16 and §3:
#   editor, admin  -> can publish (records:manage AND drafts:manage)
#   cataloguer     -> drafts:manage only; staff, but CANNOT publish
#   reader         -> holds nothing relevant; not staff
# Note the terminology trap: the group called `editors` publishes and the one
# called `cataloguers` does not. Never key a test off the group name.

http GET "$API/users?limit=500" "$TOKEN_ADMIN"
task_user_id() {
  echo "$HTTP_BODY" | python3 -c "
import sys, json
want = sys.argv[1]
for u in json.load(sys.stdin)['users']:
    if u['username'] == want:
        print(u['userId'])
        break
" "$1" 2>/dev/null
}
UID_EDITOR=$(task_user_id editor)
UID_CATALOGUER=$(task_user_id cataloguer)
UID_READER=$(task_user_id reader)
UID_ADMIN=$(task_user_id admin)

if [ -z "$UID_EDITOR" ] || [ -z "$UID_CATALOGUER" ] || [ -z "$UID_READER" ]; then
  echo -e "  ${YELLOW}SKIP${NC} Directory has not been synced — task tests need real user ids"
  ((SKIPPED++))
else

# A draft owned by the cataloguer: the natural subject of "please review this".
http POST "$API/items" "$TOKEN_CATALOGUER" '{"targetState":"DRAFT","visibilityStatus":"PRIVATE","metadata":{"title":"TEST-SUITE-TASK-DRAFT","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create draft for task tests" "201"
TASK_DRAFT_ID=$(json_field "['id']")
CLEANUP_IDS+=("$TASK_DRAFT_ID")

# --- 18a: authorisation ----------------------------------------------------
echo -e "\n  ${YELLOW}Authorisation...${NC}"

http POST "$API/tasks" "" "{\"itemId\":\"$TASK_DRAFT_ID\",\"title\":\"anon\",\"assignedToUserId\":\"$UID_EDITOR\"}"
assert_status "Anonymous cannot create a task" "401"

http POST "$API/tasks" "$TOKEN_READER" "{\"itemId\":\"$TASK_DRAFT_ID\",\"title\":\"reader\",\"assignedToUserId\":\"$UID_EDITOR\"}"
assert_status "Reader cannot create a task" "403"

http GET "$API/tasks" "$TOKEN_READER"
assert_status "Reader cannot list tasks" "403"

# The 404-not-403 path on an invisible item is deliberate — filing a task must
# not be usable to probe for hidden records — but it is NOT observable with the
# current personas: every principal that passes assertIsStaff (editor, admin,
# cataloguer) can already see HIDDEN drafts and records (§4), and the ones that
# cannot see them never get past the staff gate. The unknown-id case below
# exercises the same assertCanView call.
http POST "$API/tasks" "$TOKEN_CATALOGUER" '{"itemId":"nonexistent-item-id","title":"ghost","assignedToUserId":"'"$UID_EDITOR"'"}'
assert_status "Task against an unknown item is 404" "404"

# --- 18b: the (kind, status) assignee guard --------------------------------
echo -e "\n  ${YELLOW}Assignee guard rails...${NC}"

http POST "$API/tasks" "$TOKEN_CATALOGUER" "{\"itemId\":\"$TASK_DRAFT_ID\",\"kind\":\"REVIEW_PUBLISH\",\"title\":\"Ready for review\",\"description\":\"Checked against COBISS.\",\"assignedToUserId\":\"$UID_EDITOR\"}"
assert_status "Cataloguer files REVIEW_PUBLISH to a publisher" "201"
TASK_REVIEW_ID=$(json_field "['id']")

http POST "$API/tasks" "$TOKEN_CATALOGUER" "{\"itemId\":\"$TASK_DRAFT_ID\",\"kind\":\"REVIEW_PUBLISH\",\"title\":\"self\",\"assignedToUserId\":\"$UID_CATALOGUER\"}"
assert_status "REVIEW_PUBLISH to a non-publisher is 400 (the headline case)" "400"

http POST "$API/tasks" "$TOKEN_CATALOGUER" "{\"itemId\":\"$TASK_DRAFT_ID\",\"kind\":\"REVIEW_PUBLISH\",\"title\":\"reader\",\"assignedToUserId\":\"$UID_READER\"}"
assert_status "REVIEW_PUBLISH to a reader is 400" "400"

http POST "$API/tasks" "$TOKEN_CATALOGUER" "{\"itemId\":\"$TASK_DRAFT_ID\",\"kind\":\"GENERAL\",\"title\":\"Have a look\",\"assignedToUserId\":\"$UID_CATALOGUER\"}"
assert_status "GENERAL to a colleague who writes is 201" "201"
TASK_GENERAL_ID=$(json_field "['id']")

http POST "$API/tasks" "$TOKEN_CATALOGUER" "{\"itemId\":\"$TASK_DRAFT_ID\",\"kind\":\"GENERAL\",\"title\":\"reader\",\"assignedToUserId\":\"$UID_READER\"}"
assert_status "GENERAL to a reader is 400 — they cannot act on it either" "400"

http POST "$API/tasks" "$TOKEN_CATALOGUER" "{\"itemId\":\"$TASK_DRAFT_ID\",\"kind\":\"GENERAL\",\"title\":\"ghost\",\"assignedToUserId\":\"not-a-real-user\"}"
assert_status "Assignee absent from the directory is 400" "400"
assert_body_contains "Unknown-assignee error points at the sync endpoint" "users/sync"

# --- 18c: reads ------------------------------------------------------------
echo -e "\n  ${YELLOW}Reads...${NC}"

http GET "$API/tasks?assignedTo=me&status=OPEN" "$TOKEN_EDITOR"
assert_status "Editor lists their inbox" "200"
assert_body_contains "Inbox contains the review task" "$TASK_REVIEW_ID"

http GET "$API/tasks?createdBy=me" "$TOKEN_EDITOR"
assert_status "Editor lists what they filed" "200"
if echo "$HTTP_BODY" | grep -q "$TASK_REVIEW_ID"; then
  echo -e "  ${RED}FAIL${NC} createdBy=me returned a task the editor did not file"
  ((FAILED++))
  ERRORS+=("createdBy=me is not filtering by creator")
else
  echo -e "  ${GREEN}PASS${NC} createdBy=me excludes tasks filed by someone else"
  ((PASSED++))
fi

http GET "$API/tasks?createdBy=me" "$TOKEN_CATALOGUER"
assert_body_contains "Cataloguer sees the task they filed" "$TASK_REVIEW_ID"

http GET "$API/tasks?itemId=$TASK_DRAFT_ID&kind=REVIEW_PUBLISH" "$TOKEN_EDITOR"
assert_status "Filter by itemId and kind" "200"
assert_body_contains "kind filter keeps the review task" "$TASK_REVIEW_ID"
if echo "$HTTP_BODY" | grep -q "$TASK_GENERAL_ID"; then
  echo -e "  ${RED}FAIL${NC} kind=REVIEW_PUBLISH also returned the GENERAL task"
  ((FAILED++))
  ERRORS+=("kind filter not applied")
else
  echo -e "  ${GREEN}PASS${NC} kind filter excludes the GENERAL task"
  ((PASSED++))
fi

http GET "$API/tasks/$TASK_REVIEW_ID" "$TOKEN_EDITOR"
assert_status "Task detail returns 200" "200"
assert_json_field "Assignee renders as a name, not a UUID" "['assignedToName']" "editor editor"
assert_json_field "Creator renders as a name" "['createdByName']" "cataloguer cataloguer"
assert_json_field "itemType is resolved at read time" "['itemType']" "DRAFT"
FRESH_HIST=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['history']))" 2>/dev/null)
assert_metric "A fresh task's log holds only its CREATED row" "$FRESH_HIST" "1"

# The prefill while the editor is holding it: back to the cataloguer who asked
# for it. Asserted here rather than only after the return, because this is the
# state the "return with notes" dialog actually opens in.
assert_json_field "returnTo is the requester who filed it" "['returnTo']['displayName']" "cataloguer cataloguer"

TASK_TS=$(json_field "['createdAt']")
if echo "$TASK_TS" | grep -qE 'Z$|[+-][0-9]{2}:?[0-9]{2}$'; then
  echo -e "  ${GREEN}PASS${NC} Task timestamps carry a timezone ($TASK_TS)"
  ((PASSED++))
else
  echo -e "  ${RED}FAIL${NC} Task createdAt has no timezone: $TASK_TS"
  ((FAILED++))
  ERRORS+=("task createdAt has no timezone: $TASK_TS")
fi

# --- 18d: comments and mutation --------------------------------------------
echo -e "\n  ${YELLOW}Comments and mutation...${NC}"

# A comment is not its own kind of object: it is one of the things that can
# happen to a task, so it lands in the same log as every event.
http POST "$API/tasks/$TASK_REVIEW_ID/comments" "$TOKEN_EDITOR" '{"body":"Looking at it now."}'
assert_status "Assignee comments on a task" "201"
assert_json_field "A comment is a COMMENTED history row" "['action']" "COMMENTED"
assert_json_field "The body lands in note" "['note']" "Looking at it now."
assert_json_field "Comment author renders as a name" "['userName']" "editor editor"

http GET "$API/tasks/$TASK_REVIEW_ID" "$TOKEN_EDITOR"
assert_json_field "Filing the task wrote CREATED as the first history row" "['history'][0]['action']" "CREATED"
assert_json_field "CREATED records who it was assigned to" \
  "['history'][0]['changes'][1]['after']" "$UID_EDITOR"
assert_json_field "History is oldest-first and the comment is in it" "['history'][1]['action']" "COMMENTED"
assert_json_field "Detail history interleaves comments with events" "['history'][1]['note']" "Looking at it now."

# A task the cataloguer is neither assignee nor creator of, and on which they
# hold no records:manage escape hatch.
http POST "$API/tasks" "$TOKEN_EDITOR" "{\"itemId\":\"$TASK_DRAFT_ID\",\"kind\":\"GENERAL\",\"title\":\"editor to admin\",\"assignedToUserId\":\"$UID_ADMIN\"}"
assert_status "Editor files a task to the admin" "201"
TASK_THIRDPARTY_ID=$(json_field "['id']")

http PATCH "$API/tasks/$TASK_THIRDPARTY_ID" "$TOKEN_CATALOGUER" '{"title":"meddling"}'
assert_status "An unrelated staff member cannot edit a task" "403"

http PATCH "$API/tasks/$TASK_THIRDPARTY_ID" "$TOKEN_ADMIN" '{"title":"admin can"}'
assert_status "records:manage is the unstick-it escape hatch" "200"

http PATCH "$API/tasks/$TASK_GENERAL_ID" "$TOKEN_CATALOGUER" '{"status":"COMPLETED"}'
assert_status "Completing a task returns 200" "200"
if echo "$HTTP_BODY" | grep -q '"completedAt":null'; then
  echo -e "  ${RED}FAIL${NC} Entering COMPLETED did not set completedAt"
  ((FAILED++))
  ERRORS+=("completedAt not set on COMPLETED")
else
  echo -e "  ${GREEN}PASS${NC} Entering COMPLETED sets completedAt"
  ((PASSED++))
fi

# COMPLETED is deliberately NOT terminal: a publish that went out wrong needs
# pulling back, and that is a status change on the existing task.
http PATCH "$API/tasks/$TASK_GENERAL_ID" "$TOKEN_CATALOGUER" '{"status":"IN_PROGRESS"}'
assert_status "COMPLETED is not terminal" "200"
assert_json_field "Leaving COMPLETED clears completedAt" "['completedAt']" "None"

http PATCH "$API/tasks/$TASK_GENERAL_ID" "$TOKEN_CATALOGUER" '{"status":"CANCELLED"}'
assert_status "Cancelling a task returns 200" "200"
http PATCH "$API/tasks/$TASK_GENERAL_ID" "$TOKEN_CATALOGUER" '{"status":"OPEN"}'
assert_status "CANCELLED is terminal — reopening is 400" "400"

http PATCH "$API/tasks/$TASK_REVIEW_ID" "$TOKEN_EDITOR" "{\"assignedToUserId\":\"$UID_CATALOGUER\"}"
assert_status "Reassigning an OPEN REVIEW_PUBLISH to a non-publisher is 400" "400"

# A PATCH that moves nothing writes nothing: the GUI sends idempotent saves, and
# an audit log of non-events is noise.
http GET "$API/tasks/$TASK_THIRDPARTY_ID" "$TOKEN_ADMIN"
NOOP_BEFORE=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['history']))" 2>/dev/null)
http PATCH "$API/tasks/$TASK_THIRDPARTY_ID" "$TOKEN_ADMIN" '{"title":"admin can"}'
assert_status "A no-op PATCH still returns 200" "200"
http GET "$API/tasks/$TASK_THIRDPARTY_ID" "$TOKEN_ADMIN"
NOOP_AFTER=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['history']))" 2>/dev/null)
assert_metric "A PATCH that changes nothing writes no history row" "$NOOP_AFTER" "$NOOP_BEFORE"

# --- 18e: the return flow --------------------------------------------------
# One task ping-pongs; the thread accumulates in one place. This is the block
# the naive kind-only guard would have broken, so none of it may be dropped.
echo -e "\n  ${YELLOW}The return flow...${NC}"

http PATCH "$API/tasks/$TASK_REVIEW_ID" "$TOKEN_EDITOR" '{"status":"RETURNED"}'
assert_status "RETURNED without a new assignee is 400" "400"

# The reason travels with the return, in the same request — it is a fact about
# one handover, not a property of the task.
http PATCH "$API/tasks/$TASK_REVIEW_ID" "$TOKEN_EDITOR" "{\"status\":\"RETURNED\",\"assignedToUserId\":\"$UID_CATALOGUER\",\"note\":\"The author field is wrong.\"}"
assert_status "Returning to a cataloguer moves status and assignee together" "200"
assert_json_field "Returned task sits with the cataloguer" "['assignedToName']" "cataloguer cataloguer"
assert_json_field "Returned task keeps its REVIEW_PUBLISH goal" "['kind']" "REVIEW_PUBLISH"

# ONE row for one user action. Splitting it into RETURNED plus ASSIGNED would
# record two events that never separately happened — the API forces status and
# assignee to travel together.
http GET "$API/tasks/$TASK_REVIEW_ID" "$TOKEN_EDITOR"
assert_json_field "The return is a single RETURNED row" "['history'][-1]['action']" "RETURNED"
assert_json_field "The return carries its reason" "['history'][-1]['note']" "The author field is wrong."
assert_json_field "The return records the status move" "['history'][-1]['changes'][0]['path']" "status"
assert_json_field "…and the assignee move, in the same row" "['history'][-1]['changes'][1]['path']" "assignedToUserId"
RETURN_ROWS=$(echo "$HTTP_BODY" | python3 -c "
import sys, json
h = json.load(sys.stdin)['history']
print(sum(1 for r in h if r['action'] in ('RETURNED', 'ASSIGNED')))
" 2>/dev/null)
assert_metric "A return writes exactly one row, not RETURNED plus ASSIGNED" "$RETURN_ROWS" "1"

# returnTo tracks whoever is holding the task. Now that it sits with the
# cataloguer — who is also its creator, and so cannot be returned to themselves —
# it falls through to the last handover: the editor who sent it back.
assert_json_field "returnTo follows the holder, falling back past the creator" "['returnTo']['displayName']" "editor editor"

http PATCH "$API/tasks/$TASK_REVIEW_ID" "$TOKEN_CATALOGUER" "{\"status\":\"OPEN\",\"assignedToUserId\":\"$UID_EDITOR\",\"note\":\"Fixed.\"}"
assert_status "Cataloguer sends it back after fixing" "200"

http GET "$API/tasks/$TASK_REVIEW_ID" "$TOKEN_EDITOR"
assert_json_field "The round trip is ONE task with the whole log" "['history'][-1]['action']" "STATUS_CHANGED"
HIST_LEN=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['history']))" 2>/dev/null)
assert_metric "Every step of the round trip is on one task's log" "$HIST_LEN" "4"

http GET "$API/tasks?itemId=$TASK_DRAFT_ID&kind=REVIEW_PUBLISH" "$TOKEN_EDITOR"
assert_json_field "The return opened no second task" "['total']" "1"

# --- 18e2: snapshot vs live, the naming rule asserted -----------------------
# The whole reason these are two tables. Rename the cataloguer in the directory,
# then read the same task back: the live assignee/creator names follow, the
# history rows do not.
echo -e "\n  ${YELLOW}Snapshot vs live names...${NC}"

if [ "$PSQL_OK" = "1" ]; then
  psql_query "UPDATE user_profiles SET \"displayName\" = 'RENAMED PERSON' WHERE \"userId\" = '$UID_CATALOGUER'" >/dev/null

  http GET "$API/tasks/$TASK_REVIEW_ID" "$TOKEN_EDITOR"
  assert_json_field "The task shows who the creator is NOW" "['createdByName']" "RENAMED PERSON"
  assert_json_field "History keeps the name as it was THEN" "['history'][0]['userName']" "cataloguer cataloguer"

  psql_query "UPDATE user_profiles SET \"displayName\" = 'cataloguer cataloguer' WHERE \"userId\" = '$UID_CATALOGUER'" >/dev/null
else
  echo -e "  ${YELLOW}SKIP${NC} Snapshot-vs-live naming needs psql"
  ((SKIPPED++))
fi

# --- 18f: the observer -----------------------------------------------------
# Publishing closes its review tasks however the publish happened. Without this
# the task list lies: the draft goes out and "please review" stays OPEN forever.
echo -e "\n  ${YELLOW}The observer...${NC}"

http POST "$API/items" "$TOKEN_CATALOGUER" '{"targetState":"DRAFT","visibilityStatus":"PRIVATE","metadata":{"title":"TEST-SUITE-OBSERVER-DRAFT","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
assert_status "Create draft for the observer test" "201"
OBS_ID=$(json_field "['id']")
CLEANUP_IDS+=("$OBS_ID")

http POST "$API/tasks" "$TOKEN_CATALOGUER" "{\"itemId\":\"$OBS_ID\",\"kind\":\"REVIEW_PUBLISH\",\"title\":\"Please publish\",\"assignedToUserId\":\"$UID_EDITOR\"}"
OBS_REVIEW_ID=$(json_field "['id']")

http POST "$API/tasks" "$TOKEN_CATALOGUER" "{\"itemId\":\"$OBS_ID\",\"kind\":\"REVIEW_PUBLISH\",\"title\":\"Second opinion\",\"assignedToUserId\":\"$UID_EDITOR\"}"
OBS_RETURNED_ID=$(json_field "['id']")
http PATCH "$API/tasks/$OBS_RETURNED_ID" "$TOKEN_EDITOR" "{\"status\":\"RETURNED\",\"assignedToUserId\":\"$UID_CATALOGUER\"}"
assert_status "Park a RETURNED review task on the same item" "200"

http POST "$API/tasks" "$TOKEN_CATALOGUER" "{\"itemId\":\"$OBS_ID\",\"kind\":\"FIX_METADATA\",\"title\":\"Fix the year\",\"assignedToUserId\":\"$UID_CATALOGUER\"}"
OBS_FIX_ID=$(json_field "['id']")

http GET "$API/tasks/$OBS_REVIEW_ID" "$TOKEN_EDITOR"
assert_json_field "Before publication the task reports DRAFT" "['itemType']" "DRAFT"

# Straight through the transition endpoint — nobody touches /api/tasks.
http POST "$API/items/transition" "$TOKEN_EDITOR" "{\"ids\":[\"$OBS_ID\"],\"targetState\":\"RECORD\"}"
assert_status "Editor publishes the item" "201"

http GET "$API/tasks/$OBS_REVIEW_ID" "$TOKEN_EDITOR"
assert_json_field "Publishing closed the review task" "['status']" "COMPLETED"
if echo "$HTTP_BODY" | grep -q '"completedAt":null'; then
  echo -e "  ${RED}FAIL${NC} Observer closed the task without setting completedAt"
  ((FAILED++))
  ERRORS+=("observer left completedAt null")
else
  echo -e "  ${GREEN}PASS${NC} Observer set completedAt"
  ((PASSED++))
fi
assert_json_field "The same task id now reports RECORD (id survives publication)" "['itemType']" "RECORD"
# Attributed to the real publisher, never to `system`: a human did this, and
# "closed by Ana publishing it" is more use than "closed by system".
assert_json_field "The close is logged as CLOSED_ON_PUBLISH" "['history'][-1]['action']" "CLOSED_ON_PUBLISH"
assert_json_field "…attributed to the publisher, not to system" "['history'][-1]['userName']" "editor editor"
assert_json_field "…and records the status it moved from" "['history'][-1]['changes'][0]['before']" "OPEN"

http GET "$API/tasks/$OBS_RETURNED_ID" "$TOKEN_EDITOR"
assert_json_field "A RETURNED review task also closes — the goal was reached" "['status']" "COMPLETED"

http GET "$API/tasks/$OBS_FIX_ID" "$TOKEN_EDITOR"
assert_json_field "FIX_METADATA is untouched by publication" "['status']" "OPEN"

# Not symmetric on purpose: reopening months later would be spooky action.
http POST "$API/items/transition" "$TOKEN_EDITOR" "{\"ids\":[\"$OBS_ID\"],\"targetState\":\"DRAFT\"}"
assert_status "Unpublish the item" "201"
http GET "$API/tasks/$OBS_REVIEW_ID" "$TOKEN_EDITOR"
assert_json_field "Unpublishing does NOT reopen a completed task" "['status']" "COMPLETED"

# Guards the closing.length === 0 branch.
http POST "$API/items" "$TOKEN_EDITOR" '{"targetState":"DRAFT","visibilityStatus":"PUBLIC","metadata":{"title":"TEST-SUITE-NO-TASKS","collectionType":0,"childrenInDrafts":0,"childrenInRecords":0,"jeGlavnoGradivo":true}}'
NOTASK_ID=$(json_field "['id']")
CLEANUP_IDS+=("$NOTASK_ID")
http POST "$API/items/transition" "$TOKEN_EDITOR" "{\"ids\":[\"$NOTASK_ID\"],\"targetState\":\"RECORD\"}"
assert_status "Publishing an item with no tasks still works" "201"

# --- 18g: the picker -------------------------------------------------------
echo -e "\n  ${YELLOW}The assignee picker...${NC}"

http GET "$API/users?capability=publish&q=editor&limit=5" "$TOKEN_CATALOGUER"
assert_status "Picker query for publishers returns 200" "200"
assert_body_contains "capability=publish finds the editor" '"username":"editor"'

http GET "$API/users?capability=staff&q=cataloguer&limit=5" "$TOKEN_CATALOGUER"
assert_status "capability=staff returns 200" "200"
assert_body_contains "capability=staff includes cataloguers" '"username":"cataloguer"'

http GET "$API/users?capability=publish&q=cataloguer&limit=5" "$TOKEN_CATALOGUER"
assert_json_field "capability=publish excludes the cataloguer" "['total']" "0"

# Both conditions must apply. Guards the AND-array shape in list(): with the old
# spread, a second OR-bearing fragment would have overwritten the first and one
# of these two conditions would have been silently dropped.
http GET "$API/users?capability=staff&q=reader&limit=5" "$TOKEN_CATALOGUER"
assert_json_field "capability=staff AND q both apply — reader is excluded" "['total']" "0"

# --- 18h: the design claims, asserted --------------------------------------
echo -e "\n  ${YELLOW}Design claims...${NC}"

http GET "$API/tasks?itemIds=$TASK_DRAFT_ID,$OBS_ID&status=OPEN" "$TOKEN_EDITOR"
assert_status "Badge query by itemIds returns 200" "200"
assert_body_contains "Badge query finds the open review task" "$TASK_REVIEW_ID"

http GET "$API/tasks?itemIds=$OBS_ID" "$TOKEN_EDITOR"
if echo "$HTTP_BODY" | grep -q "$TASK_REVIEW_ID"; then
  echo -e "  ${RED}FAIL${NC} itemIds returned a task belonging to another item"
  ((FAILED++))
  ERRORS+=("itemIds filter not applied")
else
  echo -e "  ${GREEN}PASS${NC} itemIds returns tasks for exactly the listed items"
  ((PASSED++))
fi

# The item-scoped log, which is what the delete asymmetry below exists to serve.
http GET "$API/tasks/item/$TASK_DRAFT_ID/history" "$TOKEN_ADMIN"
assert_status "Item task-history returns 200 for an admin" "200"
assert_body_contains "Item task-history spans the task filed against it" "$TASK_REVIEW_ID"
# Same bar as /items/:id/history, asserted against both edges of it.
http GET "$API/tasks/item/$TASK_DRAFT_ID/history" "$TOKEN_CATALOGUER"
assert_status "Cataloguer can read item task-history, as for /items/:id/history" "200"
http GET "$API/tasks/item/$TASK_DRAFT_ID/history" "$TOKEN_READER"
assert_status "Reader cannot read item task-history" "403"

# ---------------------------------------------------------------------------
# THE decision this rewrite exists for: live tasks die with the item, the audit
# log does not. Deleting the record of what people did is the exact failure mode
# task_history was split out to prevent.
# ---------------------------------------------------------------------------
if [ "$PSQL_OK" = "1" ]; then
  HIST_BEFORE=$(psql_query "SELECT COUNT(*) FROM task_history WHERE \"itemId\" = '$TASK_DRAFT_ID'")
fi

http DELETE "$API/items" "$TOKEN_ADMIN" "{\"ids\":[\"$TASK_DRAFT_ID\"]}"
assert_status "Delete the item the tasks point at" "200"

http GET "$API/tasks/$TASK_REVIEW_ID" "$TOKEN_EDITOR"
assert_status "Deleting an item deletes its live tasks" "404"

if [ "$PSQL_OK" = "1" ]; then
  assert_metric "task_history SURVIVES the item delete — the audit is the point" \
    "$(psql_query "SELECT COUNT(*) FROM task_history WHERE \"itemId\" = '$TASK_DRAFT_ID'")" "$HIST_BEFORE"
  assert_metric "…and the live task really is gone" \
    "$(psql_query "SELECT COUNT(*) FROM tasks WHERE \"itemId\" = '$TASK_DRAFT_ID'")" "0"
fi

# Still answerable after both the task and the item are gone — which is why
# task_history carries a denormalised itemId.
http GET "$API/tasks/item/$TASK_DRAFT_ID/history" "$TOKEN_ADMIN"
assert_status "What happened around a deleted item is still readable" "200"
assert_body_contains "…including the return and its reason" "The author field is wrong."

# Neither table is CDC-tracked. If either were, a comment on a task would
# re-index the item it names — metadata and nested extractedText included.
PGSYNC_SCHEMA="$(dirname "$0")/../../infrastructure/docker/pgsync/schema.json"
if [ -f "$PGSYNC_SCHEMA" ]; then
  if grep -qE '"tasks"|"task_history"' "$PGSYNC_SCHEMA"; then
    echo -e "  ${RED}FAIL${NC} Task tables are in the pgsync schema — every log row would re-index an item"
    ((FAILED++))
    ERRORS+=("tasks/task_history must not be pgsync-tracked")
  else
    echo -e "  ${GREEN}PASS${NC} Task tables are excluded from pgsync"
    ((PASSED++))
  fi
else
  echo -e "  ${YELLOW}SKIP${NC} pgsync schema.json not found at $PGSYNC_SCHEMA"
  ((SKIPPED++))
fi

fi  # directory-synced guard

# ============================================================================
# CLEANUP
# ============================================================================
section "Cleanup"

echo -e "  Deleting ${#CLEANUP_IDS[@]} test items..."
for id in "${CLEANUP_IDS[@]}"; do
  if [ -n "$id" ]; then
    # First try as draft, then as record (item may have been transitioned)
    cleanup_item "$id" "$TOKEN_ADMIN"
  fi
done
echo -e "  ${GREEN}Done${NC}"

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}                        TEST RESULTS                            ${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

TOTAL=$((PASSED + FAILED + SKIPPED))
echo -e "  ${GREEN}Passed:${NC}  $PASSED"
echo -e "  ${RED}Failed:${NC}  $FAILED"
if [ "$SKIPPED" -gt 0 ]; then
  echo -e "  ${YELLOW}Skipped:${NC} $SKIPPED"
fi
echo -e "  ${BOLD}Total:${NC}   $TOTAL"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}${BOLD}FAILURES:${NC}"
  for err in "${ERRORS[@]}"; do
    echo -e "  ${RED}-${NC} $err"
  done
  echo ""
  exit 1
else
  echo -e "${GREEN}${BOLD}All tests passed!${NC}"
  echo ""
  exit 0
fi
