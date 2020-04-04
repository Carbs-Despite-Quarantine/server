const mysql = require("mysql");
const helpers = require("./helpers");

var db = mysql.createConnection({
  host: process.env.MYSQL_HOST || "localhost",
  user: process.env.MYSQL_USER || "cah-online",
  password: process.env.MYSQL_PASS || "password",
  database: process.env.MYSQL_DB || "cah-online"
});

db.connect((err) => {
  if (err) throw err;
  console.log("Connected to the MySQL Database!");
});

// Pass through the query method
exports.query = (sql, params, fn) => {
  db.query(sql, params, fn);
};

exports.setUserIcon = (userId, icon) => {
  db.query(`UPDATE users SET icon = ? WHERE id = ?;`, [
    icon,
    userId
  ],(err, result) => {
    if (err) return console.warn("Failed to set icon for user #" + userId + ":", err);
    console.debug("Set icon for user #" + userId + " to '" + icon + "'");
  });
};

exports.setUserName = (userId, name) => {
  db.query(`UPDATE users SET name = ? WHERE id = ?;`, [
    name,
    userId
  ],(err, result) => {
    if (err) return console.warn("Failed to set name for user #" + userId + ":", err);
    console.debug("Set name for user #" + userId + " to '" + name + "'");
  });
}

exports.addUserToRoom = (userId, roomId) => {
  db.query(`INSERT INTO room_users (user_id, room_id) VALUES (?, ?);`, [
    userId,
    roomId
  ], (err, result) => {
    if (err) return console.warn("Failed to add user #" + userId + " to room #" + roomId + ":", err);
    console.debug("Added user #" + userId + " to room #" + roomId);
  });
}

exports.getRoomUsers = (roomId, fn) => {
  var sql = `
    SELECT id, name, icon
    FROM users 
    WHERE id IN (
      SELECT user_id
      FROM room_users
      WHERE room_id = ?
    );
  `;
  db.query(sql, [
    roomId
  ],(err, results, fields) => {
    if (err) {
      console.warn("Failed to get users for room #" + roomId + ":", err);
      return fn({error: "MySQL Error"});
    }

    var roomUsers = {};
    var roomUserIds = [];

    // Convert arrays to objects (TODO: efficiency?)
    results.forEach(row => {
      roomUserIds.push(row.id);
      roomUsers[row.id] = {
        id: row.id,
        name: row.name,
        icon: row.icon
      };
    });
    fn({users: roomUsers, userIds: roomUserIds});
  });
}

exports.getRoom = (roomId, fn) => {
  if (!roomId) return fn({error: "Room ID is required"});
  var sql = `
    SELECT token, edition, rotate_czar as rotateCzar
    FROM rooms
    WHERE id = ?;
  `;
  db.query(sql, [
    roomId
  ],(err, results, fields) => {
    if (err) {
      console.warn("Failed to get room #" + roomId + ":", err);
      return fn({error: "MySQL Error"});
    } else if (results.length == 0) {
      return fn({error: "Invalid Room ID"});
    }
    fn({
      id: roomId,
      token: results[0].token,
      edition: results[0].edition,
      rotateCzar: results[0].rotateCzar
    });
  });
}

exports.getRoomWithToken = (roomId, token, fn) => {
  if (!helpers.validateHash(token, 8)) return fn({error: "Token is required"});
  exports.getRoom(roomId, room => {
    if (room.error) return fn(room);
    if (room.token != token) return fn({error: "Invalid Token"});
    return fn(room);
  });
}

exports.getRoomMessages = (roomId, limit, fn) => {
  var sql = `
    SELECT 
      msg.id, 
      msg.user_id AS userId, 
      msg.content, 
      msg.system_msg AS isSystemMsg, 
      GROUP_CONCAT(likes.user_id SEPARATOR ',') AS likes
    FROM messages msg
    LEFT JOIN message_likes likes ON msg.id = likes.message_id
    WHERE room_id = ?
    GROUP BY msg.id
    ORDER BY msg.id DESC
    LIMIT ?;`;
  db.query(sql, [
    roomId,
    limit
  ],(err, results, fields) => {
    if (err) {
      console.warn("Failed to get messages for room #" + roomId + ":", err);
      return fn({error: "MySQL Error"});
    }
    var roomMessages = {};

    results.forEach(row => {
      roomMessages[row.id] = {
        id: row.id,
        userId: row.userId,
        content: row.content,
        isSystemMsg: row.isSystemMsg,
        likes: row.likes ? row.likes.split(",") : []
      }
    });
    fn({messages: roomMessages});
  });  
}

exports.createMessage = (userId, content, isSystemMsg, fn) => {
  if (!helpers.validateString(content)) return fn({error: "Invalid Message"});
  content = helpers.stripHTML(content);

  // We get the room ID from room_users in order to create the message
  db.query(`
    INSERT INTO messages (room_id, user_id, content, system_msg) 
    VALUES ((SELECT room_id FROM room_users WHERE user_id = ?), ?, ?, ?);
  `, [
    userId,
    userId,
    content,
    isSystemMsg
  ], (err, result) => {
    if (err) {
      console.warn("Failed to create message:", err);
      return fn({error: "MySQL Error"});
    }
    var msgId = result.insertId;

    // Create an object to represent the message on the client
    fn({
      id: msgId,
      userId: userId,
      content: content,
      isSystemMsg: isSystemMsg,
      likes: []
    });
  });
}

exports.deleteRoom = (roomId) => {
  db.query(`DELETE FROM rooms WHERE id = ?;`, [
    roomId
  ], (err, result) => {
    if (err) return console.warn("Failed to delete room #" + roomId + ":", err);
    console.log("Deleted room #" + roomId);
  });
}

exports.getBlackCard = (roomId) => {
  var sql = `
    SELECT id, text, draw, pick
    FROM black_cards
    WHERE id IN (
      SELECT card_id 
      FROM black_cards_link 
      WHERE edition IN (
        SELECT edition
        FROM rooms
        WHERE id = ?
      )
    ) AND id NOT IN (
      SELECT card_id
      FROM room_black_cards
      WHERE room_id = ?
    )
    ORDER BY RAND()
    LIMIT 1;
  `;
  db.query(sql, [roomId, roomId],(err, result, fields) => {
    if (err) return console.warn("Failed to get black card:", err);
    if (result.length > 0) {
      db.query(`INSERT INTO room_black_cards (card_id, room_id) VALUES (?, ?);`, [result[0].id, roomId])
    }
    console.debug("Got " + result.length + " results..");
    console.debug("Got black card: " + result[0].text + ` (draw ${result[0].draw} pick ${result[0].pick})}`)
  });
}