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

var eccrypto = require("eccrypto");
var CryptoJS = require("crypto-js");

/* Crypto stuff is wrapped up here to make it easy to swap libraries */
function sha256(buf) {
  return CryptoJS.SHA256(buf).toString();
}

function testSha256Busted() {
  if(sha256("foo") == sha256("bar")) throw "SHA256 is busted. Sorry.";
}

function randomBytes(length) {
  var arr = new Uint8Array(length);
  global.crypto.getRandomValues(arr);
  return new Buffer(arr);
}

function fromBase64(buf) {
  return Buffer(buf, 'base64');
}

function toBase64(buf) {
  return Buffer(buf).toString('base64');
}

function symmetricDecrypt(key, ciphertext) {
  var outerObject = ciphertext.split(",");
  var encoded = CryptoJS.AES.decrypt(outerObject[0], key, {iv:CryptoJS.enc.Hex.parse(outerObject[1])}).toString(CryptoJS.enc.Utf8);
  var plaintext = fromBase64(encoded.split(",")[1]).toString('utf8')
  return plaintext;
}

function symmetricEncrypt(key, plaintext) {
  var leftPadLength = Math.floor(key.length*Math.random())+key.length,
      rightPadLength = Math.floor(key.length*Math.random())+key.length,
      iv = new CryptoJS.lib.WordArray.random(key.length),
      encoded = [ toBase64(randomBytes(leftPadLength)), toBase64(plaintext), toBase64(randomBytes(rightPadLength)) ];
  
  return CryptoJS.AES.encrypt(encoded.join(","), key, {iv:iv}).toString() + "," + iv.toString();
}

function deriveSharedSecret(private, public, callback) {
  return eccrypto.derive(private, public).then(function(sharedKey) {
    callback(sharedKey);
  });
}

function makePrivateKey(bits) {
  return randomBytes(bits / 8)
}

function getPublicKey(privateKey) {
  return eccrypto.getPublic(privateKey);
}

function serializePublicKey(publicKey) {
  return toBase64(publicKey);
}

function deserializePublicKey(serializedPublicKey) {
  return fromBase64(serializedPublicKey);
}

/* Actual FreespeakClient, used to manage comms with server */
function FreespeakClient() {
  this.keyLength = 256; 
  
  this.privateKey = makePrivateKey(this.keyLength);
  this.publicKey = getPublicKey(this.privateKey);
  this.handshakeNonce = toBase64(randomBytes(this.keyLength / 8));
  this.serializedPublicKey = serializePublicKey(this.publicKey);

  this.keys = {};
  this.eventListeners = {};
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
}

//
// Methods for sending requests to server
//

FreespeakClient.prototype.send = function(payload) {
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

  deriveSharedSecret(this.privateKey, pubkey, function(sharedKey) {
    var supplementNonce = toBase64(randomBytes(self.keyLength / 8));

    self.connectionInfo = {
      "id":id,
      "key":sha256(supplementNonce + self.handshakeNonce + peerHandshakeNonce),
      "responseHash":sha256(self.id + supplementNonce + peerHandshakeNonce)
    };

    var nonceHash = sha256(supplementNonce);
    var nonceEncrypted = symmetricEncrypt(sharedKey, supplementNonce);

    self.send(JSON.stringify(["offer", id, nonceEncrypted, nonceHash]));
  });

  this.event("offerSent", {"id":id});
}

FreespeakClient.prototype.sendAccept = function(offerData) {
  this.connectionInfo = offerData;

  var encryptedResponseHash = symmetricEncrypt(this.connectionInfo.key, this.connectionInfo.responseHash);
  this.send(JSON.stringify(["accept", this.connectionInfo.id, encryptedResponseHash]));
  this.event("acceptSent", {"id":this.connectionInfo.id});
}

FreespeakClient.prototype.sendMsg = function(id, msg) {
  if(id != this.connectionInfo.id) throw "Support for multiple peers not yet available.";

  this.send(JSON.stringify(["msg", id, symmetricEncrypt(this.connectionInfo.key, msg)]));
  this.event("msgSent", {"id":id, "msg":msg});
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

  this.event("getkey", { "id":args[1], "pubkey":deserializePublicKey(args[2]), "nonce":args[3] });
}

