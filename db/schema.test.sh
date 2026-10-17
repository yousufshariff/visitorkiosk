#!/usr/bin/env bash
# Applies schema.sql to a throwaway local PostgreSQL 16 cluster and asserts its constraints.
# Override the schema under test with SCHEMA=/path/to/schema.sql.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCHEMA="$(realpath "${SCHEMA:-$HERE/schema.sql}")"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT=54329
TMP="$(mktemp -d)"; chown postgres "$TMP"; chmod 755 "$TMP"
as_pg() { runuser -u postgres -- "$@"; }
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

as_pg "$PGBIN/initdb" -D "$TMP/data" -A trust >/dev/null || { echo "initdb failed"; exit 2; }
as_pg "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null || { cat "$TMP/log"; exit 2; }
psql_() { as_pg "$PGBIN/psql" -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql_ < "$SCHEMA" >/dev/null || { echo "FAIL: schema.sql did not apply"; exit 1; }

FAILS=0
expect_ok()   { if psql_ -c "$2" >/dev/null 2>&1; then echo "ok   - $1"; else echo "FAIL - $1 (expected success)"; FAILS=$((FAILS+1)); fi; }
expect_fail() { if psql_ -c "$2" >/dev/null 2>&1; then echo "FAIL - $1 (expected error)"; FAILS=$((FAILS+1)); else echo "ok   - $1"; fi; }

expect_ok   "insert host" "INSERT INTO users(full_name,email) VALUES ('Hana Host','hana@example.com')"
expect_ok   "insert visitor with email" "INSERT INTO visitors(full_name,email) VALUES ('Vic Visitor','Vic@Example.com')"
expect_fail "visitor needs email or phone" "INSERT INTO visitors(full_name) VALUES ('No Contact')"
expect_fail "visitor email unique, case-insensitive" "INSERT INTO visitors(full_name,email) VALUES ('Dup','vic@example.com')"
expect_ok   "visit with valid times" "INSERT INTO visits(visitor_id,host_id,qr_token,status,checked_in_at,checked_out_at) SELECT v.id,u.id,'tok-ok','checked_out',now()-interval '1 hour',now() FROM visitors v, users u LIMIT 1"
expect_fail "checked_out before checked_in rejected" "INSERT INTO visits(visitor_id,host_id,qr_token,status,checked_in_at,checked_out_at) SELECT v.id,u.id,'tok-bad','checked_out',now(),now()-interval '1 hour' FROM visitors v, users u LIMIT 1"
expect_fail "checked_out without checked_in rejected" "INSERT INTO visits(visitor_id,host_id,qr_token,checked_out_at) SELECT v.id,u.id,'tok-bad2',now() FROM visitors v, users u LIMIT 1"
expect_fail "qr_token unique" "INSERT INTO visits(visitor_id,host_id,qr_token) SELECT v.id,u.id,'tok-ok' FROM visitors v, users u LIMIT 1"
expect_fail "cannot delete host who has visits" "DELETE FROM users WHERE email='hana@example.com'"
expect_fail "invalid delivery_type rejected" "INSERT INTO deliveries(recipient_id,carrier,type) SELECT id,'UPS','boat' FROM users LIMIT 1"
expect_ok   "valid delivery" "INSERT INTO deliveries(recipient_id,carrier,type) SELECT id,'UPS','package' FROM users LIMIT 1"

[ "$FAILS" -eq 0 ] && echo "ALL OK" || { echo "$FAILS assertion(s) failed"; exit 1; }
