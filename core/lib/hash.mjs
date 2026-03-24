import crypto from "node:crypto";

export function sha1(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}

export function stableId(...parts) {
  return sha1(parts.filter((part) => part !== undefined && part !== null).join("::"));
}
