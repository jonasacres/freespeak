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

define(["lib/shared", "lib/crypto"], function(Shared, Crypto) {
  function UserData() {
    this.data = {
      "aliases": {},
    };

    this.keyLength = 256;
    this.generateKeys();
    this.eventListeners = {};
  }

  UserData.prototype.generateKeys = function() {
    this.privateKey = Crypto.makePrivateKey(this.keyLength);
    this.publicKey = Crypto.getPublicKey(this.privateKey);
    this.data.privateKey = Crypto.toBase64(this.privateKey);
    this.handshakeNonce = Crypto.toBase64(Crypto.randomBytes(this.keyLength / 8));
  }

  UserData.prototype.export = function(passphrase) {
    return Crypto.encryptWithPassphrase(passphrase, JSON.stringify(this.data));
  }

  UserData.prototype.import = function(passphrase, data) {
    this.data = JSON.parse(Crypto.decryptWithPassphrase(passphrase, data));

    if(this.data.privateKey) {
      var importedKey = Crypto.fromBase64(this.data.privateKey);
      if(importedKey != this.privateKey) {
        var oldPublicKey = this.publicKey;
        this.privateKey = importedKey;
        this.publicKey = Crypto.getPublicKey(this.privateKey);
        this.handshakeNonce = Crypto.toBase64(Crypto.randomBytes(this.keyLength / 8));
        this.event("changeKey", {"oldPublicKey":oldPublicKey, "newPublicKey":this.publicKey});
      }
    }
  }

  UserData.prototype.setAlias = function(peerId, alias) {
    this.data.aliases[peerId] = alias;
  }

  UserData.prototype.getAlias = function(peerId) {
    return this.data.aliases[peerId];
  }

  UserData.prototype.forEachAlias = function(callback) {
    for(var peerId in this.data.aliases) {
      callback(peerId, this.data.aliases[peerId]);
    }
  }

  UserData.prototype.setProfileName = function(name) {
    this.data.profileName = name;
  }

  UserData.prototype.getProfileName = function() {
    return this.data.profileName;
  }

  UserData.prototype.on = function(name, callback) {
    if(!this.eventListeners[name]) this.eventListeners[name] = [];
    this.eventListeners[name].push(callback);
  }

  UserData.prototype.event = function(name, data) {
    var event = { "name":name, "data":data },
        listeners = this.eventListeners[name];

    if(!listeners) return;
    listeners.forEach(function(listener) { listener(event) });
  }

  return UserData;
});
