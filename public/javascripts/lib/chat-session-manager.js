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

define(["lib/frontend", "lib/chat-session", "lib/crypto"], function(Frontend, ChatSession, Crypto) {
  function ChatSessionManager(client) {
    this.sessions = {};
    this.handlers = {};
    this.client = client;
    var self = this;

    this.client.on("connecting", function(event) {
      self.addSystemMessage("Connecting anonymously to Freespeak server at " + event.data.url + "...");
    });

    this.client.on("connect", function(event) {
      var url = Frontend.urlPrefix() + "/talk/" + event.data.id;
      self.wasConnected = true;

      if(self.everConnected) self.addBroadcastMessage("system", "Reconnected.");
      self.addSystemMessage("You are anonymous user " + event.data.id + ".");
      self.addSystemMessage("Give this URL to people you want to chat securely with:");
      self.addSystemMessage([ [ "chatlink", url ] ]);

      self.addSystemMessage("Server MOTD:");
      self.addSystemMessage([ ["motd", event.data.motd] ]);

      self.everConnected = true;
    });

    this.client.on("getkey", function(event) {
      var session = self.addSession(event.data.id);
      session.addMessage("system", "Establishing end-to-end encrypted channel with " + event.data.id + "...", {"notify":false});
    });

    this.client.on("getkeyFailed", function(event) {
      var session = self.addSession(event.data.id);
      session.addMessage("system", "Cannot get public key information for " + event.data.id, {"notify":false});
    });

    this.client.on("established", function(event) {
      var session = self.addSession(event.data.id);
      session.connected = true;
      session.addMessage("system", "You are now chatting securely with " + event.data.id + ".", {"notify":false});
    });

    this.client.on("disconnect", function(event) {
      var session = self.addSession(event.data.id);
      session.connected = false;
      session.addMessage("system", event.data.id + " has disconnected.", {"notify":false});
    });

    this.client.on("close", function(event) {
      self.addSystemMessage("Connection to server lost.");
      if(self.wasConnected) self.addBroadcastMessage("system", "Disconnected.", {"notify":false} );
      self.wasConnected = false;
    });

    this.client.on("msg.text", function(event) {
      var session = self.addSession(event.data.id);
      session.addMessage(event.data.id, Crypto.fromBase64(event.data.msg.text));
    });

    this.client.on("sendMsg.text", function(event) {
      var session = self.addSession(event.data.id);
      var retxPrefix = event.data.retransmit ? "[RETRY] " : "";
      session.addMessage("you", retxPrefix + Crypto.fromBase64(event.data.msg.text));
    });

    this.client.on("cryptofail", function(event) {
      var session = self.getSession(event.data.id);
      if(!session) return;

      if(event.data.reconnecting) {
        session.addMessage("system", "Remote peer was unable to decipher message. Reconnecting...");
      } else {
        session.addMessage("system", "Remote peer was unable to decipher message.");
      }
    });

    this.client.userData.on("changeKey", function(event) {
      self.reset();
      self.addSystemMessage("Changed key.");
    });
  }

  ChatSessionManager.prototype.addSystemMessage = function(text, options) {
    var session = this.addSession("system");
    session.addMessage("system", text, options)
  }

  ChatSessionManager.prototype.addBroadcastMessage = function(sender, text, options) {
    var self = this;
    Object.keys(this.sessions).forEach(function(id) {
      self.sessions[id].addMessage(sender, text, options);
    });
  }

  ChatSessionManager.prototype.addSession = function(id) {
    var self = this;

    if(this.sessions[id]) return this.sessions[id];

    var session = new ChatSession(id, function(event) {
      switch(event.name) {
        case "addMessage":
          var eventName = (self.sessions[id] == self.activeSession) ? "activeSessionAddedMessage" : "inactiveSessionAddedMessage";
          self.event(eventName, { "session":self.sessions[id], "message":event.message });
          self.event("message", { "session":self.sessions[id], "message":event.message });
          break;
        case "clearMessages":
          self.event("clearedSession", { "session":self.sessions[id] });
          break;
        case "changeDisplayName":
          self.event("setSessionDisplayName", { "session":self.sessions[id], "displayName":event.displayName, "oldDisplayname":event.oldDisplayname });
          break;
        case "setUnread":
          // placeholder
          break;
      }

      self.event("updatedSession", { "session":self.sessions[id] });
    });

    this.sessions[id] = session;
    this.event("addedSession", { "session": this.sessions[id] });

    if(this.activeSession == null || this.activeSession.peerId == "system") this.activateSession(id);

    return session;
  }

  ChatSessionManager.prototype.getSession = function(id) {
    return this.sessions[id];
  }

  ChatSessionManager.prototype.allSessions = function() {
    var sessionsList = [];
    
    for(var i in this.sessions) {
      sessionsList.push(this.sessions[i]);
    }

    return sessionsList;
  }

  ChatSessionManager.prototype.activateSession = function(id) {
    if(this.activeSession && this.activeSession.peerId == id) return;

    var self = this, prevSession = this.activeSession;
    this.activeSession = this.addSession(id);

    this.event("activatedSession", { "prevSession":prevSession, "session":this.activeSession });
    if(this.activeSession) this.event("updatedSession", { "session":this.activeSession });
    if(prevSession) this.event("updatedSession", { "session":prevSession });

    this.resendSessionMessages();
  }

  ChatSessionManager.prototype.resendSessionMessages = function() {
    var self = this;
    this.activeSession.messages.forEach(function(message) {
      self.event("activeSessionAddedMessage", { "session":self.activeSession, "message":message })
    });
  }

  ChatSessionManager.prototype.hasUnread = function() {
    if(!this.sessions) return false;

    var self = this, retval = false;

    Object.keys(this.sessions).forEach(function(id) {
      if(self.sessions[id].unread) retval = true;
    });

    return retval;
  }

  ChatSessionManager.prototype.closeSession = function(id) {
    if(!this.sessions[id]) return;

    var session = this.sessions[id];
    delete this.sessions[id];
    this.event("closedSession", { "session":session });

    if(this.activeSession && this.activeSession.peerId == id) {
      this.activateSession("system"); // we could probably do better than this, but not without a lot of work
    }
  }

  ChatSessionManager.prototype.reset = function() {
    var self = this;

    this.allSessions().forEach(function(session) {
      if(session.peerId != "system") self.closeSession(session.peerId)
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

  return ChatSessionManager;
});
