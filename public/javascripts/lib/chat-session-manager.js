define(["lib/frontend", "lib/chat-session"], function(Frontend, ChatSession) {
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
          url = Frontend.urlPrefix() + "/talk/" + event.data.id;

      self.addSystemMessage("You are anonymous user " + event.data.id + ".");
      self.addSystemMessage("Give this URL to people you want to chat securely with:");
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
      self.addBroadcastMessage("system", "Disconnected.", {"notify":false} );
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
      self.event("updatedSession", self.sessions[id]);

      if(event.name == "addMessage") {
        var eventName = (self.sessions[id] == self.activeSession) ? "activeSessionAddedMessage" : "inactiveSessionAddedMessage";
        self.event(eventName, { "session":self.sessions[id], "message":event.message });
        self.event("message", { "session":self.sessions[id], "message":event.message });
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

  ChatSessionManager.prototype.hasUnread = function() {
    if(!this.sessions) return false;

    var self = this, retval = false;

    Object.keys(this.sessions).forEach(function(id) {
      if(self.sessions[id].unread) retval = true;
    });

    return retval;
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
