import express = require("express");
import sio = require("socket.io");
import db = require("./db");
import helpers = require("./helpers");

const app: express.Application = express();
app.set("port", process.env.PORT || 3000);

const http = require("http").createServer(app);
const io = sio(http, {origins: '*:*'});

import {RoomUser, User, UserState} from "./struct/users";
import {Message, Room, RoomState} from "./struct/rooms";
import {BlackCard, Card, CardState} from "./struct/cards";
import {con} from "./db";

// A selection of Font Awesome icons suitable for profile pictures
const Icons: Array<string> = [
  "apple-alt",  "candy-cane", "carrot", "cat", "cheese", "cookie", "crow", "dog", "dove", "dragon", "egg", "fish",
  "frog", "hamburger", "hippo", "horse", "hotdog", "ice-cream", "kiwi-bird", "leaf", "lemon", "otter", "paw",
  "pepper-hot", "pizza-slice", "spider", "holly-berry", "bat", "deer", "duck", "elephant", "monkey", "narwhal",
  "pig", "rabbit", "sheep", "squirrel", "turtle", "whale", "salad", "pumpkin", "wheat", "burrito", "cheese-swiss",
  "croissant", "drumstick", "egg-fried", "french-fries", "gingerbread-man", "hat-chef", "meat", "pie", "popcorn",
  "sausage", "steak", "taco", "turkey"
];

// Contains the same packs as the database, but this is quicker to access for validation
const Packs: Array<string> = [ "RED", "BLUE", "GREEN", "ABSURD", "BOX", "PROC", "RETAIL", "FANTASY", "PERIOD", "COLLEGE", "ASS", "2012-HOL", "2013-HOL", "2014-HOL", "90s", "GEEK", "SCIFI", "WWW", "SCIENCE", "FOOD", "WEED", "TRUMP", "DAD", "PRIDE", "THEATRE", "2000s", "HIDDEN", "JEW", "CORONA", "DISNEY" ];

// The number of white cards in a standard CAH hand
const HandSize: number = 7;

// Maps user ID's to socket objects
const sockets: Record<number, sio.Socket> = {};

/*****************
 * Web Endpoints *
 *****************/

app.get("/status", (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.end("OK");
});

/**************************
 * Data Dependent Helpers *
 **************************/

// Returns all the icons which are not already taken
function getAvailableIcons(roomIcons: Array<string>) {
  let availableIcons: Array<string> = [];

  Icons.forEach((icon: string) => {
    // Add all the unused icons to the final list
    if (!roomIcons.includes(icon))  availableIcons.push(icon);
  });

  return availableIcons;
}

function getSocket(userId: number): sio.Socket | undefined {
  if (!sockets.hasOwnProperty(userId)) {
    console.warn("Tried to get socket for unknown user #" + userId + "!");
    return undefined;
  }
  return sockets[userId];
}

// Counts the number of users who are still active in a room and broadcasts a 'user left' message if one is provided
function countActiveUsersOnLeave(userId: number, roomUsers: Record<number, RoomUser>, leaveMessage?: Message): number {
  let activeUsers = 0;

  for (const roomUserId in roomUsers) {
    let roomUser = roomUsers[roomUserId];
    if (roomUser.state === UserState.inactive || roomUser.id === userId) continue;

    let socket = getSocket(roomUser.id);
    if (!socket) continue;

    // Notify active users that the user left
    activeUsers++;
    if (leaveMessage) {
      socket.emit("userLeft", {
        userId: userId,
        message: leaveMessage
      });
    }
  }
  return activeUsers;
}

function broadcastMessage(msg: Message, roomId: number, except?: number) {
  db.getRoomUsers(roomId, (err, roomUsers) => {
    if (err || !roomUsers) return console.warn("Failed to get users for room #" + roomId);

    for (const roomUserId in roomUsers) {
      let roomUser = roomUsers[roomUserId];
      if (roomUser.state === UserState.inactive || roomUser.id === except) continue;

      let socket = getSocket(roomUser.id);
      if (!socket) continue;

      // Send the message to other active users
      socket.emit("chatMessage", {message: msg});
    }
  });
}

function replaceCzar(oldCzar: RoomUser, roomUsers: Record<number, RoomUser>) {
  let newCzarId: number | undefined = undefined;

  for (const roomUserId in roomUsers) {
    let roomUser = roomUsers[roomUserId];

    if (roomUser.id !== oldCzar.id && roomUser.state !== UserState.inactive && roomUser.name && roomUser.icon) {
      newCzarId = roomUser.id;
      break
    }
  }

  if (!newCzarId) console.debug("There are no active players in room #" + oldCzar.roomId + ", but some users might be choosing a name/icon");
  else console.log("Czar left room #" + oldCzar.roomId + ", replacing with user #" + newCzarId);

  nextRound(oldCzar.roomId, newCzarId, roomUsers, (res: any) => {
    if (res.error) return console.warn("Failed to start next round when czar left: ", res.error);
    if (newCzarId) {
      db.createMessage(newCzarId as number,
        "took over from " + oldCzar.name + " as the Card Czar", true,
      (err, msg) => {
        if (err || !msg) return console.warn("Failed to broadcast new czar message:", err);
        broadcastMessage(msg, oldCzar.roomId);
      });
    }
  });
}

/********************
 * Socket Responses *
 ********************/

