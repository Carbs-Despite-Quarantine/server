import express = require("express");
import path = require("path");
import sio = require("socket.io");

const app: express.Application = express();

const http = require("http").createServer(app);
const io = sio(http);

import vars = require("./vars");
import db = require("./db");
import helpers = require("./helpers");

// Maps user ID's to socket objects
const sockets: Record<number, sio.Socket> = {};

/*****************
 * Web Endpoints *
 *****************/

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.get("/inc/*", function(req, res) {
  res.sendFile(path.join(__dirname, "../public/", req.path));
});

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

  vars.Icons.forEach((icon: string) => {
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
function countActiveUsersOnLeave(userId: number, roomUsers: Record<number, vars.RoomUser>, leaveMessage?: vars.Message): number {
  let activeUsers = 0;

  for (const roomUserId in roomUsers) {
    let roomUser = roomUsers[roomUserId];

    let socket = getSocket(roomUser.id);
    if (!socket) continue;

    // Notify active users that the user left
    if (roomUser.id !== userId && roomUser.state !== vars.UserState.inactive) {
      activeUsers++;
      if (leaveMessage) {
        socket.emit("userLeft", {
          userId: userId,
          message: leaveMessage
        });
      }
    }
  }

  return activeUsers;
}

/********************
 * Socket Responses *
 ********************/

function finishSetupRoom(userId: number, roomId: number, roomUsers: Record<number, vars.RoomUser>,
                         rotateCzar: boolean, edition: string, packs: Array<string>, fn: (...args: any[]) => void): void {
  db.getBlackCard(roomId, (err, blackCard) => {
    if (err || !blackCard) {
      console.warn("Failed to get starting black card for room #" + roomId + ":", err);
      return fn({error: err})
    }

    console.debug("Setup room #" + roomId + " with edition '" + edition + "'");

    // Get starting white cards
    db.getWhiteCards(roomId, userId, vars.HandSize, (err, hand) => {
      if (err || !hand) {
        console.warn("Failed to get starting hand for room #" + roomId + ":", err);
        return fn({error: err});
      }
      fn({hand: hand, blackCard: blackCard});
    });

    for (const roomUserId in roomUsers) {
      let roomUser = roomUsers[roomUserId];

      const socket = getSocket(roomUser.id);
      if (roomUser.id === userId || !socket) return;

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

      db.getWhiteCards(roomId, roomUser.id, vars.HandSize, (err, hand) => {
        if (err || !hand) {
          console.warn("Failed to get starting hand for user #" + roomUser.id + ":", err);
          hand = {};
        }

        db.setUserState(roomUser.id, vars.UserState.choosing);
        roomSettings.hand = hand;

        socket.emit("roomSettings", roomSettings);
      });
    }
  });
}

function finishEnterRoom(user: vars.RoomUser, room: vars.Room, roomUsers: Record<number, vars.RoomUser>,
                         hand: Record<number, vars.Card>, fn: (...args: any[]) => void): void {
  db.createMessage(user.id, "joined the room", true, (err, message) => {
    fn({message: message, hand: hand});

    let state = vars.UserState.idle;

    if (room.state === vars.RoomState.choosingCards) {
      db.setUserState(user.id, vars.UserState.choosing);
      state = vars.UserState.choosing;
    }

    for (const roomUserId in roomUsers) {
      let roomUser = roomUsers[roomUserId];

      if (roomUser.state === vars.UserState.inactive) return;

      let socket = getSocket(roomUser.id);
      if (!socket || roomUser.id === user.id) return;

      // Send the new users info to all other active room users
      socket.emit("userJoined", {
        user: user,
        message: message
      });
    }
  });
}

function finishJoinRoom(user: vars.User, room: vars.Room, promptCard: vars.BlackCard | undefined, fn: (...args: any[]) => void): void {
  // Do this before getting messages since it doubles as a check for room validity
  db.getRoomUsers(room.id, (err, roomUsers) => {
    if (err || !roomUsers) {
      console.warn("Failed to get user ids when joining room #" + room.id);
      return fn({error: err});
    }

    db.getLatestMessages(room.id, 15, (err, messages) => {
      if (err || !messages) {
        console.warn("failed to get latest messages from room #" + room.id + ": " + err);
      } else room.messages = messages;

      // Add the client to the user list
      roomUsers[user.id] = new vars.RoomUser(user.id, user.icon, user.name, vars.UserState.idle, room.id, 0);

      // Add the user to the room
      db.addUserToRoom(user.id, room.id, vars.UserState.idle);

      // Make aa list of the icons currently in use
      let roomIcons: Array<string> = [];

      for (const roomUserId in roomUsers) {
        let roomUser = roomUsers[roomUserId];

        // If the user is active, add their icon to the list
        if (roomUser.id !== user.id && roomUser.state !== vars.UserState.inactive && roomUser.icon) {
          roomIcons.push(roomUser.icon);
        }
      }

      // TODO: removed user id list from room, need to update client to support change

      fn({
        room: room,
        users: roomUsers,
        iconChoices: getAvailableIcons(roomIcons)
      });
    });
  });
}

function finishSelectResponse(user: vars.RoomUser, roomUsers: Record<number, vars.RoomUser>, cardId: number | undefined, fn: (...args: any[]) => void): void {
  db.con.query(`UPDATE rooms SET selected_response = ? WHERE id = ?;`, [cardId, user.roomId], (err) => {
    if (err) {
      console.warn("Failed to update selected card for room #" + user.roomId);
      return fn({error: "MySQL Error"});
    }

    for (const roomUserId in roomUsers) {
      let roomUser = roomUsers[roomUserId];

      let socket = getSocket(roomUser.id);
      if (!socket || roomUser.id === user.id) return;

      socket.emit("selectResponse", {cardId: cardId});
    }
  });
}

function nextRound(roomId: number, czarId: number, roomUsers: Record<number, vars.RoomUser>, fn: (...args: any[]) => void): void {
  // Get a black card for the new round
  db.getBlackCard(roomId, (err, blackCard) => {
    if (err || !blackCard) {
      console.warn("Failed to get starting black card for room #" + roomId + ":", err);
      return fn({error: err})
    }

    db.setRoomState(roomId, vars.RoomState.choosingCards);
    db.setUserState(czarId, vars.UserState.czar);

    db.con.query(`
      UPDATE room_white_cards SET state = ${vars.CardState.played}
      WHERE room_id = ? AND (state = ${vars.CardState.selected} OR state = ${vars.CardState.revealed});
    `, [roomId], (err) => {
      if (err) {
        console.warn("Failed to maek cards as played when starting new round:", err);
        return fn({error: "MySQL Error"});
      }

      // All active users apart from the czar can now pick a card
      db.con.query(`
        UPDATE users SET state = ${vars.UserState.choosing}
        WHERE room_id = ? AND NOT id = ? AND NOT state = ${vars.UserState.inactive};
      `, [roomId, czarId], (err) => {
        if (err) {
          console.warn("Failed to mark user states as choosingCards for next round:", err);
          return fn({error: "MySQL Error"});
        }

        console.debug("Starting next round in room #" + roomId);
        fn({});

        for (const roomUserId in roomUsers) {
          // TODO: consistency - use parseInt or fetch user and check id ?
          let socket = getSocket(parseInt(roomUserId));
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

      if (!vars.Icons.includes(data.icon)) return fn({error: "Invalid Icon"});

      if (user instanceof vars.RoomUser) {
        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get users for room #" + user.roomId);
            return fn({error: "Room error"});
          }

          for (const roomUserId in roomUsers) {
            let roomUser = roomUsers[roomUserId];

            // Can't share an icon with another active user
            if (roomUser.id !== userId && roomUser.state !== vars.UserState.inactive
                && roomUser.icon && roomUser.icon === data.icon) {
              return fn({error: "Icon in use"});
            }
          }

          db.setUserIcon(userId, data.icon);
          fn({});

          // Notify users who are yet to choose an icon that the chosen icon is now unavailable
          for (const roomUserId in roomUsers) {
            let roomUser = roomUsers[roomUserId];

            let socket = getSocket(roomUser.id);
            if (!socket || roomUser.id !== userId) return;

            if (roomUser.state !== vars.UserState.inactive && !roomUser.icon) {
              socket.emit("iconTaken", {icon: data.icon});
            }
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

      let token = helpers.makeHash(8);

      db.con.query(`INSERT INTO rooms (token) VALUES (?);`, [token], (err, result) => {
        if (err) {
          console.warn("Failed to create room:", err);
          return fn({error: "MySQL Error"});
        }

        let roomId = result.insertId;
        db.addUserToRoom(userId, roomId, vars.UserState.czar, (err) => {
          if (err) return fn({error: err});

          // TODO: removed userId array, need to update client
          // Used to represent the room on the client
          let room = new vars.Room(roomId, token);

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

        if (room.curPrompt) {
          db.getBlackCardByID(room.curPrompt, (err, promptCard) => {
            if (err || !promptCard) {
              console.warn("Received invalid prompt card for room #" + data.roomId + ":", err);
              finishJoinRoom(user, room, undefined, fn);
            } else finishJoinRoom(user, room, promptCard, fn);
          });
        } else finishJoinRoom(user, room, undefined, fn);
      });
    });
  });

  // Called when the users presses the "Join Room" button after setting their username
  socket.on("enterRoom", (data, fn) => {
    if (!helpers.validateString(data.userName)) return fn({error: "Invalid Username"});

    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      // We need the room to check if the game has started yet
      db.getRoom(data.roomId, (err, room) => {
        if (err || !room) return fn({error: err});

        db.getRoomUsers(data.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get user list for room #" + data.roomId);
            return fn({error: "Unexpected error"});
          } else if (!(userId in roomUsers)) {
            return fn({error: "Can't enter room that hasn't been joined"});
          }

          // Modify the temporary user object since it gets sent to clients
          user.name = helpers.stripHTML(data.userName);
          db.setUserName(userId, user.name);

          if (room.state !== vars.RoomState.new) {
            db.getWhiteCards(data.roomId, userId, vars.HandSize, (err, cards) => {
              if (err || !cards) {
                console.log("Room ID: " + data.roomId + " valid? ", helpers.validateUInt(data.roomId));
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
      if (err || !user) return db.deleteUser(userId);

      db.setUserState(userId, vars.UserState.inactive);

      db.getRoomUsers(user.roomId, (err, roomUsers) => {
        if (err || !roomUsers) return console.warn("Failed to get user list when leaving room #" + user.roomId);

        // If the user never entered the room, don't inform users of leave
        if (!user.name) {

          if (countActiveUsersOnLeave(userId, roomUsers) === 0) db.deleteRoom(user.roomId);
          else db.deleteUser(userId);
          return;
        }

        // TODO: cancel round if not enough cards left ? Inform czar of leave?
        db.con.query(`
          DELETE FROM room_white_cards WHERE user_id = ? AND state = ${vars.CardState.selected}
         `, [userId], (err) => {
          if (err) console.warn("Failed to remove clear cards from user #" + userId + " after they left!");
        });

        db.createMessage(userId, "left the room", true, (err, msg) => {
          if (err || !msg) console.warn("Failed to create leave msg for user #" + user.id + ":", err);
          // Delete the room once all users have left
          if (countActiveUsersOnLeave(userId, roomUsers, msg) === 0) db.deleteRoom(user.roomId);
          else if (user.state === vars.UserState.czar || user.state === vars.UserState.winner) {
            // If the czar or winner leaves, we need to start a new round
            let newCzarId: number | undefined = undefined;

            for (const roomUserId in roomUsers) {
              let roomUser = roomUsers[roomUserId];

              if (roomUser.id !== userId && roomUser.state !== vars.UserState.inactive && roomUser.name && roomUser.icon) {
                newCzarId = roomUser.id;
                break;
              }
            }

            if (!newCzarId) {
              console.warn("Failed to find a new czar for room #" + user.roomId);
            } else {
              console.log("Czar left room #" + user.roomId + ", replacing with user #" + newCzarId);
              nextRound(user.roomId, newCzarId, roomUsers, res => {
                if (res.error) console.warn("Failed to start next round when czar left: ", res.error);
              });
            }
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
          else if (room.state !== vars.RoomState.new) return fn({error: "Room is already setup!"});

          db.getRoomUsers(user.roomId, (err, roomUsers) => {
            if (err || !roomUsers) {
              console.warn("Failed to get users when configuring room #" + user.roomId);
              return fn({error: err});
            }

            let rotateCzar = data.rotateCzar === true;

            db.con.query(`UPDATE rooms SET edition = ?, rotate_czar = ?, state = ? WHERE id = ?;`, [
              data.edition,
              rotateCzar,
              vars.RoomState.choosingCards,
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
                  if (vars.Packs.includes(packId)) {
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

  /**************
   * Game Logic *
   **************/

  socket.on("submitCard", (data, fn) => {
    if (!helpers.validateUInt(data.cardId)) return fn({error: "Invalid Card ID"});

    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      if (user.state !== vars.UserState.choosing) {
        console.warn("A card was submitted from a user with invalid state '" + user.state + "'");
        return fn({error: "Invalid State"});
      }

      db.getRoomUsers(user.roomId, (err, roomUsers) => {
        if (err || !roomUsers) {
          console.warn("Failed to get users when submitting card in room #" + user.roomId);
          return fn({error: err});
        }

        // We can validate the card simply by trying to update it and checking the number of rows affected
        db.con.query(`
          UPDATE room_white_cards 
          SET state = ${vars.CardState.selected} 
          WHERE room_id = ? AND card_id = ? AND user_id = ? AND state = ${vars.CardState.hand};
        `,  [user.roomId, data.cardId, userId], (err, results) => {
          if (err) {
            console.warn("Failed to submit card #" + data.cardId + ":", err);
            return fn({error: "MySQL Error"});
          } else if (results.affectedRows === 0) return fn({error: "Invalid Card"});

          // Try to get a new white card to replace the one which was submitted
          db.getWhiteCards(user.roomId, userId, 1, (err, newCard) => {
            if (err || !newCard) {
              console.warn("Failed to get new card for user #" + userId + ":", err);
              fn({});
            } else fn({newCard: newCard[parseInt(Object.keys(newCard)[0])]}); // TODO: this is a serious mess..

            db.setUserState(userId, vars.UserState.idle);

            let czarSocket: sio.Socket | undefined = undefined;

            // Check if all users have submitted a card
            for (const roomUserId in roomUsers) {
              let roomUser = roomUsers[roomUserId];

              let socket = getSocket(roomUser.id);
              if (!socket || roomUser.id === userId) return;


              if (roomUser.state === vars.UserState.czar) {
                if (czarSocket) console.warn("Multiple czars were found in room #" + user.roomId + "!");
                czarSocket = socket;
              }

              socket.emit("userState", {userId: userId, state: vars.UserState.idle});
            }

            // Check if we have received enough answers to start reading them
            db.con.query(`
              SELECT id
              FROM white_cards
              WHERE id IN (
                SELECT card_id
                FROM room_white_cards
                WHERE room_id = ? AND state = ${vars.CardState.selected}                
              );
            `, [user.roomId], (err, results) => {
              if (err) {
                console.warn(`Failed to get selected cards for room #${user.roomId}:`, err);
                return fn({error: "MySQL Error"});
              }

              if (results.length >= 2) {
                // At least three players are required for a round
                if (!czarSocket) {
                  return console.warn(`No czar was found for room #${user.roomId}, but answers are ready`);
                }
                czarSocket.emit("answersReady");
              }
            });
          });
        });
      });
    });
  });

  socket.on("startReadingAnswers", (data, fn) => {
    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      if (user.state !== vars.UserState.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to start reading answers!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn({error: err});
        if (room.state !== vars.RoomState.choosingCards) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get users when switching to reading mode in room #" + user.roomId);
            return fn({error: err});
          }

          db.con.query(`
            SELECT id
            FROM white_cards
            WHERE id IN (
              SELECT card_id
              FROM room_white_cards
              WHERE room_id = ? AND state = ${vars.CardState.selected}                
            );
          `, [user.roomId], (err, results) => {
            if (err) {
              console.warn("Failed to get selected cards for room #" + user.roomId + ":", err);
              return fn({error: "MySQL Error"});
            } else if (results.length < 2) {
              return fn({error: "Not enough cards selected!"});
            }

            let submissions = results.length;

            // Mark all users who were still choosing as idle
            db.con.query(`
              UPDATE users 
              SET state = ${vars.UserState.idle}
              WHERE room_id = ? AND state = ${vars.UserState.choosing}
            `, [user.roomId], (err) => {
              if (err) {
                console.warn("Failed to mark users as idle after starting response reading:", err);
                return fn({error: "MySQL Error"});
              }

              fn({});
              db.setRoomState(user.roomId, vars.RoomState.readingCards);

              for (const roomUserId in roomUsers) {
                // TODO: consistency
                let socket = getSocket(parseInt(roomUserId));
                if (!socket) return;

                socket.emit("startReadingAnswers", {
                  count: submissions
                });
              }
            });
          });
        });
      });
    });
  });

  socket.on("revealResponse", (data, fn) => {
    if (!helpers.validateUInt(data.position)) return fn({error: "Invalid Card Position"});

    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      if (user.state !== vars.UserState.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to reveal a response!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn({error: err});
        if (room.state !== vars.RoomState.readingCards) return fn({error: "Invalid Room State"});

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
              WHERE room_id = ? AND state = ${vars.CardState.selected}                
            )
            ORDER BY RAND()
            LIMIT 1;
          `, [user.roomId], (err, results) => {
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

            db.con.query(`UPDATE room_white_cards SET state = ${vars.CardState.revealed} WHERE card_id = ? `,
            [card.id], (err) => {
              if (err) {
                console.warn("Failed to mark card as read:", err);
                return fn({error: "MySQL Error"});
              }
              fn({});
              for (const roomUserId in roomUsers) {
                // TODO: consistency
                let socket = getSocket(parseInt(roomUserId));
                if (!socket) return;

                socket.emit("revealResponse", {
                  position: data.position,
                  card: card
                });
              }
            });
          });
        });
      });
    });
  });

  socket.on("selectResponse", (data, fn) => {
    if (data.cardId != null && !helpers.validateUInt(data.cardId)) return fn({error: "Card ID must be an int"});

    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn({error: err});

      if (user.state !== vars.UserState.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to reveal a response!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn(room);
        if (room.state !== vars.RoomState.readingCards) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get users when revealing card in room #" + user.roomId);
            return fn({error: err});
          }

          if (data.cardId != null) {
            db.getWhiteCardByID(data.cardId, (err, card) => {
              if (err || !card) return fn({error: err});

              finishSelectResponse(user, roomUsers, data.cardId, fn);
            });
          } else finishSelectResponse(user, roomUsers, undefined, fn);
        });
      });
    });
  });

  // TODO: deduplication
  socket.on("selectWinner", (data, fn) => {
    if (!helpers.validateUInt(data.cardId)) return fn({error: "Invalid Card ID"});

    db.getRoomUser(userId, (err, user) => {
      if (err || !user) return fn(user);
      if (user.state !== vars.UserState.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to select a winning response!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn(room);
        if (room.state !== vars.RoomState.readingCards) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) {
            console.warn("Failed to get users when selecting winning card in room #" + user.roomId);
            return fn({error: err});
          }

          db.getWhiteCardByID(data.cardId, (err, winningCard) => {
            if (err || !winningCard) {
              console.warn(`Failed to lookup winning card from room #${user.roomId} with id #${data.cardId}`);
              return fn({error: "Invalid Card"});
            }

            db.con.query(`
              SELECT card_id AS cardId, user_id AS userId
              FROM room_white_cards
              WHERE room_id = ? AND state = ${vars.CardState.revealed}
            `, [user.roomId], (err, results) => {
              if (err) {
                console.warn("Failed to check room_white_cards for winning card:", err);
                return fn({error: "MySQL Error"});
              } else if (results.length === 0) {
                return fn({error: "Invalid Room or State"});
              }

              let winnerId: number | undefined = undefined;

              results.forEach((result: any) => {
                if (result.cardId === data.cardId) {
                  winnerId = result.userId;
                }
              });

              if (!winnerId) {
                console.warn("Winning card was not found in room_white_cards!");
                return fn({error: "Invalid Card"});
              }

              // Mark all revealed cards as played
              db.con.query(`
                UPDATE room_white_cards 
                SET state = ${vars.CardState.played} 
                WHERE room_id = ? AND state = ${vars.CardState.revealed};
              `, [user.roomId], (err) => {
                if (err) {
                  console.warn("Failed to mark cards as played:", err);
                  return fn({error: "MySQL Error"});
                }

                // Mark all active users except the winner as idle
                db.con.query(`
                  UPDATE users 
                  SET state = ${vars.UserState.idle}
                  WHERE room_id = ? AND NOT id = ? AND NOT state = ${vars.UserState.inactive};
                `, [user.roomId, winnerId], (err) => {
                  if (err) {
                    console.warn("Failed to mark all users in room #" + user.roomId+ " as idle:", err);
                    return fn({error: "MySQL Error"});
                  }

                  db.setWinner(winnerId as number, roomUsers[winnerId as number].score + 1);
                  db.setRoomState(user.roomId, vars.RoomState.viewingWinner);

                  fn({});

                  for (const roomUserId in roomUsers) {
                    // TODO: consistency
                    let socket = getSocket(parseInt(roomUserId));
                    if (!socket) return;

                    socket.emit("selectWinner", {
                      card: winningCard,
                      userId: winnerId
                    });
                  }
                });
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

      if (user.state !== vars.UserState.winner) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to start next round!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, (err, room) => {
        if (err || !room) return fn({error: err});
        if (room.state !== vars.RoomState.viewingWinner) return fn({error: "Invalid Room State"});

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

        db.getRoomUsers(user.roomId, (err, roomUsers) => {
          if (err || !roomUsers) return console.warn("Failed to get users for room #" + user.roomId);

          for (const roomUserId in roomUsers) {
            let roomUser = roomUsers[roomUserId];

            let socket = getSocket(roomUser.id);
            if (!socket || roomUser.id === userId) return;

            // Send the message to other active users
            if (roomUser.state !== vars.UserState.inactive) {
              socket.emit("chatMessage", {message: msg});
            }
          }
        });
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

              let socket = getSocket(roomUser.id);
              if (!socket || roomUser.id === userId) return;

              // Send the like information to other active users
              if (roomUser.state !== vars.UserState.inactive) {
                socket.emit("likeMessage", {msgId: data.msgId, userId: userId});
              }
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

            let socket = getSocket(roomUser.id);
            if (!socket || roomUser.id === userId) return;

            if (roomUser.state !== vars.UserState.inactive) {
              socket.emit("unlikeMessage", {msgId: data.msgId, userId: userId});
            }
          }
        });
      });
    });
  });
}

io.on("connection", (socket) => {

  // Add user to the database
  db.con.query(`INSERT INTO users VALUES ();`, (err, result) => {
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
      icons: vars.Icons
    });

    // Only register socket callbacks now that we have a userId
    initSocket(socket, userId);
  });
});

/**************
 * Web Server *
 **************/

const server = http.listen(process.env.PORT || 3000, () => {
  console.log("Listening on port %d.", server.address().port);
});
