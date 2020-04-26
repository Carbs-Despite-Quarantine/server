import mysql = require("mysql");
import helpers = require("./helpers");
import {UserState, User, RoomUser} from "./struct/users";
import {RoomState, Room, Message} from "./struct/rooms";
import {Card, BlackCard, CardState} from "./struct/cards";

/**************
 * Connection *
 **************/

export const con = mysql.createConnection({
  host: process.env.MYSQL_HOST || "localhost",
  user: process.env.MYSQL_USER || "cah-online",
  password: process.env.MYSQL_PASS || "password",
  database: process.env.MYSQL_DB || "cah-online"
});

con.connect((err: mysql.MysqlError) => {
  if (err) throw err;
  console.log("Connected to the MySQL Database!");
});

/*********
 * Users *
 *********/

function getRawUser(userId: number, fn: (err?: string, baseUser?: any) => void): void {
  con.query(`SELECT * FROM users WHERE id = ?;`, [userId], (err, results: Array<any>) => {
    if (err) {
      console.warn("Failed to get user #" + userId + ":", err);
      return fn("MySQL Error");
    } else if (results.length === 0) return fn("Invalid User ID");
    fn(undefined, results[0]);
  });
}

export function parseUser(rawUser: any): User {
  if (rawUser.room_id) {
    return new RoomUser(rawUser.id, rawUser.admin, rawUser.icon, rawUser.name, rawUser.state, rawUser.room_id, rawUser.score);
  } else return new User(rawUser.id, rawUser.admin, rawUser.icon, rawUser.name);
}

export function getUser(userId: number, fn: (err?: string, user?: User) => void): void {
  getRawUser(userId, (err, rawUser) => {
    if (err || !rawUser) return fn(err);
    return fn(undefined, parseUser(rawUser));
  });
}

export function getRoomUser(userId: number, fn: (err?: string, user?: RoomUser) => void): void {
  getUser(userId, (err, user) => {
    if (err || !user) return fn(err);
    else if (!(user instanceof RoomUser)) return fn("Not in a room");
    fn(undefined, user);
  })
}

export function setUserIcon(userId: number, icon: string): void {
  con.query(`UPDATE users SET icon = ? WHERE id = ?;`,
  [icon, userId],(err) => {
    if (err) return console.warn("Failed to set icon for user #" + userId + ":", err);
    console.debug("Set icon for user #" + userId + " to '" + icon + "'");
  });
}

export function setUserName (userId: number, name: string): void {
  con.query(`UPDATE users SET name = ? WHERE id = ?;`,
  [name, userId],(err) => {
    if (err) return console.warn("Failed to set name for user #" + userId + ":", err);
    console.debug("Set name for user #" + userId + " to '" + name + "'");
  });
}

export function setUserState(userId: number, state: UserState): void {
  con.query(`UPDATE users SET state = ? WHERE id = ?;`,
  [state, userId],(err) => {
    if (err) return console.warn("Failed to set state for user #" + userId + ":", err);
  });
}

export function setWinner(userId: number, score: number, alsoNextCzar=true): void {
  con.query(`UPDATE users SET score = ?, state = ${alsoNextCzar ? UserState.winnerAndNextCzar : UserState.winner} WHERE id = ?;`,
  [score, userId],(err) => {
    if (err) return console.warn("Failed to set score for user #" + userId + ":", err);
    console.debug("Set score for user #" + userId + " to '" + score + "'");
  });
}

export function addUserToRoom(userId: number, roomId: number, state: UserState, admin?: boolean, fn?: (err?: string) => void): void {
  let sql = `UPDATE users SET room_id = ?, state = ?, admin = ? WHERE id = ?;`;
  con.query(sql, [roomId, state, admin == true, userId], (err) => {
    if (err) {
      if (fn) fn("MySQL Error");
      return console.warn("Failed to add user #" + userId + " to room #" + roomId + ":", err);
    }
    console.debug("Added user #" + userId + " to room #" + roomId + " with state '" + state + "'");
    if (fn) fn();
  });
}

export function deleteUser(userId: number): void {
  con.query(`DELETE FROM users WHERE id = ?;`, [
    userId
  ], (err) => {
    if (err) return console.warn("Failed to delete user #" + userId + ":", err);
    console.log("Deleted user #" + userId);
  });
}

/*********
 * Rooms *
 *********/

