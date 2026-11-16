import { describe, expect, it } from "vitest";
import { createDecisionToken, verifyDecisionToken } from "@/lib/competitions/v6/decision-state";

describe("v6 decision token canonical signature boundary", () => {
  const state = () => ({id:"a".repeat(64),sessionId:"signed-session",generation:2,expiresAt:Date.now()+60_000});
  it("accepts the signed current generation and rejects an expired or changed payload", () => {
    const input=state(),token=createDecisionToken(input);
    expect(verifyDecisionToken(token)?.generation).toBe(2);
    expect(verifyDecisionToken(createDecisionToken({...input,expiresAt:Date.now()-1}))).toBeNull();
    const [,signature]=token.split(".");
    const changed=Buffer.from(JSON.stringify({...verifyDecisionToken(token),generation:3})).toString("base64url");
    expect(verifyDecisionToken(`${changed}.${signature}`)).toBeNull();
  });
  it("rejects alternate spellings that decode to the same valid HMAC bytes", () => {
    const token=createDecisionToken(state()),[payload,signature]=token.split(".");
    const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const alternate=signature.slice(0,-1)+alphabet[alphabet.indexOf(signature.at(-1)!)+1];
    expect(Buffer.from(alternate,"base64url")).toEqual(Buffer.from(signature,"base64url"));
    for(const forged of [`${payload}.${alternate}`,`${payload}.${signature}=`,`${payload}.${signature}!`,`${payload}.${signature}\n`,`${token}.extra`]) expect(verifyDecisionToken(forged)).toBeNull();
  });
});
