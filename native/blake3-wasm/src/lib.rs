//! BLAKE3 for DEPLO, exported to JavaScript through a minimal C ABI.
//!
//! Cloudflare Pages keys each asset by
//! `BLAKE3(base64(content) + extension)`, truncated to 32 hex characters.
//! `pages_asset_hash` does the base64 encoding and the hashing in one pass, so
//! the JavaScript side never builds the (33% larger) base64 string.
//!
//! JavaScript usage (see lib/deploy/blake3-wasm.ts):
//! 1. `alloc(n)` returns a pointer to `n` bytes of wasm memory.
//! 2. Copy the input there, call a hash function with an output pointer.
//! 3. `dealloc(ptr, n)` frees each allocation.

use std::alloc::{alloc as raw_alloc, dealloc as raw_dealloc, Layout};

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/// Bytes of input encoded per batch; a multiple of 3 so only the last batch needs padding.
const BATCH: usize = 3 * 4096;

/// Allocates `len` bytes (at least 1) and returns the pointer, or null on failure.
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    match Layout::from_size_align(len.max(1), 1) {
        Ok(layout) => unsafe { raw_alloc(layout) },
        Err(_) => std::ptr::null_mut(),
    }
}

/// Frees memory returned by `alloc` with the same `len`.
#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(len.max(1), 1) {
        unsafe { raw_dealloc(ptr, layout) }
    }
}

/// Writes the 32-byte BLAKE3 hash of `input[0..len]` to `out[0..32]`.
#[no_mangle]
pub extern "C" fn hash(input: *const u8, len: usize, out: *mut u8) {
    let data = unsafe { slice(input, len) };
    let digest = blake3::hash(data);
    unsafe { std::ptr::copy_nonoverlapping(digest.as_bytes().as_ptr(), out, 32) };
}

/// Writes BLAKE3(base64(content) + extension) to `out[0..32]`.
#[no_mangle]
pub extern "C" fn pages_asset_hash(content: *const u8, content_len: usize, extension: *const u8, extension_len: usize, out: *mut u8) {
    let content = unsafe { slice(content, content_len) };
    let extension = unsafe { slice(extension, extension_len) };
    let digest = asset_hash(content, extension);
    unsafe { std::ptr::copy_nonoverlapping(digest.as_ptr(), out, 32) };
}

/// Safe core of `pages_asset_hash`, also used by the native tests.
pub fn asset_hash(content: &[u8], extension: &[u8]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    let mut encoded = vec![0u8; BATCH / 3 * 4];
    for batch in content.chunks(BATCH) {
        let written = encode_base64(batch, &mut encoded);
        hasher.update(&encoded[..written]);
    }
    hasher.update(extension);
    *hasher.finalize().as_bytes()
}

/// Standard base64 with padding. `out` must hold `ceil(input.len() / 3) * 4` bytes.
fn encode_base64(input: &[u8], out: &mut [u8]) -> usize {
    let mut written = 0;
    let mut groups = input.chunks_exact(3);
    for group in &mut groups {
        let n = (u32::from(group[0]) << 16) | (u32::from(group[1]) << 8) | u32::from(group[2]);
        out[written] = BASE64[(n >> 18) as usize & 63];
        out[written + 1] = BASE64[(n >> 12) as usize & 63];
        out[written + 2] = BASE64[(n >> 6) as usize & 63];
        out[written + 3] = BASE64[n as usize & 63];
        written += 4;
    }
    let rest = groups.remainder();
    if !rest.is_empty() {
        let b0 = u32::from(rest[0]);
        let b1 = rest.get(1).map_or(0, |&b| u32::from(b));
        let n = (b0 << 16) | (b1 << 8);
        out[written] = BASE64[(n >> 18) as usize & 63];
        out[written + 1] = BASE64[(n >> 12) as usize & 63];
        out[written + 2] = if rest.len() == 2 { BASE64[(n >> 6) as usize & 63] } else { b'=' };
        out[written + 3] = b'=';
        written += 4;
    }
    written
}

unsafe fn slice<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 || ptr.is_null() {
        &[]
    } else {
        std::slice::from_raw_parts(ptr, len)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        let mut out = [0u8; 8];
        for (input, expected) in [(&b""[..], ""), (b"f", "Zg=="), (b"fo", "Zm8="), (b"foo", "Zm9v"), (b"foob", "Zm9vYg==")] {
            let n = encode_base64(input, &mut out);
            assert_eq!(std::str::from_utf8(&out[..n]).unwrap(), expected);
        }
    }

    #[test]
    fn asset_hash_equals_hashing_the_base64_string() {
        // Spans several batches and ends on a partial group.
        let content: Vec<u8> = (0..(BATCH * 3 + 2)).map(|i| (i % 251) as u8).collect();
        let mut encoded = vec![0u8; (content.len() + 2) / 3 * 4];
        let n = encode_base64(&content, &mut encoded);
        let mut expected = encoded[..n].to_vec();
        expected.extend_from_slice(b"js");
        assert_eq!(asset_hash(&content, b"js"), *blake3::hash(&expected).as_bytes());
    }

    #[test]
    fn empty_input_matches_the_published_vector() {
        assert_eq!(hex(blake3::hash(b"").as_bytes()), "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262");
    }
}
