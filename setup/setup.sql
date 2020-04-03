CREATE table versions (
	id VARCHAR(8) NOT NULL,
	name VARCHAR(32) NOT NULL,
	type ENUM('base', 'box', 'pack') NOT NULL,
	PRIMARY KEY (id)
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

CREATE TABLE users (
	id INT NOT NULL AUTO_INCREMENT,
	name VARCHAR(16),
	icon VARCHAR(16),
	PRIMARY KEY (id)
);

CREATE TABLE rooms (
	id INT NOT NULL AUTO_INCREMENT,
	edition VARCHAR(8) NOT NULL,
	PRIMARY KEY (id)
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

CREATE TABLE room_users (
	user_id INT NOT NULL,
	room_id INT NOT NULL,
	PRIMARY KEY (user_id, room_id),
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
	PRIMARY KEY (room_id, card_id),
	FOREIGN KEY (room_id)
		REFERENCES rooms (id)
		ON DELETE CASCADE
);

INSERT INTO versions (id, name, type) VALUES
	( 'US', 'American Edition', 'base' ),
	( 'UK', 'UK Edition', 'base' ),
	( 'CA', 'Canadian Edition', 'base' ),
	( 'AU', 'Australian Edition', 'base' ),
	( 'INTL', 'International Edition', 'base' ),
	( 'LAB', 'Online Edition', 'base' ),
	( 'KS', 'Kickstarter Edition', 'base' ),
	( 'RED', 'Red Box', 'box' ),
	( 'GREEN', 'Green Box', 'box' ),
	( 'BLUE', 'Blue Box', 'box' ),
	( 'ABSURD', 'Absurd Box', 'box' ),
	( 'PROC', 'Procedural Box', 'box' )
;

INSERT INTO black_cards (id, pack, text, draw, pick) VALUES 
	(0, 'base', '______ + ______ = ______.', 2, 3),
	(1, 'base', '______ is a slippery slope that leads to ______.', 0, 2),
	(2, 'base', '______ would be woefully incomplete without ______.', 0, 2),
	(3, 'base', '______: good to the last drop.', 0, 1)
;

INSERT INTO black_cards_link (card_id, edition) VALUES
	(0, 'US'), (0, 'UK'), (0, 'CA'), (0, 'AU'), (0, 'KS'),
	(1, 'US'), (1, 'UK'), (1, 'CA'), (1, 'AU'), (1, 'KS'),
	(2, 'INTL'),
	(3, 'KS')
;