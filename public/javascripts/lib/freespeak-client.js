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

/* Actual FreespeakClient, used to manage comms with server */

define(["lib/crypto"], function(Crypto) {
  function FreespeakClient() {
    this.keyLength = 256; 
    
    this.privateKey = Crypto.makePrivateKey(this.keyLength);
    this.publicKey = Crypto.getPublicKey(this.privateKey);
    this.handshakeNonce = Crypto.toBase64(Crypto.randomBytes(this.keyLength / 8));
    this.serializedPublicKey = Crypto.serializePublicKey(this.publicKey);

    this.keys = {};
    this.eventListeners = {};
    this.connectionInfo = {};
  }

  FreespeakClient.prototype.on = function(name, callback) {
    if(!this.eventListeners[name]) this.eventListeners[name] = [];
    this.eventListeners[name].push(callback);
  }

  FreespeakClient.prototype.event = function(name, data) {
    var event = { "name":name, "data":data },
        listeners = this.eventListeners[name];

    if(!listeners) return;
    listeners.forEach(function(listener) { listener(event) });
  }

  FreespeakClient.prototype.connect = function(url) {
    this.socket = new WebSocket(url);
    var self = this;

    this.socket.onopen = function(event) {
      self.sendKey();
      self.sendHeartbeat();
    }

    this.socket.onmessage = function(event) {
      var args;
      try {
        args = JSON.parse(event.data);
      } catch(exc) {
        console.log("Unable to parse event data: '" + event.data + "'");
        return;
      }

      if(!(args instanceof Array)) return;

      var handler = "__handle_" + args[0];
      if(self[handler] == null) return;

      self[handler](args);
    }

    this.socket.onclose = function(event) {
      self.event("close", {});
    }

    this.event("connecting", {"url":url});
  }

  //
  // Methods for sending requests to server
  //

  FreespeakClient.prototype.send = function(payload) {
    // TODO: don't attempt to send if socket is in CLOSED or CLOSING state
    this.socket.send(payload);
  }

  FreespeakClient.prototype.sendHeartbeat = function() {
    this.send(JSON.stringify(["heartbeat"]));
    this.event("heartbeatSent", {});
  }

  FreespeakClient.prototype.sendKey = function() {
    this.send(JSON.stringify(["key", this.serializedPublicKey, this.handshakeNonce]));
    this.event("keySent", {});
  }

  FreespeakClient.prototype.sendGetKey = function(id) {
    this.send(JSON.stringify(["getkey", id]));
    this.event("getKeySent", {"id":id});
  }

  FreespeakClient.prototype.sendOffer = function(id, pubkey, peerHandshakeNonce) {
    var self = this;

    Crypto.deriveSharedSecret(this.privateKey, pubkey, function(sharedKey) {
      var supplementNonce = Crypto.toBase64(Crypto.randomBytes(self.keyLength / 8));

      var oldInfo = self.connectionInfo[id];

      self.connectionInfo[id] = {
        "id":id,
        "key":Crypto.sha256(supplementNonce + self.handshakeNonce + peerHandshakeNonce),
        "responseHash":Crypto.sha256(self.id + supplementNonce + peerHandshakeNonce)
      };

      if(oldInfo) {
        self.connectionInfo[id].retxMsg = oldInfo.retxMsg;
      }

      var nonceHash = Crypto.sha256(supplementNonce);
      var nonceEncrypted = Crypto.symmetricEncrypt(sharedKey, supplementNonce);

      self.send(JSON.stringify(["offer", id, nonceEncrypted, nonceHash]));
    });

    this.event("offerSent", {"id":id});
  }

  FreespeakClient.prototype.sendAccept = function(offerData) {
    var oldInfo = this.connectionInfo[offerData.id],
        connInfo = this.connectionInfo[offerData.id] = offerData;

    var encryptedResponseHash = Crypto.symmetricEncrypt(connInfo.key, connInfo.responseHash);
    this.send(JSON.stringify(["accept", connInfo.id, encryptedResponseHash]));
    this.event("acceptSent", {"id":connInfo.id});

    if(oldInfo && oldInfo.retxMsg) {
      this.sendMsg(connInfo.id, oldInfo.retxMsg, {"retransmit":true});
    }
  }

  FreespeakClient.prototype.sendMsg = function(id, msg, options) {
    if(options == null) options = {};

    if(!this.connectionInfo[id]) throw "You are not connected to that ID";
    var ciphertext = Crypto.symmetricEncrypt(this.connectionInfo[id].key, msg),
        retransmitted = (options.retransmit == true);
    this.connectionInfo[id].lastMsg = msg;
    this.connectionInfo[id].lastMsgCiphertextHash = Crypto.sha256Truncated(ciphertext, 8);

    this.send(JSON.stringify(["msg", id, ciphertext, retransmitted]));
    this.event("sendMsg", {"id":id, "msg":msg, "retransmit":retransmitted });
  }

  FreespeakClient.prototype.sendCryptoFail = function(id, ciphertext) {
    var hash = Crypto.sha256Truncated(ciphertext, 8);

    this.send(JSON.stringify(["cryptofail", id, hash]));
    this.event("sendCryptoFail", {"id":id, "ciphertext":ciphertext, "hash":hash});
  }

  //
  // Message handlers, for processing incoming async requests from server
  //

  FreespeakClient.prototype.__handle_key = function(args) {
    this.id = args[1];
    this.event("connect", { "id":args[1], "motd":args[2] });
  }

  FreespeakClient.prototype.__handle_getkey = function(args) {
    if(args[2] == null) {
      this.event("getkeyFailed", { "id":args[1] });
      return;
    }

    this.event("getkey", { "id":args[1], "pubkey":Crypto.deserializePublicKey(args[2]), "nonce":args[3] });
  }

  FreespeakClient.prototype.__handle_offer = function(args) {
    var peerKey = Crypto.deserializePublicKey(args[2]),
        peerHandshakeNonce = args[3],
        self = this;
    
    Crypto.deriveSharedSecret(this.privateKey, peerKey, function(sharedKey) {
      var supplementNonce = Crypto.symmetricDecrypt(sharedKey, args[4]),
          expectedNonceHash = args[5],
          actualNonceHash = Crypto.sha256(supplementNonce);

      if(actualNonceHash != expectedNonceHash) {
        console.log("Ignoring offer from " + args[1] + ": hash of decrypted nonce did not match alleged nonce hash of " + expectedNonceHash);
        return;
      }

      var data = {
        "id":args[1],
        "key": Crypto.sha256(supplementNonce + peerHandshakeNonce + self.handshakeNonce),
        "responseHash":Crypto.sha256(args[1] + supplementNonce + self.handshakeNonce)
      };

      self.event("offer", data);
      self.event("established", data);
    });
  }

  FreespeakClient.prototype.__handle_accept = function(args) {
    var connInfo = this.connectionInfo[args[1]];
    if(!connInfo) return;

    var responseHash = Crypto.symmetricDecrypt(connInfo.key, args[2]);

    if(connInfo.responseHash != responseHash) {
      console.log("Ignoring accept from " + args[1] + ": response hash did not match expected response hash");
      return;
    }
    
    if(connInfo.retxMsg) {
      this.sendMsg(connInfo.id, connInfo.retxMsg, {"retransmit":true});
      delete connInfo.retxMsg;
    }

    this.event("accept", {"id":args[1]});
    this.event("established", connInfo);
  }

  FreespeakClient.prototype.__handle_msg = function(args) {
    var connInfo = this.connectionInfo[args[1]];
    
    try {
      if(!connInfo) throw "Don't have a connection to this peer";
      this.event("msg", {"id":args[1], "msg":Crypto.symmetricDecrypt(connInfo.key, args[2]), "retransmit":args[2]});
    } catch(exc) {
      this.sendCryptoFail(args[1], Crypto.sha256Truncated(args[2], 8));
    }
  }

  FreespeakClient.prototype.__handle_disconnect = function(args) {
    var connInfo = this.connectionInfo[args[1]];
    if(!connInfo) return;

    this.event("disconnect", { "id":args[1] });
  }

  FreespeakClient.prototype.__handle_heartbeat = function(args) {
    var self = this;

    setTimeout(function() { self.sendHeartbeat() }, 10000);
    this.event("heartbeat", {});
  }

  FreespeakClient.prototype.__handle_cryptofail = function(args) {
    var connInfo = this.connectionInfo[args[1]], reconnecting = connInfo != null;
    
    if(reconnecting) {
      if(connInfo.lastMsgCiphertextHash == args[2]) connInfo.retxMsg = connInfo.lastMsg;
      this.sendGetKey(args[1]);
    }

    this.event("cryptofail", { "id":args[1], "ciphertextHash":args[2], "reconnecting":reconnecting });
  }

  return FreespeakClient;
});
