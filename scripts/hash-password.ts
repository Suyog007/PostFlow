import { hashPassword } from "../src/server/crypto";

const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error("Usage: npm run hash-password -- '<password of at least 10 characters>'");
  process.exit(1);
}
console.log(hashPassword(pw));
