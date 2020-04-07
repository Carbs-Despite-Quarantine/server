const express = require("express");
const path = require("path");
const app = express();

const http = require("http").createServer(app);
const io = require("socket.io")(http);

const vars = require("./vars");
const db = require("./db");
const helpers = require("./helpers");

// Maps user ID's to socket objects
const sockets = {};

/*****************
 * Web Endpoints *
 *****************/

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.get("/inc/*", function(req, res) {
  res.sendFile(path.join(__dirname, "public/", req.path));
});

app.get("/status", (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.end("OK");
});

/**************************
 * Data Dependent Helpers *
 **************************/

// Returns all the icons which are not already taken
function getAvailableIcons(roomIcons) {
  let availableIcons = [];

  vars.Icons.forEach(icon => {
    // Add all the unused icons to the final list
    if (!roomIcons.includes(icon))  availableIcons.push(icon);
  });

  return availableIcons;
}

function getSocket(userId) {
  if (!sockets.hasOwnProperty(userId)) {
    console.warn("Tried to get socket for unknown user #" + userId + "!");
    return {error: "No Socket Found"};
  }
  return sockets[userId];
}

// Gets a user from the database and checks that they are currently in a room
function getRoomUser(userId, fn) {
  if (!helpers.validateUInt(userId)) return fn({error: "Invalid User ID"});
  db.getUser(userId, user => {
    if (user.error) return fn(user);
    else if (!user.roomId) return fn({error: "Not in a room"});
    fn(user);
  });
}

// Counts the number of users who are still active in a room and broadcasts a 'user left' message if one is provided
function countActiveUsersOnLeave(userId, roomInfo, leaveMessage=null) {
  let activeUsers = 0;

  roomInfo.userIds.forEach(roomUserId => {
    let socket = getSocket(roomUserId);
    if (!socket) return;

    // Notify active users that the user left
    if (roomUserId !== userId && roomInfo.users[roomUserId].state !== vars.UserStates.inactive) {
      activeUsers++;
      if (leaveMessage) {
        socket.emit("userLeft", {
          userId: userId,
          message: leaveMessage
        });
      }
    }
  });

  return activeUsers;
}

/********************
 * Socket Responses *
 ********************/

function finishSetupRoom(userId, roomId, roomInfo, rotateCzar, edition, packs, fn) {
  db.getBlackCard(roomId, blackCard => {
    if (blackCard.error) {
      console.warn("Failed to get starting black card for room #" + roomId + ":", blackCard.error);
      return fn(blackCard)
    }

    console.debug("Setup room #" + roomId + " with edition '" + edition + "'");

    // Get starting white cards
    db.getWhiteCards(roomId, userId, vars.HandSize, hand => {
      if (hand.error) {
        console.warn("Failed to get starting hand for room #" + roomId + ":", hand.error);
        return fn(hand);
      }
      fn({hand: hand, blackCard: blackCard});
    });

    roomInfo.userIds.forEach(roomUserId => {
      let socket = getSocket(roomUserId);
      if (roomUserId === userId || !socket) return;

      let roomSettings = {
        edition: edition,
        packs: packs,
        rotateCzar: rotateCzar,
        blackCard: blackCard
      };

      if (!roomInfo.users[roomUserId].name || !roomInfo.users[roomUserId].icon) {
        return socket.emit("roomSettings", roomSettings);
      }

      db.getWhiteCards(roomId, roomUserId, vars.HandSize, hand => {
        if (hand.error) {
          console.warn("Failed to get starting hand for user #" + roomUserId + ":", hand.error);
          hand = {};
        }

        db.setUserState(roomUserId, vars.UserStates.choosing);
        roomSettings.hand = hand;

        socket.emit("roomSettings", roomSettings);
      });
    });
  });
}

function finishEnterRoom(user, room, roomInfo, hand, fn) {
  db.createMessage(user.id, "joined the room", true, message => {
    fn({message: message, hand: hand});

    let state = vars.UserStates.idle;

    if (room.state === vars.RoomStates.choosingCards) {
      db.setUserState(user.id, vars.UserStates.choosing);
      state = vars.UserStates.choosing;
    }

    roomInfo.userIds.forEach(roomUserId => {
      if (roomInfo.users[roomUserId].state === vars.UserStates.inactive) return;

      let socket = getSocket(roomUserId);
      if (!socket) return;

      // Send the new users info to all other active room users
      if (roomUserId !== user.id) {
        socket.emit("userJoined", {
          user: {
            id: user.id,
            name: user.name,
            icon: user.icon,
            roomId: user.roomId,
            score: user.score,
            state: state
          },
          message: message
        });
      }
    });
  });
}