export function getRoom(roomId: number, fn: (err?: string, room?: Room) => void): void {
  if (!roomId) return fn("Room ID is required");
  con.query(`
    SELECT 
      token, 
      admin_token AS adminToken,
      edition, 
      open,
      flared_user AS flaredUser,
      rotate_czar AS rotateCzar, 
      cur_prompt AS curPrompt, 
      state, 
      selected_response AS selectedResponse
    FROM rooms
    WHERE id = ?;
  `, [roomId],(err, results) => {
    if (err) {
      console.warn("Failed to get room #" + roomId + ":", err);
      return fn("MySQL Error");
    } else if (results.length === 0) {
      return fn("Invalid Room ID");
    }
    fn(undefined, new Room(
      roomId, results[0].token, results[0].adminToken, results[0].state,
      results[0].flaredUser, results[0].edition, results[0].open,
      results[0].rotateCzar, results[0].curPrompt, results[0].selectedResponse)
    );
  });
}

export function getRoomWithToken(roomId: number, token: string, fn: (err?: string, room?: Room) => void): void {
  if (!helpers.validateHash(token, 8)) return fn("Token is required");
  getRoom(roomId, (err, room) => {
    if (err || !room) return fn(err);
    if (room.token !== token) return fn("Invalid Token");
    return fn(undefined, room);
  });
}

export function getRoomUsers(roomId: number, fn: (error?: string, users?: Record<number, RoomUser>) => void): void {
  con.query(`SELECT id, name, icon, score, state FROM users WHERE room_id = ?;`, [
    roomId
  ],(err, results: Array<any>) => {
    if (err) {
      console.warn("Failed to get users for room #" + roomId + ":", err);
      return fn("MySQL Error");
    } else if (results.length == 0) {
      return fn(undefined, {});
    }

    let users: Record<number, RoomUser> = {};

    // Convert arrays to objects (TODO: efficiency?)
    results.forEach(row => {
      users[row.id] = new RoomUser(row.id, row.admin, row.icon, row.name, row.state, roomId, row.score);
    });

    fn(undefined, users);
  });
}

export function deleteRoom(roomId: number): void {
  con.query(`DELETE FROM rooms WHERE id = ?;`, [
    roomId
  ], (err) => {
    if (err) return console.warn("Failed to delete room #" + roomId + ":", err);
    console.log("Deleted room #" + roomId);
  });
}

export function setRoomState(roomId: number, state: RoomState, fn?: (error?: string) => void): void {
  con.query(`UPDATE rooms SET state = ?, selected_response = null WHERE id = ?;`, [state, roomId], (err) => {
    if (err) {
      if (fn) fn("MySQL Error");
      return console.warn("Failed to set state for room #" + roomId + ":", err);
    }
    console.debug("Set state for room #" + roomId + " to '" + state + "'");
    if (fn) fn();
    updateRoom(roomId);
  });
}

export function countSubmittedCards(roomId: number, fn: (err?: string, count?: number) => void) {
  // Check if we have received enough answers to start reading them
  con.query(`
      SELECT user_id AS userId
      FROM room_white_cards
      WHERE room_id = ? AND state = ${CardState.selected}                
    `, [roomId], (err, results) => {
    if (err) {
      console.warn(`Failed to get selected cards for room #${roomId}:`, err);
      return fn("MySQL Error");
    }

    // Count the number of unique users who have submitted card(s)
    let submittedUsers: number[] = [];
    results.forEach((result: any) => {
      if (!submittedUsers.includes(result.userId)) submittedUsers.push(result.userId);
    });

    return fn(undefined, submittedUsers.length);
  });
}

export function addPacks(roomId: number, packs: string[], fn: (err?: string, validPacks?: string[]) => void): void {
  let packsSQL: string[] = [];
  let validPacks: string[] = [];

  if (packs.length > 0) {
    packs.forEach((packId: string) => {
      if (helpers.Packs.includes(packId)) {
        validPacks.push(packId);
        packsSQL.push(`(${roomId}, '${packId}')`);
      }
    });

    let sql = `INSERT INTO room_packs (room_id, pack_id) VALUES `;
    con.query( sql + packsSQL.join(", ") + ";", (err) => {
      if (err) {
        console.warn("Failed to add packs to room #" + roomId + ":", err);
        return fn("MySQL Error");
      }
      fn(undefined, validPacks);
    });
  } else fn(undefined, []);
}

// Create a new room with a random edition and a random selection of packs
// However, the room will always be open and rotateCzar will be disabled
export function createRandomRoom(fn: (err?: string, id?: number, token?: string) => void) {
  let token = helpers.makeHash(8);
  let adminToken = helpers.makeHash(8);
  con.query(`
    INSERT INTO rooms (
      token, admin_token, open,
      edition, rotate_czar, state
    ) VALUES (
      ?, ?, TRUE,
      (
        SELECT id FROM editions
        ORDER BY RAND()
        LIMIT 1
      ), 
      0, ${RoomState.choosingCards}
    );
  `, [token, adminToken], (err, result) => {
    if (err) {
      console.warn("Failed to create open room for immediate join:", err);
      return fn("MySQL Error");
    }
    let roomId = result.insertId;

    getBlackCard(roomId, (err, blackCard) => {
      if (err) {
        console.warn("Failed to set prompt for new open room #" + roomId + ":", err);
        return fn("MySQL Error");
      }

      let packs: string[] = [];
      helpers.Packs.forEach((pack) => {
        if (Math.random() > 0.5) packs.push(pack);
      });

      // We don't particularly care if this fails, but we need to wait for it to
      // finish so that future methods run on the room will use the correct packs
      addPacks(roomId, packs, () => {
        fn(undefined, roomId, token);
      });
    });
  });
}

