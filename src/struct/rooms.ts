export enum RoomState {
  "new" = 1,            // The room has been created but not set up
  "choosingCards", // Players are chosing responses
  "readingCards",  // The czar is reading responses
  "viewingWinner"  // A winner has been selected and the next round will begin soon
}

export class Room {
  id: number;
  token: string;
  adminToken: string | undefined;
  state: RoomState;
  flaredUser: number | undefined;

  edition: string | undefined;
  rotateCzar: boolean | undefined;
  open: boolean | undefined;
  curPrompt: number | undefined;
  selectedResponse: number | undefined;

  messages: Record<number, Message> = {};

  constructor(id: number, token: string, adminToken?: string, state?: RoomState,
              flaredUser?: number, edition?: string, rotateCzar?: boolean,
              open?: boolean, curPrompt?: number, selectedResponse?: number) {
    this.id = id;
    this.token = token;
    this.adminToken = adminToken;
    this.flaredUser = flaredUser;

    if (state && state != RoomState.new) {
      this.state = state;
      this.edition = edition;
      this.open = open;
      this.rotateCzar = rotateCzar;
      this.curPrompt = curPrompt;
      this.selectedResponse = selectedResponse;
    } else {
      this.state = RoomState.new;
    }
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