function finishJoinRoom(user, room, fn) {
  // Do this before getting messages since it doubles as a check for room validity
  db.getRoomUsers(room.id, roomInfo => {
    if (roomInfo.error) {
      console.warn("Failed to get user ids when joining room #" + room.id);
      return fn(roomInfo);
    } if (roomInfo.userIds === 0) {
      return fn({error: "Can't join empty or invalid room"});
    }

    // Add the client to the user list
    roomInfo.users[user.id] = {
      id: user.id,
      icon: user.icon,
      name: user.name,
      roomId: room.id,
      score: user.score,
      state: user.state
    };

    // Modify the temp object since it gets sent to the client
    roomInfo.userIds.push(user.id);
    room.users = roomInfo.userIds;

    db.getLatestMessages(room.id, 15, response => {
      if (response.error) {
        console.warn("failed to get latest messages from room #" + room.id + ": " + response.error);
        room.messages = {};
      } else {
        room.messages = response.messages;
      }

      // Add the user to the room
      user.roomId = room.id;
      db.addUserToRoom(user.id, room.id, vars.UserStates.idle);

      // Make aa list of the icons currently in use
      let roomIcons = [];

      roomInfo.userIds.forEach(roomUserId => {
        let roomUser = roomInfo.users[roomUserId];
        // If the user is active, add their icon to the list
        if (roomUserId !== user.id && roomUser.state !== vars.UserStates.inactive && roomUser.icon) {
          roomIcons.push(roomUser.icon);
        }
      });

      fn({
        room: room,
        users: roomInfo.users,
        iconChoices: getAvailableIcons(roomIcons)
      });
    });
  });
}

function finishSelectResponse(user, roomUserInfo, cardId, fn) {
  db.query(`UPDATE rooms SET selected_response = ? WHERE id = ?;`,
  [cardId, user.roomId], (err) => {
    if (err) {
      console.warn("Failed to update selected card for room #" + user.roomId);
      return fn({error: "MySQL Error"});
    }

    roomUserInfo.userIds.forEach(roomUserId => {
      let socket = getSocket(roomUserId);
      if (!socket || roomUserId === user.id) return;

      socket.emit("selectResponse", {cardId: cardId});
    });
  });
}

function nextRound(roomId, czarId, roomInfo, fn) {
  // Get a black card for the new round
  db.getBlackCard(roomId, blackCard => {
    if (blackCard.error) {
      console.warn("Failed to get starting black card for room #" + roomId + ":", blackCard.error);
      return fn(blackCard)
    }

    db.setRoomState(roomId, vars.RoomStates.choosingCards);
    db.setUserState(czarId, vars.UserStates.czar);

    db.query(`
      UPDATE room_white_cards
      SET state = ${vars.CardStates.played}
      WHERE room_id = ? AND (state = ${vars.CardStates.selected} OR state = ${vars.CardStates.revealed});
    `, [roomId], (err) => {
      if (err) {
        console.warn("Failed to maek cards as played when starting new round:", err);
        return fn({error: "MySQL Error"});
      }
      db.query(`
        UPDATE users
        SET state = ${vars.UserStates.choosing}
        WHERE room_id = ? AND NOT id = ?;
      `, [roomId, czarId], (err) => {
        if (err) {
          console.warn("Failed to mark user states as choosingCards for next round:", err);
          return fn({error: "MySQL Error"});
        }

        console.debug("Starting next round in room #" + roomId);
        fn({});

        roomInfo.userIds.forEach(roomUserId => {
          let socket = getSocket(roomUserId);
          if (!socket) return;

          socket.emit("nextRound", {
            card: blackCard,
            czar: czarId
          });
        })
      });
    });
  });
}

/*******************
 * Socket Handling *
 *******************/

