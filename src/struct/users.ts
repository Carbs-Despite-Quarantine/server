export enum UserState {
  "idle" = 1,           // The user is idle
  "choosing",      // The user is selecting a white card
  "czar",          // The user is the card czar
  "winner",        // The user won the most recent round
  "inactive"       // The user has left their game
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