function finishSetupRoom(userId: number, roomId: number, roomUsers: Record<number, RoomUser>,
                         rotateCzar: boolean, edition: string, packs: Array<string>, fn: (...args: any[]) => void): void {
  db.getBlackCard(roomId, (err, blackCard) => {
    if (err || !blackCard) {
      console.warn("Failed to get starting black card for room #" + roomId + ":", err);
      return fn({error: err})
    }

    console.debug("Setup room #" + roomId + " with edition '" + edition + "'");

    // Get starting white cards
    db.getWhiteCards(roomId, userId, HandSize, (err, hand) => {
      if (err || !hand) {
        console.warn("Failed to get starting hand for room #" + roomId + ":", err);
        return fn({error: err});
      }
      fn({hand: hand, blackCard: blackCard});
    });

    for (const roomUserId in roomUsers) {
      let roomUser = roomUsers[roomUserId];
      if (roomUser.state === UserState.inactive || roomUser.id === userId) continue;

      const socket = getSocket(roomUser.id);
      if (!socket) continue;

      let roomSettings = {
        edition: edition,
        packs: packs,
        rotateCzar: rotateCzar,
        blackCard: blackCard,
        hand: {}
      };

      if (!roomUsers[roomUser.id].name || !roomUsers[roomUser.id].icon) {
        return socket.emit("roomSettings", roomSettings);
      }

      db.getWhiteCards(roomId, roomUser.id, HandSize, (err, hand) => {
        if (err || !hand) {
          console.warn("Failed to get starting hand for user #" + roomUser.id + ":", err);
          hand = {};
        }

        db.setUserState(roomUser.id, UserState.choosing);
        roomSettings.hand = hand;

        socket.emit("roomSettings", roomSettings);
      });
    }
  });
}

function finishEnterRoom(user: RoomUser, room: Room, roomUsers: Record<number, RoomUser>,
                         hand: Record<number, Card>, fn: (...args: any[]) => void): void {
  db.createMessage(user.id, "joined the room", true, (err, message) => {

    let hasCzar = false;

    // We need to loop the users twice in order to properly set the users state
    for (const roomUserId in roomUsers) {
      if (roomUsers[roomUserId].state === UserState.czar) {
        hasCzar = true;
        break;
      }
    }

    let state = UserState.idle;
    if (room.state === RoomState.choosingCards) {
      state = UserState.choosing;
      if (!hasCzar) state = UserState.czar;
    }

    if (state != user.state) {
      db.setUserState(user.id, state);
      user.state = state;
    }

    fn({message: message, hand: hand, state: user.state});

    for (const roomUserId in roomUsers) {
      let roomUser = roomUsers[roomUserId];
      if (roomUser.state === UserState.inactive || roomUser.id === user.id) continue;

      let socket = getSocket(roomUser.id);
      if (!socket) continue;

      // Send the new users info to all other active room users
      socket.emit("userJoined", {
        user: user,
        message: message
      });
    }
  });
}

function finishJoinRoom(user: User, response: { [key: string]: any }, fn: (...args: any[]) => void): void {
  if (response.room.state === RoomState.readingCards) {
    db.con.query(`
      SELECT rwc.card_id AS id, wc.text, rwc.submission_group AS 'group', rwc.submission_num AS num, rwc.state
      FROM room_white_cards rwc
      LEFT JOIN white_cards wc ON rwc.card_id = wc.id
      WHERE (state = ${CardState.selected} OR state = ${CardState.revealed}) AND room_id = ?
      ORDER BY submission_group;
    `, [response.room.id], (err, results) => {
      if (err) console.warn("Failed to fetch revealed cards for newly joined user #" + user.id + " in room #" + response.room.id + ":" , err);
      else {
        response.responseGroups = {};

        results.forEach((result: any) => {
          if (!response.responseGroups.hasOwnProperty(result.group)) response.responseGroups[result.group] = {};
          let responseCard: boolean | Card = false;
          if (result.state === CardState.revealed) responseCard = new Card(result.id, result.text);
          response.responseGroups[result.group][result.num] = responseCard;
        });
      }
      fn(response);
    });
  } else if (response.room.state === RoomState.viewingWinner) {
    db.con.query(`
      SELECT rwc.card_id AS id, wc.text, rwc.submission_num as num
      FROM room_white_cards rwc
      LEFT JOIN white_cards wc ON rwc.card_id = wc.id
      WHERE room_id = ? AND state = ${CardState.winner}
      ORDER BY submission_num;
    `, [response.room.id], (err, results) => {
      if (err) console.warn("Failed to get winning card text for newly joined user #" + user.id + " in room #" + response.room.id + ":", err);
      else if (results.length > 0) {
        response.winningCards = {};
        results.forEach((result: any) => {
          response.winningCards[result.num] = new Card(result.id, result.text);
        });
      }
      fn(response);
    });
  } else fn(response);
}

