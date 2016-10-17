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

define(["lib/frontend", "lib/freespeak-client", "lib/chat-session-manager", "lib/shared", "lib/console", "lib/userdata", "lib/decoy-traffic-generator"],
  function(Frontend, FreespeakClient, ChatSessionManager, Shared, Console, UserData, DecoyTrafficGenerator)
{
  Shared.userData = new UserData();
  Shared.client = new FreespeakClient();
  Shared.sessionManager = new ChatSessionManager(Shared.client);
  Shared.showNotifications = false;
  Shared.autoreconnect = true;
  Shared.notificationList = {};
  Shared.console = Console;
  Shared.decoyTrafficGenerator = new DecoyTrafficGenerator(Shared.client);

  function runFreespeak() {
    Frontend.fixElementSizes();
    Frontend.setupNotifications();
    Frontend.setupEventListeners();

    Shared.sessionManager.on("addedSession", function(event) {
      Frontend.addSessionTab(event.data.session);
    });

    Shared.sessionManager.on("message", function(event) {
      if(Shared.showNotifications && document.hidden && !Shared.notificationList[event.data.session.peerId]) {
        Shared.notificationList[event.data.session.peerId] = true;
        var not = new Notification(Shared.client.id, { "body":"<"+event.data.message.sender+"> " + event.data.message.text });
        setTimeout(not.close.bind(not), 5000);
      }
    });

    Shared.sessionManager.on("activeSessionAddedMessage", function(event) {
      var senderName;

      if(event.data.message.sender == event.data.session.peerId) {
        senderName = event.data.session.displayName;
      } else {
        senderName = event.data.message.sender;
      }
      
      Frontend.printMessage(senderName, event.data.message.text, event.data.message.timestamp);
      if(!Frontend.terminalAtBottom() || document.hidden) {
        event.data.session.setUnread(true);
      }

      Frontend.setTitle();
    });

    Shared.sessionManager.on("inactiveSessionAddedMessage", function(event) {
      event.data.session.setUnread(true);
      Frontend.setTitle();
    });

    Shared.sessionManager.on("activatedSession", function(event) {
      Frontend.clearMessages();
      Frontend.snapTerminalToBottom();
    });

    Shared.sessionManager.on("updatedSession", function(event) {
      Frontend.syncSessionTab(event.data.session);
    });

    Shared.sessionManager.on("clearedSession", function(event) {
      if(Shared.sessionManager.activeSession && event.data.session.peerId == Shared.sessionManager.activeSession.peerId) {
        Frontend.clearMessages();
      }
    });

    Shared.sessionManager.on("closedSession", function(event) {
      Frontend.removeSessionTab(event.data.session);
    });

    Shared.sessionManager.on("setSessionDisplayName", function(event) {
      if(event.data.session == Shared.sessionManager.activeSession) {
        Frontend.clearMessages();
        Shared.sessionManager.resendSessionMessages();
      }
    });
    
    Shared.client.on("getkey", function(event) {
      Shared.client.sendOffer(event.data.id, event.data.pubkey, event.data.nonce);
    });

    Shared.client.on("connect", function(event) {
      var peerId = Frontend.requestedPeer();
      if(peerId) {
        Shared.client.sendGetKey(peerId);
        Shared.sessionManager.addSession(peerId).addMessage("system", "Requesting public key for " + peerId + "...");
      } else {
        Shared.sessionManager.addSystemMessage("Waiting for peer...");
      }
    });

    Shared.client.on("offer", function(event) {
      Shared.client.sendAccept(event.data);
    });

    Shared.client.on("close", function(event) {
      if(Shared.autoreconnect) {
        var delay = 5000;
        Shared.sessionManager.addSystemMessage("Reconnecting in " + (delay/1000) + " seconds...", {"notify":false});
        setTimeout(function() {
          Shared.sessionManager.addSystemMessage("Reconnecting...", {"notify":false});
          Shared.client.connect(Frontend.webSocketUrl());
        }, delay);
      }
    });

    Shared.client.connect(Frontend.webSocketUrl());
  }

  runFreespeak();
});
