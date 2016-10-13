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

  deriveSharedSecret(this.privateKey, pubkey, function(sharedKey) {
    var supplementNonce = toBase64(randomBytes(self.keyLength / 8));

    self.connectionInfo[id] = {
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
  var connInfo = this.connectionInfo[offerData.id] = offerData;

  var encryptedResponseHash = symmetricEncrypt(connInfo.key, connInfo.responseHash);
  this.send(JSON.stringify(["accept", connInfo.id, encryptedResponseHash]));
  this.event("acceptSent", {"id":connInfo.id});
}

FreespeakClient.prototype.sendMsg = function(id, msg) {
  if(!this.connectionInfo[id]) throw "You are not connected to that ID";

  this.send(JSON.stringify(["msg", id, symmetricEncrypt(this.connectionInfo[id].key, msg)]));
  this.event("sendMsg", {"id":id, "msg":msg});
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
    self.event("established", data);
  });
}

FreespeakClient.prototype.__handle_accept = function(args) {
  var connInfo = this.connectionInfo[args[1]];
  if(!connInfo) return;

  var responseHash = symmetricDecrypt(connInfo.key, args[2]);

  if(connInfo.responseHash != responseHash) {
    console.log("Ignoring accept from " + args[1] + ": response hash did not match expected response hash");
    return;
  }
  
  this.event("accept", {"id":args[1]});
  this.event("established", connInfo);
}

