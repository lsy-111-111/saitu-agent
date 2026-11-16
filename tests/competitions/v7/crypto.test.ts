import { describe,expect,it } from "vitest";
import { createDecisionTokenV7,sealV7,sessionKeyV7,unsealV7,verifyDecisionTokenV7 } from "@/lib/competitions/v7/crypto";

describe("v7 encrypted identity and recovery tokens",()=>{
  it("binds encrypted personal input to its exact run, and detects modification",()=>{
    const sealed=sealV7("run:one",{text:"我会Python，每周3小时"});
    expect(sealed.ciphertext.toString()).not.toContain("Python");
    expect(unsealV7("run:one",sealed)).toEqual({text:"我会Python，每周3小时"});
    expect(()=>unsealV7("run:two",sealed)).toThrow();
    const damaged=Buffer.from(sealed.ciphertext);damaged[0]^=1;
    expect(()=>unsealV7("run:one",{...sealed,ciphertext:damaged})).toThrow();
  });
  it("keeps tokens stable across background work while separating profile generations",()=>{
    const identity={id:sessionKeyV7("one"),sessionId:"one",generation:0,expiresAt:Date.now()+120000};
    const token=createDecisionTokenV7(identity);
    expect(createDecisionTokenV7({...identity})).toBe(token);
    expect(verifyDecisionTokenV7(token)).toMatchObject(identity);
    expect(createDecisionTokenV7({...identity,generation:1})).not.toBe(token);
    expect(verifyDecisionTokenV7(token+"x")).toBeNull();
    expect(verifyDecisionTokenV7(createDecisionTokenV7({...identity,expiresAt:Date.now()-1}))).toBeNull();
  });
});
