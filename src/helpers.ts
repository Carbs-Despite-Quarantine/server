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