FreespeakClient.prototype.__handle_msg = function(args) {
  var connInfo = this.connectionInfo[args[1]];
  if(!connInfo) return;

  this.event("msg", {"id":args[1], "msg":symmetricDecrypt(connInfo.key, args[2])});
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

//
// Session management
//

function ChatSession(peerId, callback) {
  this.peerId = peerId;
  this.messages = [];
  this.callback = callback;
  this.connected = false;
}

ChatSession.prototype.addMessage = function(sender, text, timestamp) {
  var message = { "timestamp":(timestamp || currentTime()), "sender":sender, "text":text };
  this.messages.push(message);
  this.callback({"name":"addMessage", "message":message});
}

function ChatSessionManager(client) {
  this.sessions = {};
  this.handlers = {};
  this.client = client;
  var self = this;

  this.client.on("connecting", function(event) {
    self.addSystemMessage("Connecting anonymously to Freespeak server at " + event.data.url + "...");
  });

  this.client.on("connect", function(event) {
    var match = /\/talk\/([0-9a-zA-Z]+)$/.exec(window.location.href),
        url = urlPrefix()+ "/talk/" + event.data.id;

    self.addSystemMessage("You are anonymous user " + event.data.id + ".");
    self.addSystemMessage("Give this URL to the person you want to chat securely with:");
    self.addSystemMessage([ [ "chatlink", url ] ]);

    self.addSystemMessage("Server MOTD:");
    self.addSystemMessage([ ["motd", event.data.motd] ]);
    
    if(match) {
      var peerId = match[1];
      client.sendGetKey(peerId); // TODO: this is the one place where network logic is contained in ChatSessionManager. Consider relocating.
      self.addSession(peerId).addMessage("system", "Requesting public key for " + peerId + "...");
    } else {
      self.addSystemMessage("Waiting for peer...");
    }
  });

  this.client.on("getkey", function(event) {
    var session = self.addSession(event.data.id);
    session.addMessage("system", "Establishing end-to-end encrypted channel with " + event.data.id + "...");
  });

  this.client.on("getkeyFailed", function(event) {
    var session = self.addSession(event.data.id);
    session.addMessage("system", "Cannot get public key information for " + event.data.id);
  });

  this.client.on("established", function(event) {
    var session = self.addSession(event.data.id);
    session.connected = true;
    session.addMessage("system", "You are now chatting securely with " + event.data.id + ".");
  });

  this.client.on("disconnect", function(event) {
    var session = self.addSession(event.data.id);
    session.connected = false;
    session.addMessage(event.data.id, event.data.id + " has disconnected.");
  });

  this.client.on("close", function(event) {
    sessionManager.addBroadcastMessage("system", "Disconnected.");
  });

  this.client.on("msg", function(event) {
    var session = self.addSession(event.data.id);
    session.addMessage(event.data.id, event.data.msg);
  });

  this.client.on("sendMsg", function(event) {
    var session = self.addSession(event.data.id);
    session.addMessage("you", event.data.msg);
  });
}

ChatSessionManager.prototype.addSystemMessage = function(text, timestamp) {
  var session = this.addSession("system");
  session.addMessage("system", text, timestamp)
}

ChatSessionManager.prototype.addBroadcastMessage = function(sender, text, timestamp) {
  var self = this;
  Object.keys(this.sessions).forEach(function(id) {
    self.sessions[id].addMessage(sender, text, timestamp);
  });
}

ChatSessionManager.prototype.addSession = function(id) {
  var self = this;

  if(this.sessions[id]) return this.sessions[id];

  var session = new ChatSession(id, function(event) {
    self.event("updatedSession", self.sessions[id]);

    if(event.name == "addMessage") {
      var eventName = (self.sessions[id] == self.activeSession) ? "activeSessionAddedMessage" : "inactiveSessionAddedMessage";
      self.event(eventName, { "session":self.sessions[id], "message":event.message });
    }
  });

  this.sessions[id] = session;
  this.event("addedSession", { "session": this.sessions[id] });

  if(this.activeSession == null || this.activeSession.peerId == "system") this.activateSession(id);

  return session;
}

ChatSessionManager.prototype.getSession = function(id) {
  return this.sessions[id];
}

ChatSessionManager.prototype.activateSession = function(id) {
  if(this.activeSession && this.activeSession.peerId == id) return;

  var self = this, prevSession = this.activeSession;
  this.activeSession = this.addSession(id);

  this.event("activatedSession", { "prevSession":prevSession, "session":this.activeSession });
  this.activeSession.messages.forEach(function(message) {
    self.event("activeSessionAddedMessage", { "session":self.activeSession, "message":message })
  });
}

ChatSessionManager.prototype.event = function(name, data) {
  if(!this.handlers[name]) return;
  
  var event = { "name":name, "data":data };

  this.handlers[name].forEach(function(handler) {
    handler(event)
  });
}

ChatSessionManager.prototype.on = function(name, callback) {
  if(!this.handlers[name]) this.handlers[name] = [];
  this.handlers[name].push(callback);
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

function clearMessages() {
  var table = document.getElementById("terminal").firstChild;
  table.innerHTML = "";
}

function terminalAtBottom() {
  return terminal.scrollTop >= terminal.scrollHeight - terminal.clientHeight;
}

function snapTerminalToBottom() {
  terminal.scrollTop = terminal.scrollHeight - terminal.clientHeight;
}


function printMessage(sender, messages, timestamp) {
  if(!(messages instanceof Array)) messages = [ messages ];

  var atBottom = terminalAtBottom(),
      table = document.getElementById("terminal").firstChild,
      row = table.insertRow(-1),
      timestampCell = row.insertCell(0),
      nickCell = row.insertCell(1),
      messageCell = row.insertCell(2);

  row.className = ["you", "system"].indexOf(sender) == -1 ? "them" : sender;
  timestampCell.className = "timestamp";
  nickCell.className = "nick";
  messageCell.className = "message";
  
  timestampCell.innerHTML = timestamp;
  nickCell.innerHTML = sender;

  var html = "<ul>"
  messages.forEach(function(message) {
    html += "<li"
    if(!(message instanceof Array)) message = [ null, message ];
    if(message[0]) html += ' class="'+message[0]+'"';
    html += ">" + escapeHtml(message[1]) + "</li>";
  });
  html += "</ul>"

  messageCell.innerHTML = html;
  if(atBottom) snapTerminalToBottom();
}

function addSessionTab(session) {
  var list = document.getElementById("sidebar").firstChild;
  var entry = document.createElement('li');
  if(session.peerId == "system") entry.className = "system";
  entry.appendChild(document.createTextNode(session.peerId));
  
  entry.onclick = function() {
    sessionManager.activateSession(session.peerId);
  }

  list.appendChild(entry);
}

function markSessionTab(session, className) {
  var list = document.getElementById("sidebar").firstChild;

  for(var child = list.firstChild; child !== null; child = child.nextSibling) {
    if(child.innerHTML == session.peerId) {
      child.className = className;
      return;
    }
  }
}

function fixElementSizes() {
  var terminal = document.getElementById("terminal");
  var sidebar = document.getElementById("sidebar");
  var typebox = document.getElementById("typebox");

  var height = "" + (typebox.getBoundingClientRect().top + window.scrollY) + "px";

  terminal.style.height = height;
  sidebar.style.height = height;

  terminal.onscroll = function() {
    if(sessionManager.activeSession && terminalAtBottom()) {
      markSessionTab(sessionManager.activeSession, "active");
    }
  }
}

document.addEventListener('keydown', function(event) {
  if([91, 93, 224].indexOf(event.keyCode) != -1) return;
  if(event.metaKey && event.keyCode == 67) return;

  if(event.keyCode == 13) {
    var typebox = document.getElementById("typebox"),
        msg = typebox.value;

    typebox.value = '';

    if(sessionManager.activeSession.connected) {
      client.sendMsg(sessionManager.activeSession.peerId, msg);
    } else if(sessionManager.activeSession.peerId == "system") {
      sessionManager.activeSession.addMessage("system", "You cannot talk in this window.");
    } else {
      sessionManager.activeSession.addMessage("system", "You are not connected.");
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
var sessionManager = new ChatSessionManager(client);
var peerId;

function runFreespeak() {
  fixElementSizes();

  sessionManager.on("addedSession", function(event) {
    addSessionTab(event.data.session);
  });

  sessionManager.on("activeSessionAddedMessage", function(event) {
    printMessage(event.data.message.sender, event.data.message.text, event.data.message.timestamp);
    if(!terminalAtBottom()) markSessionTab(event.data.session, "active unread");
  });

  sessionManager.on("inactiveSessionAddedMessage", function(event) {
    markSessionTab(event.data.session, "unread");
  });

  sessionManager.on("activatedSession", function(event) {
    if(event.data.prevSession) markSessionTab(event.data.prevSession, "");
    clearMessages();
    markSessionTab(event.data.session, "active");
    snapTerminalToBottom();
  });
  
  client.on("getkey", function(event) {
    client.sendOffer(event.data.id, event.data.pubkey, event.data.nonce);
  });

  client.on("offer", function(event) {
    client.sendAccept(event.data);
  });

  client.connect(webSocketUrl());

  for(var i = 0; i < 100; i++) sessionManager.addSystemMessage("spam");


  client.on("heartbeatSent", function(event) {
    addMessage("system", "Sent heartbeat to server...");
  });

  client.on("heartbeat", function(event) {
    addMessage("system", "Heard server heartbeat.");
  });
}

setTimeout(runFreespeak, 100);
