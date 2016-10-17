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

define(["lib/shared", "lib/frontend"], function(Shared, Frontend) {
  function Console() {
  }

  Console.commands = {};

  Console.addCommand = function(command, description, help, handler) {
    if(handler == null) {
      handler = help;
      help = null;
    }

    Console.commands[command] = { "command":command, "description":description, "help":help, "handler":handler };
  }

  Console.out = function(message) {
    var active = Shared.sessionManager.activeSession;
    if(active) active.addMessage("system", message, {"notify":false});
  }

  Console.processLine = function(line) {
    if(line.substring(0, 1) == "/") {
      Console.processSlashCommand(line);
      return;
    }

    Console.processMessage(line);
  }

  Console.processMessage = function(msg) {
    if(Shared.sessionManager.activeSession.peerId == "system") {
      Shared.sessionManager.activeSession.addMessage("system", "You cannot talk in this window.");
      return;
    }

    Shared.client.sendMsgText(Shared.sessionManager.activeSession.peerId, msg);
  }

  Console.processSlashCommand = function(line) {
    var args = line.split(/\s+/),
        command = Console.commands[args[0]];

    if(!command) {
      Console.out("Unrecognized command: " + args[0]);
      return;
    }

    return command.handler(line, args);
  }

    // * /open <peerid> -- open a window with a peer
    // * /connect -- reconnect with the server
    // * /disconnect -- disconnect form the server
    // * /alias <name> -- set peer alias

  Console.addCommand("/alias", "Set display name for current window", "Assigns a display name to the user in the current window. This name is not sent over the network, and is visible only to you.", function(line, args) {
    if(args.length != 2) {
      Console.out("Usage: /alias display_name");
      return;
    }

    if(args[1] == "system") {
      Console.out("That name is reserved.");
      return;
    }

    var active = Shared.sessionManager.activeSession;
    if(!active) return;

    if(active.peerId == "system") {
      Console.out("You may not rename the system window.");
      return;
    }

    active.setDisplayName(args[1]);
    Shared.userData.setAlias(active.peerId, args[1]);
  });

  Console.addCommand("/clear", "Clear message history from current chat window", function(line, args) {
    var active = Shared.sessionManager.activeSession;
    if(!active) return;
    active.clear();
  });

  Console.addCommand("/clearall", "Clear message history from all chat windows", function(line, args) {
    Shared.sessionManager.allSessions().forEach(function(session) {
      session.clear();
    });
  });

  Console.addCommand("/close", "Close current chat window", function(line, args) {
    var active = Shared.sessionManager.activeSession;
    if(!active) return;

    if(active.peerId == "system") {
      Console.out("You cannot close this window.");
      return;
    }

    Shared.sessionManager.closeSession(active.peerId);
  });

  Console.addCommand("/connect", "Re-open connection with server", "Opens a new connection with the server. No effect if you already have a connection.", function(line, args) {
    if(Shared.client.state == "connecting" || Shared.client.state == "connected") {
      Console.out("Already " + Shared.client.state + " to server.");
      return;
    }

    Shared.autoreconnect = true;
    Console.out("Connecting to " + Frontend.webSocketUrl());
    Shared.client.connect(Frontend.webSocketUrl());
  });

  Console.addCommand("/disconnect", "Close connection with server", function(line, args) {
    if(Shared.client.state == "disconnected") {
      Console.out("Already disconnected.");
      return;
    }

    Shared.autoreconnect = false;
    Shared.client.disconnect();
  });

  Console.addCommand("/export", "Export user identity for use in a later session", function(line, args) {
    Console.out("Copy the following text into a safe place. It contains your private key and other session data. You may copy-paste it back into Freespeak in a later session to resume using this key.");
    Console.out("/import " + Shared.userData.export("testing"));
  });

  Console.addCommand("/help", "Get info about commands", "/help will show you a list of all commands. /home <command> will give you help on a specific command, e.g. /help /say", function(line, args) {
    if(args.length == 1) {
      for(var name in Console.commands) {
        Console.out(name + ": " + Console.commands[name].description);
      }

      return;
    }

    var command = Console.commands[args[1]];
    if(!command) {
      Console.out("/help: No such command '" + args[1] + "'");
      if(args[1].substring(0, 1) != "/") Console.out("(make sure to put a / before the name of the command)");
      return;
    }

    Console.out(command.command + ": " + command.description);
    if(command.help) Console.out(command.help);
  });

  Console.addCommand("/import", "Import user identity for use in current session", function(line, args) {
    Shared.userData.import("testing", args[1]);
  });

  Console.addCommand("/open", "Open a secure connection to a peer", "/open will open a new secure chat window with a specific peer, e.g. /option 1234abcd to open a window to user 1234abcd.", function(line, args) {
    if(args.length < 2) {
      Console.out("/open: usage: /open peerId");
      return;
    }

    if(Shared.sessionManager.sessions[args[1]]) {
      Shared.sessionManager.activateSession(args[1]);
      return;
    }

    Shared.client.sendGetKey(args[1]);
  });

  Console.addCommand("/say", "Say a message in the current window", "Says the literal value of a message in the current window. For instance, `/say /clear` will cause you to say `/clear` instead of clearing your current window.", function(line, args) {
    Console.processMessage(line.substring(args[0].length+1));
  });

  return Console;
});