FreespeakClient.prototype.__handle_offer = function(args) {
  var peerKey = deserializePublicKey(args[2]),
      peerHandshakeNonce = args[3],
      self = this;
  
  deriveSharedSecret(this.privateKey, peerKey, function(sharedKey) {
    var supplementNonce = symmetricDecrypt(sharedKey, args[4]),
        expectedNonceHash = args[5],
        actualNonceHash = sha256(supplementNonce);

    if(actualNonceHash != expectedNonceHash) {
      console.log("Ignoring offer from " + args[1] + ": hash of decrypted nonce did not match alleged nonce hash of " + expectedNonceHash);
      return;
    }

    var data = {
      "id":args[1],
      "key": sha256(supplementNonce + peerHandshakeNonce + self.handshakeNonce),
      "responseHash":sha256(args[1] + supplementNonce + self.handshakeNonce)
    };

    self.event("offer", data);
  });
}

FreespeakClient.prototype.__handle_accept = function(args) {
  var responseHash = symmetricDecrypt(this.connectionInfo.key, args[2]);

  if(this.connectionInfo.responseHash != responseHash) {
    console.log("Ignoring accept from " + args[1] + ": response hash did not match expected response hash");
    return;
  }
  
  this.event("accept", {"id":args[1]});
}

FreespeakClient.prototype.__handle_msg = function(args) {
  this.event("msg", {"id":args[1], "msg":symmetricDecrypt(this.connectionInfo.key, args[2])});
}

FreespeakClient.prototype.__handle_disconnect = function(args) {
  this.event("disconnect", { "id":args[1] });
  this.socket.close();
}

FreespeakClient.prototype.__handle_heartbeat = function(args) {
  var self = this;

  setTimeout(function() { self.sendHeartbeat() }, 10000);
  this.event("heartbeat", {});
}

//
// Frontend stuff
//

function pad(x) {
  return (x < 10) ? "0"+x : ""+x;
}

function currentTime() {
  var ts = new Date();
  return [pad(ts.getHours()), pad(ts.getMinutes()), pad(ts.getSeconds())].join(":");
}

