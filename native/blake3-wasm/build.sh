#!/usr/bin/env sh
# Builds lib/deploy/blake3.wasm from this crate.
# Needs Rust and the wasm target:  rustup target add wasm32-unknown-unknown
set -eu
cd "$(dirname "$0")"
cargo test --release
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/deplo_blake3_wasm.wasm ../../lib/deploy/blake3.wasm
echo "Wrote lib/deploy/blake3.wasm ($(wc -c < ../../lib/deploy/blake3.wasm) bytes)"