/********
 * Chat *
 ********/

export function getLatestMessages(roomId: number, limit: number, fn: (err?: string, messages?: Record<number, Message>) => void): void {
  con.query(`
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
    LIMIT ?;
  `, [roomId, limit],(err, results: Array<any>) => {
    if (err) {
      console.warn("Failed to get messages for room #" + roomId + ":", err);
      return fn("MySQL Error");
    }
    let messages: Record<number, Message> = {};

    results.forEach(row => {
      messages[row.id] = new Message(row.id, row.userId, row.content, row.isSystemMsg, row.likes ? row.likes.split(",") : []);
    });
    fn(undefined, messages);
  });  
}

export function createMessage(roomId: number, userId: number, content: any, isSystemMsg: boolean, fn: (error?: string, message?: Message) => void): void {
  if (!helpers.validateString(content)) return fn("Invalid Message");
  content = helpers.stripHTML(content);

  con.query(`
    INSERT INTO messages (room_id, user_id, content, system_msg) 
    VALUES (?, ?, ?, ?);
  `, [roomId, userId, content, isSystemMsg], (err, result) => {
    if (err) {
      console.warn("Failed to create message:", err);
      return fn("MySQL Error");
    }
    let msgId = result.insertId;

    fn(undefined, new Message(msgId, userId, content, isSystemMsg, []));
    updateRoom(roomId);
  });
}

