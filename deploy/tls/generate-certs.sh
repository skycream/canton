#!/usr/bin/env bash
# generate-certs.sh - Generate self-signed TLS certificates for development/testing
# Creates: Root CA, Server cert, Admin Client cert
#
# Usage: ./generate-certs.sh [output-dir]

set -euo pipefail

CERT_DIR="${1:-$(dirname "$0")/certs}"
DAYS=365
KEY_SIZE=4096
CN_CA="Canton Dev Root CA"
CN_SERVER="localhost"
CN_CLIENT="canton-admin-client"

mkdir -p "$CERT_DIR"

echo "==> Generating certificates in: $CERT_DIR"

# ─── Root CA ───
echo "--- Creating Root CA ---"
openssl genrsa -out "$CERT_DIR/ca.key" "$KEY_SIZE"
openssl req -new -x509 -days "$DAYS" -key "$CERT_DIR/ca.key" \
  -out "$CERT_DIR/ca.crt" \
  -subj "/CN=$CN_CA/O=Canton Dev/C=US"

# ─── Server Certificate ───
echo "--- Creating Server Certificate ---"
openssl genrsa -out "$CERT_DIR/server.key" "$KEY_SIZE"
openssl req -new -key "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.csr" \
  -subj "/CN=$CN_SERVER/O=Canton Dev/C=US"

cat > "$CERT_DIR/server-ext.cnf" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = participant
DNS.3 = sequencer
DNS.4 = mediator
DNS.5 = domain-manager
IP.1 = 127.0.0.1
IP.2 = 0.0.0.0
EOF

openssl x509 -req -days "$DAYS" \
  -in "$CERT_DIR/server.csr" \
  -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
  -out "$CERT_DIR/server.crt" \
  -extfile "$CERT_DIR/server-ext.cnf"

# ─── Admin Client Certificate (for mTLS) ───
echo "--- Creating Admin Client Certificate ---"
openssl genrsa -out "$CERT_DIR/admin-client.key" "$KEY_SIZE"
openssl req -new -key "$CERT_DIR/admin-client.key" \
  -out "$CERT_DIR/admin-client.csr" \
  -subj "/CN=$CN_CLIENT/O=Canton Dev/C=US"

cat > "$CERT_DIR/client-ext.cnf" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
extendedKeyUsage = clientAuth
EOF

openssl x509 -req -days "$DAYS" \
  -in "$CERT_DIR/admin-client.csr" \
  -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
  -out "$CERT_DIR/admin-client.crt" \
  -extfile "$CERT_DIR/client-ext.cnf"

# ─── Cleanup CSR and extension files ───
rm -f "$CERT_DIR"/*.csr "$CERT_DIR"/*.cnf "$CERT_DIR"/*.srl

# ─── Set permissions ───
chmod 600 "$CERT_DIR"/*.key
chmod 644 "$CERT_DIR"/*.crt

echo ""
echo "==> Certificates generated successfully:"
echo "  CA:            $CERT_DIR/ca.crt"
echo "  Server cert:   $CERT_DIR/server.crt"
echo "  Server key:    $CERT_DIR/server.key"
echo "  Client cert:   $CERT_DIR/admin-client.crt"
echo "  Client key:    $CERT_DIR/admin-client.key"
