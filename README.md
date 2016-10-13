# Freespeak

## Overview

### What is this?

Freespeak is an anonymous, zero-knowledge, end-to-end encrypted chat service. What do these terms mean?

* Anonymous. Freespeak does not include the concept of user accounts. It is not necessary to provide any information whatsoever to begin a chat session on Freespeak.
* Zero-knowledge, end-to-end encryption. All chat on Freespeak is encrypted all the way from the sender to the recipient, and only the participants in the chat possess the necessary encryption keys to decrypt messages. Even if an adversary had total control of a Freespeak server, they would be unable to decipher any messages.
* Chat service. Freespeak is, above all, a way to talk to someone.

### How do I use this?

See our [example server] (https://example.com) (placeholder). When you connect, you'll be given a chat link to give to someone else. When they click that link, they will immediately begin an anonymous, secure chat session with you.

### Why do I want to chat with anonymous people?

Just because someone is anonymous to the server, does not mean they are anonymous to you! You are in control of who you give your chat links to. So while YOU may know exactly who you are talking to, the server has no idea, and your conversation is made that much more private.

## Technical Details

### Logging

Very little.

### Encryption

Clients generate ephemeral 256-bit elliptic curve keys for use in Elliptic Curve Diffie-Hellman key exchange. From this, the two clients agree on a randomly generated 256-bit AES session key, seeded with a minimum of 256 bits of entropy from each client. Individual messages are then encrypted with this session key in AES-CBC mode, with randomized initialization vectors, and 256-512 bits of random padding added to the start and end of each message.

### Platform

Node.js.

### License

Freespeak is distributed under the [GNU Affero General Public License, Verison 3] (https://www.gnu.org/licenses/agpl-3.0.en.html) ("GNU AGPLv3"). You can find details on this license on the GNU website, or in the LICENSE file of this project. Broadly, this license permits you to use and redistribute this software free of charge, and make modifications to the source code. If you run this project on your own server, you must allow users to download the version source code you are running, including any modifications that you have made, under the terms of the GNU AGPLv3.

To make this mandatory source redistribution easier, Freespeak automatically offers its source in the footer of its chat pages.