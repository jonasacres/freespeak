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

define(function() {
  var eccrypto = require("eccrypto");
  var CryptoJS = require("crypto-js");

  function Crypto() {}

  /* Crypto stuff is wrapped up here to make it easy to swap libraries */
  Crypto.sha256 = function(buf) {
    return CryptoJS.SHA256(buf).toString();
  }

  Crypto.randomBytes = function(length) {
    var arr = new Uint8Array(length);
    global.crypto.getRandomValues(arr);
    return new Buffer(arr);
  }

  Crypto.fromBase64 = function(buf) {
    return Buffer(buf, 'base64');
  }

  Crypto.toBase64 = function(buf) {
    return Buffer(buf).toString('base64');
  }

  Crypto.symmetricDecrypt = function(key, ciphertext) {
    var outerObject = ciphertext.split(",");
    var encoded = CryptoJS.AES.decrypt(outerObject[0], key, {iv:CryptoJS.enc.Hex.parse(outerObject[1])}).toString(CryptoJS.enc.Utf8);
    var plaintext = Crypto.fromBase64(encoded.split(",")[1]).toString('utf8')
    return plaintext;
  }

  Crypto.symmetricEncrypt = function(key, plaintext) {
    var leftPadLength = Math.floor(key.length*Math.random())+key.length,
        rightPadLength = Math.floor(key.length*Math.random())+key.length,
        iv = new CryptoJS.lib.WordArray.random(key.length),
        encoded = [ Crypto.toBase64(Crypto.randomBytes(leftPadLength)), Crypto.toBase64(plaintext), Crypto.toBase64(Crypto.randomBytes(rightPadLength)) ];
    
    return CryptoJS.AES.encrypt(encoded.join(","), key, {iv:iv}).toString() + "," + iv.toString();
  }

  Crypto.deriveSharedSecret = function(private, public, callback) {
    return eccrypto.derive(private, public).then(function(sharedKey) {
      callback(sharedKey);
    });
  }

  Crypto.makePrivateKey = function(bits) {
    return Crypto.randomBytes(bits / 8)
  }

  Crypto.getPublicKey = function(privateKey) {
    return eccrypto.getPublic(privateKey);
  }

  Crypto.serializePublicKey = function(publicKey) {
    return Crypto.toBase64(publicKey);
  }

  Crypto.deserializePublicKey = function(serializedPublicKey) {
    return Crypto.fromBase64(serializedPublicKey);
  }

  return Crypto;
});
