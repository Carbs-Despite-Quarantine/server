export enum CardState {
  "hand" = 1,           // The card is in a players hand
  "selected",      // The card has been submitted
  "revealed",      // The card has been flipped over and read
  "played",        // The card has been removed from play
  "winner"         // The card won the latest round (positioned after 'played' for backwards compat)
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