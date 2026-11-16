import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {chmodSync,mkdirSync,mkdtempSync,realpathSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from "node:fs";
import path from "node:path";
import {isActiveDecisionReleaseV7,readLocalDecisionPreviewV7} from "@/lib/competitions/v7/active-release";

const repository=realpathSync(process.cwd()),original={...process.env};
let fixture:string,release:string,control:string,current:string;
beforeEach(()=>{
  fixture=mkdtempSync(path.join(repository,"artifacts/fast24-20261109/B/preview-test-"));
  release=path.join(fixture,"app");control=path.join(fixture,"control");current=path.join(control,"current");
  mkdirSync(release,{mode:0o700});mkdirSync(control,{mode:0o700});symlinkSync(release,current);
  vi.spyOn(process,"cwd").mockReturnValue(release);
  process.env={...original,NODE_ENV:"production",SAITU_V7_LOCAL_PREVIEW:"1",NEXT_PUBLIC_SITE_URL:"http://127.0.0.1:3172",
    DATABASE_URL:"postgresql://synthetic@127.0.0.1:5432/synthetic",APP_RELEASE_DIR:release,SAITU_V7_WORKER_ACTIVE_LINK:current,SAITU_V7_WORKER_HEALTH_FILE:path.join(control,"worker-health.json")};
});
afterEach(()=>{vi.restoreAllMocks();process.env={...original};chmodSync(fixture,0o700);rmSync(fixture,{recursive:true,force:true});});

describe("explicit local compiled decision preview",()=>{
  it("accepts only the explicit current-user, same-directory active loopback preview",()=>{
    expect(readLocalDecisionPreviewV7()).toEqual({releaseDirectory:release,activeLink:current,healthFile:path.join(control,"worker-health.json"),origin:"http://127.0.0.1:3172"});
    expect(isActiveDecisionReleaseV7()).toBe(true);
  });
  it.each([undefined,"","0","true"])("does not activate a local production directory with flag %s",flag=>{
    if(flag===undefined)delete process.env.SAITU_V7_LOCAL_PREVIEW;else process.env.SAITU_V7_LOCAL_PREVIEW=flag;
    expect(readLocalDecisionPreviewV7()).toBeNull();expect(isActiveDecisionReleaseV7()).toBe(false);
  });
  it.each(["https://example.com","http://user@localhost:3172","http://localhost:3172/path","http://localhost:3172/?x=1"])("rejects nonlocal or ambiguous application origin %s",origin=>{
    process.env.NEXT_PUBLIC_SITE_URL=origin;expect(isActiveDecisionReleaseV7()).toBe(false);
  });
  it.each(["postgresql://synthetic@example.com/synthetic","postgresql://synthetic@127.0.0.1:5544/synthetic","postgresql://synthetic@localhost/synthetic?host=example.com","postgresql://synthetic@localhost/"])("rejects database endpoint %s",database=>{
    process.env.DATABASE_URL=database;expect(isActiveDecisionReleaseV7()).toBe(false);
  });
  it("denies root and a different user",()=>{
    const uid=process.getuid!(),uidMock=vi.spyOn(process as {getuid:()=>number},"getuid");uidMock.mockReturnValue(0);expect(isActiveDecisionReleaseV7()).toBe(false);
    uidMock.mockReturnValue(uid+1);expect(isActiveDecisionReleaseV7()).toBe(false);
  });
  it("rejects a writable release, control directory or ancestor",()=>{
    for(const directory of [release,control,fixture]){chmodSync(directory,0o777);expect(isActiveDecisionReleaseV7()).toBe(false);chmodSync(directory,0o700);}
  });
  it("rejects a missing, ordinary or mismatched current link",()=>{
    unlinkSync(current);expect(isActiveDecisionReleaseV7()).toBe(false);
    writeFileSync(current,"ordinary");expect(isActiveDecisionReleaseV7()).toBe(false);
    unlinkSync(current);symlinkSync(control,current);expect(isActiveDecisionReleaseV7()).toBe(false);
  });
  it("rejects an alternate health path or current working directory",()=>{
    process.env.SAITU_V7_WORKER_HEALTH_FILE=path.join(fixture,"worker-health.json");expect(isActiveDecisionReleaseV7()).toBe(false);
    process.env.SAITU_V7_WORKER_HEALTH_FILE=path.join(control,"worker-health.json");vi.mocked(process.cwd).mockReturnValue(control);expect(isActiveDecisionReleaseV7()).toBe(false);
  });
  it("requires production for the explicit flag while preserving ordinary development behavior",()=>{
    process.env={...process.env,NODE_ENV:"development"};expect(isActiveDecisionReleaseV7()).toBe(false);
    delete process.env.SAITU_V7_LOCAL_PREVIEW;delete process.env.SAITU_V7_WORKER_ACTIVE_LINK;expect(isActiveDecisionReleaseV7()).toBe(true);
  });
});