function escapeHtml(unsafe) {
  // thanks bjornd, http://stackoverflow.com/questions/6234773/can-i-escape-html-special-chars-in-javascript
  return unsafe
   .replace(/&/g, "&amp;")
   .replace(/</g, "&lt;")
   .replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;")
   .replace(/'/g, "&#039;");
}

function urlBase(url) {
  var match = /^((ws|wss|http|https):\/\/[^\/]+)\//.exec(url);
  if(!match) throw "Unable to parse URL: " + url;
  return match[1];
}

function urlPrefix() {
  return urlBase(window.location.href);
}

function webSocketUrl() {
  return urlBase(window.location.href.replace(/^http/, "ws")) + "/ws";
}

function addMessage(sender, messages) {
  if(!(messages instanceof Array)) messages = [ messages ];

  var table = document.getElementById("terminal").firstChild,
      row = table.insertRow(-1),
      timestampCell = row.insertCell(0),
      nickCell = row.insertCell(1),
      messageCell = row.insertCell(2),
      senderLookup = { you:"you", system:"system", them:peerId },
      senderName;


  row.className = sender;

  senderLookup[peerId] = peerId;
  senderName = senderLookup[sender] || "unknown";

  timestampCell.className = "timestamp";
  nickCell.className = "nick";
  messageCell.className = "message";
  
  timestampCell.innerHTML = currentTime();
  nickCell.innerHTML = senderName;

  var html = "<ul>"
  messages.forEach(function(message) {
    html += "<li"
    if(!(message instanceof Array)) message = [ null, message ];
    if(message[0]) html += ' class="'+message[0]+'"';
    html += ">" + escapeHtml(message[1]) + "</li>";
  });
  html += "</ul>"

  messageCell.innerHTML = html;
}

document.addEventListener('keydown', function(event) {
  if([91, 93, 224].indexOf(event.keyCode) != -1) return;
  if(event.metaKey && event.keyCode == 67) return;

  if(event.keyCode == 13) {
    var typebox = document.getElementById("typebox"),
        msg = typebox.value;

    typebox.value = '';

    if(peerId) {
      addMessage("you", msg);
      client.sendMsg(peerId, msg);
    } else {
      addMessage("system", "You are not connected.");
    }
  }

  document.getElementById('typebox').focus();
});

document.addEventListener('keyup', function(event) {
  if(event.keyCode == 13) {
    document.getElementById('typebox').value = '';
  }
});


// debug code
if(false) {
  var [listener, connector] = [ new FreespeakClient(), new FreespeakClient() ];

  listener.on("key", function(event) { console.log("Registered key"); });
  listener.on("connect", function(event) { console.log("Connected as " + event.data["id"]); connector.connect(webSocketUrl()) });
  listener.on("offer", function(event) { console.log("Listener received offer"); listener.sendAccept(event.data) });
  listener.on("accept", function(event) { console.log("Received accept"); });
  listener.on("msg", function(event) { console.log("Listener received message: " + event.data.msg); listener.sendMsg(connector.id, "sup") });

  listener.connect(webSocketUrl());

  connector.on("connect", function(event) {
    console.log("Second client connected; requesting key for " + listener.id);
    connector.sendGetKey(listener.id);
  });

  connector.on("getkey", function(event) {
    console.log("Got key: " + serializePublicKey(event.data["pubkey"]));
    connector.sendOffer(listener.id, event.data["pubkey"], event.data["nonce"]);
  });

  connector.on("accept", function(event) {
    connector.sendMsg(listener.id, "hola esse");
  });

  connector.on("msg", function(event) { console.log("Connector received message: " + event.data.msg) })
  return;
}

var client = new FreespeakClient();
var peerId;

function runFreespeak() {
  addMessage("system", "Connecting anonymously to Freespeak server at " + webSocketUrl() + "...");

  client.connect(webSocketUrl());

  client.on("connect", function(event) {
    var match = /\/talk\/([0-9a-zA-Z]+)$/.exec(window.location.href),
        url = urlPrefix()+ "/talk/" + event.data.id;

    addMessage("system", "You are anonymous user " + event.data.id + ".");
    if(!match) {
      addMessage("system", "Give this URL to the person you want to chat securely with:");
      addMessage("system", [ [ "chatlink", url ] ]);
    }

    addMessage("system", "Server MOTD:");
    addMessage("system", [ ["motd", event.data.motd] ]);
    
    if(match) {
      var peerId = match[1];
      client.sendGetKey(peerId);
      addMessage("system", "Requesting public key for " + peerId + "...");
    } else {
      addMessage("system", "Waiting for peer...");
    }
  });

  client.on("getkey", function(event) {
    addMessage("system", "Establishing end-to-end encrypted channel with " + event.data.id + "...");
    client.sendOffer(event.data.id, event.data.pubkey, event.data.nonce);
  });

  client.on("getkeyFailed", function(event) {
    addMessage("system", "Cannot get public key information for " + event.data.id);
  });

  client.on("offer", function(event) {
    addMessage("system", "You are now chatting securely with " + event.data.id + ".");
    client.sendAccept(event.data);
    peerId = event.data.id;
  });

  client.on("accept", function(event) {
    addMessage("system", "You are now chatting securely with " + event.data.id + ".");
    peerId = event.data.id;
  });

  client.on("msg", function(event) {
    addMessage(event.data.id, event.data.msg);
  });

  client.on("sendMsg", function(event) {
    addMessage("you", event.data.msg);
  });

  client.on("disconnect", function(event) {
    addMessage("system", "Server lost connection to remote peer.");
    peerId = null;
  });

  client.on("close", function(event) {
    addMessage("system", "Lost connection to server.");
    peerId = null;
  });

  client.on("heartbeatSent", function(event) {
    addMessage("system", "Sent heartbeat to server...");
  });

  client.on("heartbeat", function(event) {
    addMessage("system", "Heard server heartbeat.");
  });
}

setTimeout(runFreespeak, 100);