export function updateRoom(roomId: number) {
  con.query(`
    UPDATE rooms
    SET last_active = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [roomId], (err) => {
    if (err) console.warn("Failed to update last active time for room #" + roomId + ":", roomId);
  });
}

/*********
 * Cards *
 *********/

function getCardByID(id: number, black:boolean, fn: (error?: string, card?: any) => void): void {
  if (!helpers.validateUInt(id)) return fn("Card ID must be an int");
  let color = black ? "black" : "white";
  con.query(`SELECT * FROM ${color}_cards WHERE id = ?;`,
  [id], (err, results) => {
    if (err) {
      console.warn("Failed to get " + color + " card #" + id + ":" + err);
      return fn("MySQL Error");
    } else if (results.length === 0) {
      console.warn("Didn't find " + color + " card id with #" + id);
      return fn("Invalid Card ID");
    }
    return fn(undefined, results[0]);
  });
}

function getCards(roomId: number, black: boolean, count: number, fn: (error?: string, cards?: Array<any>) => void): void {
  if (!helpers.validateUInt(roomId)) return fn("Invalid Room ID");
  if (!helpers.validateUInt(count) || count < 1) count = 1;
  let color = black ? "black" : "white";

  con.query(`
    SELECT *
    FROM ${color}_cards
    WHERE id IN (
      SELECT card_id 
      FROM ${color}_cards_link 
      WHERE edition IN (
        SELECT edition
        FROM rooms
        WHERE id = ${roomId}
      )
      UNION
      SELECT id
      FROM ${color}_cards
      WHERE pack IN (
        SELECT pack_id
        FROM room_packs
        WHERE room_id = ${roomId}
      )
    ) AND id NOT IN (
      SELECT card_id
      FROM room_${color}_cards
      WHERE room_id = ${roomId}
    ) ${black ? "AND draw = 0 AND pick < 3" : ""}
    ORDER BY RAND()
    LIMIT ${count};
  `, (err, results) => {
    if (err) {
      console.warn(`Failed to get ${color} card:`, err);
      return fn("MySQL Error");
    } else if (results.length === 0) return fn("No cards left!");
    return fn(undefined, results);
  });
}

export function getBlackCard(roomId: number, fn: (error?: string, card?: BlackCard) => void): void {
  getCards(roomId, true, 1, (err, cards) => {
    if (err || !cards) return fn(err);

    let card = cards[0];

    con.query(`
      INSERT INTO room_black_cards (card_id, room_id) VALUES (?, ?)
    `, [card.id, roomId], (err) => {
      // aTODO: this logs an error if the last two users in a room leave in quick succession
      // since we try to get a new black card when the czar leaves,
      // but by the time we have the new card, the room has been deleted
      if (err) return console.warn("Failed to mark black card as used:", err);
    });

    con.query(`
      UPDATE rooms SET cur_prompt = ? WHERE id = ?
    `, [card.id, roomId], (err) => {
      if (err) return console.warn("Failed to update prompt for room #" + roomId + ":", err);

      fn(undefined, new BlackCard(card.id, card.text, card.draw, card.pick));
    });
  });
}

export function getBlackCardByID(id: number, fn: (error?: string, card?: BlackCard) => void): void {
  getCardByID(id, true, (err, card) => {
    if (err || !card) return fn(err);
    fn(undefined, new BlackCard(card.id,card.text,card.draw, card.pick));
  });
}

export function getWhiteCards(roomId: number, userId: number, count: number, fn: (error?: string, cards?: Record<number, Card>) => void): void {
  if (!helpers.validateUInt(userId)) return fn("Invalid User ID");
  getCards(roomId, false, count, (err, rawCards) => {
    if (err || !rawCards) return fn(err);

    let cards: Record<number, Card> = {};
    let cardsSql: Array<string> = [];

    rawCards.forEach(rawCard => {
      cardsSql.push(`(${rawCard.id}, ${roomId}, ${userId})`);
      cards[rawCard.id] = new Card(rawCard.id, rawCard.text);
    });

    // Prevent the chosen cards from being reused
    let sql = `INSERT INTO room_white_cards (card_id, room_id, user_id) VALUES `;
    con.query(sql + cardsSql.join(", ") + ";", (err) => {
      if (err) {
        console.warn("Failed to mark white card as used... trying again");
        return getWhiteCards(roomId, userId, count, fn);
      } else fn(undefined, cards);
    });
  });
}

export function getWhiteCardByID(id: number, fn: (error?: string, card?: Card) => void): void {
  getCardByID(id, false, (err, card) => {
    if (err || !card) return fn(err);
    fn(undefined, new Card(card.id, card.text));
  });
}

export function setCardState(state: CardState, roomId: number, cardId: number, userId?: number, oldState?: CardState, submitNum?: number, fn?: (err?: string) => void): void {
  con.query(`
    UPDATE room_white_cards 
    SET state = ${state}, submission_num = ?
    WHERE room_id = ? AND card_id = ? ${userId ? ("AND user_id = " + userId) : ""} ${oldState ? ("AND state = " + oldState) : ""};
  `,  [submitNum || 0, roomId, cardId], (err) => {
    if (err) {
      console.warn("Failed to set card #" + cardId + " to state #" + state + ":", err);
      if (fn) return fn("MySQL Error");
    } else if (fn) return fn();
  });
}

function submitCardsRecursive(user: RoomUser, cards: {[pos: string]: number}, cardNum: number, fn: (err?: string) => void): void {
  setCardState(CardState.selected, user.roomId, cards[cardNum], user.id, CardState.hand, cardNum, (err) => {
    if (err) return fn(err);

    if (cardNum + 1 < Object.keys(cards).length) {
      submitCardsRecursive(user, cards, cardNum + 1, fn);
    } else fn();
  });
}

export function submitCards(user: RoomUser, cards: {[pos: string]: number}, fn: (err?: string) => void): void {
  submitCardsRecursive(user, cards, 0, fn);
}

function groupAnswersRecursive(roomId: number, submittedUsers: number[], group: number, fn: (err?: string, groups?: number) => void): void {
  const submissionUser = submittedUsers[group];
  con.query(`
    UPDATE room_white_cards
    SET submission_group = ${group}
    WHERE room_id = ${roomId} AND state = ${CardState.selected} AND user_id = ${submissionUser};
  `, (err) => {
    if (err) {
      console.warn("Failed to set group for submission #" + group + " in room #" + roomId + ":", err);
      fn("MySQL Error");
    }
    if (group + 1 < submittedUsers.length) groupAnswersRecursive(roomId, submittedUsers, group + 1, fn);
    else fn(undefined, submittedUsers.length);
  });
}

export function groupAnswers(roomId: number, fn: (err?: string, groups?: number) => void): void {
  con.query(`
    SELECT user_id AS userId, card_id AS cardId
    FROM room_white_cards
    WHERE room_id = ? AND state = ${CardState.selected}
    ORDER BY RAND();
  `, [roomId], (err, results) => {
    if (err) {
      console.warn("Failed to get selected cards for room #" + roomId + ":", err);
      return fn("MySQL Error");
    }

    let submittedUsers: number[] = [];
    results.forEach((result: any) => {
      if (!submittedUsers.includes(result.userId)) submittedUsers.push(result.userId);
    });

    if (submittedUsers.length < 2) return fn("Not enough cards submitted!");

    groupAnswersRecursive(roomId, submittedUsers, 0, fn);
  });
}