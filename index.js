const express = require("express");
const path = require("path");
const app = express();

var http = require("http").createServer(app);
var io = require("socket.io")(http);

const vars = require("./vars");
const db = require("./db");
const helpers = require("./helpers");

/**
 * User:
 *  - id (int)
 *  - name (string)
 *  - icon (string)
 *  - roomId (int)
 *  - socket (<socket>)
 **/
var users = {}

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
  var availableIcons = [];

  vars.Icons.forEach(icon => {
    // Add all the unused icons to the final list
    if (!roomIcons.includes(icon))  availableIcons.push(icon);
  });

  return availableIcons;
}

function getUser(userId, requireRoom=false) {
  if (!users.hasOwnProperty(userId)) return {error: "Invalid User"};
  if (requireRoom && !users[userId].roomId) return {error: "Not in a room"};
  return users[userId];
}

function setUserState(userId, state) {
  users[userId].state = state;
  db.setUserState(userId, state);
}

/********************
 * Socket Responses *
 ********************/

function finishSetupRoom(userId, roomId, roomUserInfo, rotateCzar, edition, packs, fn) {
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

    roomUserInfo.userIds.forEach(roomUserId => {
      if (roomUserId == userId || !users.hasOwnProperty(roomUserId)) return;

      var roomSettings = {
        edition: edition,
        packs: packs,
        rotateCzar: rotateCzar,
        blackCard: blackCard
      };

      if (!roomUserInfo.users[roomUserId].name || !roomUserInfo.users[roomUserId].icon) {
        return users[roomUserId].socket.emit("roomSettings", roomSettings);
      };

      db.getWhiteCards(roomId, roomUserId, vars.HandSize, hand => {
        if (hand.error) {
          console.warn("Failed to get starting hand for user #" + roomUserId + ":", hand.error);
          hand = {};
        }
        setUserState(roomUserId, vars.UserStates.choosing);

        roomSettings.hand = hand;
        users[roomUserId].socket.emit("roomSettings", roomSettings);
      });
    });
  });
}

function finishEnterRoom(user, room, roomUserIds, hand, fn) {
  db.createMessage(user.id, "joined the room", true, message => {
    fn({message: message, hand: hand});

    if (room.state == vars.RoomStates.choosingCards) {
      setUserState(user.id, vars.UserStates.choosing);
    }

    roomUserIds.forEach(roomUserId => {
      if (!users.hasOwnProperty(roomUserId)) return;
      var socketUser = users[roomUserId];

      // Send the new users info to all other active room users
      if (roomUserId != user.id && socketUser.roomId == room.id) {
        socketUser.socket.emit("userJoined", {
          user: {
            id: user.id,
            name: user.name,
            icon: user.icon,
            roomId: user.roomId,
            score: user.score,
            state: user.state
          },
          message: message
        });
      }
    });
  });
}

