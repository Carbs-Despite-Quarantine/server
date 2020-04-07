// A selection of Font Awesome icons suitable for profile pictures
export const Icons: Array<string> = ["apple-alt",  "candy-cane", "carrot", "cat", "cheese", "cookie", "crow", "dog", "dove", "dragon", "egg", "fish", "frog", "hamburger", "hippo", "horse", "hotdog", "ice-cream", "kiwi-bird", "leaf", "lemon", "otter", "paw", "pepper-hot", "pizza-slice", "spider"];

// Contains the same packs as the database, but this is quicker to access for validation
export const Packs: Array<string> = [ "RED", "BLUE", "GREEN", "ABSURD", "BOX", "PROC", "RETAIL", "FANTASY", "PERIOD", "COLLEGE", "ASS", "2012-HOL", "2013-HOL", "2014-HOL", "90s", "GEEK", "SCIFI", "WWW", "SCIENCE", "FOOD", "WEED", "TRUMP", "DAD", "PRIDE", "THEATRE", "2000s", "HIDDEN", "JEW", "CORONA" ];

// The number of white cards in a standard CAH hand
export const HandSize: number = 7;

export enum UserState {
  "idle" = 1,           // The user is idle
  "choosing",      // The user is selecting a white card
  "czar",          // The user is the card czar
  "winner",        // The user won the most recent round
  "inactive"       // The user has left their game
}

export enum RoomState {
  "new" = 1,            // The room has been created but not set up
  "choosingCards", // Players are chosing responses
  "readingCards",  // The czar is reading responses
  "viewingWinner"  // A winner has been selected and the next round will begin soon
}

export enum CardState {
  "hand" = 1,           // The card is in a players hand
  "selected",      // The card has been submitted
  "revealed",      // The card has been flipped over and read
  "played"         // The card has been removed from play
}

export class User {
  id: number;
  state: UserState;

  name: string | undefined;
  icon: string | undefined;

  constructor(id: number, icon?: string, name?: string) {
    this.id = id;
    this.state = UserState.idle;

    this.icon = icon;
    this.name = name;
  }
}

export class RoomUser extends User {
  roomId: number;
  score: number;

  constructor(id: number, icon: string | undefined, name: string | undefined, state: UserState, roomId: number, score: number) {
    super(id, icon, name);
    this.state = state;

    this.roomId = roomId;
    this.score = score;
  }
}

export class Room {
  id: number;
  token: string;
  state: RoomState;

  edition: string | undefined;
  rotateCzar: boolean | undefined;
  curPrompt: number | undefined;
  selectedResponse: number | undefined;

  messages: Record<number, Message> = {};

  constructor(id: number, token: string, state?: RoomState,
              edition?: string, rotateCzar?: boolean,
              curPrompt?: number, selectedResponse?: number) {
    this.id = id;
    this.token = token;

    if (state && state != RoomState.new) {
      this.state = state;
      this.edition = edition;
      this.rotateCzar = rotateCzar;
      this.curPrompt = curPrompt;
      this.selectedResponse = selectedResponse;
    } else {
      this.state = RoomState.new;
    }
  }
}

export class Card {
  id: number;
  text: string;

  constructor(id: number, text: string) {
    this.id = id;
    this.text = text;
  }
}

export class BlackCard extends Card {
  draw: number;
  pick: number;

  constructor(id: number, text: string, draw: number, pick: number) {
    super(id, text);
    this.draw = draw;
    this.pick = pick;
  }
}

export class Message {
  id: number;
  userId: number;
  content: string;
  isSystemMsg: boolean;
  likes: Array<number>;

  constructor(id: number, userId: number, content: string, isSystemMsg: boolean, likes: Array<number>) {
    this.id = id;
    this.userId = userId;
    this.content = content;
    this.isSystemMsg = isSystemMsg;
    this.likes = likes;
  }
}