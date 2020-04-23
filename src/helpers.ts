/*************
 * Constants *
 *************/

// A selection of Font Awesome icons suitable for profile pictures
export const Icons: Array<string> = [
  "apple-alt",  "candy-cane", "carrot", "cat", "cheese", "cookie", "crow", "dog", "dove", "dragon", "egg", "fish",
  "frog", "hamburger", "hippo", "horse", "hotdog", "ice-cream", "kiwi-bird", "leaf", "lemon", "otter", "paw",
  "pepper-hot", "pizza-slice", "spider", "holly-berry", "bat", "deer", "duck", "elephant", "monkey", "narwhal",
  "pig", "rabbit", "sheep", "squirrel", "turtle", "whale", "salad", "pumpkin", "wheat", "burrito", "cheese-swiss",
  "croissant", "drumstick", "egg-fried", "french-fries", "gingerbread-man", "hat-chef", "meat", "pie", "popcorn",
  "sausage", "steak", "taco", "turkey"
];

// Contains the same packs as the database, but this is quicker to access for validation
export const Packs: Array<string> = [ "RED", "BLUE", "GREEN", "ABSURD", "BOX", "PROC", "RETAIL", "FANTASY", "PERIOD",
  "COLLEGE", "ASS", "2012-HOL", "2013-HOL", "2014-HOL", "90s", "GEEK", "SCIFI", "WWW", "SCIENCE", "FOOD", "WEED",
  "TRUMP", "DAD", "PRIDE", "THEATRE", "2000s", "HIDDEN", "JEW", "CORONA", "DISNEY" ];

/*******************
 * Data Validation *
 *******************/

export function validateHash(hash: any, length: number): boolean {
  return typeof hash === "string" && hash.length === length;
}

export function validateUInt(uint: any) {
  return typeof uint === "number" && uint % 1 === 0 && uint >= 0;
}

export function validateBoolean(boolean: any) {
  return typeof boolean === "boolean";
}

export function validateObject(object: any) {
  return typeof object === "object";
}

export function validateString(string: any) {
  return typeof string === "string" && string.length > 0;
}

/*******************
 * General Helpers *
 *******************/

// generate a random hash
export function makeHash(length: number) {
  let result = "";
  let hexChars = "0123456789abcdefghijklmnopqrstuvwxyz";
  for (let i = 0; i < length; i += 1) {
    result += hexChars[Math.floor(Math.random() * hexChars.length)];
  }
  return result;
}

// Replace </> characters with 'safe' encoded counterparts
export function stripHTML(string: string) {
  return string.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}