function continueJoinRoom(user: User, room: Room, promptCard: BlackCard | undefined, fn: (...args: any[]) => void): void {
  // Do this before getting messages since it doubles as a check for room validity
  db.getRoomUsers(room.id, (err, roomUsers) => {
    if (err || !roomUsers) {
      console.warn("Failed to get user ids when joining room #" + room.id);
      return fn({error: err});
    }

    db.getLatestMessages(room.id, 15, (err, messages) => {
      if (err || !messages) {
        console.warn("failed to get latest messages from room #" + room.id + ": " + err);
      }

      // Add the client to the user list
      roomUsers[user.id] = new RoomUser(user.id, user.admin, user.icon, user.name, UserState.idle, room.id, 0);

      // Add the user to the room
      db.addUserToRoom(user.id, room.id, UserState.idle, user.admin);

      // Make aa list of the icons currently in use
      let roomIcons: Array<string> = [];

      for (const roomUserId in roomUsers) {
        let roomUser = roomUsers[roomUserId];

        // If the user is active, add their icon to the list
        if (roomUser.id !== user.id && roomUser.state !== UserState.inactive && roomUser.icon) {
          roomIcons.push(roomUser.icon);
        }
      }

      // Match the structure of the client room object
      let clientRoom = {
        id: room.id,
        state: room.state,
        flaredUser: room.flaredUser,
        edition: room.edition,
        rotateCzar: room.rotateCzar,
        selectedResponse: room.selectedResponse,
        curPrompt: promptCard,
        messages: messages
      };

      let response: { [key: string]: any } = {
        room: clientRoom,
        users: roomUsers,
        iconChoices: getAvailableIcons(roomIcons)
      };

      if (user.admin) {
        db.con.query(`
          SELECT 
            id, name, 
            IF(id IN (
              SELECT pack_id
              FROM room_packs
              WHERE room_id = ?
            ), 1, 0) AS enabled
          FROM packs 
          ORDER BY RAND();
        `, [room.id], (err, results) => {
          if (err) {
            console.warn("Failed to retrieve pack list when creating room:", err);
            return fn({error: "MySQL Error"});
          }

          let packs: Record<string, { id: string, name: string, enabled: boolean }> = {};
          results.forEach((result: any) => packs[result.id] = {
            id: result.id,
            name: result.name,
            enabled: result.enabled == true
          });

          response.packs = packs;
          finishJoinRoom(user, response, fn);
        });
      } else finishJoinRoom(user, response, fn);
    });
  });
}

function nextRound(roomId: number, czarId: number | undefined, roomUsers: Record<number, RoomUser>, fn: (...args: any[]) => void): void {
  // Get a black card for the new round
  db.getBlackCard(roomId, (err, blackCard) => {
    if (err || !blackCard) {
      console.warn("Failed to get starting black card for room #" + roomId + ":", err);
      return fn({error: err})
    }

    db.setRoomState(roomId, RoomState.choosingCards);
    if (czarId) db.setUserState(czarId, UserState.czar);

    db.con.query(`
      UPDATE room_white_cards SET state = ${CardState.played}, submission_group = NULL, submission_num = NULL
      WHERE room_id = ? AND NOT state = ${CardState.hand} AND NOT state = ${CardState.played};
    `, [roomId], (err) => {
      if (err) {
        console.warn("Failed to mark cards as played when starting new round:", err);
        return fn({error: "MySQL Error"});
      }

      // All active users apart from the czar can now pick a card
      db.con.query(`
        UPDATE users SET state = ${UserState.choosing}
        WHERE room_id = ?${czarId ? " AND NOT id = " + czarId : ""} AND NOT state = ${UserState.inactive};
      `, [roomId], (err) => {
        if (err) {
          console.warn("Failed to mark user states as choosingCards for next round:", err);
          return fn({error: "MySQL Error"});
        }

        console.debug("Starting next round in room #" + roomId);
        fn({});

        for (const roomUserId in roomUsers) {
          let roomUser = roomUsers[roomUserId];
          if (roomUser.state === UserState.inactive) continue;

          let socket = getSocket(roomUser.id);
          if (!socket) continue;

          socket.emit("nextRound", {
            card: blackCard,
            czar: czarId
          });
        }
      });
    });
  });
}

function deleteUser(userId: number) {
  if (sockets.hasOwnProperty(userId)) delete sockets[userId];
  db.deleteUser(userId);
}

function deleteRoom(roomId: number, roomUsers: Record<number, RoomUser>) {
  for (const roomUserId in roomUsers) {
    if (sockets.hasOwnProperty(roomUserId)) delete sockets[roomUserId];
  }
  db.deleteRoom(roomId);
}

/*******************
 * Socket Handling *
 *******************/

