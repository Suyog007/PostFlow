import { hashPassword } from "../src/server/crypto";

const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error("usage: npm run hash-password -- 'a password of 10+ characters'");
  process.exit(1);
}
console.log(hashPassword(pw));