function finishJoinRoom(user, room, fn) {
  // Do this before getting messages since it doubles as a check for room validity
  db.getRoomUsers(room.id, response => {
    if (response.error) {
      console.warn("Failed to get user ids when joining room #" + room.id);
      return fn(response);
    } if (response.userIds == 0) {
      return fn({error: "Can't join empty or invalid room"});
    }

    // Cache the user lists so wse can reuse the response variable
    var roomUsers = response.users;
    var roomUserIds = response.userIds;

    // Add the client to the user list
    roomUsers[user.id] = {
      id: user.id,
      icon: user.icon,
      name: user.name,
      roomId: room.id,
      score: user.score,
      state: user.state
    };
    roomUserIds.push(user.id);

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
      var roomIcons = [];

      roomUserIds.forEach(roomUserId => {
        var roomUser = roomUsers[roomUserId];
        // If the user is active, add their icon to the list
        if (roomUserId != user.id && users.hasOwnProperty(roomUserId) && users[roomUserId].roomId == room.id && roomUser.icon) {
          roomIcons.push(roomUser.icon)    
          // I'm not sure if we still need this on the client but it dosen't hurt
          roomUsers[roomUserId].roomId = room.id;
        }
      });

      fn({
        room: room,
        users: roomUsers,
        iconChoices: getAvailableIcons(roomIcons)
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
    var user = getUser(userId);
    if (user.error) return fn(user);

    if (!vars.Icons.includes(data.icon)) return fn({error: "Invalid Icon"});

    db.setUserIcon(userId, data.icon);

    if (user.roomId) {
      db.getRoomUsers(user.roomId, response => {
        if (response.error) {
          console.warn("Failed to get users for room #" + user.roomId);
          return fn({error: "Room error"});
        }

        response.userIds.forEach(roomUserId => {
          roomUser = response.users[roomUserId];

          // Can't share an icon with another active user
          if (roomUserId != userId && users.hasOwnProperty[roomUserId] && users[roomUserId].roomId == user.roomId && roomUser.icon) {
            if (roomUser.icon == data.icon) {
              return fn({error: "Icon in use"});
            }
          }
        });

        user.icon = data.icon;
        fn({});

        // Notify users who are yet to choose an icon that the chosen icon is now unavailable
        response.userIds.forEach(roomUserId => {
          if (!users.hasOwnProperty(roomUserId)) return;
          socketUser = users[roomUserId];

          if (roomUserId != userId && socketUser.roomId == user.roomId && !response.users[roomUserId].icon) {
            socketUser.socket.emit("iconTaken", {
              icon: data.icon
            });
          }
        });
      });
    } else {
      user.icon = data.icon;
      return fn({});
    }
  });

  socket.on("createRoom", (data, fn) => {
    var user = getUser(userId);
    if (user.error) return fn(user);

    if (!helpers.validateString(data.userName)) return fn({error: "Invalid Username"});

    var token = helpers.makeHash(8);

    db.query(`INSERT INTO rooms (token) VALUES (?);`, [
      token
    ], (err, result) => {
      if (err) {
        console.warn("Failed to create room:", err);
        return fn({error: "MySQL Error"});
      }

      var roomId = result.insertId;
      db.addUserToRoom(userId, roomId, vars.UserStates.czar, () => {
        // Used to represent the room on the client
        var room = {
          id: roomId,
          token: token,
          users: [userId],
          messages: {},
          state: vars.RoomStates.new
        };

        // Update the users detaiils
        user.name = helpers.stripHTML(data.userName);
        user.roomId = roomId;
        user.state = vars.UserStates.czar;

        db.setUserName(userId, user.name);

        // Get a list of editions to give the client
        db.query(`SELECT id, name FROM editions;`, (err, results) => {
          if (err) {
            console.warn("Failed to retrieve edition list when creating room:", err);
            return fn({error: "MySQL Error"});
          }

          var editions = {};
          results.forEach(result => editions[result.id] = result.name);

          db.query(`SELECT id, name FROM packs ORDER BY RAND();`, (err, results) => {
            if (err) {
              console.warn("Failed to retrieve pack list when creating room:", err);
              return fn({error: "MySQL Error"});
            }

            var packs = {};
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

  // Used to add an unnamed user to a room
  socket.on("joinRoom", (data, fn) => {
    var user = getUser(userId);
    if (user.error) return fn(user);
    db.getRoomWithToken(data.roomId, data.token, room => {
      if (room.error) return fn(room);

      if (room.curPrompt) {
        db.getBlackCardByID(room.curPrompt, curPrompt => {
          if (curPrompt.error) {
            console.warn("Recieved invalid prompt card for room #" + data.roomId + ":", curPrompt.error);
            room.curPrompt = null;
          } else room.curPrompt = curPrompt;
          finishJoinRoom(user, room, fn);
        });
      } else finishJoinRoom(user, room, fn);
    });
  });

  // Called when the users presses the "Join Room" button after setting their username
  socket.on("enterRoom", (data, fn) => {
    var user = getUser(userId, true);
    if (user.error) return fn(user);

    if (!helpers.validateString(data.userName)) return fn({error: "Invalid Username"});

    // We need the room to check if the game has started yet
    db.getRoom(data.roomId, room => {
      if (room.error) return fn(room);

      db.getRoomUsers(data.roomId, response => {
        if (response.error) {
          console.warn("Failed to get user list for room #" + data.roomId);
          return fn({error: "Unexpected error"});
        } else if (response.userIds.length == 0) {
          return fn({error: "Invalid Room"});
        } else if (!response.userIds.includes(userId)) {
          return fn({error: "Can't enter room that hasn't been joined"});
        }

        user.name = helpers.stripHTML(data.userName);
        db.setUserName(userId, user.name);

        if (room.state != vars.RoomStates.new) {
          db.getWhiteCards(data.roomId, userId, vars.HandSize, cards => {
            if (cards.error) {
              console.log("Room ID: " + data.roomId + " valid? ", helpers.validateUInt(data.roomId));
              console.warn("Failed to get white cards for new user #" + userId + ":", cards.error);
              return fn(cards);
            }

            finishEnterRoom(user, room, response.userIds, cards, fn);
          });
        } else {
          finishEnterRoom(user, room, response.userIds, {}, fn);
        }
      });
    });
  });

  socket.on("userLeft", (data) => {
    var user = getUser(userId, true);
    if (user.error) {
      // Delete the user if they weren't in a room
      return db.deleteUser(userId);
    }

    var activeUsers = 0;

    db.getRoomUsers(user.roomId, response => {
      if (response.error) return console.warn("Failed to get user list when leaving room #" + user.roomId);
      else if (response.userIds.length == 0) {
        user.roomId = null;
        return;
      };

      // If the user never entered the room, don't inform users of leave
      if (!response.users[userId].name) {
        // We have to do this twice to prevent users who haven't entered leaving the room open indefinitely
        response.userIds.forEach(roomUserId => {
          if (roomUserId != userId && users.hasOwnProperty(roomUserId) && users[roomUserId].roomId == user.roomId) activeUsers++;
        });

        if (activeUsers == 0) db.deleteRoom(user.roomId);
        else db.deleteUser(userId);

        // If we aren't returning here, we still need the roomId for createMessage()
        user.roomId = null;
        return;
      }

      db.createMessage(userId, "left the room", true, message => {
          response.userIds.forEach(roomUserId => {
          if (!users.hasOwnProperty(roomUserId)) return;
          var socketUser = users[roomUserId];

          // Notify active users that the user left
          if (roomUserId != userId && socketUser.roomId == user.roomId) {
            activeUsers++;
            socketUser.socket.emit("userLeft", {
              userId: userId,
              message: message
            });
          }
        });

        // Delete the room once all users have left
        if (activeUsers == 0) db.deleteRoom(user.roomId);
        user.roomId = null;
      });
    });
  });

  socket.on("roomSettings", (data, fn) => {
    var user = getUser(userId, true);
    if (user.error) return fn(user);

    // Validate the edition
    db.query(`SELECT name FROM editions WHERE id = ?;`, [
      data.edition
    ], (err, result, fields) => {
      if (err) {
        console.warn("Failed to get edition '" + data.edition + "' from versions table:", err);
        return fn({error: "MySQL Error"});
      } else if (result.length == 0) return fn({error: "Invalid Edition"});

      db.getRoom(user.roomId, room => {
        if (room.error) return fn(room);
        else if (room.state != vars.RoomStates.new) return fn({error: "Room is already setup!"});

        db.getRoomUsers(user.roomId, response => {
          if (response.error) {
            console.warn("Failed to get users when configuring room #" + user.roomId);
            return fn(response);
          } else if (response.userIds.length == 0) return fn({error: "Invalid Room"});

          var rotateCzar = data.rotateCzar == true;

          db.query(`UPDATE rooms SET edition = ?, rotate_czar = ?, state = ? WHERE id = ?;`, [
            data.edition,
            rotateCzar,
            vars.RoomStates.choosingCards,
            user.roomId
          ], (err, result) => {
            if (err) {
              console.warn("Failed to apply room settings:", err);
              return fn({error: "MySQL Error"});
            }

            var packsSQL = [];
            var validPacks = [];

            if (data.packs.length > 0) {
              data.packs.forEach(packId => {
                if (vars.Packs.includes(packId)) {
                  validPacks.push(packId);
                  packsSQL.push(`(${user.roomId}, '${packId}')`);
                }
              });

              var sql = `INSERT INTO room_packs (room_id, pack_id) VALUES `;
              db.query(sql + packsSQL.join(", ") + ";", (err, result) => {
                if (err) {
                  console.warn("Failed to add packs to room #" + user.roomId + ":", err);
                }
                finishSetupRoom(userId, user.roomId, response, rotateCzar, data.edition, validPacks, fn);
              });
            } else finishSetupRoom(userId, user.roomId, response, rotateCzar, data.edition, [], fn);
          });
        });
      });
    });
  });

  /********
   * Game *
   ********/

  socket.on("submitCard", (data, fn) => {
    if (!helpers.validateUInt(data.cardId)) return fn({error: "Invalid Card ID"});
    var user = getUser(userId, true);
    if (user.error) return fn(user);

    if (user.state != vars.UserStates.choosing) {
      console.warn("A card was submitted from a user with invalid state '" + user.state + "'");
      return fn({error: "Invalid State"});
    }

    db.getRoomUsers(user.roomId, response => {
      if (response.error) {
        console.warn("Failed to get users when submitting card in room #" + user.roomId);
        return fn(response);
      } else if (response.userIds.length == 0) return fn({error: "Invalid Room"});

      // We can validate the card simply by trying to update it and checking the number of rows affected
      db.query(`
        UPDATE room_white_cards 
        SET state = ${vars.CardStates.selected} 
        WHERE room_id = ? AND card_id = ? AND user_id = ? AND state = ${vars.CardStates.hand};
      `,  [user.roomId, data.cardId, userId], (err, results, fields) => {
        if (err) {
          console.warn("Failed to submit card #" + data.cardId + ":", err);
          return fn({error: "MySQL Error"});
        } else if (results.affectedRows == 0) return fn({error: "Invalid Card"});

        // Try to get a new white card to replace the one which was submitted
        db.getWhiteCards(user.roomId, userId, 1, newCard => {
          if (newCard.error || newCard.length == 0) {
            console.warn("Failed to get new card for user #" + userId + ":", newCard.error);
            fn({});
          } else fn({newCard: newCard});

          setUserState(userId, vars.UserStates.idle);

          var cardCzar = null;
          var activeUsers = 1;

          // Check if all users have submitted a card
          response.userIds.forEach(roomUserId => {
            if (!users.hasOwnProperty(roomUserId) || roomUserId == userId) return;

            var roomUser = response.users[roomUserId];
            var socketUser = users[roomUserId];

            activeUsers++;

            if (roomUser.state == vars.UserStates.czar) {
              if (cardCzar) console.warn("Multiple czars were found in room #" + user.roomId + "!");
              cardCzar = socketUser;
            }

            socketUser.socket.emit("userState", {userId: userId, state: vars.UserStates.idle});
          });

          // At least three players are required for a round
          if (activeUsers > 2) {
            if (!cardCzar) return console.warn("No czar was found for room #" + user.roomId);
            cardCzar.socket.emit("answersReady");
          }
        });         
      });
    });
  });

  // TODO
  socket.on("startReadAnswers", (data, fn) => {
    // Get all the chosen cards for this round
    db.query(`
      SELECT id
      FROM white_cards
      WHERE id IN (
        SELECT card_id
        FROM room_white_cards
        WHERE room_id = ? AND state = ${vars.CardStates.selected}                
      );
    `, [user.roomId], (err, results, fields) => {
      if (err) {
        return console.warn("Failed to get selected cards for room #" + user.roomId + ":", err);
      } else if (results.length == 0) {
        return console.warn("Didn't find any selected cards for room #" + user.roomId + " despite all players having submitted");
      }

      var cardChoices = {};

      results.forEach(result => {
        cardChoices[result.id] = {
          id: result.id,
          text: result.text
        };
      });

      response.userIds.forEach(roomUserId => {
        if (!users.hasOwnProperty(roomUserId)) return;

        users[roomUserId].socket.emit("cardChoices", {
          choices: cardChoices
        });
      });
    });
  });

  /***************
   * Chat System *
   ***************/

  socket.on("chatMessage", (data, fn) => {
    var user = getUser(userId, true);
    if (user.error) return fn(user);
    if (!helpers.validateString(data.content)) return fn({error: "Invalid Message"});

    db.createMessage(userId, data.content, false, message => {
      fn({message: message});

      db.getRoomUsers(user.roomId, response => {
        if (response.error) return console.warn("Failed to get users for room #" + user.roomId);
        response.userIds.forEach(roomUserId => {
          if (!users.hasOwnProperty(roomUserId)) return;
          var socketUser = users[roomUserId];

          // Send the message to other active users
          if (roomUserId != userId && socketUser.roomId == user.roomId) {
            socketUser.socket.emit("chatMessage", {message: message});
          }
        });
      });
    });
  });

  socket.on("likeMessage", (data, fn) => {
    var user = getUser(userId, true);
    if (user.error) return fn(user);

    // We need to check that the user is actually in the room 
    // where the message was sent and, that it isn't a system message
    var sql = `
      SELECT system_msg 
      FROM messages 
      WHERE id = ? AND room_id = ?;
    `;
    db.query(sql, [
      data.msgId,
      user.roomId
    ],(err, msgInfo, fields) => {
      if (err) {
        console.warn("Failed to get msg #" + data.msgId + ":", err);
        return fn({error: "MySQL Error"});
      } else if (msgInfo.length == 0) {
        return fn({error: "Invalid Message ID"});
      } else if (msgInfo[0].system_msg == 1) {
        return fn({error: "Can't like a system message"});
      }

      // Now we can actually add the like
      db.query(`INSERT INTO message_likes (message_id, user_id) VALUES (?, ?);`, [
        data.msgId,
        userId
      ], (err, insertResult) => {
        if (err) {
          console.warn("Failed to add like:", err);
          return fn({error: "MySQL Error"});
        }
        fn({});

        db.getRoomUsers(user.roomId, response => {
          if (response.error) return console.warn("Failed to get user ids for room #" + user.roomId);
          response.userIds.forEach(roomUserId => {
            if (!users.hasOwnProperty(roomUserId)) return;
            var socketUser = users[roomUserId];

            // Send the like information to other active users
            if (roomUserId != userId && socketUser.roomId == user.roomId) {
              socketUser.socket.emit("likeMessage", {msgId: data.msgId, userId: userId});
            }
          });
        });
      });
    });
  });

  socket.on("unlikeMessage", (data, fn) => {
    var user = getUser(userId, true);
    if (user.error) return fn(user);

    db.query(`DELETE FROM message_likes WHERE message_id = ? AND user_id = ?;`, [
      data.msgId,
      userId
    ], (err, result) => {
      if (err) {
        console.warn("Failed to remove like:", err);
        return fn({error: "MySQL Error"});
      } else if (result.affectedRows == 0) {
        return fn({error: "Can't unlike a message that hasn't been liked!"})
      }
      fn({});

      // Inform other active users that the like was removed
      db.getRoomUsers(user.roomId, response => {
        if (response.error) return console.warn("Failed to get users for room #" + user.roomId);
        response.userIds.forEach(roomUserId => {
          if (!users.hasOwnProperty(roomUserId)) return;
          var socketUser = users[roomUserId];

          if (roomUserId != userId && socketUser.roomId == user.roomId) {
            socketUser.socket.emit("unlikeMessage", {msgId: data.msgId, userId: userId});
          }
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

    var userId = result.insertId;

     // Save the users details
    users[userId] = {
      id: userId,
      name: null,
      icon: null,
      roomId: null,
      score: 0,
      state: vars.UserStates.idle,
      socket: socket
    };

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

var server = http.listen(process.env.PORT || 3000, () => {
  console.log("Listening on port %d.", server.address().port);
});