function initSocket(socket: sio.Socket, userId: number) {

  /*****************
   * Room Handling *
   *****************/

  socket.on("setIcon", (data, fn) => {
    db.getUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      if (!Icons.includes(data.icon)) return fn({error: "Invalid Icon"});

      if (user instanceof RoomUser) {
        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get users for room #" + user.roomId);
            return fn({error: "Room error"});
          }

          for (const roomUserId in roomUsers) {
            let roomUser = roomUsers[roomUserId];

            // Can't share an icon with another active user
            if (roomUser.id !== userId && roomUser.state !== UserState.inactive
                && roomUser.icon && roomUser.icon === data.icon) {
              return fn({error: "Icon in use"});
            }
          }

          db.setUserIcon(userId, data.icon);
          fn({});

          // Notify users who are yet to choose an icon that the chosen icon is now unavailable
          for (const roomUserId in roomUsers) {
            let roomUser = roomUsers[roomUserId];
            if (roomUser.state === UserState.inactive || roomUser.id === userId) continue;

            let socket = getSocket(roomUser.id);
            if (!socket) continue;

            if (!roomUser.icon) socket.emit("iconTaken", {icon: data.icon});
          }
        });
      } else {
        db.setUserIcon(userId, data.icon);
        fn({});
      }
    });
  });

  socket.on("createRoom", (data, fn) => {
    if (!helpers.validateString(data.userName)) return fn({error: "Invalid Username"});

    db.getUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      const token = helpers.makeHash(8);
      const adminToken = helpers.makeHash(8);

      db.con.query(`INSERT INTO rooms (token, admin_token) VALUES (?, ?);`, [token, adminToken], (err, result) => {
        if (err) {
          console.warn("Failed to create room:", err);
          return fn({error: "MySQL Error"});
        }

        let roomId = result.insertId;
        db.addUserToRoom(userId, roomId, UserState.czar, false,(err) => {
          if (err) return fn({error: err});

          // Used to represent the room on the client
          let room = new Room(roomId, token);

          db.setUserName(userId, helpers.stripHTML(data.userName));

          // Get a list of editions to give the client
          db.con.query(`SELECT id, name FROM editions ORDER BY RAND();`, (err, results) => {
            if (err) {
              console.warn("Failed to retrieve edition list when creating room:", err);
              return fn({error: "MySQL Error"});
            }

            let editions: Record<number, string> = {};
            results.forEach((result: any) => editions[result.id] = result.name);

            db.con.query(`SELECT id, name FROM packs ORDER BY RAND();`, (err, results) => {
              if (err) {
                console.warn("Failed to retrieve pack list when creating room:", err);
                return fn({error: "MySQL Error"});
              }

              let packs: Record<number, string> = {};
              results.forEach((result: any) => packs[result.id] = result.name);

              // Wait for the join message to be created before sending a response
              db.createMessage(userId, "created the room", true, (err, msg) => {
                if (err || !msg) console.warn("Failed to create join message:", err);
                else room.messages[msg.id] = msg;

                console.log("Created room #" + roomId + " for user #" + userId);
                fn({
                  room: room,
                  editions: editions,
                  packs: packs
                });
              });
            });
          });
        });
      });
    });
  });

  // Used to add an unnamed user to a room
  socket.on("joinRoom", (data, fn) => {
    db.getUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      db.getRoomWithToken(data.roomId, data.token, (err, room) => {
        if (err || !room) return fn({error: err});

        if (data.adminToken) {
          if (data.adminToken !== room.adminToken) {
            return fn({error: "Invalid Admin Token"});
          } else {
            user.admin = true;
          }
        }

        if (room.curPrompt) {
          db.getBlackCardByID(room.curPrompt, (err, promptCard) => {
            if (err || !promptCard) {
              console.warn("Received invalid prompt card for room #" + data.roomId + ":", err);
              continueJoinRoom(user, room, undefined, fn);
            } else continueJoinRoom(user, room, promptCard, fn);
          });
        } else continueJoinRoom(user, room, undefined, fn);
      });
    });
  });

  // Called when the users presses the "Join Room" button after setting their username
  socket.on("enterRoom", (data, fn) => {
    if (!helpers.validateString(data.userName)) return fn({error: "Invalid Username"});

    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      // We need the room to check if the game has started yet
      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn({error: err});

        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get user list for room #" + user.roomId);
            return fn({error: "Unexpected error"});
          } else if (!(userId in roomUsers)) {
            return fn({error: "Can't enter room that hasn't been joined"});
          }

          // Modify the temporary user object since it gets sent to clients
          user.name = helpers.stripHTML(data.userName);
          db.setUserName(userId, user.name);

          if (room.state !== RoomState.new) {
            db.getWhiteCards(user.roomId, userId, HandSize, (err, cards) => {
              if (err || !cards) {
                console.warn("Failed to get white cards for new user #" + userId + ":", err);
                return fn({error: err});
              }

              finishEnterRoom(user, room, roomUsers, cards, fn);
            });
          } else {
            finishEnterRoom(user, room, roomUsers, {}, fn);
          }
        });
      });
    });
  });

  socket.on("userLeft", () => {
    db.getRoomUser(userId, (err, user) => {
      // Delete the user if they weren't in a room
      if (err || !user) return deleteUser(userId);

      db.setUserState(userId, UserState.inactive);

      db.getRoomUsers(user.roomId, (err, roomUsers) => {
        if (err || !roomUsers) return console.warn("Failed to get user list when leaving room #" + user.roomId);

        // If the user never entered the room, don't inform users of leave
        if (!user.name) {

          if (countActiveUsersOnLeave(userId, roomUsers) === 0) deleteRoom(user.roomId, roomUsers);
          else deleteUser(userId);
          return;
        }

        db.getRoom(user.roomId, (err, room) => {
          if (err || !room) return;

          // Only remove submitted cards if the room is still in the choosing phase
          if (room.state === RoomState.choosingCards) {
            db.con.query(`
              DELETE FROM room_white_cards WHERE user_id = ? AND state = ${CardState.selected}
            `, [userId], (err, results) => {
              if (err) return console.warn("Failed to remove clear cards from user #" + userId + " after they left!");
              else if (results.affectedRows > 0) {
                db.countSubmittedCards(user.roomId, (err, count) => {
                  if (err || count === undefined) return;
                  if (count < 2) {
                    for (const roomUserId in roomUsers) {
                      let roomUser = roomUsers[roomUserId];
                      if (roomUser.state !== UserState.czar) continue;

                      let socket = getSocket(roomUser.id);

                      // There is only one answer left, we can't read them now
                      if (socket) socket.emit("answersNotReady");
                    }
                  }
                });
              }
            });
          }
        });

        db.createMessage(userId, "left the room", true, (err, msg) => {
          if (err || !msg) console.warn("Failed to create leave msg for user #" + user.id + ":", err);
          // Delete the room once all users have left
          if (countActiveUsersOnLeave(userId, roomUsers, msg) === 0) deleteRoom(user.roomId, roomUsers);
          else if (user.state === UserState.czar || user.state === UserState.winnerAndNextCzar || user.state === UserState.nextCzar) {
            // If the czar or winner leaves, we need to start a new round
            replaceCzar(user, roomUsers);
          }
        });
      });
    });
  });

  socket.on("roomSettings", (data, fn) => {
    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      // Validate the edition
      db.con.query(`SELECT name FROM editions WHERE id = ?;`, [
        data.edition
      ], (err, result) => {
        if (err) {
          console.warn("Failed to get edition '" + data.edition + "' from versions table:", err);
          return fn({error: "MySQL Error"});
        } else if (result.length === 0) return fn({error: "Invalid Edition"});

        db.getRoom(user.roomId, (err, room) => {
          if (err || !room) return fn({error: err});
          else if (room.state !== RoomState.new) return fn({error: "Room is already setup!"});

          db.getRoomUsers(user.roomId, (err, roomUsers) => {
            if (err || !roomUsers) {
              console.warn("Failed to get users when configuring room #" + user.roomId);
              return fn({error: err});
            }

            let rotateCzar = data.rotateCzar === true;

            db.con.query(`UPDATE rooms SET edition = ?, rotate_czar = ?, state = ? WHERE id = ?;`, [
              data.edition,
              rotateCzar,
              RoomState.choosingCards,
              user.roomId
            ], (err) => {
              if (err) {
                console.warn("Failed to apply room settings:", err);
                return fn({error: "MySQL Error"});
              }

              let packsSQL: string[] = [];
              let validPacks: string[] = [];

              if (data.packs.length > 0) {
                data.packs.forEach((packId: string) => {
                  if (Packs.includes(packId)) {
                    validPacks.push(packId);
                    packsSQL.push(`(${user.roomId}, '${packId}')`);
                  }
                });

                let sql = `INSERT INTO room_packs (room_id, pack_id) VALUES `;
                db.con.query( sql + packsSQL.join(", ") + ";", (err) => {
                  if (err) console.warn("Failed to add packs to room #" + user.roomId + ":", err);
                  finishSetupRoom(userId, user.roomId, roomUsers, rotateCzar, data.edition, validPacks, fn);
                });
              } else finishSetupRoom(userId, user.roomId, roomUsers, rotateCzar, data.edition, [], fn);
            });
          });
        });
      });
    });
  });

  /******************
   * Admin Controls *
   ******************/

  socket.on("applyFlair", (data, fn) => {
    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      if (!user.admin) return fn({error: "No Permission"});

      db.getRoomUsers(user.roomId, (err, roomUsers) => {
        if (err || !roomUsers) {
          console.warn("Failed to get users when setting flair in room #" + user.roomId);
          return fn({error: "MySQL Error"});
        }

        if (data.userId && !roomUsers.hasOwnProperty(data.userId)) data.userId = undefined;

        db.con.query(`
          UPDATE rooms
          SET flared_user = ?
          WHERE id = ?
        `, [data.userId || null, user.roomId], (err) => {
          if (err) {
            console.warn("Failed to set flared user for room #" + user.roomId + ":", err);
            return fn({error: "MySQL Error"});
          }

          fn({});

          for (const roomUserId in roomUsers) {
            const roomUser = roomUsers[roomUserId];
            if (roomUser.state === UserState.inactive) continue;

            const socket = getSocket(roomUser.id);
            if (!socket) continue;

            socket.emit("applyFlair", {
              userId: data.userId
            });
          }
        });
      });
    });
  });

  /**************
   * Game Logic *
   **************/

  socket.on("submitCards", (data, fn) => {
    let cards = data.cards;

    if (!helpers.validateObject(cards)) return fn({error: "Invalid Card Object"});

    const cardsLen = Object.keys(cards).length;

    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      if (user.state !== UserState.choosing) {
        console.warn("A card was submitted from a user with invalid state '" + user.state + "'");
        return fn({error: "Invalid State"});
      }

      db.con.query(`
        SELECT pick
        FROM black_cards
        WHERE id IN (
          SELECT cur_prompt
          FROM rooms
          WHERE id = ?
        )
      `, [user.roomId], (err, results) => {
        if (err) {
          console.warn("Failed to get pick value for cur prompt in room #" + user.roomId + " when submitting " + cardsLen + " cards:", err);
          return fn({error: "MySQL Error"});
        } else if (results.length === 0) return fn({error: "Invalid Prompt"});
        else if (results[0].pick !== cardsLen) return fn({error: "Incorrect number of cards"});

        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get users when submitting card in room #" + user.roomId);
            return fn({error: "MySQL Error"});
          }

          db.con.query(`
            SELECT card_id AS cardId FROM room_white_cards
            WHERE room_id = ? AND user_id = ? AND state = ${CardState.hand};
          `, [user.roomId, userId], (err, results) => {
            if (err) {
              console.warn("Failed to check hand for user #" + userId + ":", err);
              return fn({error: "MySQL Error"});
            }

            let handIds = results.map((result: any) => result.cardId);

            for (const pos in cards) {
              if (!handIds.includes(cards[pos])) {
                console.warn("User #" + userId + " tried to submit card #" + cards[pos] + " which they didn't own!");
                return fn({error: "Invalid Card"});
              }
            }

            db.submitCards(user, cards, (err) => {
              if (err) return fn({error: err});

              // Try to get a new white card to replace the one which was submitted
              db.getWhiteCards(user.roomId, userId, cardsLen, (err, newCards) => {
                if (err || !newCards) {
                  console.warn("Failed to get new card for user #" + userId + ":", err);
                  fn({});
                } else fn({newCards: newCards});

                db.setUserState(userId, UserState.idle);

                let czarSocket: sio.Socket | undefined = undefined;
                let maxResponses = 0;

                // Check if all users have submitted a card
                for (const roomUserId in roomUsers) {
                  let roomUser = roomUsers[roomUserId];
                  if (roomUser.state === UserState.inactive) continue;

                  let socket = getSocket(roomUser.id);
                  if (!socket) continue;


                  if (roomUser.state === UserState.czar) {
                    if (czarSocket) console.warn("Multiple czars were found in room #" + user.roomId + "!");
                    czarSocket = socket;
                  } else if (roomUser.name && roomUser.icon) {
                    maxResponses++;
                  }

                  if (roomUser.id !== userId) {
                    socket.emit("userState", {userId: userId, state: UserState.idle});
                  }
                }

                db.countSubmittedCards(user.roomId, (err, count) => {
                  if (err || count === undefined) return;

                  if (!czarSocket) {
                    return console.warn(`No czar was found for room #${user.roomId}, but answers are ready`);
                  }

                  czarSocket.emit("answersReady", {
                    count: count,
                    maxResponses: maxResponses
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  socket.on("skipPrompt", (data, fn) => {
    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      if (!user.admin && user.state !== UserState.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to skip the prompts!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn({error: err});
        if (room.state !== RoomState.choosingCards) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get users when skipping prompt in room #" + user.roomId + ":", err);
            return fn({error: err});
          }

          db.countSubmittedCards(user.roomId, (err, count) => {
            if (err) {
              console.warn("Failed to count submitted cards in room#" + user.roomId);
              return fn({error: "MySQL Error"});
            }

            if (count && count > 0) {
              console.warn("User #" + userId + " tried to skip prompt despite already having " + count + " answers submitted");
              return fn({error: "Can't skip prompt once responses are submitted"});
            }

            db.getBlackCard(user.roomId, (err, blackCard) => {
              if (err || !blackCard) {
                console.warn("Failed to get new prompt in room #" + user.roomId + ":", err);
                return fn({error: err});
              }

              db.createMessage(userId, "skipped the prompt", true, (err, message) => {
                if (err || !message) console.warn("Failed to create 'skipped prompt' message in room #" + user.roomId + ":", err);

                for (const roomUserId in roomUsers) {
                  let roomUser = roomUsers[roomUserId];
                  if (roomUser.state === UserState.inactive) continue;

                  let socket = getSocket(roomUser.id);
                  if (!socket) continue;

                  socket.emit("skipPrompt", {
                    newPrompt: blackCard,
                    message: message
                  });
                }
              });
            });
          });
        });
      });
    });
  });

  socket.on("startReadingAnswers", (data, fn) => {
    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      if (!user.admin && user.state !== UserState.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to start reading answers!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn({error: err});
        if (room.state !== RoomState.choosingCards) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get users when switching to reading mode in room #" + user.roomId);
            return fn({error: err});
          }

          db.groupAnswers(user.roomId, (err, groups) => {
            if (err || !groups) return fn({error: err});

            // Mark all users who were still choosing as idle
            db.con.query(`
              UPDATE users 
              SET state = ${UserState.idle}
              WHERE room_id = ? AND state = ${UserState.choosing}
            `, [user.roomId], (err) => {
              if (err) {
                console.warn("Failed to mark users as idle after starting response reading:", err);
                return fn({error: "MySQL Error"});
              }

              fn({});
              db.setRoomState(user.roomId, RoomState.readingCards);

              for (const roomUserId in roomUsers) {
                let roomUser = roomUsers[roomUserId];
                if (roomUser.state === UserState.inactive) continue;

                let socket = getSocket(roomUser.id);
                if (!socket) continue;

                socket.emit("startReadingAnswers", {
                  groups: groups
                });
              }
            });
          });
        });
      });
    });
  });

  socket.on("revealResponse", (data, fn) => {
    if (!helpers.validateUInt(data.group)) return fn({error: "Invalid Card Group"});
    if (!helpers.validateUInt(data.num)) return fn({error: "Invalid Card Number"});

    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      if (!user.admin && user.state !== UserState.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to reveal a response!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn({error: err});
        if (room.state !== RoomState.readingCards) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get users when revealing card in room #" + user.roomId);
            return fn({error: err});
          }

          db.con.query(`
            SELECT id, text
            FROM white_cards
            WHERE id IN (
              SELECT card_id
              FROM room_white_cards
              WHERE room_id = ? AND state = ${CardState.selected} AND submission_group = ? AND submission_num = ?              
            )
          `, [user.roomId, data.group, data.num], (err, results) => {
            if (err) {
              console.warn("Failed to get selected cards for room #" + user.roomId + ":", err);
              return fn({error: "MySQL Error"});
            } else if (results.length === 0) {
              return fn({error: "No cards left!"});
            }

            let card = {
              id: results[0].id,
              text: results[0].text
            };

            db.con.query(`
              UPDATE room_white_cards 
              SET state = ${CardState.revealed}
              WHERE card_id = ? AND room_id = ? AND submission_group = ? AND submission_num = ?;
             `, [card.id, user.roomId, data.group, data.num], (err) => {
              if (err) {
                console.warn("Failed to mark card as read:", err);
                return fn({error: "MySQL Error"});
              }
              fn({});
              for (const roomUserId in roomUsers) {
                let roomUser = roomUsers[roomUserId];
                if (roomUser.state === UserState.inactive) continue;

                let socket = getSocket(roomUser.id);
                if (!socket) continue;

                socket.emit("revealResponse", {
                  group: data.group,
                  num: data.num,
                  card: card
                });
              }
            });
          });
        });
      });
    });
  });

  socket.on("selectResponseGroup", (data, fn) => {
    if (data.group != null && !helpers.validateUInt(data.group)) return fn({error: "Card ID must be an int"});

    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      if (!user.admin && user.state !== UserState.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to select a response!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn(room);
        if (room.state !== RoomState.readingCards) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get users when selecting card in room #" + user.roomId);
            return fn({error: err});
          }

          db.con.query(`UPDATE rooms SET selected_response = ? WHERE id = ?;`, [data.group, user.roomId], (err) => {
            if (err) {
              console.warn("Failed to update selected card for room #" + user.roomId);
              return fn({error: "MySQL Error"});
            }

            for (const roomUserId in roomUsers) {
              let roomUser = roomUsers[roomUserId];
              if (roomUser.state === UserState.inactive) continue;

              let socket = getSocket(roomUser.id);
              if (!socket) continue;

              socket.emit("selectResponseGroup", {group: data.group});
            }
          });
        });
      });
    });
  });

  // TODO: deduplication
  socket.on("selectWinner", (data, fn) => {
    if (!helpers.validateUInt(data.group)) return fn({error: "Invalid Group"});

    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn(user);
      if (!user.admin && user.state !== UserState.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to select a winning response!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn(room);
        if (room.state !== RoomState.readingCards) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get users when selecting winning card in room #" + user.roomId);
            return fn({error: err});
          }

          db.con.query(`
            SELECT rwc.card_id AS id, wc.text, rwc.user_id AS userId, rwc.submission_num as num
            FROM room_white_cards rwc
            LEFT JOIN white_cards wc ON rwc.card_id = wc.id 
            WHERE room_id = ? AND (state = ${CardState.revealed} OR state = ${CardState.selected}) AND submission_group = ?
            ORDER BY submission_num;
          `, [user.roomId, data.group], (err, results) => {
            if (err) {
              console.warn("Failed to check room_white_cards for winning card:", err);
              return fn({error: "MySQL Error"});
            } else if (results.length === 0) {
              return fn({error: "Invalid Room or State"});
            }

            const winnerId = results[0].userId;

            if (roomUsers[winnerId].state === UserState.inactive) {
              // Start a new round with a different czar if the winner is inactive
              fn({});
              return replaceCzar(roomUsers[winnerId], roomUsers);
            }

            let winningCards: Record<number, Card> = {};
            results.forEach((result: any) => {
              winningCards[result.num] = new Card(result.id, result.text);
            });

            // Mark all revealed cards that didn't win as played
            db.con.query(`
              UPDATE room_white_cards 
              SET state = ${CardState.played}, submission_group = NULL, submission_num = NULL
              WHERE room_id = ? AND (state = ${CardState.revealed} OR state = ${CardState.selected}) AND NOT submission_group = ?;
            `, [user.roomId, data.group], (err) => {
              if (err) {
                console.warn("Failed to mark cards as played:", err);
                return fn({error: "MySQL Error"});
              }

              db.con.query(`
                UPDATE room_white_cards 
                SET state = ${CardState.winner}
                WHERE room_id = ? AND (state = ${CardState.revealed} OR state = ${CardState.selected}) AND submission_group = ?;
              `, [user.roomId, data.group], (err) => {
                if (err) console.warn("Failed to mark winning cards in room #" + user.roomId + ":", err);
              });

              let nextCzarId = winnerId;

              // TODO: This is not exactly an efficient way to find the next czar
              if (room.rotateCzar) {
                let foundNextCzar = false;
                let passedCzar = false;

                // Find the next active user after the czar
                for (const roomUserId in roomUsers) {
                  let roomUser = roomUsers[roomUserId];
                  if (roomUser.state === UserState.czar) passedCzar = true;
                  else if (passedCzar && roomUser.state !== UserState.inactive) {
                    foundNextCzar = true;
                    nextCzarId = roomUser.id;
                    break;
                  }
                }

                // If the czar is near/at the end of the user array, start again at the start
                if (!foundNextCzar) {
                  for (const roomUserId in roomUsers) {
                    let roomUser = roomUsers[roomUserId];
                    if (roomUser.state !== UserState.inactive && roomUser.state !== UserState.czar) {
                      nextCzarId = roomUser.id;
                      foundNextCzar = true;
                      break;
                    }
                  }
                }

                if (!foundNextCzar) {
                  console.warn("Failed to find a new czar for room with rotate option enabled, defaulting to winner");
                }
              }

              // Mark all active users except the winner as idle
              db.con.query(`
                UPDATE users 
                SET state = ${UserState.idle}
                WHERE room_id = ? AND NOT id = ? AND NOT id = ? AND NOT state = ${UserState.inactive};
              `, [user.roomId, winnerId, nextCzarId], (err) => {
                if (err) {
                  console.warn("Failed to mark all users in room #" + user.roomId+ " as idle:", err);
                  return fn({error: "MySQL Error"});
                }

                let winnerIsNextCzar = nextCzarId === winnerId;

                // Only use the nextCzar state if the winner and next czar are different
                if (!winnerIsNextCzar) db.setUserState(nextCzarId as number, UserState.nextCzar);

                db.setWinner(winnerId as number, roomUsers[winnerId as number].score + 1, winnerIsNextCzar);
                db.setRoomState(user.roomId, RoomState.viewingWinner);

                fn({});

                for (const roomUserId in roomUsers) {
                  let roomUser = roomUsers[roomUserId];
                  if (roomUser.state === UserState.inactive) continue;

                  let socket = getSocket(roomUser.id);
                  if (!socket) continue;

                  socket.emit("selectWinner", {
                    winningCards: winningCards,
                    winnerId: winnerId,
                    nextCzarId: nextCzarId
                  });
                }
              });
            });
          })
        });
      });
    });
  });

  socket.on("nextRound", (data, fn) => {
    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      if (user.state !== UserState.nextCzar && user.state != UserState.winnerAndNextCzar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to start next round!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn({error: err});
        if (room.state !== RoomState.viewingWinner) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get users when starting next round in room #" + user.roomId);
            return fn({error: err});
          }

          nextRound(user.roomId, userId, roomUsers, fn);
        });
      });
    });
  });

  socket.on("recycleHand", (fn) => {
    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});
      if (!user.name || !user.icon) return fn({error: "Can't recycle hand before entering room!"});

      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn({error: err});
        if (room.state === RoomState.new) return fn({error: "Invalid Room State"});

        db.con.query(`
          DELETE FROM room_white_cards
          WHERE user_id = ? AND state = ${CardState.hand};
        `, [userId], (err) => {
          if (err) {
            console.warn("Failed to delete old cards for recycle:", err);
            return fn({error: "MySQL Error"});
          }

          db.getWhiteCards(user.roomId, userId, HandSize, (err, cards) => {
            if (err || !cards) return fn({error: err});

            db.createMessage(userId, "recycled their cards", true, (err, message) => {
              if (err || !message) return fn({error: err});

              fn({cards: cards, message: message});
              broadcastMessage(message, user.roomId, userId);
            })
          });
        });
      });
    });
  });

  /***************
   * Chat System *
   ***************/

  socket.on("chatMessage", (data, fn) => {
    if (!helpers.validateString(data.content)) return fn({error: "Invalid Message"});

    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn(err);

      db.createMessage(userId, data.content, false, (err, msg) => {
        if (err || !msg) return fn({error: err});
        fn({message: msg});

        broadcastMessage(msg, user.roomId, userId);
      });
    });
  });

  socket.on("likeMessage", (data, fn) => {
    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      // We need to check that the user is actually in the room where the message was sent
      // and that the message isn't a system message
      db.con.query(`
        SELECT system_msg AS isSystemMsg
        FROM messages 
        WHERE id = ? AND room_id = ?;
      `, [data.msgId, user.roomId],(err, msgInfo) => {
        if (err) {
          console.warn("Failed to get msg #" + data.msgId + ":", err);
          return fn({error: "MySQL Error"});
        } else if (msgInfo.length === 0) {
          return fn({error: "Invalid Message ID"});
        } else if (msgInfo[0].isSystemMsg) {
          return fn({error: "Can't like a system message"});
        }

        // Now we can actually add the like
        db.con.query(`INSERT INTO message_likes (message_id, user_id) VALUES (?, ?);`, [
          data.msgId,
          userId
        ], (err) => {
          if (err) {
            console.warn("Failed to add like:", err);
            return fn({error: "MySQL Error"});
          }
          fn({});

          db.getRoomUsers(user.roomId, (err, roomUsers) => {
            if (err || !roomUsers) return console.warn("Failed to get user ids for room #" + user.roomId);

            for (const roomUserId in roomUsers) {
              let roomUser = roomUsers[roomUserId];
              if (roomUser.state === UserState.inactive || roomUser.id === userId) continue;

              let socket = getSocket(roomUser.id);
              if (!socket) continue;

              // Send the like information to other active users
              socket.emit("likeMessage", {msgId: data.msgId, userId: userId});
            }
          });
        });
      });
    });
  });

  socket.on("unlikeMessage", (data, fn) => {
    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      db.con.query(`DELETE FROM message_likes WHERE message_id = ? AND user_id = ?;`, [
        data.msgId,
        userId
      ], (err, result) => {
        if (err) {
          console.warn("Failed to remove like:", err);
          return fn({error: "MySQL Error"});
        } else if (result.affectedRows === 0) {
          return fn({error: "Can't unlike a message that hasn't been liked!"})
        }

        fn({});

        // Inform other active users that the like was removed
        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) return console.warn("Failed to get users for room #" + user.roomId);
          for (const roomUserId in roomUsers) {
            let roomUser = roomUsers[roomUserId];
            if (roomUser.state === UserState.inactive || roomUser.id === userId) continue;

            let socket = getSocket(roomUser.id);
            if (!socket) continue;

            socket.emit("unlikeMessage", {msgId: data.msgId, userId: userId});
          }
        });
      });
    });
  });
}

