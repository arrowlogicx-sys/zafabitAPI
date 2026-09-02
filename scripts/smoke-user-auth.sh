#!/usr/bin/env bash
# End-to-end smoke test for the user app's signup -> home flow through the
# gateway. Assumes the gateway is on :4000 with auth + identity-profiles up
# and migrated. Usage: BASE=http://localhost:4000 PHONE=+919999900001 ./scripts/smoke-user-auth.sh
set -euo pipefail

BASE="${BASE:-http://localhost:4000}"
PHONE="${PHONE:-+919999900001}"
jqget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }

echo "1) send-otp"
curl -sS -X POST "$BASE/auth/send-otp" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"language\":\"en\",\"channel\":\"sms\"}" | tee /tmp/s1.json | python3 -m json.tool
OTP=$(jqget "d['data']['otp']" < /tmp/s1.json)

echo "2) verify-otp (otp=$OTP)"
curl -sS -X POST "$BASE/auth/verify-otp" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"otp\":\"$OTP\"}" | tee /tmp/s2.json | python3 -m json.tool
TOKEN=$(jqget "d['data']['token']" < /tmp/s2.json)
AUTH=(-H "Authorization: Bearer $TOKEN")

echo "3) basic-info"
curl -sS -X PUT "$BASE/profile/basic-info" "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"firstName":"Smoke","lastName":"Test","language":"en"}' | python3 -m json.tool

echo "4) addresses"
curl -sS -X POST "$BASE/profile/addresses" "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"title":"Home","houseName":"12A","pincode":"560001","latitude":12.97,"longitude":77.59,"city":"Bengaluru","state":"KA","propertyProfile":{"bhkType":"2BHK","homeType":"apartment","memberCount":3,"hasPets":false}}' | python3 -m json.tool

echo "5) property-profile"
curl -sS -X POST "$BASE/profile/property-profile" "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"propertyType":"apartment","bhkType":"2BHK","rooms":2,"members":3,"hasPets":false,"sizeSqFt":900}' | python3 -m json.tool

echo "6) GET /profile/me"
curl -sS "$BASE/profile/me" "${AUTH[@]}" | python3 -m json.tool

echo "7) push-token"
curl -sS -X PUT "$BASE/profile/push-token" "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"pushToken":"fake-fcm-token"}' | python3 -m json.tool

echo "8) re-verify -> customerProfile.propertyProfile.bhkType should now be set"
curl -sS -X POST "$BASE/auth/send-otp" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" >/dev/null
curl -sS -X POST "$BASE/auth/verify-otp" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"otp\":\"$OTP\"}" | python3 -c "import sys,json;u=json.load(sys.stdin)['data']['user'];print('customerProfile:',u['customerProfile'])"

echo "9) logout + delete account"
curl -sS -X POST "$BASE/auth/logout" "${AUTH[@]}" | python3 -m json.tool
curl -sS -X DELETE "$BASE/auth/me" "${AUTH[@]}" | python3 -m json.tool

echo "ALL GOOD"
