import sha256 from '@cryptography/sha256';
import bytesFromHex from '@helpers/bytes/bytesFromHex';

// SHA-256 of the same fixed RSA-2048 PKCS#1 identity used by HTTPS discovery, not MTProto's fingerprint.
export default function serverFingerprint(publicKey: {modulus: string, exponent: string}) {
  const der = bytesFromHex('3082010a0282010100' + publicKey.modulus + '0203010001');
  return sha256(String.fromCharCode(...der), 'hex');
}