io.on("connection", (socket) => {
  let socketUserId = parseInt(socket.handshake.query.userId);
  let socketUserToken = socket.handshake.query.userToken;

  // Try to reconnect old session
  if (helpers.validateUInt(socketUserId) && helpers.validateHash(socketUserToken, 8)) {
    db.con.query(
      `SELECT * from users WHERE id = ? AND token = ?;`,
    [socketUserId, socketUserToken], (err, results) => {
      if (err) return console.warn("Failed to lookup reconnecting user #" + socketUserId);
      else if (results.length == 0) {
        console.warn("User #" + socketUserId + " tried to reconnect with an invalid token");
        // TODO: reset client
        return setupNewUser(socket);
      } else {
        console.debug("Reconnected user #" + socketUserId);
        sockets[socketUserId] = socket;
        initSocket(socket, socketUserId);
      }
    });
  } else setupNewUser(socket);
});

function setupNewUser(socket: sio.Socket) {
  let userToken = helpers.makeHash(8);

  // Add user to the database
  db.con.query(`INSERT INTO users (token) VALUES ('${userToken}');`, (err, result) => {
    if (err) {
      console.warn("Failed to create user:", err);
      return;
    }

    let userId = result.insertId;

    // Cache the socket object
    sockets[userId] = socket;

    // Send the generated userId
    socket.emit("init", {
      userId: userId,
      userToken: userToken,
      icons: Icons
    });

    // Only register socket callbacks now that we have a userId
    initSocket(socket, userId);
  });
}

/**************
 * Web Server *
 **************/

const server = http.listen(process.env.PORT || 3000, () => {
  console.log("Listening on port %d.", server.address().port);
});