function initSocket(socket, userId) {

  /*****************
   * Room Handling *
   *****************/

  socket.on("setIcon", (data, fn) => {
    db.getUser(userId, user => {
      if (user.error) return fn(user);

      if (!vars.Icons.includes(data.icon)) return fn({error: "Invalid Icon"});

      if (user.roomId) {
        db.getRoomUsers(user.roomId, roomInfo => {
          if (roomInfo.error) {
            console.warn("Failed to get users for room #" + user.roomId);
            return fn({error: "Room error"});
          }

          roomInfo.userIds.forEach(roomUserId => {
            let roomUser = roomInfo.users[roomUserId];

            // Can't share an icon with another active user
            if (roomUserId !== userId && roomUser.state !== vars.UserStates.inactive
                && roomUser.icon && roomUser.icon === data.icon) {
              return fn({error: "Icon in use"});
            }
          });

          db.setUserIcon(userId, data.icon);
          fn({});

          // Notify users who are yet to choose an icon that the chosen icon is now unavailable
          roomInfo.userIds.forEach(roomUserId => {
            let socket = getSocket(roomUserId);
            if (!socket) return;

            let roomUser = roomInfo.users[roomUserId];

            if (roomUserId !== userId && roomUser.state !== vars.UserStates.inactive && !roomUser.icon) {
              socket.emit("iconTaken", {icon: data.icon});
            }
          });
        });
      } else {
        db.setUserIcon(userId, data.icon);
        fn({});
      }
    });
  });

  socket.on("createRoom", (data, fn) => {
    if (!helpers.validateString(data.userName)) return fn({error: "Invalid Username"});

    db.getUser(userId, user => {
      if (user.error) return fn(user);

      let token = helpers.makeHash(8);

      db.query(`INSERT INTO rooms (token) VALUES (?);`, [token], (err, result) => {
        if (err) {
          console.warn("Failed to create room:", err);
          return fn({error: "MySQL Error"});
        }

        let roomId = result.insertId;
        db.addUserToRoom(userId, roomId, vars.UserStates.czar, res => {
          if (res.error) return fn(res);

          // Used to represent the room on the client
          let room = {
            id: roomId,
            token: token,
            users: [userId],
            messages: {},
            state: vars.RoomStates.new
          };

          db.setUserName(userId, helpers.stripHTML(data.userName));

          // Get a list of editions to give the client
          db.query(`SELECT id, name FROM editions ORDER BY RAND();`, (err, results) => {
            if (err) {
              console.warn("Failed to retrieve edition list when creating room:", err);
              return fn({error: "MySQL Error"});
            }

            let editions = {};
            results.forEach(result => editions[result.id] = result.name);

            db.query(`SELECT id, name FROM packs ORDER BY RAND();`, (err, results) => {
              if (err) {
                console.warn("Failed to retrieve pack list when creating room:", err);
                return fn({error: "MySQL Error"});
              }

              let packs = {};
              results.forEach(result => packs[result.id] = result.name);

              // Wait for the join message to be created before sending a response
              db.createMessage(userId, "created the room", true, message => {
                if (message.error) console.warn("Failed to create join message:", message.error);
                else room.messages[message.id] = message;

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
    db.getUser(userId, user => {
      if (user.error) return fn(user);

      db.getRoomWithToken(data.roomId, data.token, room => {
        if (room.error) return fn(room);

        if (room.curPrompt) {
          db.getBlackCardByID(room.curPrompt, curPrompt => {
            if (curPrompt.error) {
              console.warn("Received invalid prompt card for room #" + data.roomId + ":", curPrompt.error);
              room.curPrompt = null;
            } else room.curPrompt = curPrompt;
            finishJoinRoom(user, room, fn);
          });
        } else finishJoinRoom(user, room, fn);
      });
    });
  });

  // Called when the users presses the "Join Room" button after setting their username
  socket.on("enterRoom", (data, fn) => {
    if (!helpers.validateString(data.userName)) return fn({error: "Invalid Username"});

    getRoomUser(userId, user => {
      if (user.error) return fn(user);

      // We need the room to check if the game has started yet
      db.getRoom(data.roomId, room => {
        if (room.error) return fn(room);

        db.getRoomUsers(data.roomId, response => {
          if (response.error) {
            console.warn("Failed to get user list for room #" + data.roomId);
            return fn({error: "Unexpected error"});
          } else if (response.userIds.length === 0) {
            return fn({error: "Invalid Room"});
          } else if (!response.userIds.includes(userId)) {
            return fn({error: "Can't enter room that hasn't been joined"});
          }

          // Modify the temporary user object since it gets sent to clients
          user.name = helpers.stripHTML(data.userName);
          db.setUserName(userId, user.name);

          if (room.state !== vars.RoomStates.new) {
            db.getWhiteCards(data.roomId, userId, vars.HandSize, cards => {
              if (cards.error) {
                console.log("Room ID: " + data.roomId + " valid? ", helpers.validateUInt(data.roomId));
                console.warn("Failed to get white cards for new user #" + userId + ":", cards.error);
                return fn(cards);
              }

              finishEnterRoom(user, room, response, cards, fn);
            });
          } else {
            finishEnterRoom(user, room, response, {}, fn);
          }
        });
      });
    });
  });

  socket.on("userLeft", () => {
    getRoomUser(userId, user => {
      // Delete the user if they weren't in a room
      if (user.error) return db.deleteUser(userId);

      db.setUserState(userId, vars.UserStates.inactive);

      db.getRoomUsers(user.roomId, roomInfo => {
        if (roomInfo.error) return console.warn("Failed to get user list when leaving room #" + user.roomId);
        else if (roomInfo.userIds.length === 0) return;

        // If the user never entered the room, don't inform users of leave
        if (!user.name) {

          if (countActiveUsersOnLeave(userId, roomInfo) === 0) db.deleteRoom(user.roomId);
          else db.deleteUser(userId);
          return;
        }

        // TODO: cancel round if not enough cards left ? Inform czar of leave?
        db.query(`
          DELETE FROM room_white_cards WHERE user_id = ? AND state = ${vars.CardStates.selected}
         `, [userId], (err) => {
          if (err) console.warn("Failed to remove clear cards from user #" + userId + " after they left!");
        });

        db.createMessage(userId, "left the room", true, message => {
          // Delete the room once all users have left
          if (countActiveUsersOnLeave(userId, roomInfo, message) === 0) db.deleteRoom(user.roomId);
          else if (user.state === vars.UserStates.czar || user.state === vars.UserStates.winner) {
            // If the czar or winner leaves, we need to start a new round
            let newCzarId = null;

            for (let roomUserId in roomInfo.users) {
              let roomUser = roomInfo.users[roomUserId];
              let userState = roomUser.state;
              if (roomUserId !== userId && userState !== vars.UserStates.inactive && roomUser.name && roomUser.icon) {
                newCzarId = roomUserId;
                break;
              }
            }

            if (newCzarId == null) {
              console.warn("Failed to find a new czar for room #" + user.roomId);
            } else {
              console.warn("Czar left room #" + user.roomId + ", replacing with user #" + newCzarId);
              nextRound(user.roomId, newCzarId, roomInfo, res => {
                if (res.error) {
                  console.warn("Failed to start next round when czar left: ", res.error);
                }
              });
            }
          }
        });
      });
    });
  });

  socket.on("roomSettings", (data, fn) => {
    getRoomUser(userId, user => {
      if (user.error) return fn(user);

      // Validate the edition
      db.query(`SELECT name FROM editions WHERE id = ?;`, [
        data.edition
      ], (err, result) => {
        if (err) {
          console.warn("Failed to get edition '" + data.edition + "' from versions table:", err);
          return fn({error: "MySQL Error"});
        } else if (result.length === 0) return fn({error: "Invalid Edition"});

        db.getRoom(user.roomId, room => {
          if (room.error) return fn(room);
          else if (room.state !== vars.RoomStates.new) return fn({error: "Room is already setup!"});

          db.getRoomUsers(user.roomId, response => {
            if (response.error) {
              console.warn("Failed to get users when configuring room #" + user.roomId);
              return fn(response);
            } else if (response.userIds.length === 0) return fn({error: "Invalid Room"});

            let rotateCzar = data.rotateCzar === true;

            db.query(`UPDATE rooms SET edition = ?, rotate_czar = ?, state = ? WHERE id = ?;`, [
              data.edition,
              rotateCzar,
              vars.RoomStates.choosingCards,
              user.roomId
            ], (err) => {
              if (err) {
                console.warn("Failed to apply room settings:", err);
                return fn({error: "MySQL Error"});
              }

              let packsSQL = [];
              let validPacks = [];

              if (data.packs.length > 0) {
                data.packs.forEach(packId => {
                  if (vars.Packs.includes(packId)) {
                    validPacks.push(packId);
                    packsSQL.push(`(${user.roomId}, '${packId}')`);
                  }
                });

                let sql = `INSERT INTO room_packs (room_id, pack_id) VALUES `;
                db.query( sql + packsSQL.join(", ") + ";", (err) => {
                  if (err) console.warn("Failed to add packs to room #" + user.roomId + ":", err);
                  finishSetupRoom(userId, user.roomId, response, rotateCzar, data.edition, validPacks, fn);
                });
              } else finishSetupRoom(userId, user.roomId, response, rotateCzar, data.edition, [], fn);
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

    getRoomUser(userId, user => {
      if (user.error) return fn(user);

      if (user.state !== vars.UserStates.choosing) {
        console.warn("A card was submitted from a user with invalid state '" + user.state + "'");
        return fn({error: "Invalid State"});
      }

      db.getRoomUsers(user.roomId, roomInfo => {
        if (roomInfo.error) {
          console.warn("Failed to get users when submitting card in room #" + user.roomId);
          return fn(roomInfo);
        } else if (roomInfo.userIds.length === 0) return fn({error: "Invalid Room"});

        // We can validate the card simply by trying to update it and checking the number of rows affected
        db.query(`
          UPDATE room_white_cards 
          SET state = ${vars.CardStates.selected} 
          WHERE room_id = ? AND card_id = ? AND user_id = ? AND state = ${vars.CardStates.hand};
        `,  [user.roomId, data.cardId, userId], (err, results) => {
          if (err) {
            console.warn("Failed to submit card #" + data.cardId + ":", err);
            return fn({error: "MySQL Error"});
          } else if (results.affectedRows === 0) return fn({error: "Invalid Card"});

          // Try to get a new white card to replace the one which was submitted
          db.getWhiteCards(user.roomId, userId, 1, newCard => {
            if (newCard.error || newCard.length === 0) {
              console.warn("Failed to get new card for user #" + userId + ":", newCard.error);
              fn({});
            } else fn({newCard: newCard});

            db.setUserState(userId, vars.UserStates.idle);

            let czarSocket = null;

            // Check if all users have submitted a card
            roomInfo.userIds.forEach(roomUserId => {
              let socket = getSocket(roomUserId);
              if (!socket || roomUserId === userId) return;

              let roomUser = roomInfo.users[roomUserId];

              if (roomUser.state === vars.UserStates.czar) {
                if (czarSocket) console.warn("Multiple czars were found in room #" + user.roomId + "!");
                czarSocket = socket;
              }

              socket.emit("userState", {userId: userId, state: vars.UserStates.idle});
            });

            // Check if we have received enough answers to start reading them
            db.query(`
              SELECT id
              FROM white_cards
              WHERE id IN (
                SELECT card_id
                FROM room_white_cards
                WHERE room_id = ? AND state = ${vars.CardStates.selected}                
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
    getRoomUser(userId, user => {
      if (user.error) return fn(user);

      if (user.state !== vars.UserStates.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to start reading answers!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, room => {
        if (room.error) return fn(room);
        if (room.state !== vars.RoomStates.choosingCards) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, response => {
          if (response.error) {
            console.warn("Failed to get users when switching to reading mode in room #" + user.roomId);
            return fn(response);
          } else if (response.userIds.length === 0) return fn({error: "Invalid Room"});

          db.query(`
            SELECT id
            FROM white_cards
            WHERE id IN (
              SELECT card_id
              FROM room_white_cards
              WHERE room_id = ? AND state = ${vars.CardStates.selected}                
            );
          `, [user.roomId], (err, results) => {
            if (err) {
              console.warn("Failed to get selected cards for room #" + user.roomId + ":", err);
              return fn({error: "MySQL Error"});
            } else if (results.length < 2) {
              return fn({error: "Not enough cards selected!"});
            }

            let submissions = results.length;

            db.query(`
              UPDATE users 
              SET state = ${vars.UserStates.idle}
              WHERE room_id = ? AND NOT state = ${vars.UserStates.czar}
            `, [user.roomId], (err) => {
              if (err) {
                console.warn("Failed to mark users as idle after starting response reading:", err);
                return fn({error: "MySQL Error"});
              }

              fn({});
              db.setRoomState(user.roomId, vars.RoomStates.readingCards);

              response.userIds.forEach(roomUserId => {
                let socket = getSocket(roomUserId);
                if (!socket) return;

                socket.emit("startReadingAnswers", {
                  count: submissions
                });
              });
            });
          });
        });
      });
    });
  });

  socket.on("revealResponse", (data, fn) => {
    if (!helpers.validateUInt(data.position)) return fn({error: "Invalid Card Position"});

    getRoomUser(userId, user => {
      if (user.error) return fn(user);

      if (user.state !== vars.UserStates.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to reveal a response!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, room => {
        if (room.error) return fn(room);
        if (room.state !== vars.RoomStates.readingCards) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, response => {
          if (response.error) {
            console.warn("Failed to get users when revealing card in room #" + user.roomId);
            return fn(response);
          } else if (response.userIds.length === 0) return fn({error: "Invalid Room"});

          db.query(`
            SELECT id, text
            FROM white_cards
            WHERE id IN (
              SELECT card_id
              FROM room_white_cards
              WHERE room_id = ? AND state = ${vars.CardStates.selected}                
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

            db.query(`UPDATE room_white_cards SET state = ${vars.CardStates.revealed} WHERE card_id = ? `,
            [card.id], (err) => {
              if (err) {
                console.warn("Failed to mark card as read:", err);
                return fn({error: "MySQL Error"});
              }
              fn({});
              response.userIds.forEach(roomUserId => {
                let socket = getSocket(roomUserId);
                if (!socket) return;

                socket.emit("revealResponse", {
                  position: data.position,
                  card: card
                });
              });
            });
          });
        });
      });
    });
  });

  socket.on("selectResponse", (data, fn) => {
    if (data.cardId != null && !helpers.validateUInt(data.cardId)) return fn({error: "Card ID must be an int"});

    getRoomUser(userId, user => {
      if (user.error) return fn(user);

      if (user.state !== vars.UserStates.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to reveal a response!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, room => {
        if (room.error) return fn(room);
        if (room.state !== vars.RoomStates.readingCards) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, response => {
          if (response.error) {
            console.warn("Failed to get users when revealing card in room #" + user.roomId);
            return fn(response);
          } else if (response.userIds.length === 0) return fn({error: "Invalid Room"});

          if (data.cardId != null) {
            db.getWhiteCardByID(data.cardId, card => {
              if (card.error) return fn(card);

              finishSelectResponse(user, response, data.cardId, fn);
            });
          } else finishSelectResponse(user, response, null, fn);
        });
      });
    });
  });

  // TODO: deduplication
  socket.on("selectWinner", (data, fn) => {
    if (!helpers.validateUInt(data.cardId)) return fn({error: "Invalid Card ID"});

    getRoomUser(userId, user => {
      if (user.error) return fn(user);
      if (user.state !== vars.UserStates.czar) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to select a winning response!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, room => {
        if (room.error) return fn(room);
        if (room.state !== vars.RoomStates.readingCards) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, response => {
          if (response.error) {
            console.warn("Failed to get users when selecting winning card in room #" + user.roomId);
            return fn(response);
          } else if (response.userIds.length === 0) return fn({error: "Invalid Room"});

          db.getWhiteCardByID(data.cardId, winningCard => {
            if (winningCard.error) {
              console.warn(`Failed to lookup winning card from room #${user.roomId} with id #${data.cardId}`);
              return fn({error: "Invalid Card"});
            }

            db.query(`
              SELECT card_id AS cardId, user_id AS userId
              FROM room_white_cards
              WHERE room_id = ? AND state = ${vars.CardStates.revealed}
            `, [user.roomId], (err, results) => {
              if (err) {
                console.warn("Failed to check room_white_cards for winning card:", err);
                return fn({error: "MySQL Error"});
              } else if (results.length === 0) {
                return fn({error: "Invalid Room or State"});
              }

              let winnerId = null;

              results.forEach(result => {
                if (result.cardId === data.cardId) {
                  winnerId = result.userId;
                }
              });

              if (winnerId == null) {
                console.warn("Winning card was not found in room_white_cards!");
                return fn({error: "Invalid Card"});
              }

              // Mark all revealed cards as played
              db.query(`
                UPDATE room_white_cards 
                SET state = ${vars.CardStates.played} 
                WHERE room_id = ? AND state = ${vars.CardStates.revealed};
              `, [user.roomId], (err) => {
                if (err) {
                  console.warn("Failed to mark cards as played:", err);
                  return fn({error: "MySQL Error"});
                }

                db.query(`
                  UPDATE users 
                  SET state = ${vars.UserStates.idle}
                  WHERE room_id = ? AND NOT id = ?;
                `, [user.roomId, winnerId], (err) => {
                  if (err) {
                    console.warn("Failed to mark all users in room #" + user.roomId+ " as idle:", err);
                    return fn({error: "MySQL Error"});
                  }

                  db.setWinner(winnerId, response.users[winnerId].score + 1);
                  db.setRoomState(user.roomId, vars.RoomStates.viewingWinner);

                  fn({});

                  response.userIds.forEach(roomUserId => {
                    let socket = getSocket(roomUserId);
                    if (!socket) return;

                    socket.emit("selectWinner", {
                      card: winningCard,
                      userId: winnerId
                    });
                  });
                });
              });
            });
          })
        });
      });
    });
  });

  socket.on("nextRound", (data, fn) => {
    getRoomUser(userId, user => {
      if (user.error) return fn(user);

      if (user.state !== vars.UserStates.winner) {
        console.warn("User #" + userId + " with state '" + user.state + "' tried to start next round!");
        return fn({error: "Invalid User State"});
      }

      db.getRoom(user.roomId, room => {
        if (room.error) return fn(room);
        if (room.state !== vars.RoomStates.viewingWinner) return fn({error: "Invalid Room State"});

        db.getRoomUsers(user.roomId, response => {
          if (response.error) {
            console.warn("Failed to get users when starting next round in room #" + user.roomId);
            return fn(response);
          } else if (response.userIds.length === 0) return fn({error: "Invalid Room"});

          nextRound(user.roomId, userId, response, fn);
        });
      });
    });
  });

  /***************
   * Chat System *
   ***************/

  socket.on("chatMessage", (data, fn) => {
    if (!helpers.validateString(data.content)) return fn({error: "Invalid Message"});

    getRoomUser(userId, user => {
      if (user.error) return fn(user);

      db.createMessage(userId, data.content, false, message => {
        fn({message: message});

        db.getRoomUsers(user.roomId, roomInfo => {
          if (roomInfo.error) return console.warn("Failed to get users for room #" + user.roomId);
          roomInfo.userIds.forEach(roomUserId => {
            let socket = getSocket(roomUserId);
            if (!socket || roomUserId === userId) return;

            // Send the message to other active users
            if (roomInfo.users[roomUserId].state !== vars.UserStates.inactive) {
              socket.emit("chatMessage", {message: message});
            }
          });
        });
      });
    });
  });

  socket.on("likeMessage", (data, fn) => {
    getRoomUser(userId, user => {
      if (user.error) return fn(user);

      // We need to check that the user is actually in the room where the message was sent
      // and that the message isn't a system message
      db.query(`
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
        db.query(`INSERT INTO message_likes (message_id, user_id) VALUES (?, ?);`, [
          data.msgId,
          userId
        ], (err) => {
          if (err) {
            console.warn("Failed to add like:", err);
            return fn({error: "MySQL Error"});
          }
          fn({});

          db.getRoomUsers(user.roomId, roomInfo => {
            if (roomInfo.error) return console.warn("Failed to get user ids for room #" + user.roomId);
            roomInfo.userIds.forEach(roomUserId => {
              let socket = getSocket(roomUserId);
              if (!socket || roomUserId === userId) return;

              // Send the like information to other active users
              if (roomInfo.users[roomUserId].state !== vars.UserStates.inactive) {
                socket.emit("likeMessage", {msgId: data.msgId, userId: userId});
              }
            });
          });
        });
      });
    });
  });

  socket.on("unlikeMessage", (data, fn) => {
    getRoomUser(userId, user => {
      if (user.error) return fn(user);

      db.query(`DELETE FROM message_likes WHERE message_id = ? AND user_id = ?;`, [
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
        db.getRoomUsers(user.roomId, roomInfo => {
          if (roomInfo.error) return console.warn("Failed to get users for room #" + user.roomId);
          roomInfo.userIds.forEach(roomUserId => {
            let socket = getSocket(roomUserId);
            if (!socket || roomUserId === userId) return;

            if (roomInfo.users[roomUserId].state !== vars.UserStates.inactive) {
              socket.emit("unlikeMessage", {msgId: data.msgId, userId: userId});
            }
          });
        });
      });
    });
  });
}

io.on("connection", (socket) => {

  // Add user to the database
  db.query(`INSERT INTO users VALUES ();`, (err, result) => {
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
