// Freespeak, a zero-knowledge ephemeral chat server
// Copyright (C) 2016 Jonas Acres

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

define(["autogen/crypto-support"], function(CryptoSupport) {
  var eccrypto = CryptoSupport.eccrypto;
  var CryptoJS = CryptoSupport.CryptoJS;

  var keyLength = 32;

  function Crypto() {}

  /* First, we have a bunch of wrapper functions. These are really just bridges to library functions,
  ** but we do it to make it easy to swap libraries later.
  */

  /* Character encoding */

  Crypto.fromBase64 = function(buf) {
    return CryptoJS.enc.Base64.parse(buf).toString(CryptoJS.enc.Latin1);
  }

  Crypto.toBase64 = function(buf) {
    return CryptoJS.enc.Latin1.parse(buf).toString(CryptoJS.enc.Base64);
  }

  Crypto.hexToBytes = function(buf) {
    return CryptoJS.enc.Hex.parse(buf).toString(CryptoJS.enc.Latin1);
  }

  Crypto.bytesToHex = function(buf) {
    return CryptoJS.enc.Latin1.parse(buf).toString(CryptoJS.enc.Hex);
  }

  Crypto.stringToArray = function(buf) {
    var arr = [];
    for(var i = 0; i < buf.length; i++) arr.push(buf.charCodeAt(i));
    return arr;
  }

  /* PRNG */

  Crypto.randomBytes = function(length) {
    return (new CryptoJS.lib.WordArray.random(length)).toString(CryptoJS.enc.Latin1);
  }

  Crypto.randInt = function(max) {
    var n = 0,
        r = Crypto.randomBytes(Math.ceil(Math.log(max)/Math.log(2)));
    
    for(var i = 0; i < r.length; i++) {
      n = (n << 8) + r.charCodeAt(i);
    }

    return n;
  }

  /* Secure hashing */

  Crypto.sha256 = function(buf) {
    return CryptoJS.SHA256(buf).toString();
  }

  Crypto.sha256Truncated = function(buf, length) {
    var hash = Crypto.sha256(buf);
    hash = hash.substring(buf.length - length, buf.length);
  }

  /* Symmetric ciphers */

  Crypto.aesDecrypt = function(key, ciphertext, iv) {
    if(typeof(key) == 'string') key = CryptoJS.enc.Latin1.parse(key);
    if(typeof(iv) == 'string') iv = CryptoJS.enc.Latin1.parse(iv);
    return CryptoJS.AES.decrypt(ciphertext, key, {"iv":iv}).toString(CryptoJS.enc.Latin1);
  }

  Crypto.aesEncrypt = function(key, plaintext, iv) {
    if(typeof(key) == 'string') key = CryptoJS.enc.Latin1.parse(key);
    if(typeof(iv) == 'string') iv = CryptoJS.enc.Latin1.parse(iv);
    return CryptoJS.AES.encrypt(plaintext, key, {"iv":iv}).toString(CryptoJS.enc.Latin1);
  }

  /* Asymmetric ciphers */

  Crypto.deriveSharedSecret = function(private, public, callback) {
    return eccrypto.derive(Crypto.stringToArray(private), Crypto.stringToArray(public)).then(function(sharedKey) {
      callback(sharedKey);
    });
  }

  Crypto.makePrivateKey = function(bits) {
    return Crypto.randomBytes(bits / 8)
  }

  Crypto.getPublicKey = function(privateKey) {
    var s = "",
        pub = eccrypto.getPublic(Crypto.stringToArray(privateKey));
    for(var i in pub) s += String.fromCharCode(privateKey[i]);
    return s;
  }

  Crypto.serializePublicKey = function(publicKey) {
    return Crypto.toBase64(publicKey);
  }

  Crypto.deserializePublicKey = function(serializedPublicKey) {
    return Crypto.fromBase64(serializedPublicKey);
  }

  /* Padding */

  Crypto.messagePaddingBytes = function(length) {
    /* Use Math.random() here since it isn't worthwhile to deplete our entropy pool on this. */
    var s = "";
    for(var i = 0; i < length; i++) s += String.fromCharCode(Math.floor(256*Math.random()));
    return s;
  }

  /* Key derivation */

  Crypto.deriveKeyFromPassphrase = function(passphrase, salt) {
    salt = salt || Crypto.randomBytes(128/8);
    return [ CryptoJS.PBKDF2(passphrase, salt, { keySize:keyLength, iterations:1000 }), salt ];
  }

  /* Now we have a frontend to symmetric encryption designed to apply some major niceties, including:
   *  - Per-message keys
   *  - Random padding
   *  - Random initialization vectors
   *  - Built-in error detection
   */

  Crypto.symmetricEncrypt = function(sessionKey, plaintext) {
    // Encrypt a message using our scheme:
    // Inner cipher, encrypted with randomly-generated message key and random IV:
    //   sha256(plaintext) + plaintext
    // Outer cipher, encrypted with session key and random IV:
    //   leftPaddingLength + leftPadding + messageKey + innerIV + innerCipherText + rightPadding
    // Final message:
    //   base64(outerIv + outerCiphertext)

    var        innerKey = new Crypto.randomBytes(keyLength),
                innerIV = new Crypto.randomBytes(keyLength),
                outerIV = new Crypto.randomBytes(keyLength),
         innerPlaintext = Crypto.hexToBytes(Crypto.sha256(plaintext)) + plaintext,

          leftPadLength = Crypto.randInt(256), // 256 because we use a 1-byte length field
         rightPadLength = Crypto.randInt(256),

         outerPlaintext =   String.fromCharCode(leftPadLength)
                          + String.fromCharCode(rightPadLength)
                          + Crypto.messagePaddingBytes(leftPadLength)
                          + innerKey
                          + innerIV
                          + Crypto.aesEncrypt(innerKey, innerPlaintext, innerIV)
                          + Crypto.messagePaddingBytes(rightPadLength),
        outerCiphertext = Crypto.aesEncrypt(sessionKey, outerPlaintext, outerIV);

    return Crypto.toBase64(outerIV + outerCiphertext);
  }

  Crypto.symmetricDecrypt = function(sessionKey, ciphertext) {
    // TODO: graceful error checking (as it stands, just accept it'll throw an exception of SOME kind if it doesn't work)
    var         outerWrapper = Crypto.fromBase64(ciphertext),
                     outerIV = outerWrapper.substring(0, keyLength),
             outerCiphertext = outerWrapper.substring(keyLength),

              outerPlaintext = Crypto.aesDecrypt(sessionKey, outerCiphertext, outerIV),
               leftPadLength = outerCiphertext.charCodeAt(0),
              rightPadLength = outerCiphertext.charCodeAt(1),
             messageKeyIndex = 1 + 1 + leftPadLength, // 2x 1-byte length fields
                innerIVIndex = messageKeyIndex + keyLength,
        innerCiphertextIndex = innerIVIndex + keyLength,
               rightPadIndex = outerPlaintext.length - rightPadLength,

                  messageKey = outerPlaintext.substring(messageKeyIndex, innerIVIndex),
                     innerIV = outerPlaintext.substring(innerIVIndex, innerCiphertextIndex),
             innerCiphertext = outerPlaintext.substring(innerCiphertextIndex, rightPadIndex),

                innerWrapper = Crypto.aesDecrypt(messageKey, innerCiphertext, innerIV),
                   innerHash = Crypto.bytesToHex(innerWrapper.substring(0, 32)), // sha256 -> 32 bytes
                   plaintext = innerWrapper.substring(32);

    if(sha256(plaintext) != innerHash) throw "Unable to decipher message.";
    return plaintext;
  }

  return Crypto;
});
