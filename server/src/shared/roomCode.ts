// No 0/O, 1/I/L: codes get read aloud and typed by hand.
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

export function generateRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const index = Math.min(Math.floor(random() * ROOM_CODE_ALPHABET.length), ROOM_CODE_ALPHABET.length - 1);
    code += ROOM_CODE_ALPHABET[index];
  }
  return code;
}

/** Trims and upper-cases user input so "ab7k2 " still finds room "AB7K2". */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}
