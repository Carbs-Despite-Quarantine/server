USE `cah-online`;

DROP TABLE IF EXISTS room_white_cards, room_black_cards;
DROP TABLE IF EXISTS message_likes, messages, room_users, room_packs, black_cards_link, white_cards_link;
DROP TABLE IF EXISTS rooms, users, black_cards, white_cards, editions, packs;

CREATE table editions (
	id VARCHAR(8) NOT NULL,
	name VARCHAR(32) NOT NULL,
	PRIMARY KEY (id)
);

CREATE table packs (
	id VARCHAR(8) NOT NULL,
	name VARCHAR(32) NOT NULL,
	PRIMARY KEY(id)
);

CREATE TABLE black_cards ( 
  id INT NOT NULL,
  pack VARCHAR(8) NOT NULL,
  text VARCHAR(160) NOT NULL, 
  draw INT NOT NULL DEFAULT 0,
  pick INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id)
);

CREATE table black_cards_link (
  card_id INT NOT NULL,
  edition VARCHAR(8) NOT NULL,
  PRIMARY KEY(card_id, edition)
);

CREATE TABLE white_cards ( 
  id INT NOT NULL, 
  pack VARCHAR(8) NOT NULL,
  text VARCHAR(160) NOT NULL,
  PRIMARY KEY (id)
);

CREATE table white_cards_link (
  card_id INT NOT NULL,
  edition VARCHAR(8) NOT NULL,
  PRIMARY KEY(card_id, edition)
);

CREATE TABLE rooms (
	id INT NOT NULL AUTO_INCREMENT,
	token VARCHAR(8) NOT NULL,
	edition VARCHAR(8),
	rotate_czar BOOLEAN DEFAULT FALSE,
	cur_czar INT NOT NULL,
	PRIMARY KEY (id)
);

CREATE TABLE users (
	id INT NOT NULL AUTO_INCREMENT,
	room_id INT,
	name VARCHAR(16),
	icon VARCHAR(16),
	score INT NOT NULL DEFAULT 0,
	PRIMARY KEY (id),
	FOREIGN KEY (room_id)
		REFERENCES rooms (id)
		ON DELETE CASCADE
);

CREATE TABLE messages (
	id INT NOT NULL AUTO_INCREMENT,
	room_id INT NOT NULL,
	user_id INT NOT NULL,
	content VARCHAR(256) NOT NULL,
	system_msg BOOLEAN DEFAULT FALSE,
	sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	FOREIGN KEY (room_id)
		REFERENCES rooms (id)
		ON DELETE CASCADE
);

CREATE TABLE message_likes (
	message_id INT NOT NULL,
	user_id INT NOT NULL,
	added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (message_id, user_id),
	FOREIGN KEY (message_id)
		REFERENCES messages (id)
		ON DELETE CASCADE
);

CREATE TABLE room_packs (
	room_id INT NOT NULL,
	pack_id VARCHAR(8) NOT NULL,
	FOREIGN KEY (room_id)
		REFERENCES rooms (id)
		ON DELETE CASCADE
);

CREATE TABLE room_black_cards (
	room_id INT NOT NULL,
	card_id INT NOT NULL,
	PRIMARY KEY (room_id, card_id),
	FOREIGN KEY (room_id)
		REFERENCES rooms (id)
		ON DELETE CASCADE
);

CREATE TABLE room_white_cards (
	room_id INT NOT NULL,
	card_id INT NOT NULL,
	user_id INT,
	PRIMARY KEY (room_id, card_id),
	FOREIGN KEY (room_id)
		REFERENCES rooms (id)
		ON DELETE CASCADE
);

INSERT INTO editions (id, name) VALUES
	( 'US', 'American Edition' ),
	( 'UK', 'UK Edition' ),
	( 'CA', 'Canadian Edition' ),
	( 'AU', 'Australian Edition' ),
	( 'INTL', 'International Edition' ),
	( 'KS', 'Kickstarter Edition' ),
	( 'FAMILY', 'Family Edition' )
;